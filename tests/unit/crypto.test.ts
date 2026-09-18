import { describe, expect, it } from 'vitest';
import { generateOtp, generateWinnerCode, hashOtp, isValidWinnerCode, safeEqual, sha256 } from '@/lib/crypto';

const PEPPER = 'a'.repeat(48);

describe('OTP generation', () => {
  it('always produces six digits, including leading zeros', () => {
    for (let i = 0; i < 2_000; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it('covers the full range and does not repeat trivially', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOtp()));
    expect(seen.size).toBeGreaterThan(450);
  });
});

describe('OTP hashing', () => {
  it('is deterministic for the same code, salt and pepper', () => {
    expect(hashOtp('123456', PEPPER, 'p1')).toBe(hashOtp('123456', PEPPER, 'p1'));
  });

  it('differs per participant, so one hash cannot be replayed elsewhere', () => {
    expect(hashOtp('123456', PEPPER, 'p1')).not.toBe(hashOtp('123456', PEPPER, 'p2'));
  });

  it('differs when the pepper changes', () => {
    expect(hashOtp('123456', PEPPER, 'p1')).not.toBe(hashOtp('123456', 'b'.repeat(48), 'p1'));
  });

  it('never stores the code itself', () => {
    expect(hashOtp('123456', PEPPER, 'p1')).not.toContain('123456');
  });
});

describe('constant-time compare', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(safeEqual(sha256('x'), sha256('x'))).toBe(true);
    expect(safeEqual(sha256('x'), sha256('y'))).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
  });
});

describe('winner codes', () => {
  it('uses the TOAP prefix and unambiguous characters', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateWinnerCode();
      expect(code).toMatch(/^TOAP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
      expect(code.split('-')[1]).not.toMatch(/[01OIL]/);   // no lookalike characters to misread at the booth
      expect(isValidWinnerCode(code)).toBe(true);
    }
  });

  it('is not sequential and collides rarely', () => {
    const codes = new Set(Array.from({ length: 20_000 }, () => generateWinnerCode()));
    expect(codes.size).toBeGreaterThan(19_980);
  });

  it('rejects malformed codes', () => {
    expect(isValidWinnerCode('TOAP-0O1IL9')).toBe(false);
    expect(isValidWinnerCode('12345')).toBe(false);
    expect(isValidWinnerCode('')).toBe(false);
  });
});
