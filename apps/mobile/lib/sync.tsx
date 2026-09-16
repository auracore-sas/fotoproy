/**
 * Offline sync engine (F2.5–F2.7).
 *
 * Watches connectivity (NetInfo) and drains the local `sync_queue` FIFO:
 *   1. requests a pre-signed PUT URL for the media object;
 *   2. uploads the local file bytes straight to storage (no base64 in memory);
 *   3. registers the photo metadata with POST /photos (idempotent by client
 *      UUID) and marks the queue item done.
 *
 * Failures are retried automatically with exponential backoff (see
 * `markSyncFailed`); items that the server can never accept stay FAILED and
 * are only retried on an explicit “sync now”. The queue is the source of
 * truth for what is still pending, so the state survives app restarts.
 */
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import {
  completeSyncItem,
  countPendingSync,
  dropSyncItem,
  getLocalComment,
  getLocalPhoto,
  getLocalPin,
  listNextPendingSync,
  listQueueItemStates,
  markCommentSynced,
  markPhotoSynced,
  markPinSynced,
  markSyncFailed,
  markSyncUploading,
  requeueFailed,
  resetStaleUploading,
} from './db';
import type { SyncQueueItem } from './db';
import type { MediaKind, UploadableMediaType } from './types';

/** Per-entity sync state shown as badges on gallery tiles. */
export type ItemSyncState = 'PENDING' | 'UPLOADING' | 'FAILED';

export interface SyncSnapshot {
  /** Whether the device currently has connectivity. */
  online: boolean;
  /** True while at least one item is being uploaded. */
  syncing: boolean;
  /** Items waiting to be uploaded (pending + failed). */
  pendingCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** entityId (photo client uuid) → current queue state. */
  items: Record<string, ItemSyncState>;
}

const INITIAL_SNAPSHOT: SyncSnapshot = {
  online: false,
  syncing: false,
  pendingCount: 0,
  lastError: null,
  lastSyncedAt: null,
  items: {},
};

type ProcessOutcome = 'ok' | 'retry' | 'permanent' | 'auth';

/** Milliseconds between safety drains (picks up items whose backoff elapsed). */
const SAFETY_INTERVAL_MS = 15_000;

const contentTypes: Record<MediaKind, UploadableMediaType> = {
  PHOTO: 'image/jpeg',
  VIDEO: 'video/mp4',
};

function humanError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Error de conexión';
}

export class SyncEngine {
  private token: string | null = null;
  private readonly listeners = new Set<(snapshot: SyncSnapshot) => void>();
  private snapshotState: SyncSnapshot = INITIAL_SNAPSHOT;
  private netUnsubscribe: (() => void) | null = null;
  private safetyTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private draining = false;
  private wakeQueued = false;
  private authError = false;

  setSession(token: string | null): void {
    this.token = token;
  }

  /** Starts watching connectivity and processing the queue. Idempotent. */
  async start(): Promise<void> {
    this.running = true;
    this.authError = false;
    // Items stuck in UPLOADING (app killed mid-upload) become retryable.
    await resetStaleUploading();
    // Items parked by an earlier outage (or by the old give-up policy) get a
    // fresh chance on every app start — the queue is not a dead letter box.
    await requeueFailed();
    await this.refreshState();

    if (!this.netUnsubscribe) {
      this.netUnsubscribe = NetInfo.addEventListener((state) => {
        const online = state.isConnected !== false && state.isInternetReachable !== false;
        if (online !== this.snapshotState.online) {
          this.update({ online });
        }
        if (online) {
          void this.wake();
        }
      });
    }
    if (!this.safetyTimer) {
      this.safetyTimer = setInterval(() => {
        if (this.snapshotState.online && this.running) {
          void this.wake();
        }
      }, SAFETY_INTERVAL_MS);
    }
    // Initial connectivity probe + first drain.
    const state = await NetInfo.fetch();
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    this.update({ online });
    if (online) {
      void this.wake();
    }
  }

