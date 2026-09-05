import type { MediaKind } from '@fotoproy/shared';

/**
 * Deterministic object keys inside the storage bucket.
 *
 * Layout (per organization, so one shared bucket can serve several orgs):
 *   photos/{orgId}/{photoId}.{ext}   → original media (photo or video)
 *   thumbs/{orgId}/{photoId}.webp    → server-generated photo thumbnail
 */

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
};

export function extensionForContentType(contentType: string): string {
  const ext = EXT_BY_CONTENT_TYPE[contentType];
  if (!ext) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  return ext;
}

export function mediaStorageKey(organizationId: string, mediaId: string, ext: string): string {
  return `photos/${organizationId}/${mediaId}.${ext}`;
}

export function thumbnailStorageKey(organizationId: string, mediaId: string): string {
  return `thumbs/${organizationId}/${mediaId}.webp`;
}

export type { MediaKind };
