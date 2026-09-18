import { z } from 'zod';

/**
 * Philippine mobile numbers. Accepts 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX
 * and 9XXXXXXXXX, and normalises everything to E.164 (+639XXXXXXXXX).
 */
export function normalisePhMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '');
  let local: string | null = null;
  if (/^639\d{9}$/.test(digits)) local = digits.slice(2);
  else if (/^09\d{9}$/.test(digits)) local = digits.slice(1);
  else if (/^9\d{9}$/.test(digits)) local = digits;
  if (!local) return null;
  return `+63${local}`;
}

export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Display helpers — participant data is masked everywhere outside admin. */
export function maskMobile(mobile: string): string {
  return mobile.length < 6 ? '••••' : `${mobile.slice(0, 5)}•••••${mobile.slice(-2)}`;
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  const head = user.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(user.length - 2, 2))}@${domain}`;
}

const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // Reject control characters and angle brackets outright; everything is also
    // escaped on output, this is belt and braces against junk input.
    .refine((v) => !/[<>\u0000-\u001F\u007F]/.test(v), 'Invalid characters');

export const registrationSchema = z.object({
  fullName: safeText(2, 80).refine((v) => /[A-Za-z\u00C0-\u024F]/.test(v), 'Enter your name'),
  company: safeText(2, 120),
  designation: safeText(2, 120).optional().or(z.literal('')),
  mobile: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .transform((v, ctx) => {
      const n = normalisePhMobile(v);
      if (!n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a Philippine mobile number, e.g. 0917 123 4567' });
        return z.NEVER;
      }
      return n;
    }),
  email: z.string().trim().max(160).email('Enter a valid email address').transform(normaliseEmail),
  consent: z.literal(true, { errorMap: () => ({ message: 'Please accept the privacy notice to continue' }) }),
});

export const otpSendSchema = z.object({ channel: z.enum(['MOBILE', 'EMAIL']) });

export const otpVerifySchema = z.object({
  channel: z.enum(['MOBILE', 'EMAIL']),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email().transform(normaliseEmail),
  password: z.string().min(8).max(200),
});

export const prizeSchema = z.object({
  name: safeText(2, 40).transform((v) => v.toUpperCase().replace(/\s+/g, '_')),
  displayName: safeText(2, 40),
  description: safeText(0, 200).optional().or(z.literal('')),
  initialQuantity: z.number().int().min(0).max(100000),
  weight: z.number().int().min(0).max(100000),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(999).default(0),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const inventoryAdjustSchema = z.object({
  prizeId: z.string().uuid(),
  adjustment: z.number().int().refine((v) => v !== 0, 'Adjustment cannot be zero'),
  reason: safeText(3, 200),
  confirm: z.literal(true),
});

export const collectSchema = z.object({
  winnerId: z.string().uuid(),
  notes: safeText(0, 200).optional().or(z.literal('')),
});
