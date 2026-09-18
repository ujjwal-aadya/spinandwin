import { describe, expect, it } from 'vitest';
import { maskEmail, maskMobile, normaliseEmail, normalisePhMobile, registrationSchema } from '@/lib/validation';

describe('Philippine mobile normalisation', () => {
  it('accepts every common local format', () => {
    for (const input of ['09171234567', '+639171234567', '639171234567', '9171234567',
                         '0917 123 4567', '0917-123-4567', '+63 917 123 4567']) {
      expect(normalisePhMobile(input)).toBe('+639171234567');
    }
  });

  it('rejects anything that is not a PH mobile', () => {
    for (const input of ['02 8123 4567', '0817123456', '+14155552671', '12345', '', 'not a number']) {
      expect(normalisePhMobile(input)).toBeNull();
    }
  });
});

describe('masking', () => {
  it('hides most of the number and the local part', () => {
    expect(maskMobile('+639171234567')).toBe('+6391•••••67');
    expect(maskEmail('juan.delacruz@bank.com.ph')).toBe('ju•••••••••••@bank.com.ph');
  });
});

describe('registration schema', () => {
  const valid = {
    fullName: '  Maria Santos ', company: 'Metrobank Trust', designation: 'Trust Officer',
    mobile: '0917 123 4567', email: ' Maria.Santos@BANK.com.PH ', consent: true,
  };

  it('trims, normalises and accepts a good entry', () => {
    const parsed = registrationSchema.parse(valid);
    expect(parsed.fullName).toBe('Maria Santos');
    expect(parsed.mobile).toBe('+639171234567');
    expect(parsed.email).toBe('maria.santos@bank.com.ph');
  });

  it('requires consent', () => {
    expect(registrationSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it('rejects script payloads and bad addresses', () => {
    expect(registrationSchema.safeParse({ ...valid, fullName: '<script>alert(1)</script>' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, mobile: '+14155552671' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, fullName: 'A' }).success).toBe(false);
  });

  it('normalises email casing consistently', () => {
    expect(normaliseEmail(' A@B.COM ')).toBe('a@b.com');
  });
});
