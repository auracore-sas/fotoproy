import { desc, eq, isNull } from 'drizzle-orm';
import { db } from './database';
import { photos, syncQueue } from './schema';
import type { SyncStatus } from './schema';
import { generateId } from '../id';

/* ------------------------------------------------------------------ */
/* Photos (local-first capture)                                        */
/* ------------------------------------------------------------------ */

export interface NewLocalPhoto {
  id: string;
  projectId: string;
  userId?: string | null;
  localUri: string;
  thumbnailUri?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  notes?: string | null;
  capturedAt: string; // ISO UTC (device clock)
}

/** Persists a photo locally first — always succeeds, even offline. */
export async function createLocalPhoto(input: NewLocalPhoto): Promise<void> {
  await db.insert(photos).values({
    id: input.id,
    projectId: input.projectId,
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
  createdAt: string;
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
    createdAt: new Date().toISOString(),
  };
  await db.insert(syncQueue).values(item);
  return { ...item, payload };
}

export async function listPendingSync(limit = 50): Promise<SyncQueueItem[]> {
  const rows = await db
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.status, 'PENDING'))
    .orderBy(desc(syncQueue.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    entityType: row.entityType as QueueableEntityType,
    payload: JSON.parse(row.payload) as unknown,
  }));
}

export async function countPendingSync(): Promise<number> {
  const rows = await db
    .select({ count: syncQueue.id })
    .from(syncQueue)
    .where(eq(syncQueue.status, 'PENDING'));
  return rows.length;
}

export async function updateSyncStatus(
  queueId: string,
  status: SyncStatus,
  attempts?: number,
): Promise<void> {
  if (status === 'DONE') {
    // Completed items are removed from the queue (append-only log is the server).
    await db.delete(syncQueue).where(eq(syncQueue.id, queueId));
    return;
  }
  const current = await db.select().from(syncQueue).where(eq(syncQueue.id, queueId)).limit(1);
  const row = current[0];
  if (!row) {
    return;
  }
  await db
    .update(syncQueue)
    .set({ status, attempts: attempts ?? row.attempts + 1 })
    .where(eq(syncQueue.id, queueId));
}
