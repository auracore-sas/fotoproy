/**
 * Verification of the F4.5 hardening against a running API.
 *
 * Checks: strict request bodies, upload size caps (pre-sign and commit), the
 * missing-object rejection, the stored content type, and EXIF stripping.
 *
 * The API must be running with a small photo cap so the oversized case is cheap:
 *   RATE_LIMIT_ENABLED=false UPLOAD_MAX_PHOTO_MB=1 pnpm dev:api
 *   pnpm check:hardening
 *
 * Only for development/staging: it creates a throwaway organization.
 */
/* eslint-disable no-undef -- standalone Node CLI (not part of the TS codebase) */
import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const API = process.env.API ?? 'http://localhost:4100';
const TS = Date.now();

const post = async (path, body, token, raw = false) => {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 120) };
  }
  return { status: response.status, body: parsed };
};

const results = [];
const check = (label, expected, actual) => {
  const ok = String(expected) === String(actual);
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${actual}${ok ? '' : ` (esperado ${expected})`}`);
};

// --- setup -----------------------------------------------------------------
const registered = await post('/auth/register', {
  email: `f45-${TS}@test.local`,
  password: 'secret123',
  fullName: 'F45 Tester',
  organizationName: `F45 Org ${TS}`,
});
const token = registered.body.accessToken;
const project = (await post('/projects', { code: `F45-${TS}`, name: `F45 ${TS}` }, token)).body;

// --- strict body -----------------------------------------------------------
const extra = await post(
  '/projects',
  { code: `F45X-${TS}`, name: 'Extra field', organizationId: 'spoofed' },
  token,
);
check('body con campo extra → 400', 400, extra.status);
check('mensaje de validación', true, /Validation failed/.test(extra.body.message ?? ''));

// --- pre-sign size cap ----------------------------------------------------
const tooBig = await post(
  '/photos/presign',
  {
    id: randomUUID(),
    projectId: project.id,
    contentType: 'image/jpeg',
    sizeBytes: 5 * 1024 * 1024,
  },
  token,
);
check('presign declarando 5 MB (límite 1 MB) → 413', 413, tooBig.status);
check('código UPLOAD_TOO_LARGE', 'UPLOAD_TOO_LARGE', tooBig.body.code);

// --- missing object at commit --------------------------------------------
const missingId = randomUUID();
const missingKey = (
  await post(
    '/photos/presign',
    { id: missingId, projectId: project.id, contentType: 'image/jpeg' },
    token,
  )
).body.storageKey;
const missing = await post(
  '/photos',
  {
    id: missingId,
    projectId: project.id,
    storageKey: missingKey,
    latitude: -0.18,
    longitude: -78.47,
    capturedAt: new Date().toISOString(),
  },
  token,
);
check('commit sin objeto subido → 400', 400, missing.status);
check('código UPLOAD_MISSING', 'UPLOAD_MISSING', missing.body.code);

// --- stored object over the cap ------------------------------------------
const bigId = randomUUID();
const bigKey = (
  await post(
    '/photos/presign',
    { id: bigId, projectId: project.id, contentType: 'image/jpeg' },
    token,
  )
).body.storageKey;
const bigUploadUrl = (
  await post(
    '/photos/presign',
    { id: bigId, projectId: project.id, contentType: 'image/jpeg' },
    token,
  )
).body.uploadUrl;
const bigBuffer = await sharp({
  create: {
    width: 3000,
    height: 2000,
    channels: 3,
    noise: { type: 'gaussian', mean: 128, sigma: 40 },
  },
})
  .jpeg({ quality: 95 })
  .toBuffer();
console.log(`   (imagen de prueba: ${(bigBuffer.byteLength / 1024).toFixed(0)} KB)`);
await fetch(bigUploadUrl, {
  method: 'PUT',
  body: bigBuffer,
  headers: { 'Content-Type': 'image/jpeg' },
});
const big = await post(
  '/photos',
  {
    id: bigId,
    projectId: project.id,
    storageKey: bigKey,
    latitude: -0.18,
    longitude: -78.47,
    capturedAt: new Date().toISOString(),
  },
  token,
);
check('commit de objeto sobre el límite → 413', 413, big.status);

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});
const leftover = await s3
  .send(new HeadObjectCommand({ Bucket: process.env.STORAGE_BUCKET ?? 'fotoproy', Key: bigKey }))
  .then(() => 'existe')
  .catch(() => 'eliminado');
check('objeto sobredimensionado eliminado del bucket', 'eliminado', leftover);

// --- stored object with the wrong content type ---------------------------
const fakeId = randomUUID();
const fake = (
  await post(
    '/photos/presign',
    { id: fakeId, projectId: project.id, contentType: 'image/jpeg' },
    token,
  )
).body;
await fetch(fake.uploadUrl, {
  method: 'PUT',
  body: Buffer.from('esto no es una foto'),
  headers: { 'Content-Type': 'text/plain' },
});
const fakeCommit = await post(
  '/photos',
  {
    id: fakeId,
    projectId: project.id,
    storageKey: fake.storageKey,
    latitude: -0.18,
    longitude: -78.47,
    capturedAt: new Date().toISOString(),
  },
  token,
);
check('objeto que no es una imagen → 400', 400, fakeCommit.status);
check('código UPLOAD_TYPE_MISMATCH', 'UPLOAD_TYPE_MISMATCH', fakeCommit.body.code);

// --- EXIF stripping -------------------------------------------------------
const exifPhotoId = randomUUID();
const exifPhoto = (
  await post(
    '/photos/presign',
    { id: exifPhotoId, projectId: project.id, contentType: 'image/jpeg' },
    token,
  )
).body;

const exifSource = await sharp({
  create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 60, b: 90 } },
})
  .withMetadata({
    exif: {
      IFD0: { Copyright: 'FotoProy F4.5 check', Software: 'leaky-camera' },
      GPS: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' },
    },
  })
  .jpeg({ quality: 80 })
  .toBuffer();
const sourceMeta = await sharp(exifSource).metadata();
console.log(
  `   (origen EXIF: ${sourceMeta.exif ? `${sourceMeta.exif.byteLength} bytes` : 'sin EXIF'})`,
);
await fetch(exifPhoto.uploadUrl, {
  method: 'PUT',
  body: exifSource,
  headers: { 'Content-Type': 'image/jpeg' },
});
const createdExif = await post(
  '/photos',
  {
    id: exifPhotoId,
    projectId: project.id,
    storageKey: exifPhoto.storageKey,
    latitude: -0.18,
    longitude: -78.47,
    notes: 'Prueba EXIF',
    capturedAt: new Date().toISOString(),
  },
  token,
);
check('foto con EXIF registrada', 201, createdExif.status);

// Wait for the processing pipeline (stamp + strip) to replace the object.
let stored;
for (let attempt = 0; attempt < 15; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const detail = await fetch(`${API}/photos/${exifPhotoId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (!detail.imageUrl) continue;
  const bytes = Buffer.from(await fetch(detail.imageUrl).then((r) => r.arrayBuffer()));
  const meta = await sharp(bytes).metadata();
  if (!meta.exif || attempt === 14) {
    stored = { meta, hasExif: Boolean(meta.exif), bytes: bytes.byteLength };
    break;
  }
  stored = { meta, hasExif: Boolean(meta.exif), bytes: bytes.byteLength };
}
check('EXIF eliminado del objeto almacenado', false, stored.hasExif);
check('JPEG re-codificado (no el original)', true, stored.bytes !== exifSource.byteLength);

console.log(`\nPASS=${results.filter(Boolean).length} FAIL=${results.filter((r) => !r).length}`);
