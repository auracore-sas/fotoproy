import { Directory, File, Paths } from 'expo-file-system';

const PHOTO_DIR = 'fotoproy';

/**
 * Copies a captured photo from the camera cache into the app documents
 * directory (persistent storage). Returns the destination URI.
 */
export async function persistCapturedPhoto(sourceUri: string, photoId: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  dir.create({ intermediates: true, idempotent: true });

  const source = new File(sourceUri);
  const destination = new File(dir, `${photoId}.jpg`);
  if (!destination.exists) {
    await source.copy(destination);
  }
  return destination.uri;
}

/** Returns the absolute URI for a stored photo id (existing or not). */
export function photoFileUri(photoId: string): string {
  return new File(new Directory(Paths.document, PHOTO_DIR), `${photoId}.jpg`).uri;
}
