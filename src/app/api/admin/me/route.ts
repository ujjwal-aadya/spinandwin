import { currentAdmin } from '@/lib/session';
import { ok, fail, serverError, ERRORS } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await currentAdmin();
    if (!admin) return fail(ERRORS.UNAUTHORISED, 401, 'NO_SESSION');
    return ok(admin);
  } catch (error) {
    return serverError('admin-me', error);
  }
}
