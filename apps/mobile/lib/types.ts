/**
 * Local API types — mirror the DTOs defined in `@fotoproy/shared`.
 * (Metro/pnpm consumption of the shared workspace package will be formalized
 * later; until then these shapes are the contract used by the app.)
 */

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'TECHNICIAN';

export interface UserInfo {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  /** Short professional signature (initials/nickname) burned on photos. */
  signature: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: UserInfo;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  clientName: string | null;
  latitude: number | null;
  longitude: number | null;
  organizationId: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface CreateProjectPayload {
  code: string;
  name: string;
  description?: string;
  clientName?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export type MediaKind = 'PHOTO' | 'VIDEO';

/** MIME types accepted for direct (pre-signed) uploads — mirror of shared. */
export type UploadableMediaType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'video/mp4';

export interface PresignPhotoUploadPayload {
  /** Client UUID of the media item (also used as the object name). */
  id: string;
  projectId: string;
  contentType: UploadableMediaType;
}

export interface PresignUploadResponse {
  storageKey: string;
  uploadUrl: string;
  contentType: UploadableMediaType;
  expiresIn: number;
}

export interface CreatePhotoPayload {
  id: string;
  projectId: string;
  kind?: MediaKind;
  durationMs?: number;
  storageKey: string;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  notes?: string;
  capturedAt: string;
}

export interface Photo {
  id: string;
  projectId: string;
  userId: string | null;
  kind: MediaKind;
  durationMs: number | null;
  /** Short-lived signed URL to the original media (refresh when expired). */
  imageUrl: string;
  thumbnailUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  notes: string | null;
  capturedAt: string;
  syncedAt: string;
}
