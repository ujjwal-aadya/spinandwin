/** Centralised, validated environment access. Server-only. */
type Mode = 'development' | 'test' | 'production';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  get mode(): Mode {
    const m = (process.env.APP_MODE ?? process.env.NODE_ENV ?? 'development') as Mode;
    return m === 'production' || m === 'test' ? m : 'development';
  },
  get appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  },
  get supabaseUrl(): string {
    return required('SUPABASE_URL');
  },
  get supabaseServiceKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get sessionSecret(): string {
    const s = required('SESSION_SECRET');
    if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return s;
  },
  get otpPepper(): string {
    const s = required('OTP_PEPPER');
    if (s.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters');
    return s;
  },
  /** Simulated OTP delivery. Hard-blocked in production so it cannot ship by accident. */
  get otpDevMode(): boolean {
    const on = process.env.OTP_DEV_MODE === 'true';
    if (on && this.mode === 'production') {
      throw new Error('OTP_DEV_MODE cannot be enabled while APP_MODE=production');
    }
    return on;
  },
  get smsProvider(): string {
    return process.env.SMS_PROVIDER ?? 'console';
  },
  get emailProvider(): string {
    return process.env.EMAIL_PROVIDER ?? 'console';
  },
  get adminEventOverride(): boolean {
    return process.env.ADMIN_EVENT_OVERRIDE === 'true';
  },
};
