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
  {
    // v3 — sync queue retry bookkeeping: exponential backoff scheduling and
    // the last error message (kept for the UI / diagnostics).
    version: 3,
    statements: [
      `ALTER TABLE sync_queue ADD COLUMN next_attempt_at TEXT;`,
      `ALTER TABLE sync_queue ADD COLUMN last_error TEXT;`,
    ],
  },
  {
    // v4 — online gallery cache: lightweight mirror of the server photo list
    // (photos captured by the rest of the team) with locally downloaded
    // thumbnails so they can be browsed offline.
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS remote_photos (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'PHOTO',
        duration_ms INTEGER,
        image_url TEXT,
        thumb_local_uri TEXT,
        author_user_id TEXT,
        captured_at TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_remote_photos_project ON remote_photos(project_id);`,
    ],
  },
  {
    // v5 — richer project cache: coordinates + createdAt so the project
    // detail screen works offline (same fields as the API DTO).
    version: 5,
    statements: [
      `ALTER TABLE cached_projects ADD COLUMN latitude REAL;`,
      `ALTER TABLE cached_projects ADD COLUMN longitude REAL;`,
      `ALTER TABLE cached_projects ADD COLUMN created_at TEXT;`,
    ],
  },
];
