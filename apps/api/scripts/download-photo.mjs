#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node CLI (not part of the TS codebase) */
/**
 * Downloads a stored photo (original + thumbnail) from local MinIO / R2
 * through a fresh signed URL, straight from the database.
 *
 * Usage (from the repo root — loads apps/api/.env):
 *   pnpm photo:download <photoId> [outputDir]
 *
 * Example:
 *   pnpm photo:download 308b8073-9438-41af-8634-efb19df6510b /tmp/fotoproy-dl
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaClient } from '@fotoproy/database';

const [, , photoId, outDirArg] = process.argv;

if (!photoId) {
  console.error('Usage: pnpm photo:download <photoId> [outputDir]');
  process.exit(1);
}

const endpoint = process.env.STORAGE_ENDPOINT;
const bucket = process.env.STORAGE_BUCKET;
if (!endpoint || !bucket) {
  console.error('Missing STORAGE_* env vars (did you run from the repo root with --env-file?).');
  process.exit(1);
}

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  endpoint,
  forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});

async function download(key, targetFile) {
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 120,
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${key} → HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.writeFile(targetFile, bytes);
  return { targetFile, bytes: bytes.length };
}

try {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    include: { project: { select: { code: true } } },
  });
  if (!photo) {
    console.error(`Photo not found: ${photoId}`);
    process.exit(1);
  }

  const outDir = outDirArg ?? 'downloads';
  const original = await download(
    photo.storageKey,
    path.join(outDir, `${photo.project.code}-${photoId}.${photo.storageKey.split('.').pop()}`),
  );
  console.log(
    `Original (${photo.kind.toLowerCase()}): ${original.targetFile} (${original.bytes} bytes)`,
  );

  if (photo.thumbnailStorageKey) {
    const thumb = await download(
      photo.thumbnailStorageKey,
      path.join(outDir, `${photo.project.code}-${photoId}.thumb.jpg`),
    );
    console.log(`Thumbnail: ${thumb.targetFile} (${thumb.bytes} bytes)`);
  }

  console.log(
    `Meta: capturedAt=${photo.capturedAt.toISOString()} syncedAt=${photo.syncedAt.toISOString()}`,
  );
} finally {
  await prisma.$disconnect();
}
