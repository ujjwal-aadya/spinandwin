import { clearParticipantSession } from '@/lib/session';
import { ok, sameOriginOk, fail, serverError } from '@/lib/http';

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    await clearParticipantSession();
    return ok({ stage: 'REGISTER' });
  } catch (error) {
    return serverError('logout', error);
  }
}
