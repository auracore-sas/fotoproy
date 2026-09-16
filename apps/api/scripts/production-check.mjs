/**
 * Throwaway end-to-end check against the production deployment.
 *
 * Creates a clearly labelled test organization, project, photo (uploaded through
 * the pre-signed URL the phone uses) and read-only share link, then prints what
 * it found. Cleanup is a separate step.
 *
 * Usage (from apps/api, so the workspace deps resolve):
 *   API=https://fotoproy.apx5.com node e2e-deploy-check.mjs
 */
/* eslint-disable no-undef -- standalone Node CLI (not part of the TS codebase) */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const API = process.env.API ?? 'https://fotoproy.apx5.com';
const TS = Date.now();
const ORG_NAME = `Deploy check ${TS}`;

const json = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
};

const post = async (path, body, token) => {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await json(response) };
};

const get = async (path, headers = {}) => {
  const response = await fetch(`${API}${path}`, { headers });
  return { status: response.status, response };
};

// 1. Organization + admin user ---------------------------------------------
const registered = await post('/auth/register', {
  email: `deploy-check-${TS}@test.local`,
  password: 'deploy-check-1234',
  fullName: 'Deploy Check',
  organizationName: ORG_NAME,
});
const token = registered.body.accessToken;
console.log(`register ${registered.status} · org ${registered.body.user?.organizationId}`);

// 2. Project ----------------------------------------------------------------
const project = await post(
  '/projects',
  {
    code: `CHECK-${TS}`,
    name: `Prueba de despliegue ${TS}`,
    description: 'Datos de prueba (se borran)',
  },
  token,
);
console.log(`project ${project.status} · ${project.body.id}`);

// 3. Pre-signed upload, exactly like the phone ------------------------------
const photoId = randomUUID();
const presign = await post(
  '/photos/presign',
  { id: photoId, projectId: project.body.id, contentType: 'image/jpeg' },
  token,
);
console.log(`presign ${presign.status} · key ${presign.body.storageKey}`);
console.log(`       upload host ${new URL(presign.body.uploadUrl).host}`);

const svg = Buffer.from(
  `<svg width="1600" height="1200" xmlns="http://www.w3.org/2000/svg">
     <rect width="1600" height="1200" fill="#1e3a5f"/>
     <rect x="120" y="240" width="1360" height="720" fill="#e2e8f0"/>
     <rect x="120" y="240" width="1360" height="60" fill="#f59e0b"/>
     <rect x="260" y="420" width="420" height="380" fill="#94a3b8"/>
     <rect x="820" y="500" width="500" height="300" fill="#64748b"/>
     <text x="140" y="180" font-family="sans-serif" font-size="72" fill="#ffffff">FotoProy · prueba de despliegue</text>
     <text x="140" y="1050" font-family="sans-serif" font-size="52" fill="#cbd5e1">Avance de obra simulado</text>
   </svg>`,
);
const jpeg = await sharp(svg).jpeg({ quality: 82 }).toBuffer();
const upload = await fetch(presign.body.uploadUrl, {
  method: 'PUT',
  body: jpeg,
  headers: { 'Content-Type': 'image/jpeg' },
});
console.log(`upload ${upload.status} · ${jpeg.byteLength} bytes`);

// 4. Register the photo -----------------------------------------------------
const photo = await post(
  '/photos',
  {
    id: photoId,
    projectId: project.body.id,
    storageKey: presign.body.storageKey,
    latitude: -0.1807,
    longitude: -78.4678,
    notes: 'Foto de prueba del despliegue',
    capturedAt: new Date().toISOString(),
  },
  token,
);
console.log(`photo ${photo.status} · ${photo.body.id}`);

// 5. Wait for the server-side stamping + thumbnail -------------------------
let detail = null;
for (let attempt = 1; attempt <= 15; attempt += 1) {
  const result = await get(`/photos/${photoId}`, { Authorization: `Bearer ${token}` });
  detail = await json(result.response);
  if (detail.thumbnailUrl) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log(
  `thumbnail ${detail?.thumbnailUrl ? 'ready' : 'MISSING'} · key ${detail?.thumbnailStorageKey ?? '-'}`,
);

// 6. Read-only share link ---------------------------------------------------
const share = await post('/shares', { projectId: project.body.id, expiresInDays: 7 }, token);
console.log(`share ${share.status} · ${share.body.url}`);
console.log(`      status ${share.body.status} · expires ${share.body.expiresAt}`);
const shareToken = share.body.url.split('/s/')[1];

// 7. Public surface ---------------------------------------------------------
const page = await get(`/s/${shareToken}`, { Accept: 'text/html' });
const html = await page.response.text();
const thumb = await get(`/s/${shareToken}/media/${photoId}?size=thumb`);
const full = await get(`/s/${shareToken}/media/${photoId}?size=full`);
const payload = await get(`/s/${shareToken}`, { Accept: 'application/json' });
const payloadBody = await json(payload.response);
console.log(
  `page ${page.status} · ${html.length} bytes · img tag ${html.includes(`/s/${shareToken}/media/${photoId}`)}`,
);
console.log(
  `media thumb ${thumb.status} (${thumb.response.headers.get('content-type')}, ${thumb.response.headers.get('content-length')} bytes)`,
);
console.log(
  `media full  ${full.status} (${full.response.headers.get('content-type')}, ${full.response.headers.get('content-length')} bytes)`,
);
console.log(
  `json ${payload.status} · photos ${payloadBody.photos?.length} · pinned ${payloadBody.photos?.[0]?.pinned ?? '-'}`,
);

writeFileSync(
  'production-check.json',
  JSON.stringify(
    {
      orgId: registered.body.user?.organizationId,
      userId: registered.body.user?.id,
      projectId: project.body.id,
      photoId,
      photoKey: presign.body.storageKey,
      thumbnailKey: detail?.thumbnailStorageKey,
      shareId: share.body.id,
      shareUrl: share.body.url,
      shareToken,
      email: `deploy-check-${TS}@test.local`,
    },
    null,
    2,
  ),
);
console.log('\nwritten production-check.json');
