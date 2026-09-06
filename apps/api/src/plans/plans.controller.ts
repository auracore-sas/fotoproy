import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type {
  CreatePlanInput,
  Page,
  PlanListQuery,
  Plan,
  PresignPlanUploadInput,
  PresignUploadResponse,
} from '@fotoproy/shared';
import {
  createPlanInputSchema,
  planListQuerySchema,
  presignPlanUploadSchema,
  uuidSchema,
} from '@fotoproy/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { PlansService } from './plans.service.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /** Pre-signed PUT URL to upload a plan file directly to storage. */
  @Post('presign')
  @Roles('ADMIN', 'SUPERVISOR')
  presignUpload(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(presignPlanUploadSchema)) body: PresignPlanUploadInput,
  ): Promise<PresignUploadResponse> {
    return this.plansService.presignUpload(current, body);
  }

  /** Registers an uploaded plan (ADMIN/SUPERVISOR only). */
  @Post()
  @Roles('ADMIN', 'SUPERVISOR')
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createPlanInputSchema)) body: CreatePlanInput,
  ): Promise<Plan> {
    return this.plansService.create(current, body);
  }

  @Get()
  list(
    @CurrentUser() current: AuthedUser,
    @Query(new ZodValidationPipe(planListQuerySchema)) query: PlanListQuery,
  ): Promise<Page<Plan>> {
    return this.plansService.list(current, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<Plan> {
    return this.plansService.findOne(current, id);
  }
}
