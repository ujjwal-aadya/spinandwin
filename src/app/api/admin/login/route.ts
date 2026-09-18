import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { adminLoginSchema } from '@/lib/validation';
import { createAdminSession } from '@/lib/session';
import { checkRateLimit, LIMITS } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import type { AdminRow } from '@/lib/types';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const GENERIC = 'Email or password is incorrect.';

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const ip = ipHash(req);

    if (ip) {
      const limit = await checkRateLimit({ bucket: 'admin_login_ip', key: ip, ...LIMITS.adminLoginPerIp });
      if (!limit.allowed) return fail(ERRORS.RATE_LIMITED, 429, 'RATE_LIMITED');
    }

    const { email, password } = adminLoginSchema.parse(await readJson(req));

    const byEmail = await checkRateLimit({ bucket: 'admin_login_email', key: email, ...LIMITS.adminLoginPerEmail });
    if (!byEmail.allowed) return fail(ERRORS.RATE_LIMITED, 429, 'RATE_LIMITED');

    const { data } = await db().from('admin_users').select('*').eq('email', email).maybeSingle();
    const admin = data as AdminRow | null;

    // Constant-ish work whether or not the account exists.
    const hash = admin?.password_hash ?? '$2a$12$0000000000000000000000000000000000000000000000000000';
    const passwordOk = await bcrypt.compare(password, hash);

    if (!admin || !admin.is_active || !passwordOk) {
      if (admin) {
        const attempts = admin.failed_login_attempts + 1;
        await db().from('admin_users').update({
          failed_login_attempts: attempts,
          locked_until: attempts >= MAX_FAILED
            ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : admin.locked_until,
        }).eq('id', admin.id);
        await audit({ adminId: admin.id, action: 'ADMIN_LOGIN_FAILED', entity: 'admin', entityId: admin.id,
          ipHash: ip, metadata: { attempts } });
      }
      return fail(GENERIC, 401, 'INVALID_CREDENTIALS');
    }

    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return fail(`This account is locked. Try again after ${LOCK_MINUTES} minutes.`, 423, 'LOCKED');
    }

    await db().from('admin_users').update({
      failed_login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString(),
    }).eq('id', admin.id);

    await createAdminSession(admin.id, ip);
    await audit({ adminId: admin.id, action: 'ADMIN_LOGIN', entity: 'admin', entityId: admin.id, ipHash: ip });

    return ok({ role: admin.role, fullName: admin.full_name });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('admin-login', error);
  }
}
