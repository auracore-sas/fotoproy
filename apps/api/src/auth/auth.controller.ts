import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthResponse, LoginInput, RegisterInput } from '@fotoproy/shared';
import { loginSchema, registerSchema } from '@fotoproy/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<AuthResponse> {
    return this.authService.register(body);
  }

  @Public()
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput): Promise<AuthResponse> {
    return this.authService.login(body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser): Promise<AuthResponse['user']> {
    return this.authService.me(user);
  }
}
