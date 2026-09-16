import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';

type Bucket = 'general' | 'public' | 'media';

/** Cached limits, resolved once at startup. */
interface Limits {
  enabled: boolean;
  windowMs: number;
  general: number;
  public: number;
  media: number;
  trustCfHeader: boolean;
}

const DEFAULTS = {
  general: 600,
  // A share page plus its payload is a handful of requests; the images travel
  // through the media bucket. 120/min leaves room for refreshes and several
  // viewers behind one office IP while still cutting off a flood.
  public: 120,
  media: 1200,
};

/** Public gallery pages load one proxy request per photo, hence the big media cap. */
function bucketFor(path: string): Bucket {
  if (!path.startsWith('/s/')) {
    return 'general';
  }
  if (/^\/s\/[^/]+\/media\//.test(path) || /^\/s\/[^/]+\/plan\/[^/]+\/media\//.test(path)) {
    return 'media';
  }
  return 'public';
}

/**
 * Global rate limiter (F4.5).
 *
 * Buckets: the authenticated API, the public share pages and payloads, and the
 * public media proxy. Public endpoints are the ones without authentication, so
 * they get much tighter limits — except the media proxy, which a single gallery
 * view can hit hundreds of times.
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(RateLimitGuard.name);
  private limits!: Limits;

  constructor(
    private readonly service: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const read = (key: string, fallback: number): number => {
      const value = Number(this.config.get<string>(key) ?? Number.NaN);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    this.limits = {
      enabled: (this.config.get<string>('RATE_LIMIT_ENABLED') ?? 'true') !== 'false',
      windowMs: read('RATE_LIMIT_WINDOW_SECONDS', 60) * 1000,
      general: read('RATE_LIMIT_MAX', DEFAULTS.general),
      public: read('RATE_LIMIT_PUBLIC_MAX', DEFAULTS.public),
      media: read('RATE_LIMIT_MEDIA_MAX', DEFAULTS.media),
      trustCfHeader: (this.config.get<string>('RATE_LIMIT_TRUST_CF_HEADER') ?? 'true') !== 'false',
    };
    if (!this.limits.enabled) {
      this.logger.warn('Rate limiting is disabled (RATE_LIMIT_ENABLED=false)');
      return;
    }
    this.logger.log(
      `Rate limiting per ${this.limits.windowMs / 1000}s → general ${this.limits.general} · ` +
        `public ${this.limits.public} · media ${this.limits.media}`,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.limits.enabled) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const path = request.path || '/';
    const bucket = bucketFor(path);
    const limit =
      bucket === 'media'
        ? this.limits.media
        : bucket === 'public'
          ? this.limits.public
          : this.limits.general;

    const identity = this.identity(request);
    const verdict = this.service.hit(`${bucket}:${identity}`, limit, this.limits.windowMs);

    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
    if (verdict.allowed) {
      return true;
    }

    response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        retryAfterSeconds: verdict.retryAfterSeconds,
      },
      429,
    );
  }

  /**
   * Behind Cloudflare the real visitor is `CF-Connecting-IP`; `req.ip` would be
   * the CDN edge and every visitor would share one bucket. The header is only
   * trusted when traffic is expected to come through the CDN
   * (RATE_LIMIT_TRUST_CF_HEADER=false when the origin is reachable directly).
   */
  private identity(request: Request): string {
    if (this.limits.trustCfHeader) {
      const header = request.headers['cf-connecting-ip'];
      const value = Array.isArray(header) ? header[0] : header;
      if (value) {
        return value.trim();
      }
    }
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }
}
