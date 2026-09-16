import { and, asc, desc, eq, isNotNull, isNull, lte, ne, notInArray, or } from 'drizzle-orm';
import { db } from './database';
import {
  cachedProjects,
  photoComments,
  photoPins,
  photos,
  projectPlans,
  remotePhotos,
  syncQueue,
} from './schema';
import type { MediaKind, SyncStatus } from './schema';
import { generateId } from '../id';

/* ------------------------------------------------------------------ */
/* Photos (local-first capture)                                        */
/* ------------------------------------------------------------------ */

export interface NewLocalPhoto {
  id: string;
  projectId: string;
  kind?: MediaKind;
  durationMs?: number | null;
  userId?: string | null;
  localUri: string;
  thumbnailUri?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  notes?: string | null;
  capturedAt: string; // ISO UTC (device clock)
}

/** Persists a media item locally first — always succeeds, even offline. */
export async function createLocalPhoto(input: NewLocalPhoto): Promise<void> {
  await db.insert(photos).values({
    id: input.id,
    projectId: input.projectId,
    kind: input.kind ?? 'PHOTO',
    durationMs: input.durationMs ?? null,
    userId: input.userId ?? null,
    localUri: input.localUri,
    thumbnailUri: input.thumbnailUri ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    altitude: input.altitude ?? null,
    notes: input.notes ?? null,
    capturedAt: input.capturedAt,
    syncedAt: null,
    createdAt: new Date().toISOString(),
  });
}

