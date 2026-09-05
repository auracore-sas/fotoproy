import { and, asc, desc, eq, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { db } from './database';
import { photos, syncQueue } from './schema';
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

/* ------------------------------------------------------------------ */
/* Sync queue                                                          */
/* ------------------------------------------------------------------ */

export type QueueableEntityType = 'photo' | 'pin' | 'comment' | 'plan';
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

/** Auto-retry policy: exponential backoff, then give up until manual retry. */
export const MAX_SYNC_ATTEMPTS = 6;

/** Backoff delay in ms after `failures` consecutive failures. */
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
 * Records a failed attempt with exponential backoff. After MAX_SYNC_ATTEMPTS
 * the item stops being auto-retried (nextAttemptAt = null) until a manual
 * retry resets it.
 */
export async function markSyncFailed(
  queueId: string,
  message: string,
  failures: number,
): Promise<void> {
  const nextAttemptAt =
    failures >= MAX_SYNC_ATTEMPTS
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
