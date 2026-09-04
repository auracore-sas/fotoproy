import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedUser } from '../interfaces/auth-user.interface.js';

/** Injects the authenticated user (set by JwtAuthGuard) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthedUser }>();
    return request.user;
  },
);