export async function getLocalPhoto(id: string) {
  const rows = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listLocalPhotos(projectId: string) {
  return db
    .select()
    .from(photos)
    .where(eq(photos.projectId, projectId))
    .orderBy(desc(photos.capturedAt));
}
export async function listUnsyncedPhotos() {
  return db.select().from(photos).where(isNull(photos.syncedAt));
}

export async function markPhotoSynced(id: string, syncedAt: string): Promise<void> {
  await db.update(photos).set({ syncedAt }).where(eq(photos.id, id));
}

/**
 * Sets/clears the optional note of a LOCAL photo that has not synced yet.
 * The sync engine reads the row at upload time, so the note travels with the
 * next POST /photos. Synced photos are append-only (no edits).
 */
export async function updateLocalPhotoNotes(id: string, notes: string | null): Promise<void> {
  await db.update(photos).set({ notes }).where(eq(photos.id, id));
}

/* ------------------------------------------------------------------ */
/* Sync queue                                                          */
/* ------------------------------------------------------------------ */

export type QueueableEntityType = 'photo' | 'pin' | 'pin_remove' | 'comment' | 'plan';
export interface SyncQueueItem {
  id: string;
  entityType: QueueableEntityType;
  entityId: string;
  payload: unknown;
  status: SyncStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/**
 * Backoff policy: exponential delay capped at 60 s. Transient failures retry
 * forever; permanent ones park the item until an explicit retry.
 */
export function backoffDelayMs(failures: number): number {
  return Math.min(1000 * 2 ** failures, 60_000);
}

/** Enqueues an append-only operation to be synced when connectivity returns. */
export async function enqueueSync(
  entityType: QueueableEntityType,
  entityId: string,
  payload: unknown,
): Promise<SyncQueueItem> {
  const item = {
    id: generateId(),
    entityType,
    entityId,
    payload: JSON.stringify(payload),
    status: 'PENDING' as const,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  await db.insert(syncQueue).values(item);
  return { ...item, payload };
}

/**
 * Next item to upload (FIFO by createdAt): pending items first, then failed
 * items whose backoff window has elapsed.
 */
export async function listNextPendingSync(limit = 20): Promise<SyncQueueItem[]> {
  const now = new Date().toISOString();
  const rows = await db
    .select()
    .from(syncQueue)
    .where(
      and(
        or(
          eq(syncQueue.status, 'PENDING'),
          and(
            eq(syncQueue.status, 'FAILED'),
            isNotNull(syncQueue.nextAttemptAt),
            lte(syncQueue.nextAttemptAt, now),
          ),
        ),
      ),
    )
    .orderBy(asc(syncQueue.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    entityType: row.entityType as QueueableEntityType,
    payload: JSON.parse(row.payload) as unknown,
  }));
}

/** Number of items waiting to be uploaded (pending, in-flight or failed). */
export async function countPendingSync(): Promise<number> {
  const rows = await db
    .select({ count: syncQueue.id })
    .from(syncQueue)
    .where(ne(syncQueue.status, 'DONE'));
  return rows.length;
}

/** Per-entity sync state map for UI badges (keyed by entity client uuid). */
export async function listQueueItemStates(): Promise<
  Array<{ entityId: string; status: SyncStatus }>
> {
  const rows = await db
    .select({ entityId: syncQueue.entityId, status: syncQueue.status })
    .from(syncQueue)
    .where(ne(syncQueue.status, 'DONE'));
  return rows.map((row) => ({ entityId: row.entityId, status: row.status }));
}

/** Marks an item as in-flight (upload started). */
export async function markSyncUploading(queueId: string): Promise<void> {
  await db.update(syncQueue).set({ status: 'UPLOADING' }).where(eq(syncQueue.id, queueId));
}

/**
 * Records a failed attempt with exponential backoff.
 *
 * Transient failures (no connectivity, 5xx) keep a retry timestamp forever
 * with a capped delay, so a long outage never parks the queue. Permanent
 * failures (invalid payload, forbidden…) set `nextAttemptAt = null`: they
 * only run again on an explicit “sync now”.
 */
export async function markSyncFailed(
  queueId: string,
  message: string,
  failures: number,
  permanent = false,
): Promise<void> {
  const nextAttemptAt = permanent
    ? null
    : new Date(Date.now() + backoffDelayMs(failures)).toISOString();
  await db
    .update(syncQueue)
    .set({ status: 'FAILED', attempts: failures, nextAttemptAt, lastError: message })
    .where(eq(syncQueue.id, queueId));
}

/** Removes the queue item after a successful sync (the server keeps the log). */
export async function completeSyncItem(queueId: string): Promise<void> {
  await db.delete(syncQueue).where(eq(syncQueue.id, queueId));
}

/** Drops a queue item that can never succeed (bad payload / unsupported). */
export async function dropSyncItem(queueId: string): Promise<void> {
  await db.delete(syncQueue).where(eq(syncQueue.id, queueId));
}

/**
 * Drops every pending operation of one entity (optionally of a single type).
 * Used when an offline action is undone before syncing: detaching a pin that
 * was created offline cancels its pending create instead of creating it and
 * removing it on the server.
 */
export async function dropQueuedEntityOps(
  entityId: string,
  entityType?: QueueableEntityType,
): Promise<void> {
  await db
    .delete(syncQueue)
    .where(
      entityType
        ? and(eq(syncQueue.entityId, entityId), eq(syncQueue.entityType, entityType))
        : eq(syncQueue.entityId, entityId),
    );
}

/**
 * Resets items stuck in UPLOADING (e.g. the app was killed mid-upload) back
 * to PENDING so they are retried on the next run.
 */
export async function resetStaleUploading(): Promise<void> {
  await db.update(syncQueue).set({ status: 'PENDING' }).where(eq(syncQueue.status, 'UPLOADING'));
}

/** Resets failed items for an explicit “sync now” (clears attempts/backoff). */
export async function requeueFailed(): Promise<number> {
  const rows = await db
    .select({ id: syncQueue.id })
    .from(syncQueue)
    .where(eq(syncQueue.status, 'FAILED'));
  if (rows.length > 0) {
    await db
      .update(syncQueue)
      .set({ status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: null })
      .where(eq(syncQueue.status, 'FAILED'));
  }
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Photo pins (append-only local mirror + offline anchor, F3.3/F3.6)   */
/* ------------------------------------------------------------------ */

export interface LocalPin {
  id: string;
  planId: string;
  photoId: string;
  pageNumber: number;
  xPercentage: number;
  yPercentage: number;
  createdAt: string;
  syncedAt: string | null;
  /** Set when the anchor was detached (soft-remove; the photo is kept). */
  removedAt?: string | null;
}

/** Persists a pin locally first — always succeeds, even offline. */
export async function createLocalPin(
  input: Omit<LocalPin, 'syncedAt' | 'createdAt'>,
): Promise<void> {
  await db.insert(photoPins).values({
    ...input,
    createdAt: new Date().toISOString(),
    syncedAt: null,
  });
}

export async function getLocalPin(id: string): Promise<LocalPin | null> {
  const rows = await db.select().from(photoPins).where(eq(photoPins.id, id)).limit(1);
  return (rows[0] as unknown as LocalPin | undefined) ?? null;
}

/** Pins anchored on a plan (synced + pending), oldest first. Detached ones are hidden. */
export async function listLocalPins(planId: string): Promise<LocalPin[]> {
  const rows = await db
    .select()
    .from(photoPins)
    .where(and(eq(photoPins.planId, planId), isNull(photoPins.removedAt)))
    .orderBy(asc(photoPins.createdAt));
  return rows as unknown as LocalPin[];
}

export async function markPinSynced(id: string, syncedAt: string): Promise<void> {
  await db.update(photoPins).set({ syncedAt }).where(eq(photoPins.id, id));
}

/**
 * Detaches a pin locally (soft-remove). The evidence photo stays untouched and
 * the pin disappears from the plan immediately, even offline; the queued
 * `pin_remove` entry syncs the change when there is connectivity.
 */
export async function removeLocalPin(id: string): Promise<void> {
  await db
    .update(photoPins)
    .set({ removedAt: new Date().toISOString() })
    .where(eq(photoPins.id, id));
}

/* ------------------------------------------------------------------ */
/* Plans (offline cache, F3.2/F4.3)                                    */
/* ------------------------------------------------------------------ */

export interface LocalPlan {
  id: string;
  projectId: string;
  title: string;
  /** Local copy of the plan image (downloaded) — enables offline viewing. */
  localUri: string | null;
  remoteUrl: string | null;
  thumbnailUrl: string | null;
  pageCount: number;
  planKind: 'IMAGE' | 'PDF';
  createdAt: string;
  syncedAt: string | null;
}

/** Upserts a plan mirror. `localUri` is preserved when the input omits it. */
export async function upsertCachedPlan(plan: LocalPlan): Promise<void> {
  const existing = await getCachedPlan(plan.id);
  const localUri = plan.localUri ?? existing?.localUri ?? null;
  const values = { ...plan, localUri };
  await db
    .insert(projectPlans)
    .values(values)
    .onConflictDoUpdate({ target: projectPlans.id, set: values });
}

export async function getCachedPlan(id: string): Promise<LocalPlan | null> {
  const rows = await db.select().from(projectPlans).where(eq(projectPlans.id, id)).limit(1);
  return (rows[0] as unknown as LocalPlan | undefined) ?? null;
}

/** Cached plans of a project (offline fallback for the plans list). */
export async function listCachedPlans(projectId: string): Promise<LocalPlan[]> {
  const rows = await db
    .select()
    .from(projectPlans)
    .where(eq(projectPlans.projectId, projectId))
    .orderBy(desc(projectPlans.createdAt));
  return rows as unknown as LocalPlan[];
}

/** Stores the on-disk copy of a plan image. */
export async function setPlanLocalUri(id: string, localUri: string): Promise<void> {
  await db.update(projectPlans).set({ localUri }).where(eq(projectPlans.id, id));
}

/* ------------------------------------------------------------------ */
/* Photo comments (append-only local mirror, F3.5/F3.6)                */
/* ------------------------------------------------------------------ */

export interface LocalComment {
  id: string;
  photoId: string;
  body: string;
  createdAt: string;
  syncedAt: string | null;
}

/** Persists a comment locally first — always succeeds, even offline. */
export async function createLocalComment(
  input: Omit<LocalComment, 'syncedAt' | 'createdAt'>,
): Promise<void> {
  await db.insert(photoComments).values({
    ...input,
    createdAt: new Date().toISOString(),
    syncedAt: null,
  });
}

export async function getLocalComment(id: string): Promise<LocalComment | null> {
  const rows = await db.select().from(photoComments).where(eq(photoComments.id, id)).limit(1);
  return (rows[0] as unknown as LocalComment | undefined) ?? null;
}

/** Comments stored on this device for a photo, oldest first. */
export async function listLocalComments(photoId: string): Promise<LocalComment[]> {
  const rows = await db
    .select()
    .from(photoComments)
    .where(eq(photoComments.photoId, photoId))
    .orderBy(asc(photoComments.createdAt));
  return rows as unknown as LocalComment[];
}

export async function markCommentSynced(id: string, syncedAt: string): Promise<void> {
  await db.update(photoComments).set({ syncedAt }).where(eq(photoComments.id, id));
}

/* ------------------------------------------------------------------ */
/* Cached projects (offline list + detail, F1.6/F2)                    */
/* ------------------------------------------------------------------ */

export interface CachedProjectRow {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  description: string | null;
  organizationId: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string | null;
  updatedAt: string;
}

/** Server DTO shape (updatedAt is stamped locally on write). */
export type CachedProjectInput = Omit<CachedProjectRow, 'updatedAt'>;

/** Writes (or refreshes) the last known server shape of a project. */
export async function upsertCachedProject(project: CachedProjectInput): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db
    .insert(cachedProjects)
    .values({ ...project, updatedAt })
    .onConflictDoUpdate({
      target: cachedProjects.id,
      set: {
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        description: project.description,
        organizationId: project.organizationId,
        latitude: project.latitude,
        longitude: project.longitude,
        createdAt: project.createdAt,
        updatedAt,
      },
    });
}

/** Upserts a whole page/collection (called after every successful fetch). */
export async function replaceCachedProjects(projects: CachedProjectInput[]): Promise<void> {
  for (const project of projects) {
    await upsertCachedProject(project);
  }
}

/** Cached projects, most recently seen first. */
export async function listCachedProjects(): Promise<CachedProjectRow[]> {
  const rows = await db.select().from(cachedProjects).orderBy(desc(cachedProjects.updatedAt));
  return rows as unknown as CachedProjectRow[];
}

/** One cached project (detail screen fallback when offline). */
export async function getCachedProject(id: string): Promise<CachedProjectRow | null> {
  const rows = await db.select().from(cachedProjects).where(eq(cachedProjects.id, id)).limit(1);
  return (rows[0] as unknown as CachedProjectRow | undefined) ?? null;
}

/* ------------------------------------------------------------------ */
/* Remote photos cache (online gallery / F2.8)                         */
/* ------------------------------------------------------------------ */

export interface RemotePhotoCacheRow {
  id: string;
  projectId: string;
  kind: MediaKind;
  durationMs: number | null;
  imageUrl: string | null;
  thumbLocalUri: string | null;
  authorUserId: string | null;
  capturedAt: string;
  syncedAt: string;
  cachedAt: string;
}

/** Upserts one server photo into the remote cache. */
export async function upsertRemotePhoto(row: Omit<RemotePhotoCacheRow, 'cachedAt'>): Promise<void> {
  const cachedAt = new Date().toISOString();
  await db
    .insert(remotePhotos)
    .values({ ...row, cachedAt })
    .onConflictDoUpdate({
      target: remotePhotos.id,
      set: {
        kind: row.kind,
        durationMs: row.durationMs,
        imageUrl: row.imageUrl,
        thumbLocalUri: row.thumbLocalUri,
        authorUserId: row.authorUserId,
        capturedAt: row.capturedAt,
        syncedAt: row.syncedAt,
        cachedAt,
      },
    });
}

/** Cache rows of a project, newest first. */
export async function listRemotePhotos(projectId: string): Promise<RemotePhotoCacheRow[]> {
  const rows = await db
    .select()
    .from(remotePhotos)
    .where(eq(remotePhotos.projectId, projectId))
    .orderBy(desc(remotePhotos.capturedAt));
  return rows as unknown as RemotePhotoCacheRow[];
}

/** True when the project cache has a row (avoid re-downloading on focus). */
export async function hasRemotePhoto(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: remotePhotos.id })
    .from(remotePhotos)
    .where(eq(remotePhotos.id, id))
    .limit(1);
  return rows.length > 0;
}

/** Removes cache rows of the project that are no longer on the server. */
export async function pruneRemotePhotos(projectId: string, keepIds: string[]): Promise<void> {
  if (keepIds.length === 0) {
    await db.delete(remotePhotos).where(eq(remotePhotos.projectId, projectId));
    return;
  }
  await db
    .delete(remotePhotos)
    .where(and(eq(remotePhotos.projectId, projectId), notInArray(remotePhotos.id, keepIds)));
}
