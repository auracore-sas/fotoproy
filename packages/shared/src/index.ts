/**
 * FotoProy — Dominio compartido (zod schemas + tipos derivados).
 *
 * Fuente de la verdad de contratos entre `apps/mobile` y `apps/api`.
 * Los nombres de campos usan camelCase (convención TS). El esquema de BD
 * (Prisma) es independiente y solo informativo respecto a la SPEC.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const USER_ROLES = ['ADMIN', 'SUPERVISOR', 'TECHNICIAN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PLAN_KINDS = ['IMAGE', 'PDF'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** Nombres de entidades que la cola de sincronización local puede procesar. */
export const SYNC_ENTITY_TYPES = ['photo', 'pin', 'comment', 'plan'] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export const SYNC_STATUSES = ['PENDING', 'UPLOADING', 'DONE', 'FAILED'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Helpers comunes                                                     */
/* ------------------------------------------------------------------ */

export const emailSchema = z.string().trim().toLowerCase().email('Email inválido').max(255);

/** Contraseña mínima razonable para MVP (sin requisitos exóticos). */
export const passwordSchema = z.string().min(8, 'Mínimo 8 caracteres').max(128);

export const fullNameSchema = z.string().trim().min(2, 'Nombre requerido').max(255);

/** UUID v4 (los clientes generan sus propios IDs). */
export const uuidSchema = z
  .string()
  .uuid('ID inválido')
  .describe('UUID v4 generado por el cliente (idempotencia offline)');

export const latitudeSchema = z
  .number()
  .min(-90)
  .max(90)
  .nullable()
  .optional()
  .describe('Latitud decimal (WGS84). null si no hay permiso/GPS');

export const longitudeSchema = z
  .number()
  .min(-180)
  .max(180)
  .nullable()
  .optional()
  .describe('Longitud decimal (WGS84). null si no hay permiso/GPS');

/* ------------------------------------------------------------------ */
/* Auth y usuarios                                                     */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  /** Nombre legal de la organización que se crea junto con el primer ADMIN. */
  organizationName: z.string().trim().min(2, 'Nombre de organización requerido').max(255),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Contraseña requerida'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  /** Contraseña temporal asignada por el ADMIN de la organización. */
  password: passwordSchema,
  fullName: fullNameSchema,
  role: z.enum(USER_ROLES).default('TECHNICIAN'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: uuidSchema,
    email: emailSchema,
    fullName: z.string(),
    role: z.enum(USER_ROLES),
    organizationId: z.string().uuid(),
    organizationName: z.string(),
  }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/* ------------------------------------------------------------------ */
/* Proyectos                                                           */
/* ------------------------------------------------------------------ */

export const createProjectSchema = z.object({
  code: z.string().trim().min(1, 'Código requerido').max(50),
  name: z.string().trim().min(2, 'Nombre requerido').max(255),
  description: z.string().trim().max(2000).optional(),
  clientName: z.string().trim().max(255).optional(),
  /** Ubicación central del proyecto (opcional). */
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
/* Planos / mapas de obra                                              */
/* ------------------------------------------------------------------ */

export const createPlanInputSchema = z.object({
  projectId: uuidSchema,
  title: z.string().trim().min(1).max(255),
  planKind: z.enum(PLAN_KINDS).default('IMAGE'),
  /** Clave del objeto ya subido a R2 por el cliente (pre-signed upload). */
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
/* Fotos                                                               */
/* ------------------------------------------------------------------ */

export const createPhotoInputSchema = z.object({
  /** UUID de cliente — permite idempotencia si el móvil reintenta. */
  id: uuidSchema,
  projectId: uuidSchema,
  storageKey: z.string().min(1, 'storageKey requerido (objeto subido a R2)'),
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

/* ------------------------------------------------------------------ */
/* Pines (foto anclada sobre un plano)                                 */
/* ------------------------------------------------------------------ */

export const createPinInputSchema = z.object({
  id: uuidSchema,
  planId: uuidSchema,
  photoId: uuidSchema,
  pageNumber: z.number().int().min(1).default(1),
  /** Posición relativa 0.00 – 100.00 (%) dentro de la página. */
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
/* Comentarios                                                         */
/* ------------------------------------------------------------------ */

export const createCommentInputSchema = z.object({
  id: uuidSchema,
  photoId: uuidSchema,
  body: z.string().trim().min(1, 'Comentario vacío').max(2000),
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
/* Compartir (enlaces de solo lectura)                                 */
/* ------------------------------------------------------------------ */

export const createShareInputSchema = z.object({
  projectId: uuidSchema,
  /** Días de validez (1–365). */
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type CreateShareInput = z.infer<typeof createShareInputSchema>;

/* ------------------------------------------------------------------ */
/* Página genérica                                                     */
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
