import { Injectable, NotFoundException } from '@nestjs/common';
import type { Project as DbProject } from '@fotoproy/database';
import type { Page, CreateProjectInput, UpdateProjectInput } from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  clientName: string | null;
  latitude: number | null;
  longitude: number | null;
  organizationId: string;
  createdAt: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a project in the caller's organization. */
  async create(current: AuthedUser, input: CreateProjectInput): Promise<ProjectDto> {
    const project = await this.prisma.project.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        clientName: input.clientName ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        organizationId: current.organizationId,
      },
    });
    return this.toDto(project);
  }

  /** Lists the caller's projects (paginated). */
  async list(
    current: AuthedUser,
    query: { page: number; pageSize: number },
  ): Promise<Page<ProjectDto>> {
    const where = { organizationId: current.organizationId };
    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: projects.map((p) => this.toDto(p)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    };
  }

  /** Returns one project of the caller's organization. */
  async findOne(current: AuthedUser, id: string): Promise<ProjectDto> {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId: current.organizationId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return this.toDto(project);
  }

  /** Updates an existing project (org-scoped). */
  async update(current: AuthedUser, id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.findOne(current, id); // 404 + org check
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.code !== undefined && { code: input.code }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description ?? null }),
        ...(input.clientName !== undefined && { clientName: input.clientName ?? null }),
        ...(input.latitude !== undefined && { latitude: input.latitude }),
        ...(input.longitude !== undefined && { longitude: input.longitude }),
      },
    });
    return this.toDto(project);
  }

  /** Soft-deletes are not part of the model: this removes the project (ADMIN). */
  async remove(current: AuthedUser, id: string): Promise<void> {
    await this.findOne(current, id); // 404 + org check
    await this.prisma.project.delete({ where: { id } });
  }

  private toDto(project: DbProject): ProjectDto {
    return {
      id: project.id,
      code: project.code,
      name: project.name,
      description: project.description,
      clientName: project.clientName,
      latitude: project.latitude === null ? null : Number(project.latitude),
      longitude: project.longitude === null ? null : Number(project.longitude),
      organizationId: project.organizationId,
      createdAt: project.createdAt.toISOString(),
    };
  }
}
