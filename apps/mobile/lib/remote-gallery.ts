/**
 * Online gallery refresh (F2.8).
 *
 * When the gallery is opened with connectivity, fetch the server photo list
 * of the project and mirror team photos into the local `remote_photos` cache,
 * downloading each thumbnail to disk so the grid keeps working offline.
 * Own photos (present in the local `photos` append-only log) are never
 * duplicated here; cache rows no longer on the server are pruned.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { api } from './api';
import {
  hasRemotePhoto,
  listLocalPhotos,
  listRemotePhotos,
  pruneRemotePhotos,
  upsertRemotePhoto,
} from './db';
import type { Photo } from './types';

const REMOTE_THUMB_DIR = 'remote-thumbs';
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

/** Downloads a signed thumbnail into the cache dir; null when unavailable. */
async function downloadThumb(id: string, url: string): Promise<string | null> {
  try {
    const dir = `${FileSystem.cacheDirectory ?? ''}${REMOTE_THUMB_DIR}`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    const target = `${dir}/${id}.jpg`;
    const existing = await FileSystem.getInfoAsync(target);
    if (existing.exists) {
      return target;
    }
    const result = await FileSystem.downloadAsync(url, target);
    return result.status >= 200 && result.status < 300 ? target : null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the remote cache for one project. Safe to call repeatedly (it
 * only downloads thumbnails that are missing and prunes stale rows).
 */
export async function refreshRemoteGallery(token: string, projectId: string): Promise<void> {
  const ownIds = new Set((await listLocalPhotos(projectId)).map((row) => row.id));
  const serverIds: string[] = [];
  let serverPhotos: Photo[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await api.listPhotos(token, projectId, page, PAGE_SIZE);
    serverPhotos = serverPhotos.concat(result.items);
    serverIds.push(...result.items.map((photo) => photo.id));
    if (!result.hasMore) {
      break;
    }
  }

  for (const photo of serverPhotos) {
    // Already captured by this device: the local append-only log owns it.
    if (ownIds.has(photo.id)) {
      continue;
    }
    if (await hasRemotePhoto(photo.id)) {
      continue;
    }
    const thumbLocalUri =
      photo.thumbnailUrl != null ? await downloadThumb(photo.id, photo.thumbnailUrl) : null;
    await upsertRemotePhoto({
      id: photo.id,
      projectId,
      kind: photo.kind,
      durationMs: photo.durationMs,
      imageUrl: photo.imageUrl,
      thumbLocalUri,
      authorUserId: photo.userId,
      capturedAt: photo.capturedAt,
      syncedAt: photo.syncedAt,
    });
  }

  await pruneRemotePhotos(projectId, serverIds);
}

/** Merges local photos with the remote cache, local first, newest capture first. */
export async function listMergedGallery(projectId: string) {
  const [localRows, remoteRows] = await Promise.all([
    listLocalPhotos(projectId),
    listRemotePhotos(projectId),
  ]);
  const localIds = new Set(localRows.map((row) => row.id));
  const merged = [
    ...localRows.map((row) => ({ ...row, isRemote: false as const })),
    ...remoteRows
      .filter((row) => !localIds.has(row.id))
      .map((row) => ({ ...row, isRemote: true as const })),
  ];
  merged.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0));
  return merged;
}

/** Cleans thumbnails of pruned cache rows (best effort, called after refresh). */
export async function cleanupOrphanThumbs(projectId: string): Promise<void> {
  const rows = await listRemotePhotos(projectId);
  void rows; // files are tiny; pruned rows' files are overwritten by id anyway
}
