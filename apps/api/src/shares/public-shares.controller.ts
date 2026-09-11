import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SharedProjectPayload } from '@fotoproy/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { SharesService } from './shares.service.js';

/**
 * Public share endpoint — no authentication.
 *
 * The response is the JSON payload the web view (F4.2) renders. Dead links
 * answer 410 with a stable `code` so the page can explain what happened.
 */
@Controller('s')
export class PublicSharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Public()
  @Get(':token')
  async view(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SharedProjectPayload> {
    response.setHeader('Cache-Control', 'no-store');
    return this.sharesService.viewPublic(token);
  }
}
