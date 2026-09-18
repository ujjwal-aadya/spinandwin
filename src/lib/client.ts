'use client';

export interface ApiError { message: string; code?: string; fields?: Record<string, string>;
  retryAfterSeconds?: number; attemptsLeft?: number }

export class RequestFailed extends Error {
  readonly detail: ApiError;
  constructor(detail: ApiError) {
    super(detail.message);
    this.detail = detail;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) headers.set('Content-Type', 'application/json');

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });

  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* non-JSON error page */ }

  const body = payload as null | {
    ok?: boolean; data?: T; error?: string; code?: string; fields?: Record<string, string>;
    retryAfterSeconds?: number; attemptsLeft?: number;
  };

  if (!res.ok || !body?.ok) {
    throw new RequestFailed({
      message: body?.error ?? 'Something went wrong. Please try again.',
      code: body?.code, fields: body?.fields,
      retryAfterSeconds: body?.retryAfterSeconds, attemptsLeft: body?.attemptsLeft,
    });
  }
  return body.data as T;
}
