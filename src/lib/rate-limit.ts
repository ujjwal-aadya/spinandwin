import { db } from './db';
import { sha256 } from './crypto';

export interface LimitRule { bucket: string; key: string; limit: number; windowSeconds: number }

export interface LimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

/**
 * Fixed-window counter backed by rate_limit_events. Every OTP send, OTP
 * verification, spin and admin login passes through here, keyed by IP and by
 * the identity being targeted (mobile / email / admin email).
 */
export async function checkRateLimit(rule: LimitRule): Promise<LimitResult> {
  const keyHash = sha256(`${rule.bucket}:${rule.key}`);
  const since = new Date(Date.now() - rule.windowSeconds * 1000).toISOString();

  const { data, error } = await db()
    .from('rate_limit_events')
    .select('created_at')
    .eq('bucket', rule.bucket)
    .eq('key_hash', keyHash)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .returns<{ created_at: string }[]>();

  if (error) throw new Error(`rate limit read failed: ${error.message}`);
  const hits = data ?? [];

  if (hits.length >= rule.limit) {
    const oldest = hits[0] ? new Date(hits[0].created_at).getTime() : Date.now();
    const retry = Math.max(1, Math.ceil((oldest + rule.windowSeconds * 1000 - Date.now()) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds: retry };
  }

  await db().from('rate_limit_events').insert({ bucket: rule.bucket, key_hash: keyHash });
  return { allowed: true, remaining: rule.limit - hits.length - 1, retryAfterSeconds: 0 };
}

/** Housekeeping — call from a cron job or before the event. */
export async function pruneRateLimits(olderThanHours = 24): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
  await db().from('rate_limit_events').delete().lt('created_at', cutoff);
}

export const LIMITS = {
  otpSendPerIp: { limit: 12, windowSeconds: 3600 },
  otpSendPerDestination: { limit: 5, windowSeconds: 3600 },
  otpVerifyPerIp: { limit: 30, windowSeconds: 3600 },
  registerPerIp: { limit: 15, windowSeconds: 3600 },
  spinPerIp: { limit: 20, windowSeconds: 3600 },
  adminLoginPerIp: { limit: 10, windowSeconds: 900 },
  adminLoginPerEmail: { limit: 5, windowSeconds: 900 },
} as const;
