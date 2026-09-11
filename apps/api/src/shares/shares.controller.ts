import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { CreateShareInput, Share, ShareListQuery } from '@fotoproy/shared';
import { createShareInputSchema, shareListQuerySchema, uuidSchema } from '@fotoproy/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { SharesService } from './shares.service.js';

/** Private share-link management (ADMIN/SUPERVISOR only). */
@Controller('shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  /** Creates a read-only link; the response is the only place the token shows. */
  @Post()
  @Roles('ADMIN', 'SUPERVISOR')
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createShareInputSchema)) body: CreateShareInput,
    @Req() request: Request,
  ): Promise<Share> {
    return this.sharesService.create(current, body, request);
  }

  /** Active/expired/revoked links of one project. */
  @Get()
  @Roles('ADMIN', 'SUPERVISOR')
  list(
    @CurrentUser() current: AuthedUser,
    @Query(new ZodValidationPipe(shareListQuerySchema)) query: ShareListQuery,
  ): Promise<Share[]> {
    return this.sharesService.list(current, query);
  }

  /** Revokes a link (idempotent). */
  @Delete(':id')
  @Roles('ADMIN', 'SUPERVISOR')
  revoke(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<Share> {
    return this.sharesService.revoke(current, id);
  }
}
