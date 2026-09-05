/**
 * Minimal HTTP client for the FotoProy API.
 * Base URL comes from EXPO_PUBLIC_API_URL (see .env) so it can be switched
 * per environment without rebuilding.
 */
import type {
  AuthResponse,
  CreatePhotoPayload,
  CreateProjectPayload,
  Page,
  Photo,
  PresignPhotoUploadPayload,
  PresignUploadResponse,
  Project,
  UserInfo,
} from './types';

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.86.35:4100';

export class ApiError extends Error {
  readonly status: number;
  readonly issues?: unknown;

  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', token, body } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifica tu conexión.');
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      (data && (data.message as string)) ||
      (data && typeof data.message === 'object' ? JSON.stringify(data.message) : '') ||
      `Error ${response.status}`;
    throw new ApiError(response.status, message, data?.issues);
  }
  return data as T;
}

export const api = {
  register(payload: {
    email: string;
    password: string;
    fullName: string;
    organizationName: string;
  }): Promise<AuthResponse> {
    return request('/auth/register', { method: 'POST', body: payload });
  },

  login(payload: { email: string; password: string }): Promise<AuthResponse> {
    return request('/auth/login', { method: 'POST', body: payload });
  },

  me(token: string): Promise<UserInfo> {
    return request('/auth/me', { token });
  },

  listProjects(token: string, page = 1): Promise<Page<Project>> {
    return request(`/projects?page=${page}&pageSize=20`, { token });
  },

  getProject(token: string, id: string): Promise<Project> {
    return request(`/projects/${id}`, { token });
  },

  createProject(token: string, payload: CreateProjectPayload): Promise<Project> {
    return request('/projects', { method: 'POST', token, body: payload });
  },

  presignPhotoUpload(
    token: string,
    payload: PresignPhotoUploadPayload,
  ): Promise<PresignUploadResponse> {
    return request('/photos/presign', { method: 'POST', token, body: payload });
  },

  /** Registers a media item already uploaded to storage (idempotent by id). */
  createPhoto(token: string, payload: CreatePhotoPayload): Promise<Photo> {
    return request('/photos', { method: 'POST', token, body: payload });
  },

  listPhotos(token: string, projectId: string, page = 1): Promise<Page<Photo>> {
    return request(`/photos?projectId=${projectId}&page=${page}&pageSize=20`, { token });
  },

  getPhoto(token: string, id: string): Promise<Photo> {
    return request(`/photos/${id}`, { token });
  },
};