  /** Stops processing (e.g. on logout). Pending items survive in SQLite. */
  stop(): void {
    this.running = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.safetyTimer) {
      clearInterval(this.safetyTimer);
      this.safetyTimer = null;
    }
    this.netUnsubscribe?.();
    this.netUnsubscribe = null;
  }

  /** Explicit “sync now”: requeues failed items and drains immediately. */
  async syncNow(): Promise<void> {
    if (!this.token || !this.running) {
      return;
    }
    if (this.authError) {
      return;
    }
    await requeueFailed();
    await this.refreshState();
    await this.wake();
  }

  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SyncSnapshot {
    return this.snapshotState;
  }

  /** Requests a drain (new queue item, connectivity, timer…). */
  private wake(): Promise<void> {
    if (!this.running || !this.token || this.authError) {
      return Promise.resolve();
    }
    if (this.draining) {
      this.wakeQueued = true;
      return Promise.resolve();
    }
    return this.drain();
  }

  /** Processes queue items serially until the queue is empty or an error stops it. */
  private async drain(): Promise<void> {
    this.draining = true;
    this.wakeQueued = false;
    try {
      while (this.running && this.token && !this.authError) {
        const [item] = await listNextPendingSync(1);
        if (!item) {
          break;
        }
        const outcome = await this.process(item);
        if (outcome === 'retry' || outcome === 'auth') {
          break; // scheduleRetry (or pause) handles the next attempt.
        }
      }
    } finally {
      this.draining = false;
      if (this.wakeQueued && this.running) {
        void this.wake();
      }
    }
  }

  /** Uploads one queue item. Returns how the caller should continue. */
  private async process(item: SyncQueueItem): Promise<ProcessOutcome> {
    const entityId = item.entityId;
    try {
      const token = this.token!;

      if (item.entityType === 'pin') {
        return this.syncPin(item, token);
      }

      if (item.entityType === 'pin_remove') {
        return this.syncPinRemove(item, token);
      }

      if (item.entityType === 'comment') {
        return this.syncComment(item, token);
      }

      if (item.entityType !== 'photo') {
        // Comments arrive later — never silently retry them forever.
        await dropSyncItem(item.id);
        await this.refreshState();
        return 'ok';
      }

      const photo = await getLocalPhoto(entityId);
      if (!photo) {
        await dropSyncItem(item.id); // orphaned queue item (capture never finished)
        await this.refreshState();
        return 'ok';
      }

      const kind = photo.kind as MediaKind;
      const contentType = contentTypes[kind];

      // 1. pre-signed PUT URL for this media object.
      let presign;
      try {
        presign = await api.presignPhotoUpload(token, {
          id: photo.id,
          projectId: photo.projectId,
          contentType,
        });
      } catch (error) {
        return this.classifyApiError(item, error);
      }

      // 2. direct binary upload to storage (streamed by the native module).
      this.update({ syncing: true });
      await this.markItemUploading(item, entityId);
      let uploadStatus: number;
      try {
        const upload = await FileSystem.uploadAsync(presign.uploadUrl, photo.localUri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': contentType },
        });
        uploadStatus = upload.status;
      } catch (error) {
        const message = humanError(error);
        return this.failAndSchedule(item, message);
      }
      if (uploadStatus < 200 || uploadStatus >= 300) {
        return this.failAndSchedule(item, `Subida rechazada (HTTP ${uploadStatus})`);
      }

      // 3. register metadata (idempotent by client UUID).
      try {
        const created = await api.createPhoto(token, {
          id: photo.id,
          projectId: photo.projectId,
          kind,
          durationMs: photo.durationMs ?? undefined,
          storageKey: presign.storageKey,
          latitude: photo.latitude ?? null,
          longitude: photo.longitude ?? null,
          altitude: photo.altitude ?? null,
          notes: photo.notes ?? undefined,
          capturedAt: photo.capturedAt,
        });
        await markPhotoSynced(photo.id, created.syncedAt);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // The upload succeeded on a previous attempt but the response was
          // lost: confirm the photo exists and treat it as synced.
          try {
            const existing = await api.getPhoto(token, photo.id);
            await markPhotoSynced(photo.id, existing.syncedAt);
          } catch {
            return this.classifyApiError(item, error);
          }
        } else {
          return this.classifyApiError(item, error);
        }
      }

      await completeSyncItem(item.id);
      // A photo that just landed may unblock dependent comments/pins parked
      // while waiting for it (see `waitForPhotoUpload`).
      await requeueFailed();
      this.update({
        syncing: false,
        lastError: null,
        lastSyncedAt: new Date().toISOString(),
      });
      await this.refreshState();
      return 'ok';
    } catch (error) {
      return this.failAndSchedule(item, humanError(error));
    }
  }

  private async markItemUploading(item: SyncQueueItem, entityId: string): Promise<void> {
    await markSyncUploading(item.id);
    this.update({ items: { ...this.snapshotState.items, [entityId]: 'UPLOADING' } });
  }

  /**
   * True while a locally captured photo referenced by a comment/pin has not
   * reached the server yet. Posting the dependent entity before its photo
   * exists fails with 404, so the item waits with transient backoff instead.
   */
  private async waitForPhotoUpload(photoId: string): Promise<boolean> {
    const photo = await getLocalPhoto(photoId);
    return Boolean(photo && !photo.syncedAt);
  }

  /** Syncs one locally-written comment (F3.6): POST /comments, idempotent. */
  private async syncComment(item: SyncQueueItem, token: string): Promise<ProcessOutcome> {
    const comment = await getLocalComment(item.entityId);
    if (!comment) {
      await dropSyncItem(item.id); // orphaned queue item
      await this.refreshState();
      return 'ok';
    }
    if (await this.waitForPhotoUpload(comment.photoId)) {
      return this.failAndSchedule(item, 'Esperando a que la foto se suba');
    }
    this.update({ syncing: true });
    await this.markItemUploading(item, item.entityId);
    try {
      await api.createComment(token, {
        id: comment.id,
        photoId: comment.photoId,
        body: comment.body,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) {
        return this.classifyApiError(item, error, { photoDependent: true });
      }
      // 409 = already registered on a previous attempt → treat as synced.
    }
    await markCommentSynced(comment.id, new Date().toISOString());
    await completeSyncItem(item.id);
    this.update({ syncing: false, lastError: null, lastSyncedAt: new Date().toISOString() });
    await this.refreshState();
    return 'ok';
  }

  /** Syncs one locally-anchored pin (F3.6): POST /pins, idempotent by id. */
  private async syncPin(item: SyncQueueItem, token: string): Promise<ProcessOutcome> {
    const pin = await getLocalPin(item.entityId);
    if (!pin) {
      await dropSyncItem(item.id); // orphaned queue item
      await this.refreshState();
      return 'ok';
    }
    if (await this.waitForPhotoUpload(pin.photoId)) {
      return this.failAndSchedule(item, 'Esperando a que la foto se suba');
    }
    this.update({ syncing: true });
    await this.markItemUploading(item, item.entityId);
    try {
      await api.createPin(token, {
        id: pin.id,
        planId: pin.planId,
        photoId: pin.photoId,
        pageNumber: pin.pageNumber,
        xPercentage: pin.xPercentage,
        yPercentage: pin.yPercentage,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) {
        return this.classifyApiError(item, error, { photoDependent: true });
      }
      // 409 = already registered on a previous attempt → treat as synced.
    }
    await markPinSynced(pin.id, new Date().toISOString());
    await completeSyncItem(item.id);
    this.update({ syncing: false, lastError: null, lastSyncedAt: new Date().toISOString() });
    await this.refreshState();
    return 'ok';
  }

  /**
   * Detaches a pin on the server (soft-remove). A 404 means the pin never
   * reached the server (created and removed while offline) or was already
   * detached on another device — both are success for an idempotent remove.
   */
  private async syncPinRemove(item: SyncQueueItem, token: string): Promise<ProcessOutcome> {
    this.update({ syncing: true });
    await this.markItemUploading(item, item.entityId);
    try {
      await api.removePin(token, item.entityId);
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) {
        return this.classifyApiError(item, error);
      }
      // Already gone: nothing else to do.
    }
    await completeSyncItem(item.id);
    this.update({ syncing: false, lastError: null, lastSyncedAt: new Date().toISOString() });
    await this.refreshState();
    return 'ok';
  }

  /**
   * Classifies API errors: 401 → pause, network/5xx → retry forever with
   * backoff, 404 of a dependent entity → retry (its photo may still be on its
   * way), other 4xx → permanent failure (parked until an explicit retry).
   */
  private async classifyApiError(
    item: SyncQueueItem,
    error: unknown,
    options: { photoDependent?: boolean } = {},
  ): Promise<ProcessOutcome> {
    if (error instanceof ApiError && error.status === 401) {
      this.authError = true;
      this.update({
        syncing: false,
        lastError: 'Tu sesión expiró. Cierra sesión y vuelve a entrar para sincronizar.',
      });
      return 'auth';
    }
    const message = humanError(error);
    if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
      return this.failAndSchedule(item, message);
    }
    if (options.photoDependent && error instanceof ApiError && error.status === 404) {
      return this.failAndSchedule(item, message);
    }
    // Permanent validation/authorization failure: park until an explicit retry.
    await markSyncFailed(item.id, message, item.attempts + 1, true);
    this.update({ syncing: false, lastError: message });
    await this.refreshState();
    return 'permanent';
  }

  /** Marks the item failed with exponential backoff and schedules the retry. */
  private async failAndSchedule(item: SyncQueueItem, message: string): Promise<'retry'> {
    const failures = item.attempts + 1;
    await markSyncFailed(item.id, message, failures);
    this.update({ syncing: false, lastError: message });
    await this.refreshState();

    // Auto-retry after the backoff window (only while online).
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    const delay = Math.min(1000 * 2 ** failures, 60_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running && this.snapshotState.online && !this.authError) {
        void this.wake();
      }
    }, delay);
    return 'retry';
  }

  private async refreshState(): Promise<void> {
    const [count, rows] = await Promise.all([countPendingSync(), listQueueItemStates()]);
    const items: Record<string, ItemSyncState> = {};
    for (const row of rows) {
      items[row.entityId] = row.status === 'DONE' ? 'PENDING' : (row.status as ItemSyncState);
    }
    this.update({ pendingCount: count, items });
  }

  private update(partial: Partial<SyncSnapshot>): void {
    this.snapshotState = { ...this.snapshotState, ...partial };
    for (const listener of this.listeners) {
      listener(this.snapshotState);
    }
  }
}

/* ------------------------------------------------------------------ */
/* React provider + hook                                               */
/* ------------------------------------------------------------------ */

interface SyncContextValue extends SyncSnapshot {
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

/**
 * Bridges the singleton SyncEngine to React state. Must be rendered inside
 * the AuthProvider (the engine needs the current JWT).
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const engineRef = useRef<SyncEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new SyncEngine();
  }
  const engine = engineRef.current;
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() => engine.snapshot());

  // Mirror engine state changes into React state.
  useEffect(() => engine.subscribe(setSnapshot), [engine]);

  // Start/stop with the auth session.
  useEffect(() => {
    engine.setSession(token);
    if (token) {
      void engine.start();
    } else {
      engine.stop();
    }
  }, [engine, token]);

  const syncNow = useCallback(() => engine.syncNow(), [engine]);
  const value = useMemo(() => ({ ...snapshot, syncNow }), [snapshot, syncNow]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return ctx;
}
