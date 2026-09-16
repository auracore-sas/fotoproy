import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Photo as DbPhoto } from '@fotoproy/database';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { thumbnailStorageKey } from '../storage/object-keys.js';

/**
 * Post-processing for confirmed photos (sharp, inline async + periodic sweep):
 *
 *  1. OPTIONAL evidence stamp: burns a band with project code, capture time
 *     (UTC), GPS coordinates, author and note ONTO the stored original
 *     (STORAGE_STAMP_PHOTOS=true). The stamped JPEG overwrites the same
 *     object key so the whole team sees the same image.
 *  2. Thumbnail: always generates a ~480px JPEG under `thumbs/…` from the
 *     (possibly stamped) image — JPEG on purpose: RN's core <Image> cannot
 *     decode WebP on iOS.
 *
 * Videos are skipped (sharp has no video decoder). Rows whose client already
 * uploaded a thumbnail (thumbnailStorageKey set) are skipped too.
 */
@Injectable()
export class ThumbnailsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThumbnailsService.name);
  private readonly enabled: boolean;
  private readonly stampEnabled: boolean;
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
    this.stampEnabled = (config.get<string>('STORAGE_STAMP_PHOTOS') ?? 'true') === 'true';
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

  /** Fire-and-forget processing for a just-created photo. */
  schedule(photoId: string): void {
    if (!this.enabled) {
      return;
    }
    void this.process(photoId).catch((error) =>
      this.logger.error(`Processing for ${photoId} failed: ${(error as Error).message}`),
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
      const [project, author] = await Promise.all([
        this.prisma.project.findUnique({
          where: { id: photo.projectId },
          select: { organizationId: true, code: true },
        }),
        photo.userId
          ? this.prisma.user.findUnique({
              where: { id: photo.userId },
              select: { fullName: true, signature: true },
            })
          : null,
      ]);
      if (!project) {
        return;
      }

      const { default: sharp } = await import('sharp');
      const original = await this.storage.getObject(photo.storageKey);

      // Optional evidence stamp: oriented JPEG + top band, then the stored
      // original is replaced so local/remote and thumbnails stay consistent.
      let source = original;
      if (this.stampEnabled) {
        const oriented = await sharp(original)
          .rotate()
          .jpeg({ quality: 88, mozjpeg: true })
          .toBuffer();
        const { width } = await sharp(oriented).metadata();
        if (width && width > 0) {
          const signer =
            (author?.signature ?? '').trim() || (author?.fullName ?? '').trim() || null;
          const svg = buildStampSvg(width, photo, signer, project.code);
          source = await sharp(oriented)
            .composite([{ input: svg, top: 0, left: 0 }])
            .jpeg({ quality: 88, mozjpeg: true })
            .toBuffer();
          await this.storage.putObject(photo.storageKey, source, 'image/jpeg');
          this.logger.log(`Evidence stamp burned for photo ${photoId}`);
        }
      }

      const thumb = await sharp(source)
        .rotate()
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
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

/* ------------------------------------------------------------------ */
/* Evidence stamp (SVG rendered over the photo by sharp/libvips)       */
/* ------------------------------------------------------------------ */

const BAND_RATIO = 0.055; // band height vs image width
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Minimal XML escaping for SVG text nodes. */
function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortText(text: string | null, max: number): string {
  if (!text) {
    return '';
  }
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-09-05 13:20 UTC` — deterministic, timezone-free. */
function formatUtcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`
  );
}

function gpsText(photo: DbPhoto): string {
  const parts: string[] = [];
  if (photo.latitude != null && photo.longitude != null) {
    parts.push(`${Number(photo.latitude).toFixed(6)}, ${Number(photo.longitude).toFixed(6)}`);
  } else {
    parts.push('sin GPS');
  }
  if (photo.altitude != null) {
    parts.push(`${Math.round(Number(photo.altitude))} m`);
  }
  return `GPS ${parts.join(' · ')}`;
}

/** Builds the SVG band (top of the image) with the evidence text. */
export function buildStampSvg(
  width: number,
  photo: DbPhoto,
  authorName: string | null,
  projectCode: string,
): Buffer {
  const bandHeight = Math.round(clamp(width * BAND_RATIO, 96, 320));
  const fs1 = Math.round(bandHeight * 0.24); // project · datetime
  const fs2 = Math.round(bandHeight * 0.21); // GPS
  const fs3 = Math.round(bandHeight * 0.18); // author · note
  const padX = Math.round(bandHeight * 0.14);

  const line1 = xml(`${projectCode}  ·  ${formatUtcStamp(photo.capturedAt)}`);
  const line2 = xml(gpsText(photo));
  const line3 = xml(
    shortText([authorName, photo.notes].filter(Boolean).join(' · '), 160) || 'FotoProy',
  );

  // Font list on purpose: the container ships DejaVu and Liberation fonts (see
  // Dockerfile). Without an installed font librsvg draws placeholder boxes
  // instead of the stamp text.
  const font = "Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif";
  const svg =
    `<svg width="${width}" height="${bandHeight}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="rgba(0,0,0,0.60)"/>` +
    `<text x="${padX}" y="${Math.round(bandHeight * 0.42)}" fill="#ffffff" font-family="${font}" font-size="${fs1}" font-weight="bold">${line1}</text>` +
    `<text x="${padX}" y="${Math.round(bandHeight * 0.72)}" fill="#ffd23f" font-family="${font}" font-size="${fs2}">${line2}</text>` +
    `<text x="${padX}" y="${Math.round(bandHeight * 0.96)}" fill="#e8e8e8" font-family="${font}" font-size="${fs3}">${line3}</text>` +
    `</svg>`;
  return Buffer.from(svg);
}
