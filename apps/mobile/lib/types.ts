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
  /** Expected object size; lets the API reject an oversized upload up front. */
  sizeBytes?: number;
}

/**
 * Upload caps, mirrored from `MAX_UPLOAD_BYTES` in `@fotoproy/shared`.
 *
 * The app checks the file size before uploading so the user gets an immediate,
 * actionable message instead of a rejection after the transfer. The API enforces
 * the same caps (and can be configured lower per environment), so this is a UX
 * shortcut, not the security boundary.
 */
export const MAX_UPLOAD_BYTES = {
  PHOTO: 25 * 1024 * 1024,
  VIDEO: 200 * 1024 * 1024,
} as const;

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

export type PlanKind = 'IMAGE' | 'PDF';

/** MIME types accepted for plan uploads — mirror of shared. */
export type UploadablePlanType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf';

export interface PresignPlanUploadPayload {
  id: string;
  projectId: string;
  contentType: UploadablePlanType;
}

export interface CreatePlanPayload {
  id?: string;
  projectId: string;
  title: string;
  planKind?: PlanKind;
  storageKey: string;
  pageCount?: number;
}

export interface Plan {
  id: string;
  projectId: string;
  title: string;
  planKind: PlanKind;
  pageCount: number;
  /** Short-lived signed URL to the plan file. */
  fileUrl: string;
  thumbnailUrl: string | null;
  createdAt: string;
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

export interface CreatePinPayload {
  id: string;
  planId: string;
  photoId: string;
  pageNumber?: number;
  xPercentage: number;
  yPercentage: number;
}

export interface PinPhotoSummary {
  id: string;
  kind: MediaKind;
  durationMs: number | null;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  thumbnailUrl: string | null;
  imageUrl: string;
}

export interface Pin {
  id: string;
  planId: string;
  photoId: string;
  pageNumber: number;
  xPercentage: number;
  yPercentage: number;
  createdAt: string;
  /** Soft-remove timestamp (pin detached from the plan; photo kept). */
  removedAt?: string | null;
  photo?: PinPhotoSummary;
}

export interface CreateCommentPayload {
  id: string;
  photoId: string;
  body: string;
}

export interface Comment {
  id: string;
  photoId: string;
  userId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/* F4.1 — read-only share links */

export type ShareStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ShareLink {
  id: string;
  projectId: string;
  status: ShareStatus;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdById: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  /** Full public link — only returned when the link is created. */
  url?: string;
}

export interface CreateSharePayload {
  projectId: string;
  /** Validity in days (1–365). */
  expiresInDays: number;
}
