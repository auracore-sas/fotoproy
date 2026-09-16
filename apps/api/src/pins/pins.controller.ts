import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { CreatePinInput, PhotoPin } from '@fotoproy/shared';
import { createPinInputSchema, uuidSchema } from '@fotoproy/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { PinsService } from './pins.service.js';

@Controller()
export class PinsController {
  constructor(private readonly pinsService: PinsService) {}

  /** Anchors a photo on a plan page at a relative position (0–100 %). */
  @Post('pins')
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createPinInputSchema)) body: CreatePinInput,
  ): Promise<PhotoPin> {
    return this.pinsService.create(current, body);
  }

  /** All pins of a plan with their anchored photo (for the plan viewer). */
  @Get('plans/:id/pins')
  listByPlan(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<PhotoPin[]> {
    return this.pinsService.listByPlan(current, id);
  }

  /**
   * Detaches a photo from the plan (soft-remove, idempotent). The evidence
   * photo stays in the gallery; only the anchor disappears.
   */
  @Delete('pins/:id')
  remove(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<PhotoPin> {
    return this.pinsService.remove(current, id);
  }
}
