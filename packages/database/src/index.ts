/**
 * @fotoproy/database — re-exports the generated Prisma client.
 *
 * The API (apps/api) must ALWAYS consume this package (never @prisma/client
 * directly) so there is a single source for the client and its types.
 */
export * from '@prisma/client';
export { PrismaClient } from '@prisma/client';
