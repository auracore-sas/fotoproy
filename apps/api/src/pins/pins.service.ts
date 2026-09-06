import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PhotoPin as DbPin } from '@fotoproy/database';
import type { CreatePinInput, PhotoPin } from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

/**
 * Pins: a photo anchored over a plan page at a relative position (x%, y%).
 * Append-only: a pin is created (client UUID) and never edited or moved;
 * repositioning means deleting/creating (future) — no write conflicts.
 */
@Injectable()
export class PinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** F3.3 — anchors an existing photo of the same project on a plan page. */
  async create(current: AuthedUser, input: CreatePinInput): Promise<PhotoPin> {
    // The plan must belong to the caller's organization.
    const plan = await this.prisma.projectPlan.findFirst({
      where: { id: input.planId, project: { organizationId: current.organizationId } },
      include: { project: { select: { id: true } } },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (input.pageNumber < 1 || input.pageNumber > plan.pageCount) {
      throw new BadRequestException(`pageNumber must be between 1 and ${plan.pageCount}`);
    }
    // The photo must belong to the caller's organization AND the same project.
    const photo = await this.prisma.photo.findFirst({
      where: { id: input.photoId, project: { organizationId: current.organizationId } },
      select: { id: true, projectId: true },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    if (photo.projectId !== plan.projectId) {
      throw new BadRequestException('Photo and plan must belong to the same project');
    }

    const existing = await this.prisma.photoPin.findUnique({
      where: { id: input.id },
      include: { plan: { include: { project: { select: { organizationId: true } } } } },
    });
    if (existing) {
      if (
        existing.plan.project.organizationId === current.organizationId &&
        existing.photoId === input.photoId
      ) {
        return this.toDto(existing as DbPin); // idempotent retry
      }
      throw new ConflictException('Pin id already exists');
    }

    const pin = await this.prisma.photoPin.create({
      data: {
        id: input.id,
        planId: input.planId,
        photoId: input.photoId,
        createdById: current.userId,
        pageNumber: input.pageNumber,
        xPercentage: input.xPercentage,
        yPercentage: input.yPercentage,
      },
    });
    return this.toDto(pin);
  }

  /** F3.4 — lists the pins of a plan with the anchored photo summary. */
  async listByPlan(current: AuthedUser, planId: string): Promise<PhotoPin[]> {
    const plan = await this.prisma.projectPlan.findFirst({
      where: { id: planId, project: { organizationId: current.organizationId } },
      select: { id: true },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const pins = await this.prisma.photoPin.findMany({
      where: { planId },
      include: { photo: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(pins.map((pin) => this.toDto(pin)));
  }

  private async toDto(pin: DbPin & { photo?: unknown }): Promise<PhotoPin> {
    const photo = pin.photo as
      | {
          id: string;
          kind: 'PHOTO' | 'VIDEO';
          durationMs: number | null;
          storageKey: string;
          thumbnailStorageKey: string | null;
          capturedAt: Date;
          latitude: unknown;
          longitude: unknown;
          notes: string | null;
        }
      | undefined;

    const [imageUrl, thumbnailUrl] = photo
      ? await Promise.all([
          this.storage.presignGet(photo.storageKey),
          photo.thumbnailStorageKey ? this.storage.presignGet(photo.thumbnailStorageKey) : null,
        ])
      : [null, null];

    return {
      id: pin.id,
      planId: pin.planId,
      photoId: pin.photoId,
      pageNumber: pin.pageNumber,
      xPercentage: Number(pin.xPercentage),
      yPercentage: Number(pin.yPercentage),
      createdAt: pin.createdAt.toISOString(),
      photo: photo
        ? {
            id: photo.id,
            kind: photo.kind,
            durationMs: photo.durationMs,
            capturedAt: photo.capturedAt.toISOString(),
            latitude: photo.latitude === null ? null : Number(photo.latitude),
            longitude: photo.longitude === null ? null : Number(photo.longitude),
            notes: photo.notes,
            thumbnailUrl,
            imageUrl: imageUrl as string,
          }
        : undefined,
    };
  }
}
