import { Directory, File, Paths } from 'expo-file-system';

const MEDIA_DIR = 'fotoproy';

/**
 * Copies a captured media file (photo or video) from the camera cache into
 * the app documents directory (persistent storage). Returns the URI.
 */
export async function persistCapturedMedia(
  sourceUri: string,
  mediaId: string,
  extension = 'jpg',
): Promise<string> {
  const dir = new Directory(Paths.document, MEDIA_DIR);
  dir.create({ intermediates: true, idempotent: true });

  const source = new File(sourceUri);
  const destination = new File(dir, `${mediaId}.${extension}`);
  if (!destination.exists) {
    await source.copy(destination);
  }
  return destination.uri;
}

/** Copies a captured photo (jpg) — kept for convenience. */
export function persistCapturedPhoto(sourceUri: string, photoId: string): Promise<string> {
  return persistCapturedMedia(sourceUri, photoId, 'jpg');
}

/** Returns the absolute URI for a stored media id (existing or not). */
export function mediaFileUri(mediaId: string, extension = 'jpg'): string {
  return new File(new Directory(Paths.document, MEDIA_DIR), `${mediaId}.${extension}`).uri;
}
