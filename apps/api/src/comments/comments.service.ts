import { Injectable, NotFoundException } from '@nestjs/common';
import type { PhotoComment as DbComment } from '@fotoproy/database';
import type { Comment, CreateCommentInput } from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

/** Comments on photos: append-only text, author name resolved at read time. */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requirePhoto(organizationId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, project: { organizationId } },
      select: { id: true },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return photo;
  }

  /** F3.5 — adds a comment to a photo of the caller's organization. */
  async create(current: AuthedUser, input: CreateCommentInput): Promise<Comment> {
    await this.requirePhoto(current.organizationId, input.photoId);
    const existing = await this.prisma.photoComment.findUnique({
      where: { id: input.id },
      include: { photo: { include: { project: { select: { organizationId: true } } } } },
    });
    if (existing) {
      if (existing.photo.project.organizationId === current.organizationId) {
        return this.toDto(existing); // idempotent retry
      }
      throw new NotFoundException('Photo not found');
    }
    const comment = await this.prisma.photoComment.create({
      data: {
        id: input.id,
        photoId: input.photoId,
        userId: current.userId,
        body: input.body,
      },
      include: { user: { select: { fullName: true } } },
    });
    return this.toDto(comment);
  }

  /** F3.5 — comments of a photo, oldest first, with author names. */
  async listByPhoto(current: AuthedUser, photoId: string): Promise<Comment[]> {
    await this.requirePhoto(current.organizationId, photoId);
    const comments = await this.prisma.photoComment.findMany({
      where: { photoId },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((comment) => this.toDto(comment));
  }

  private toDto(comment: DbComment & { user?: { fullName: string } | null }): Comment {
    return {
      id: comment.id,
      photoId: comment.photoId,
      userId: comment.userId,
      authorName: comment.user?.fullName ?? null,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }
}
