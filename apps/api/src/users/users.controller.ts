import { Body, Controller, Get, Post } from '@nestjs/common';
import type { CreateUserInput } from '@fotoproy/shared';
import { createUserSchema } from '@fotoproy/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { UsersService } from './users.service.js';
import type { MemberDto } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('ADMIN', 'SUPERVISOR')
  list(@CurrentUser() current: AuthedUser): Promise<MemberDto[]> {
    return this.usersService.list(current);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<MemberDto> {
    return this.usersService.create(current, body);
  }
}
