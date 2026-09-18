import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { env } from './env';
import { hashIp } from './crypto';

export const ERRORS = {
  VALIDATION: 'We could not read those details. Please check and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  UNAUTHORISED: 'Please start again from the welcome screen.',
  FORBIDDEN: 'You do not have access to this action.',
  NOT_FOUND: 'We could not find that record.',
  OTP_INVALID: 'That code is not correct. Please try again.',
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  OTP_ATTEMPTS: 'Too many incorrect attempts. Request a new code.',
  ALREADY_SPUN: 'You have already spun. Your prize is shown below.',
  NOT_ELIGIBLE: 'Please verify your mobile number and email first.',
  EVENT_CLOSED: 'The event is not open right now.',
  NO_INVENTORY: 'All prizes have been claimed. Please visit the booth.',
  SERVER: 'Something went wrong on our side. Please try again.',
} as const;

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function fail(message: string, status = 400, code?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, code, ...extra }, { status });
}

/** Never leaks stack traces, SQL or provider errors to the browser. */
export function serverError(context: string, error: unknown) {
  const id = Math.random().toString(36).slice(2, 10);
  console.error(JSON.stringify({
    level: 'error', ref: id, context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    at: new Date().toISOString(),
  }));
  return fail(`${ERRORS.SERVER} (ref ${id})`, 500, 'SERVER_ERROR');
}

export function validationError(error: ZodError) {
  const first = error.issues[0];
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!fields[key]) fields[key] = issue.message;
  }
  return fail(first?.message ?? ERRORS.VALIDATION, 422, 'VALIDATION', { fields });
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
}

export function ipHash(req: Request): string | null {
  return hashIp(clientIp(req), env.sessionSecret);
}

/** Rejects cross-site form/JSON posts that carry cookies (CSRF defence in depth). */
export function sameOriginOk(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin fetch from the app sends no Origin for GET
  try {
    const allowed = new URL(env.appUrl).host;
    return new URL(origin).host === allowed || new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 20_000) throw new Error('Payload too large');
  return (text ? JSON.parse(text) : {}) as T;
}
