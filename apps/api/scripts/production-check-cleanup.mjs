/**
 * Removes an end-to-end check: deletes the test project through the API (which
 * cascades photos, shares, pins and comments) and its objects from the bucket.
 *
 * Usage:
 *   API=<base> FILE=<json> STORAGE_ENDPOINT=<url> STORAGE_BUCKET=<bucket> \
 *   STORAGE_ACCESS_KEY_ID=<key> STORAGE_SECRET_ACCESS_KEY=<secret> \
 *   node cleanup-deploy-check.mjs
 */
/* eslint-disable no-undef -- standalone Node CLI (not part of the TS codebase) */
import { readFileSync } from 'node:fs';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const file = process.env.FILE ?? 'production-check.json';
const data = JSON.parse(readFileSync(file, 'utf8'));
const api = process.env.API;

const login = await fetch(`${api}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: data.email, password: 'deploy-check-1234' }),
});
const { accessToken } = await login.json();
console.log(`login ${login.status}`);

const deleted = await fetch(`${api}/projects/${data.projectId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${accessToken}` },
});
console.log(`delete project ${deleted.status} (${data.projectId})`);

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.STORAGE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});
const keys = [
  data.photoKey,
  `thumbs/${data.orgId}/${data.photoId}.jpg`,
  `thumbs/${data.orgId}/${data.photoId}.webp`,
].filter(Boolean);
const removed = await s3.send(
  new DeleteObjectsCommand({
    Bucket: process.env.STORAGE_BUCKET,
    Delete: { Objects: keys.map((Key) => ({ Key })) },
  }),
);
console.log(`objects removed: ${(removed.Deleted ?? []).length}/${keys.length}`);

const share = await fetch(data.shareUrl);
console.log(`share link now: ${share.status} (404 = gone)`);
