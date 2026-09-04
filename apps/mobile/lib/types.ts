/**
 * Local API types — mirror the DTOs defined in `@fotoproy/shared`.
 * (Metro/pnpm consumption of the shared workspace package will be formalized
 * later; until then these shapes are the contract used by the app.)
 */

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'TECHNICIAN';

export interface UserInfo {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserInfo;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  clientName: string | null;
  latitude: number | null;
  longitude: number | null;
  organizationId: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface CreateProjectPayload {
  code: string;
  name: string;
  description?: string;
  clientName?: string;
  latitude?: number | null;
  longitude?: number | null;
}
