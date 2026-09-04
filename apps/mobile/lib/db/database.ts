import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { MIGRATIONS } from './migrations';
import * as schema from './schema';

/** Single shared SQLite database for the whole app. */
export const sqlite = openDatabaseSync('fotoproy.db');

/** Typed Drizzle client bound to the local database. */
export const db = drizzle(sqlite, { schema });

export type LocalDb = typeof db;

/**
 * Applies pending local migrations (PRAGMA user_version based).
 * Call once at startup, before any repository is used.
 */
export async function initDatabase(): Promise<void> {
  const row = await sqlite.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue;
    }
    // Each migration runs atomically: a failure leaves user_version untouched.
    sqlite.execSync('BEGIN;');
    try {
      sqlite.execSync(migration.statements.join('\n'));
      sqlite.execSync(`PRAGMA user_version = ${migration.version};`);
      sqlite.execSync('COMMIT;');
      current = migration.version;
      console.log(`[db] applied local migration v${migration.version}`);
    } catch (error) {
      sqlite.execSync('ROLLBACK;');
      console.error('[db] migration failed', error);
      throw error;
    }
  }
}
