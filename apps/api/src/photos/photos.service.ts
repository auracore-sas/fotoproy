import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Photo as DbPhoto } from '@fotoproy/database';
import type {
  CreatePhotoInput,
  Page,
  PhotoListQuery,
  PresignPhotoUploadInput,
  PresignUploadResponse,
} from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  extensionForContentType,
  mediaStorageKey,
  thumbnailStorageKey,
} from '../storage/object-keys.js';
import { uploadLimitBytes } from '../common/upload-limits.js';
import { ThumbnailsService } from './thumbnails.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

/** Full media extension whitelist used to validate client storage keys. */
const ALLOWED_MEDIA_EXTS = ['jpg', 'png', 'webp', 'heic', 'mp4'];

export interface PhotoDto {
  id: string;
  projectId: string;
  userId: string | null;
  kind: 'PHOTO' | 'VIDEO';
  durationMs: number | null;
  /** Short-lived signed URL to the original media. */
  imageUrl: string;
  /** Short-lived signed URL to the WebP thumbnail (photos only). */
  thumbnailUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  notes: string | null;
  capturedAt: string;
  syncedAt: string;
}

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly thumbnails: ThumbnailsService,
  ) {}

  /** Org-scoped project lookup (404 on foreign/unknown projects). */
  private async requireProject(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  /**
   * F2.1 — Issues a pre-signed PUT URL for a new media object. The object key
   * is derived server-side from (organization, client id, content type) so a
   * client can never reference an object outside its own org.
   */
  async presignUpload(
    current: AuthedUser,
    input: PresignPhotoUploadInput,
  ): Promise<PresignUploadResponse> {
    await this.requireProject(current.organizationId, input.projectId);

    // F4.5 — reject an oversized upload before the client spends bandwidth on
    // it. The authoritative check happens in `create()` against the stored
    // object, because this size is client-declared.
    const kind = input.contentType === 'video/mp4' ? 'VIDEO' : 'PHOTO';
    const limit = uploadLimitBytes(kind);
    if (input.sizeBytes !== undefined && input.sizeBytes > limit) {
      throw new PayloadTooLargeException({
        code: 'UPLOAD_TOO_LARGE',
        message: `Upload exceeds the ${kind.toLowerCase()} limit`,
        limitBytes: limit,
        sizeBytes: input.sizeBytes,
      });
    }

    const ext = extensionForContentType(input.contentType);
    const storageKey = mediaStorageKey(current.organizationId, input.id, ext);
    const uploadUrl = await this.storage.presignPut(storageKey);
    return {
      storageKey,
      uploadUrl,
      contentType: input.contentType,
      expiresIn: this.storage.config.signedUrlTtl,
    };
  }

  /**
   * F2.2 — Registers a media item that the client already uploaded to storage.
   * Idempotent by client UUID: retries return the existing photo instead of
   * creating duplicates.
   */
  async create(current: AuthedUser, input: CreatePhotoInput): Promise<PhotoDto> {
    await this.requireProject(current.organizationId, input.projectId);

    const existing = await this.prisma.photo.findUnique({
      where: { id: input.id },
      include: { project: { select: { organizationId: true } } },
    });
    if (existing) {
      if (
        existing.project.organizationId === current.organizationId &&
        existing.storageKey === input.storageKey
      ) {
        // Same client retrying the same upload → idempotent success.
        return this.toDto(existing as DbPhoto);
      }
      throw new ConflictException('Photo id already exists');
    }

    const expectedKey = this.expectedMediaKey(current.organizationId, input.id, input.storageKey);
    if (input.storageKey !== expectedKey) {
      throw new ForbiddenException('storageKey does not match the pre-signed object');
    }
    if (
      input.thumbnailStorageKey &&
      input.thumbnailStorageKey !== thumbnailStorageKey(current.organizationId, input.id)
    ) {
      throw new ForbiddenException('thumbnailStorageKey does not match the pre-signed object');
    }
    if (input.kind === 'VIDEO' && input.durationMs === undefined) {
      throw new BadRequestException('durationMs is required for videos');
    }

    // F4.5 — the object must exist and fit the cap before the record is created:
    // otherwise a client could register media that was never uploaded (broken
    // galleries, empty thumbnails) or park arbitrarily large files in the bucket.
    const stored = await this.storage.headObject(input.storageKey);
    if (!stored) {
      throw new BadRequestException({
        code: 'UPLOAD_MISSING',
        message: 'The object was not found in storage; upload it before registering the media',
      });
    }
    const limit = uploadLimitBytes(input.kind);
    if (stored.contentLength > limit) {
      await this.storage.deleteObject(input.storageKey);
      throw new PayloadTooLargeException({
        code: 'UPLOAD_TOO_LARGE',
        message: `Stored object exceeds the ${input.kind.toLowerCase()} limit and was removed`,
        limitBytes: limit,
        sizeBytes: stored.contentLength,
      });
    }

    // The declared content type is only a promise: check what the client
    // actually stored, so a text file cannot be registered as a photo/video.
    const expectedPrefix = input.kind === 'VIDEO' ? 'video/' : 'image/';
    const storedType = stored.contentType ?? '';
    if (!storedType.startsWith(expectedPrefix)) {
      await this.storage.deleteObject(input.storageKey);
      throw new BadRequestException({
        code: 'UPLOAD_TYPE_MISMATCH',
        message: `Stored object is not a ${input.kind.toLowerCase()} (content type: ${storedType || 'unknown'})`,
      });
    }

    const photo = await this.prisma.photo.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        userId: current.userId,
        kind: input.kind,
        durationMs: input.durationMs ?? null,
        storageKey: input.storageKey,
        thumbnailStorageKey: input.thumbnailStorageKey ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        altitude: input.altitude ?? null,
        notes: input.notes ?? null,
        capturedAt: new Date(input.capturedAt),
      },
    });

    // Photos without a client-provided thumbnail get one generated server-side.
    if (photo.kind === 'PHOTO' && !photo.thumbnailStorageKey) {
      this.thumbnails.schedule(photo.id);
    }
    return this.toDto(photo);
  }

  /** Lists the org's photos of a project (paginated). */
  async list(current: AuthedUser, query: PhotoListQuery): Promise<Page<PhotoDto>> {
    await this.requireProject(current.organizationId, query.projectId);
    const where = {
      projectId: query.projectId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.planId ? { pins: { some: { planId: query.planId } } } : {}),
    };
    const [total, photos] = await this.prisma.$transaction([
      this.prisma.photo.count({ where }),
      this.prisma.photo.findMany({
        where,
        orderBy: { capturedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items = await Promise.all(photos.map((photo) => this.toDto(photo)));
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    };
  }

  /** Returns one photo of the caller's organization. */
  async findOne(current: AuthedUser, id: string): Promise<PhotoDto> {
    const photo = await this.prisma.photo.findFirst({
      where: { id, project: { organizationId: current.organizationId } },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return this.toDto(photo);
  }

  /**
   * Rebuilds the expected key for a client-supplied storage key and raises on
   * anything that is not `photos/{org}/{id}.{allowedExt}`.
   */
  private expectedMediaKey(organizationId: string, mediaId: string, storageKey: string): string {
    const dot = storageKey.lastIndexOf('.');
    const ext = dot >= 0 ? storageKey.slice(dot + 1).toLowerCase() : '';
    if (!ALLOWED_MEDIA_EXTS.includes(ext)) {
      throw new ForbiddenException('storageKey has an unsupported extension');
    }
    return mediaStorageKey(organizationId, mediaId, ext);
  }

  /** Maps a DB row to the API DTO with fresh short-lived read URLs. */
  private async toDto(photo: DbPhoto): Promise<PhotoDto> {
    const [imageUrl, thumbnailUrl] = await Promise.all([
      this.storage.presignGet(photo.storageKey),
      photo.thumbnailStorageKey ? this.storage.presignGet(photo.thumbnailStorageKey) : null,
    ]);
    return {
      id: photo.id,
      projectId: photo.projectId,
      userId: photo.userId,
      kind: photo.kind,
      durationMs: photo.durationMs,
      imageUrl,
      thumbnailUrl,
      latitude: photo.latitude === null ? null : Number(photo.latitude),
      longitude: photo.longitude === null ? null : Number(photo.longitude),
      altitude: photo.altitude === null ? null : Number(photo.altitude),
      notes: photo.notes,
      capturedAt: photo.capturedAt.toISOString(),
      syncedAt: photo.syncedAt.toISOString(),
    };
  }
}
