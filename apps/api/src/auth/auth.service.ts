import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { Prisma } from '@fotoproy/database';
import bcrypt from 'bcryptjs';
import type { AuthResponse, LoginInput, RegisterInput, UpdateProfileInput } from '@fotoproy/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Registers a new organization with its first user (ADMIN). */
  async register(input: RegisterInput): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const organization = await tx.organization.create({
        data: { legalName: input.organizationName },
      });
      return tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: 'ADMIN',
          organizationId: organization.id,
        },
        include: { organization: true },
      });
    });

    return this.buildAuthResponse(user);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { organization: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }
    return this.buildAuthResponse(user);
  }

  /** Returns the current authenticated user (fresh data from the DB). */
  async me(current: AuthedUser): Promise<AuthResponse['user']> {
    const user = await this.prisma.user.findUnique({
      where: { id: current.userId },
      include: { organization: true },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.toUserDto(user);
  }

  /**
   * Updates the caller's own profile (full name / professional signature).
   * The signature is the short text (initials, nickname) burned on photos.
   */
  async updateProfile(
    current: AuthedUser,
    input: UpdateProfileInput,
  ): Promise<AuthResponse['user']> {
    const user = await this.prisma.user.update({
      where: { id: current.userId },
      data: {
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        // null clears the signature.
        ...(input.signature !== undefined && { signature: input.signature }),
      },
      include: { organization: true },
    });
    return this.toUserDto(user);
  }

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    organization: { id: string; legalName: string } | null;
  }): Promise<AuthResponse> {
    const accessToken = await this.signToken(
      user.id,
      user.email,
      user.role as AuthedUser['role'],
      user.organization?.id,
    );
    return { accessToken, user: this.toUserDto(user) };
  }

  private async signToken(
    userId: string,
    email: string,
    role: AuthedUser['role'],
    organizationId: string | null | undefined,
  ): Promise<string> {
    const payload = {
      sub: userId,
      email,
      role,
      organizationId: organizationId ?? '',
    };
    const expiresIn = this.config.get<string>(
      'JWT_EXPIRES_IN',
      '7d',
    ) as JwtSignOptions['expiresIn'];
    return this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn,
    });
  }

  private toUserDto(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    signature?: string | null;
    organization: { id: string; legalName: string } | null;
  }): AuthResponse['user'] {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as AuthResponse['user']['role'],
      organizationId: user.organization?.id ?? '',
      organizationName: user.organization?.legalName ?? '',
      signature: user.signature ?? null,
    };
  }
}
