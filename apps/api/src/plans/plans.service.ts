import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ProjectPlan as DbPlan } from '@fotoproy/database';
import type {
  CreatePlanInput,
  Page,
  PlanListQuery,
  PresignPlanUploadInput,
  PresignUploadResponse,
} from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  extensionForContentType,
  planStorageKey,
  thumbnailStorageKey,
} from '../storage/object-keys.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

const ALLOWED_PLAN_EXTS = ['jpg', 'png', 'webp', 'heic', 'pdf'];

export interface PlanDto {
  id: string;
  projectId: string;
  title: string;
  planKind: 'IMAGE' | 'PDF';
  pageCount: number;
  /** Short-lived signed URL to the uploaded plan file. */
  fileUrl: string;
  /** Short-lived signed URL to the JPEG thumbnail (IMAGE plans). */
  thumbnailUrl: string | null;
  createdAt: string;
}

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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

  /** F3.1 — pre-signed PUT URL for a new plan file. */
  async presignUpload(
    current: AuthedUser,
    input: PresignPlanUploadInput,
  ): Promise<PresignUploadResponse> {
    await this.requireProject(current.organizationId, input.projectId);
    const ext = extensionForContentType(input.contentType);
    const storageKey = planStorageKey(current.organizationId, input.id, ext);
    const uploadUrl = await this.storage.presignPut(storageKey);
    return {
      storageKey,
      uploadUrl,
      contentType: input.contentType,
      expiresIn: this.storage.config.signedUrlTtl,
    };
  }

  /** F3.1 — registers an uploaded plan (idempotent by client id). */
  async create(current: AuthedUser, input: CreatePlanInput): Promise<PlanDto> {
    await this.requireProject(current.organizationId, input.projectId);
    if (input.planKind === 'PDF' && input.pageCount < 1) {
      throw new BadRequestException('pageCount must be >= 1 for PDF plans');
    }

    const id = input.id;
    if (id) {
      const existing = await this.prisma.projectPlan.findUnique({
        where: { id },
        include: { project: { select: { organizationId: true } } },
      });
      if (existing) {
        if (
          existing.project.organizationId === current.organizationId &&
          existing.storageKey === input.storageKey
        ) {
          return this.toDto(existing as DbPlan); // idempotent retry
        }
        throw new ConflictException('Plan id already exists');
      }
    }

    const expectedKey = this.expectedKey(current.organizationId, input);
    if (input.storageKey !== expectedKey) {
      throw new ForbiddenException('storageKey does not match the pre-signed object');
    }

    const plan = await this.prisma.projectPlan.create({
      data: {
        ...(id ? { id } : {}),
        projectId: input.projectId,
        title: input.title,
        planKind: input.planKind,
        pageCount: input.pageCount,
        storageKey: input.storageKey,
      },
    });

    // IMAGE plans (single page) get a server-generated thumbnail (async).
    if (plan.planKind === 'IMAGE' && plan.pageCount === 1) {
      void this.generateThumbnail(plan.id).catch((error) =>
        this.logger.error(`Plan thumbnail for ${plan.id} failed: ${(error as Error).message}`),
      );
    }
    return this.toDto(plan);
  }

  /** Lists the org's plans of a project (paginated). */
  async list(current: AuthedUser, query: PlanListQuery): Promise<Page<PlanDto>> {
    await this.requireProject(current.organizationId, query.projectId);
    const where = { projectId: query.projectId };
    const [total, plans] = await this.prisma.$transaction([
      this.prisma.projectPlan.count({ where }),
      this.prisma.projectPlan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items = await Promise.all(plans.map((plan) => this.toDto(plan)));
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    };
  }

  /** Returns one plan of the caller's organization. */
  async findOne(current: AuthedUser, id: string): Promise<PlanDto> {
    const plan = await this.prisma.projectPlan.findFirst({
      where: { id, project: { organizationId: current.organizationId } },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return this.toDto(plan);
  }

  /** Async thumbnail for IMAGE plans (download → resize → upload). */
  private async generateThumbnail(planId: string): Promise<void> {
    const plan = await this.prisma.projectPlan.findUnique({
      where: { id: planId },
      include: { project: { select: { organizationId: true } } },
    });
    if (!plan || plan.thumbnailStorageKey || plan.planKind !== 'IMAGE') {
      return;
    }
    const buffer = await this.storage.getObject(plan.storageKey);
    const { default: sharp } = await import('sharp');
    const thumb = await sharp(buffer)
      .rotate()
      .resize({ width: 480, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    const key = thumbnailStorageKey(plan.project.organizationId, plan.id);
    await this.storage.putObject(key, thumb, 'image/jpeg');
    await this.prisma.projectPlan.update({
      where: { id: plan.id },
      data: { thumbnailStorageKey: key },
    });
  }

  private expectedKey(organizationId: string, input: CreatePlanInput): string {
    const dot = input.storageKey.lastIndexOf('.');
    const ext = dot >= 0 ? input.storageKey.slice(dot + 1).toLowerCase() : '';
    if (!ALLOWED_PLAN_EXTS.includes(ext)) {
      throw new ForbiddenException('storageKey has an unsupported extension');
    }
    const id = input.id ?? '';
    return planStorageKey(organizationId, id, ext);
  }

  private async toDto(plan: DbPlan): Promise<PlanDto> {
    const [fileUrl, thumbnailUrl] = await Promise.all([
      this.storage.presignGet(plan.storageKey),
      plan.thumbnailStorageKey ? this.storage.presignGet(plan.thumbnailStorageKey) : null,
    ]);
    return {
      id: plan.id,
      projectId: plan.projectId,
      title: plan.title,
      planKind: plan.planKind,
      pageCount: plan.pageCount,
      fileUrl,
      thumbnailUrl,
      createdAt: plan.createdAt.toISOString(),
    };
  }
}
