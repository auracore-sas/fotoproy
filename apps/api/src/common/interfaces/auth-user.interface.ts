import type { UserRole } from '@fotoproy/shared';

/** Authenticated user attached to the request by JwtAuthGuard. */
export interface AuthedUser {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string;
}
