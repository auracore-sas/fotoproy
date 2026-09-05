import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Photo as DbPhoto } from '@fotoproy/database';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { thumbnailStorageKey } from '../storage/object-keys.js';

/**
 * Generates WebP thumbnails (≈480px) for confirmed photos and stores them in
 * the bucket under `thumbs/…`.
 *
 * MVP approach (no queue infrastructure yet):
 *  - `schedule()` fires an in-process, non-blocking job right after a photo
 *    row is created;
 *  - a periodic sweep retries rows that still lack a thumbnail (e.g. after a
 *    restart or a transient storage error).
 * Photos whose client already uploaded a thumbnail (thumbnailStorageKey set)
 * are skipped. Videos are skipped (sharp has no video decoder).
 */
@Injectable()
export class ThumbnailsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThumbnailsService.name);
  private readonly enabled: boolean;
  private readonly sweepIntervalMs = 5 * 60 * 1000;
  private timer?: NodeJS.Timeout;
  /** In-flight ids so the sweep never duplicates a running job. */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.enabled = (config.get<string>('STORAGE_GENERATE_THUMBS') ?? 'true') === 'true';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('Thumbnail generation is disabled (STORAGE_GENERATE_THUMBS=false)');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep().catch((error) =>
        this.logger.error(`Thumbnail sweep failed: ${(error as Error).message}`),
      );
    }, this.sweepIntervalMs);
    // Give the first sweep a head start (thumbnails created before boot).
    setTimeout(() => {
      void this.sweep().catch(() => undefined);
    }, 5_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Fire-and-forget thumbnail generation for a just-created photo. */
  schedule(photoId: string): void {
    if (!this.enabled) {
      return;
    }
    void this.process(photoId).catch((error) =>
      this.logger.error(`Thumbnail for ${photoId} failed: ${(error as Error).message}`),
    );
  }

  async process(photoId: string): Promise<void> {
    if (this.inflight.has(photoId)) {
      return;
    }
    this.inflight.add(photoId);
    try {
      const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
      if (!photo || photo.kind !== 'PHOTO' || photo.thumbnailStorageKey) {
        return;
      }
      const project = await this.prisma.project.findUnique({
        where: { id: photo.projectId },
        select: { organizationId: true },
      });
      if (!project) {
        return;
      }

      const original = await this.storage.getObject(photo.storageKey);
      const { default: sharp } = await import('sharp');
      const thumb = await sharp(original)
        .rotate() // honor EXIF orientation before stripping metadata
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true }) // JPEG: RN core <Image> can't decode WebP on iOS
        .toBuffer();

      const thumbKey = thumbnailStorageKey(project.organizationId, photo.id);
      await this.storage.putObject(thumbKey, thumb, 'image/jpeg');
      await this.prisma.photo.update({
        where: { id: photo.id },
        data: { thumbnailStorageKey: thumbKey },
      });
      this.logger.log(`Thumbnail ready for photo ${photoId}`);
    } finally {
      this.inflight.delete(photoId);
    }
  }

  /** Backfills photos that are missing a thumbnail (idempotent). */
  async sweep(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const missing = await this.prisma.photo.findMany({
      where: { kind: 'PHOTO', thumbnailStorageKey: null },
      select: { id: true },
      take: 50,
    });
    if (missing.length === 0) {
      return;
    }
    this.logger.log(`Thumbnail sweep: ${missing.length} photo(s) without thumbnail`);
    // Run serially to keep memory flat on big backfills.
    for (const { id } of missing) {
      await this.process(id).catch((error) =>
        this.logger.error(`Thumbnail for ${id} failed: ${(error as Error).message}`),
      );
    }
  }
}

export type { DbPhoto };
