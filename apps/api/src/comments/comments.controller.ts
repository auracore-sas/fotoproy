import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Comment, CreateCommentInput } from '@fotoproy/shared';
import { createCommentInputSchema, uuidSchema } from '@fotoproy/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { CommentsService } from './comments.service.js';

@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('comments')
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createCommentInputSchema)) body: CreateCommentInput,
  ): Promise<Comment> {
    return this.commentsService.create(current, body);
  }

  @Get('photos/:id/comments')
  listByPhoto(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<Comment[]> {
    return this.commentsService.listByPhoto(current, id);
  }
}
