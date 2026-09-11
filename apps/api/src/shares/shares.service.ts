import { randomUUID } from 'node:crypto';
import { GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Share as DbShare } from '@fotoproy/database';
import type {
  CreateShareInput,
  Share,
  ShareListQuery,
  SharedProjectPayload,
} from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { generateShareToken, hashShareToken, isPlausibleShareToken } from './share-token.js';
import { resolvePublicBaseUrl, type RequestLike } from './public-url.js';
import { renderPhotoPage, renderProjectPage } from './share-page.js';

/**
 * F4.1 — read-only share links.
 *
 * Private side (ADMIN/SUPERVISOR): create, list and revoke links of a project.
 * Public side (no auth): `GET /s/:token` resolves the link into a read-only
 * payload with freshly signed storage URLs.
 */
@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /** Creates a link with a fresh 256-bit token; the token is returned once. */
  async create(current: AuthedUser, input: CreateShareInput, request: RequestLike): Promise<Share> {
    await this.requireProject(current.organizationId, input.projectId);

    const token = generateShareToken();
    const share = await this.prisma.share.create({
      data: {
        id: randomUUID(),
        projectId: input.projectId,
        organizationId: current.organizationId,
        tokenHash: hashShareToken(token),
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
        createdById: current.userId,
      },
    });

    return this.toDto(share, this.linkFor(token, request));
  }

  /** Links of one project of the caller's organization (newest first). */
  async list(current: AuthedUser, query: ShareListQuery): Promise<Share[]> {
    await this.requireProject(current.organizationId, query.projectId);
    const shares = await this.prisma.share.findMany({
      where: { projectId: query.projectId, organizationId: current.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return shares.map((share) => this.toDto(share));
  }

  /** Revokes a link (idempotent: revoking twice keeps the first timestamp). */
  async revoke(current: AuthedUser, id: string): Promise<Share> {
    const share = await this.prisma.share.findFirst({
      where: { id, organizationId: current.organizationId },
    });
    if (!share) {
      throw new NotFoundException('Share link not found');
    }
    const revoked =
      share.revokedAt === null
        ? await this.prisma.share.update({ where: { id }, data: { revokedAt: new Date() } })
        : share;
    return this.toDto(revoked);
  }

  /**
   * Public read-only payload for `GET /s/:token`.
   *
   * 404 when the token does not exist (no distinction with other orgs, to make
   * enumeration useless) and 410 with a stable code when the link is revoked
   * or expired.
   */
  async viewPublic(token: string): Promise<SharedProjectPayload> {
    if (!isPlausibleShareToken(token)) {
      throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: 'Share link not found' });
    }

    const share = await this.prisma.share.findUnique({
      where: { tokenHash: hashShareToken(token) },
      include: {
        project: { include: { organization: { select: { legalName: true, tradeName: true } } } },
      },
    });
    if (!share) {
      throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: 'Share link not found' });
    }
    if (share.revokedAt !== null) {
      throw new GoneException({ code: 'SHARE_REVOKED', message: 'This share link was revoked' });
    }
    if (share.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({ code: 'SHARE_EXPIRED', message: 'This share link has expired' });
    }

    const photos = await this.prisma.photo.findMany({
      where: { projectId: share.projectId },
      orderBy: { capturedAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    });

    // Diagnostics only: never block (or fail) the public response on this.
    void this.prisma.share
      .update({
        where: { id: share.id },
        data: { lastAccessAt: new Date(), accessCount: { increment: 1 } },
      })
      .catch((error: unknown) => this.logger.warn(`Share access not recorded: ${String(error)}`));

    return {
      project: {
        name: share.project.name,
        description: share.project.description,
        clientName: share.project.clientName,
        organizationName:
          share.project.organization.tradeName ?? share.project.organization.legalName,
      },
      expiresAt: share.expiresAt.toISOString(),
      photos: await Promise.all(
        photos.map(async (photo) => ({
          id: photo.id,
          kind: photo.kind,
          durationMs: photo.durationMs,
          url: await this.storage.presignGet(photo.storageKey),
          thumbnailUrl: photo.thumbnailStorageKey
            ? await this.storage.presignGet(photo.thumbnailStorageKey)
            : null,
          authorName: photo.user?.fullName ?? null,
          notes: photo.notes,
          latitude: photo.latitude === null ? null : Number(photo.latitude),
          longitude: photo.longitude === null ? null : Number(photo.longitude),
          altitude: photo.altitude === null ? null : Number(photo.altitude),
          capturedAt: photo.capturedAt.toISOString(),
        })),
      ),
    };
  }

  /** F4.2 — HTML gallery rendered for browsers (`GET /s/:token`). */
  async renderProjectPage(token: string, request: RequestLike): Promise<string> {
    return renderProjectPage(await this.viewPublic(token), token, this.baseUrl(request));
  }

  /** F4.2 — HTML detail page of one photo of the shared project. */
  async renderPhotoDetailPage(
    token: string,
    photoId: string,
    request: RequestLike,
  ): Promise<string> {
    const payload = await this.viewPublic(token);
    const photo = payload.photos.find((item) => item.id === photoId);
    if (!photo) {
      throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: 'Photo not found' });
    }
    return renderPhotoPage(payload, photo, token, this.baseUrl(request));
  }

  /** Full public link built from the configured base URL (or the request). */
  private linkFor(token: string, request: RequestLike): string {
    return `${this.baseUrl(request)}/s/${token}`;
  }

  /** Base URL for links inside the public pages (absolute, shareable). */
  private baseUrl(request: RequestLike): string {
    return resolvePublicBaseUrl(request, this.config.get<string>('PUBLIC_BASE_URL'));
  }

  private async requireProject(organizationId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }

  private toDto(share: DbShare, url?: string): Share {
    return {
      id: share.id,
      projectId: share.projectId,
      status: this.statusOf(share),
      expiresAt: share.expiresAt.toISOString(),
      revokedAt: share.revokedAt?.toISOString() ?? null,
      createdAt: share.createdAt.toISOString(),
      createdById: share.createdById,
      lastAccessAt: share.lastAccessAt?.toISOString() ?? null,
      accessCount: share.accessCount,
      ...(url ? { url } : {}),
    };
  }

  private statusOf(share: DbShare): Share['status'] {
    if (share.revokedAt !== null) {
      return 'REVOKED';
    }
    return share.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : 'ACTIVE';
  }
}
