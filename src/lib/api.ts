import { accessToken } from './supabase';

export class ApiClientError extends Error {
  status: number;
  code: string | null;
  details: unknown;
  constructor(status: number, message: string, code: string | null, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, { method = 'GET', body, auth = true, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await accessToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'You appear to be offline. Check your connection and retry.', 'OFFLINE');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const payload = (data || {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiClientError(res.status, payload.error || `Request failed (${res.status}).`, payload.code || null, payload.details);
  }
  return data as T;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.') {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
