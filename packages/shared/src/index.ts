/**
 * FotoProy — Shared domain (zod schemas + derived types).
 *
 * Single source of truth for contracts between `apps/mobile` and `apps/api`.
 * Field names use camelCase (TS convention). The DB schema (Prisma) is
 * independent and only informative with respect to the SPEC.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const USER_ROLES = ['ADMIN', 'SUPERVISOR', 'TECHNICIAN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PLAN_KINDS = ['IMAGE', 'PDF'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const MEDIA_KINDS = ['PHOTO', 'VIDEO'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Entity kinds that the local sync queue can process. */
export const SYNC_ENTITY_TYPES = ['photo', 'pin', 'comment', 'plan'] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export const SYNC_STATUSES = ['PENDING', 'UPLOADING', 'DONE', 'FAILED'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Common helpers                                                      */
/* ------------------------------------------------------------------ */

export const emailSchema = z.string().trim().toLowerCase().email('Invalid email').max(255);

/** Reasonable minimum password policy for the MVP (no exotic rules). */
export const passwordSchema = z.string().min(8, 'Minimum 8 characters').max(128);

export const fullNameSchema = z.string().trim().min(2, 'Name is required').max(255);

/** UUID v4 (clients generate their own IDs). */
export const uuidSchema = z
  .string()
  .uuid('Invalid ID')
  .describe('Client-generated UUID v4 (offline idempotency)');

export const latitudeSchema = z
  .number()
  .min(-90)
  .max(90)
  .nullable()
  .optional()
  .describe('Decimal latitude (WGS84). null when no permission/GPS');

export const longitudeSchema = z
  .number()
  .min(-180)
  .max(180)
  .nullable()
  .optional()
  .describe('Decimal longitude (WGS84). null when no permission/GPS');

/* ------------------------------------------------------------------ */
/* Auth & users                                                        */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  /** Legal name of the organization created together with the first ADMIN. */
  organizationName: z.string().trim().min(2, 'Organization name is required').max(255),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  /** Temporary password assigned by the organization ADMIN. */
  password: passwordSchema,
  fullName: fullNameSchema,
  role: z.enum(USER_ROLES).default('TECHNICIAN'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Short professional signature burned on photos (initials / nickname).
 * Optional: null/absent means “no signature set”.
 */
export const signatureSchema = z
  .string()
  .trim()
  .max(48, 'Signature too long (max 48 chars)')
  .nullable()
  .optional();
export type SignatureInput = z.infer<typeof signatureSchema>;

export const updateProfileSchema = z.object({
  fullName: fullNameSchema.optional(),
  signature: signatureSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: uuidSchema,
    email: emailSchema,
    fullName: z.string(),
    role: z.enum(USER_ROLES),
    organizationId: z.string().uuid(),
    organizationName: z.string(),
    /** Professional signature (initials/nickname) shown on photos. */
    signature: z.string().max(48).nullable(),
  }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export const createProjectSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(50),
  name: z.string().trim().min(2, 'Name is required').max(255),
  description: z.string().trim().max(2000).optional(),
  clientName: z.string().trim().max(255).optional(),
  /** Project center location (optional). */
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectSchema = createProjectSchema.extend({
  id: uuidSchema,
  organizationId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

/* ------------------------------------------------------------------ */
/* Project plans / site maps                                           */
/* ------------------------------------------------------------------ */

export const createPlanInputSchema = z.object({
  projectId: uuidSchema,
  title: z.string().trim().min(1).max(255),
  planKind: z.enum(PLAN_KINDS).default('IMAGE'),
  /** Object key already uploaded to R2 by the client (pre-signed upload). */
  storageKey: z.string().min(1),
  pageCount: z.number().int().min(1).max(500).default(1),
});
export type CreatePlanInput = z.infer<typeof createPlanInputSchema>;

export const planSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string(),
  fileUrl: z.string().url(),
  thumbnailUrl: z.string().url().nullable().optional(),
  pageCount: z.number().int(),
  planKind: z.enum(PLAN_KINDS),
  createdAt: z.string().datetime({ offset: true }),
});
export type Plan = z.infer<typeof planSchema>;

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

export const createPhotoInputSchema = z.object({
  /** Client UUID — enables idempotency when the mobile retries. */
  id: uuidSchema,
  projectId: uuidSchema,
  kind: z.enum(MEDIA_KINDS).default('PHOTO'),
  /** Video duration in milliseconds (only for kind VIDEO). */
  durationMs: z.number().int().min(0).optional(),
  storageKey: z.string().min(1, 'storageKey is required (object uploaded to R2)'),
  thumbnailStorageKey: z.string().optional(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  altitude: z.number().nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
  capturedAt: z.string().datetime(),
});
export type CreatePhotoInput = z.infer<typeof createPhotoInputSchema>;

export const photoSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  userId: z.string().uuid().nullable(),
  kind: z.enum(MEDIA_KINDS),
  durationMs: z.number().int().nullable(),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  altitude: z.number().nullable(),
  notes: z.string().nullable(),
  capturedAt: z.string().datetime(),
  syncedAt: z.string().datetime({ offset: true }),
});
export type Photo = z.infer<typeof photoSchema>;

export const photoListQuerySchema = z.object({
  projectId: uuidSchema,
  userId: z.string().uuid().optional(),
  planId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PhotoListQuery = z.infer<typeof photoListQuerySchema>;

/** MIME types the API accepts for direct (pre-signed) uploads. */
export const UPLOADABLE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
] as const;
export type UploadableMediaType = (typeof UPLOADABLE_MEDIA_TYPES)[number];

export const presignPhotoUploadSchema = z.object({
  /** Client UUID of the media item (also used as the object name). */
  id: uuidSchema,
  projectId: uuidSchema,
  contentType: z.enum(UPLOADABLE_MEDIA_TYPES),
});
export type PresignPhotoUploadInput = z.infer<typeof presignPhotoUploadSchema>;

export const presignUploadResponseSchema = z.object({
  /** Object key to send back in POST /photos. */
  storageKey: z.string(),
  /** HTTP PUT URL (pre-signed, expires). Upload the file bytes directly. */
  uploadUrl: z.string().url(),
  contentType: z.enum(UPLOADABLE_MEDIA_TYPES),
  /** Validity of uploadUrl in seconds. */
  expiresIn: z.number().int(),
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

/* ------------------------------------------------------------------ */
/* Pins (photo anchored over a plan)                                   */
/* ------------------------------------------------------------------ */

export const createPinInputSchema = z.object({
  id: uuidSchema,
  planId: uuidSchema,
  photoId: uuidSchema,
  pageNumber: z.number().int().min(1).default(1),
  /** Relative position 0.00 – 100.00 (%) within the page. */
  xPercentage: z.number().min(0).max(100),
  yPercentage: z.number().min(0).max(100),
});
export type CreatePinInput = z.infer<typeof createPinInputSchema>;

export const pinSchema = z.object({
  id: uuidSchema,
  planId: uuidSchema,
  photoId: uuidSchema,
  pageNumber: z.number().int(),
  xPercentage: z.number(),
  yPercentage: z.number(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Pin = z.infer<typeof pinSchema>;

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export const createCommentInputSchema = z.object({
  id: uuidSchema,
  photoId: uuidSchema,
  body: z.string().trim().min(1, 'Comment cannot be empty').max(2000),
});
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

export const commentSchema = z.object({
  id: uuidSchema,
  photoId: uuidSchema,
  userId: z.string().uuid().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Comment = z.infer<typeof commentSchema>;

/* ------------------------------------------------------------------ */
/* Sharing (read-only links)                                           */
/* ------------------------------------------------------------------ */

export const createShareInputSchema = z.object({
  projectId: uuidSchema,
  /** Validity in days (1–365). */
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type CreateShareInput = z.infer<typeof createShareInputSchema>;

/* ------------------------------------------------------------------ */
/* Generic page                                                        */
/* ------------------------------------------------------------------ */

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    hasMore: z.boolean(),
  });
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};
