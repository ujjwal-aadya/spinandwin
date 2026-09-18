import { db } from '@/lib/db';
import { activeEvent, spinWindow, windowBlocked, windowMessage } from '@/lib/event';
import { currentSession } from '@/lib/session';
import { checkRateLimit, LIMITS } from '@/lib/rate-limit';
import { ok, fail, ipHash, sameOriginOk, serverError, ERRORS } from '@/lib/http';
import type { SpinResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The only way to win a prize.
 *
 * Everything that matters happens inside allocate_spin() in PostgreSQL:
 * an advisory lock per participant, a unique constraint on (event, participant),
 * row locks on the prize table, a guarded decrement, and the winner record —
 * all in one transaction. The browser supplies no participant id, no prize id
 * and no eligibility flag; it only receives the outcome.
 */
export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');

    const session = await currentSession();
    if (!session) return fail(ERRORS.UNAUTHORISED, 401, 'NO_SESSION');
    if (!session.identityConfirmed) return fail(ERRORS.NOT_ELIGIBLE, 403, 'NOT_ELIGIBLE');

    const ip = ipHash(req);
    if (ip) {
      const limit = await checkRateLimit({ bucket: 'spin_ip', key: ip, ...LIMITS.spinPerIp });
      if (!limit.allowed) return fail(ERRORS.RATE_LIMITED, 429, 'RATE_LIMITED',
        { retryAfterSeconds: limit.retryAfterSeconds });
    }

    const event = await activeEvent();
    if (!event || event.id !== session.participant.event_id) {
      return fail('No event is running right now.', 404, 'NO_EVENT');
    }

    const state = spinWindow(event);
    if (windowBlocked(state)) return fail(windowMessage(state), 403, 'EVENT_CLOSED');

    const idempotencyKey = req.headers.get('idempotency-key')?.slice(0, 80) ?? null;

    const { data, error } = await db().rpc('allocate_spin', {
      p_event_id: event.id,
      p_participant_id: session.participant.id,
      p_ip_hash: ip,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const message = error.message ?? '';
      if (message.includes('NOT_ELIGIBLE')) return fail(ERRORS.NOT_ELIGIBLE, 403, 'NOT_ELIGIBLE');
      if (message.includes('PARTICIPANT_BLOCKED')) return fail(ERRORS.FORBIDDEN, 403, 'BLOCKED');
      if (message.includes('PARTICIPANT_NOT_FOUND')) return fail(ERRORS.UNAUTHORISED, 401, 'NO_SESSION');
      throw new Error(message);
    }

    const result = data as SpinResult;

    if (result.status === 'NO_INVENTORY') {
      return ok({ alreadySpun: result.already_spun, noInventory: true, prize: null,
                  message: ERRORS.NO_INVENTORY });
    }

    return ok({
      alreadySpun: result.already_spun,
      noInventory: false,
      prize: result.prize ? { id: result.prize.id, displayName: result.prize.display_name,
                              color: result.prize.color } : null,
      winnerCode: result.winner_code ?? null,
      wonAt: result.won_at ?? null,
      collectionStatus: result.collection_status ?? 'PENDING',
      participantName: session.participant.full_name,
    });
  } catch (error) {
    return serverError('spin', error);
  }
}
