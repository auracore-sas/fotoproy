import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  CreateProjectInput,
  Page,
  ProjectListQuery,
  UpdateProjectInput,
} from '@fotoproy/shared';
import {
  createProjectSchema,
  projectListQuerySchema,
  updateProjectSchema,
  uuidSchema,
} from '@fotoproy/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { ProjectsService } from './projects.service.js';
import type { ProjectDto } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Roles('ADMIN', 'SUPERVISOR')
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
  ): Promise<ProjectDto> {
    return this.projectsService.create(current, body);
  }

  @Get()
  list(
    @CurrentUser() current: AuthedUser,
    @Query(new ZodValidationPipe(projectListQuerySchema)) query: ProjectListQuery,
  ): Promise<Page<ProjectDto>> {
    return this.projectsService.list(current, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<ProjectDto> {
    return this.projectsService.findOne(current, id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPERVISOR')
  update(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
  ): Promise<ProjectDto> {
    return this.projectsService.update(current, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.projectsService.remove(current, id).then(() => ({ deleted: true }));
  }
}
