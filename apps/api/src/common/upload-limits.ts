import { MAX_UPLOAD_BYTES, type MediaKind } from '@fotoproy/shared';

const MB = 1024 * 1024;

/** Reads a megabyte limit from the environment, falling back to the shared cap. */
function limitFromEnv(key: string, fallbackBytes: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw * MB) : fallbackBytes;
}

export type UploadKind = MediaKind | 'PLAN';

/**
 * Effective upload caps.
 *
 * The shared values are the contract with the mobile app (which can warn before
 * uploading); the environment variables let an operator tighten or raise them
 * without rebuilding — e.g. to match a CDN body limit.
 */
export function uploadLimitBytes(kind: UploadKind): number {
  switch (kind) {
    case 'PHOTO':
      return limitFromEnv('UPLOAD_MAX_PHOTO_MB', MAX_UPLOAD_BYTES.photo);
    case 'VIDEO':
      return limitFromEnv('UPLOAD_MAX_VIDEO_MB', MAX_UPLOAD_BYTES.video);
    case 'PLAN':
      return limitFromEnv('UPLOAD_MAX_PLAN_MB', MAX_UPLOAD_BYTES.plan);
  }
}
