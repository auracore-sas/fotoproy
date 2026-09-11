/**
 * Base URL used to build public share links.
 *
 * `PUBLIC_BASE_URL` wins when defined (production: the real domain). In dev it
 * falls back to the incoming request, so a phone on the LAN gets a link that
 * opens from its own browser.
 */
export interface RequestLike {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim() || undefined;
}

export function resolvePublicBaseUrl(request: RequestLike, configured?: string): string {
  const fromEnv = configured?.trim().replace(/\/+$/, '');
  if (fromEnv) {
    return fromEnv;
  }
  const protocol = firstHeader(request.headers['x-forwarded-proto']) ?? request.protocol ?? 'http';
  const host =
    firstHeader(request.headers['x-forwarded-host']) ?? firstHeader(request.headers.host);
  return `${protocol}://${host ?? 'localhost:4100'}`;
}
