import { ConflictException, Injectable } from '@nestjs/common';
import type { User as DbUser } from '@fotoproy/database';
import bcrypt from 'bcryptjs';
import type { CreateUserInput } from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

export interface MemberDto {
  id: string;
  email: string;
  fullName: string;
  role: DbUser['role'];
  isActive: boolean;
  createdAt: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lists the members of the caller's organization. */
  async list(current: AuthedUser): Promise<MemberDto[]> {
    const users = await this.prisma.user.findMany({
      where: { organizationId: current.organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.toMemberDto(u));
  }

  /** Creates a member inside the caller's organization (ADMIN only). */
  async create(current: AuthedUser, input: CreateUserInput): Promise<MemberDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        role: input.role,
        organizationId: current.organizationId,
      },
    });
    return this.toMemberDto(user);
  }

  private toMemberDto(user: DbUser): MemberDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
