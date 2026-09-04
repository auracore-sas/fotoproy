import { randomUUID } from 'expo-crypto';

/** Generates a client UUID v4 (idempotency + offline-first ids). */
export function generateId(): string {
  return randomUUID();
}
