import { createHash, createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';

/** 6-digit OTP from a cryptographically secure source (never Math.random). */
export function generateOtp(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/** OTPs are stored only as a keyed hash, so a database leak reveals no codes. */
export function hashOtp(code: string, pepper: string, salt: string): string {
  return createHmac('sha256', pepper).update(`${salt}:${code}`).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Opaque session token; only its SHA-256 is persisted. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** IPs are stored hashed so logs cannot be reversed into personal data. */
export function hashIp(ip: string | null, pepper: string): string | null {
  return ip ? createHmac('sha256', pepper).update(ip).digest('hex').slice(0, 32) : null;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Mirrors gen_winner_code() in SQL; used by tests and by tooling. */
export function generateWinnerCode(prefix = 'TOAP', length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return `${prefix}-${out}`;
}

export function isValidWinnerCode(code: string): boolean {
  return /^[A-Z]{3,8}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,10}$/.test(code.trim().toUpperCase());
}
