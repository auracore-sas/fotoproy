import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

/**
 * Local mirror of the server entities + offline sync queue.
 * All timestamps are ISO 8601 UTC strings. Photos/pins/comments/plans are
 * append-only: rows are created locally with a client UUID and never edited.
 */

export const mediaKinds = ['PHOTO', 'VIDEO'] as const;
export type MediaKind = (typeof mediaKinds)[number];

export const photos = sqliteTable('photos', {
  id: text('id').primaryKey(), // client UUID v4
  projectId: text('project_id').notNull(),
  userId: text('user_id'), // owner (from the session), nullable while offline
  kind: text('kind', { enum: [...mediaKinds] })
    .notNull()
    .default('PHOTO'),
  durationMs: integer('duration_ms'), // video duration in ms (kind VIDEO)
  localUri: text('local_uri').notNull(), // local media file
  thumbnailUri: text('thumbnail_uri'), // local thumbnail file
  latitude: real('latitude'),
  longitude: real('longitude'),
  altitude: real('altitude'),
  notes: text('notes'),
  capturedAt: text('captured_at').notNull(), // device clock (may drift offline)
  syncedAt: text('synced_at'), // set once the server confirms the upload
  createdAt: text('created_at').notNull(),
});

export const photoPins = sqliteTable('photo_pins', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  photoId: text('photo_id').notNull(),
  pageNumber: integer('page_number').notNull().default(1),
  xPercentage: real('x_percentage').notNull(), // 0 – 100
  yPercentage: real('y_percentage').notNull(),
  createdAt: text('created_at').notNull(),
  syncedAt: text('synced_at'),
});

export const photoComments = sqliteTable('photo_comments', {
  id: text('id').primaryKey(),
  photoId: text('photo_id').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  syncedAt: text('synced_at'),
});

export const projectPlans = sqliteTable('project_plans', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  localUri: text('local_uri'), // uploaded plan file kept locally
  remoteUrl: text('remote_url'),
  thumbnailUrl: text('thumbnail_url'),
  pageCount: integer('page_count').notNull().default(1),
  planKind: text('plan_kind', { enum: ['IMAGE', 'PDF'] })
    .notNull()
    .default('IMAGE'),
  createdAt: text('created_at').notNull(),
  syncedAt: text('synced_at'),
});

/** Read-only cache of projects so the app can list them offline. */
export const cachedProjects = sqliteTable('cached_projects', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  clientName: text('client_name'),
  description: text('description'),
  organizationId: text('organization_id').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const syncStatuses = ['PENDING', 'UPLOADING', 'DONE', 'FAILED'] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export const syncQueue = sqliteTable('sync_queue', {
  id: text('id').primaryKey(), // queue item id (own uuid)
  entityType: text('entity_type').notNull(), // photo | pin | comment | plan
  entityId: text('entity_id').notNull(), // client uuid of the entity
  payload: text('payload').notNull(), // JSON body for the API
  status: text('status', { enum: [...syncStatuses] })
    .notNull()
    .default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').notNull(),
});
