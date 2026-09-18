import { currentSession } from '@/lib/session';
import { participantState } from '@/lib/state';
import { ok, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Rehydrates the flow after a refresh, a lost connection or a new browser tab. */
export async function GET() {
  try {
    const session = await currentSession();
    if (!session) return ok({ stage: 'REGISTER', participant: null, result: null });
    return ok(await participantState(session));
  } catch (error) {
    return serverError('me', error);
  }
}
