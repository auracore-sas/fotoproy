/**
 * Local DB migrations, versioned by PRAGMA user_version.
 *
 * Version 1 — initial mirror schema (photos, pins, comments, plans,
 * cached projects) + the offline sync queue.
 *
 * IMPORTANT: never edit an applied migration. Append a new entry with the
 * next version number instead.
 */
export interface LocalMigration {
  version: number;
  statements: string[];
}

export const MIGRATIONS: LocalMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        user_id TEXT,
        local_uri TEXT NOT NULL,
        thumbnail_uri TEXT,
        latitude REAL,
        longitude REAL,
        altitude REAL,
        notes TEXT,
        captured_at TEXT NOT NULL,
        synced_at TEXT,
        created_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS photo_pins (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL,
        photo_id TEXT NOT NULL,
        page_number INTEGER NOT NULL DEFAULT 1,
        x_percentage REAL NOT NULL,
        y_percentage REAL NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS photo_comments (
        id TEXT PRIMARY KEY NOT NULL,
        photo_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS project_plans (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        local_uri TEXT,
        remote_url TEXT,
        thumbnail_url TEXT,
        page_count INTEGER NOT NULL DEFAULT 1,
        plan_kind TEXT NOT NULL DEFAULT 'IMAGE',
        created_at TEXT NOT NULL,
        synced_at TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS cached_projects (
        id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        client_name TEXT,
        description TEXT,
        organization_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      // Sync queue lives in the same migration to keep the first release atomic.
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);`,
      `CREATE INDEX IF NOT EXISTS idx_pins_plan ON photo_pins(plan_id);`,
      `CREATE INDEX IF NOT EXISTS idx_comments_photo ON photo_comments(photo_id);`,
      `CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);`,
    ],
  },
  {
    // v2 — media kind support: photos can now be short videos.
    version: 2,
    statements: [
      `ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'PHOTO';`,
      `ALTER TABLE photos ADD COLUMN duration_ms INTEGER;`,
    ],
  },
];
