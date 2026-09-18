import { clearAdminSession, currentAdmin } from '@/lib/session';
import { audit } from '@/lib/audit';
import { ok, fail, ipHash, sameOriginOk, serverError } from '@/lib/http';

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const admin = await currentAdmin();
    if (admin) await audit({ adminId: admin.id, action: 'ADMIN_LOGOUT', ipHash: ipHash(req) });
    await clearAdminSession();
    return ok({ loggedOut: true });
  } catch (error) {
    return serverError('admin-logout', error);
  }
}
