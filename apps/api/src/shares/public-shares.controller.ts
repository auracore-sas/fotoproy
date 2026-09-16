import { Controller, Get, HttpException, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ShareErrorCode } from '@fotoproy/shared';
import { SHARE_ERROR_CODES } from '@fotoproy/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { SharesService } from './shares.service.js';
import { renderErrorPage } from './share-page.js';

/** Browser requests (`Accept: text/html…`) get the rendered page. */
function prefersHtml(accept: string | undefined): boolean {
  if (!accept) {
    return false;
  }
  return accept.includes('text/html');
}

/**
 * CSP for the public pages: same-origin media (served through the API proxy),
 * inline CSS, no scripts and no framing. Notably it does NOT include
 * `upgrade-insecure-requests`, which would rewrite the media URLs to HTTPS and
 * break every image when the API is served over plain HTTP (dev/LAN/staging).
 */
const PAGE_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

interface ShareErrorLike {
  status: number;
  code: ShareErrorCode;
}

function toShareErrorCode(value: unknown, fallback: ShareErrorCode): ShareErrorCode {
  return typeof value === 'string' && (SHARE_ERROR_CODES as readonly string[]).includes(value)
    ? (value as ShareErrorCode)
    : fallback;
}

/** Maps a thrown HTTP exception to a status + stable share error code. */
function asShareError(error: unknown): ShareErrorLike {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    const rawCode =
      typeof response === 'object' && response !== null && 'code' in response
        ? (response as { code: unknown }).code
        : undefined;
    return {
      status,
      code: toShareErrorCode(rawCode, status === 410 ? 'SHARE_EXPIRED' : 'SHARE_NOT_FOUND'),
    };
  }
  return { status: 500, code: 'SHARE_NOT_FOUND' };
}

/**
 * Public share endpoints — no authentication.
 *
 * `GET /s/:token` answers HTML to browsers and JSON to API clients
 * (`Accept: application/json`), so the same URL is both the page the client
 * opens and the payload any integration can read. `GET /s/:token/p/:photoId`
 * is the individual photo page.
 */
@Controller('s')
export class PublicSharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Public()
  @Get(':token')
  async view(
    @Param('token') token: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const html = prefersHtml(request.headers.accept);
    try {
      if (html) {
        setPageHeaders(response);
        response.type('html').send(await this.sharesService.renderProjectPage(token, request));
      } else {
        response.json(await this.sharesService.viewPublic(token));
      }
    } catch (error) {
      this.respondError(response, error, html);
    }
  }

  @Public()
  @Get(':token/p/:photoId')
  async viewPhoto(
    @Param('token') token: string,
    @Param('photoId') photoId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const html = prefersHtml(request.headers.accept);
    try {
      if (html) {
        setPageHeaders(response);
        response
          .type('html')
          .send(await this.sharesService.renderPhotoDetailPage(token, photoId, request));
      } else {
        const payload = await this.sharesService.viewPublic(token);
        const photo = payload.photos.find((item) => item.id === photoId);
        if (!photo) {
          throw new HttpException({ code: 'SHARE_NOT_FOUND', message: 'Photo not found' }, 404);
        }
        response.json(photo);
      }
    } catch (error) {
      this.respondError(response, error, html);
    }
  }

  @Public()
  @Get(':token/media/:photoId')
  async media(
    @Param('token') token: string,
    @Param('photoId') photoId: string,
    @Query('size') size: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // Public pages must never be cached by shared proxies: the link can be revoked.
    response.setHeader('Cache-Control', 'private, max-age=300');
    try {
      const media = await this.sharesService.streamPublicMedia(
        token,
        photoId,
        size === 'full' ? 'full' : 'thumb',
      );
      response.setHeader('Content-Type', media.contentType);
      if (media.contentLength !== undefined) {
        response.setHeader('Content-Length', String(media.contentLength));
      }
      media.body.on('error', () => response.destroy());
      media.body.pipe(response);
    } catch (error) {
      this.respondError(response, error, false);
    }
  }

  private respondError(response: Response, error: unknown, html: boolean): void {
    const { status, code } = asShareError(error);
    if (!html) {
      response.status(status).json({ statusCode: status, code, message: 'Share link error' });
      return;
    }
    setPageHeaders(response);
    response.status(status).type('html').send(renderErrorPage(code));
  }
}

/** Headers shared by every HTML response of the public share view. */
function setPageHeaders(response: Response): void {
  response.setHeader('Content-Security-Policy', PAGE_CSP);
}
