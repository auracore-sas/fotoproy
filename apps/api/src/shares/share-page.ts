import type { SharedPhoto, SharedProjectPayload } from '@fotoproy/shared';
import type { ShareErrorCode } from '@fotoproy/shared';

/**
 * F4.2 — minimal server-rendered web view for share links.
 *
 * Plain HTML + inline CSS (no SPA, no build step): a browser hitting
 * `GET /s/:token` sees the project gallery instead of raw JSON. Every piece of
 * user data goes through `escapeHtml`.
 */

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F8FAFC; color: #0F172A;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  header { background: #1D4ED8; color: #fff; padding: 20px 16px; }
  header .org { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .85; }
  header h1 { margin: 6px 0 4px; font-size: 22px; line-height: 1.25; }
  header .meta { font-size: 13px; opacity: .9; }
  main { padding: 16px; max-width: 1100px; margin: 0 auto; }
  .description { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; font-size: 14px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .tile { display: block; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; }
  .tile img, .tile video { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #E2E8F0; }
  .tile .caption { padding: 8px 10px; font-size: 12px; color: #475569; }
  .empty { background: #fff; border: 1px dashed #CBD5E1; border-radius: 12px; padding: 28px 16px; text-align: center; color: #475569; }
  .back { display: inline-block; margin-bottom: 14px; font-size: 14px; color: #1D4ED8; text-decoration: none; }
  .photo { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; }
  .photo img, .photo video { display: block; width: 100%; max-height: 78vh; object-fit: contain; background: #0F172A; }
  dl { margin: 0; padding: 14px; display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 14px; }
  dt { color: #64748B; }
  dd { margin: 0; }
  footer { padding: 24px 16px 32px; text-align: center; color: #94A3B8; font-size: 12px; }
  .error { max-width: 520px; margin: 12vh auto; padding: 0 20px; text-align: center; }
  .error h1 { font-size: 20px; margin: 0 0 8px; }
  .error p { color: #475569; font-size: 14px; line-height: 1.5; }
`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
<footer>Compartido con FotoProy · documentación fotográfica de obra</footer>
</body>
</html>`;
}

/** Project gallery: thumbnails (with the burned evidence stamp) + captions. */
export function renderProjectPage(
  payload: SharedProjectPayload,
  token: string,
  baseUrl: string,
): string {
  const { project, photos, expiresAt } = payload;
  const tiles = photos
    .map((photo) => {
      // Media is proxied by the API (see `streamPublicMedia`): the bucket host
      // stays private and browsers cannot upgrade the request to HTTPS.
      const mediaUrl = `${baseUrl}/s/${token}/media/${photo.id}`;
      const media =
        photo.kind === 'VIDEO'
          ? `<video src="${escapeAttr(`${mediaUrl}?size=full`)}" poster="${escapeAttr(
              mediaUrl,
            )}" preload="none" muted playsinline></video>`
          : `<img src="${escapeAttr(mediaUrl)}" alt="${escapeAttr(
              `Foto del ${formatDateTime(photo.capturedAt)}`,
            )}" loading="lazy" />`;
      return `<a class="tile" href="${escapeAttr(`${baseUrl}/s/${token}/p/${photo.id}`)}">
  ${media}
  <span class="caption">${escapeHtml(formatDateTime(photo.capturedAt))}${
    photo.authorName ? ` · ${escapeHtml(photo.authorName)}` : ''
  }</span>
</a>`;
    })
    .join('\n');

  const body = `<header>
  <div class="org">${escapeHtml(project.organizationName)}</div>
  <h1>${escapeHtml(project.name)}</h1>
  <div class="meta">Avance de obra · ${photos.length} ${
    photos.length === 1 ? 'foto' : 'fotos'
  } · enlace válido hasta el ${escapeHtml(formatDateTime(expiresAt))}</div>
</header>
<main>
  ${project.description ? `<div class="description">${escapeHtml(project.description)}</div>` : ''}
  ${
    photos.length === 0
      ? '<div class="empty">Todavía no hay fotos publicadas en este proyecto.</div>'
      : `<div class="grid">\n${tiles}\n</div>`
  }
</main>`;

  return layout(`${project.name} — FotoProy`, body);
}

/** Single photo: full-size media + metadata. */
export function renderPhotoPage(
  payload: SharedProjectPayload,
  photo: SharedPhoto,
  token: string,
  baseUrl: string,
): string {
  const mediaUrl = `${baseUrl}/s/${token}/media/${photo.id}?size=full`;
  const media =
    photo.kind === 'VIDEO'
      ? `<video src="${escapeAttr(mediaUrl)}" controls playsinline></video>`
      : `<img src="${escapeAttr(mediaUrl)}" alt="${escapeAttr(
          `Foto del ${formatDateTime(photo.capturedAt)}`,
        )}" />`;

  const coordinates =
    photo.latitude !== null &&
    photo.latitude !== undefined &&
    photo.longitude !== null &&
    photo.longitude !== undefined
      ? `${photo.latitude.toFixed(6)}, ${photo.longitude.toFixed(6)}`
      : '—';

  const body = `<header>
  <div class="org">${escapeHtml(payload.project.organizationName)}</div>
  <h1>${escapeHtml(payload.project.name)}</h1>
  <div class="meta">Foto del ${escapeHtml(formatDateTime(photo.capturedAt))}</div>
</header>
<main>
  <a class="back" href="${escapeAttr(`${baseUrl}/s/${token}`)}">← Volver a todas las fotos</a>
  <div class="photo">
    ${media}
    <dl>
      <dt>Fecha</dt><dd>${escapeHtml(formatDateTime(photo.capturedAt))}</dd>
      <dt>Autor</dt><dd>${photo.authorName ? escapeHtml(photo.authorName) : '—'}</dd>
      <dt>Ubicación</dt><dd>${escapeHtml(coordinates)}</dd>
      <dt>Nota</dt><dd>${photo.notes ? escapeHtml(photo.notes) : '—'}</dd>
    </dl>
  </div>
</main>`;

  return layout(`${payload.project.name} — FotoProy`, body);
}

const ERROR_COPY: Record<ShareErrorCode, { title: string; message: string }> = {
  SHARE_NOT_FOUND: {
    title: 'Enlace no encontrado',
    message:
      'Este enlace no existe o fue reemplazado. Pide a quien te lo compartió que genere uno nuevo.',
  },
  SHARE_EXPIRED: {
    title: 'Enlace vencido',
    message: 'El enlace de este proyecto expiró. Pide uno nuevo para seguir viendo el avance.',
  },
  SHARE_REVOKED: {
    title: 'Enlace revocado',
    message: 'Quien lo compartió lo revocó, así que ya no muestra el proyecto.',
  },
};

/** Dead-link page (revoked, expired or unknown token). */
export function renderErrorPage(code: ShareErrorCode): string {
  const copy = ERROR_COPY[code];
  return layout(
    `${copy.title} — FotoProy`,
    `<div class="error">
  <h1>${escapeHtml(copy.title)}</h1>
  <p>${escapeHtml(copy.message)}</p>
</div>`,
  );
}
