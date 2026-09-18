import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { confirmSessionIdentity, currentSession } from '@/lib/session';
import { otpVerifySchema } from '@/lib/validation';
import { verifyOtp } from '@/lib/otp';
import { participantState } from '@/lib/state';
import { checkRateLimit, LIMITS } from '@/lib/rate-limit';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import type { ParticipantRow } from '@/lib/types';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');

    const session = await currentSession();
    if (!session) return fail(ERRORS.UNAUTHORISED, 401, 'NO_SESSION');

    const ip = ipHash(req);
    if (ip) {
      const limit = await checkRateLimit({ bucket: 'otp_verify_ip', key: ip, ...LIMITS.otpVerifyPerIp });
      if (!limit.allowed) return fail(ERRORS.RATE_LIMITED, 429, 'RATE_LIMITED',
        { retryAfterSeconds: limit.retryAfterSeconds });
    }

    const { channel, code } = otpVerifySchema.parse(await readJson(req));
    const event = await activeEvent();
    if (!event) return fail('No event is running right now.', 404, 'NO_EVENT');

    const purpose = session.identityConfirmed ? 'VERIFY' : 'CHALLENGE';
    const outcome = await verifyOtp(session.participant, channel, code, ip, purpose);

    switch (outcome.status) {
      case 'VERIFIED':
      case 'ALREADY_VERIFIED': {
        if (purpose === 'CHALLENGE') await confirmSessionIdentity(session.sessionId);
        const { data } = await db().from('participants').select('*')
          .eq('id', session.participant.id).single();
        const state = await participantState({
          sessionId: session.sessionId, participant: data as ParticipantRow, identityConfirmed: true,
        });
        return ok(state);
      }
      case 'INVALID':
        return fail(ERRORS.OTP_INVALID, 400, 'OTP_INVALID', { attemptsLeft: outcome.attemptsLeft });
      case 'EXPIRED':
        return fail(ERRORS.OTP_EXPIRED, 400, 'OTP_EXPIRED');
      case 'TOO_MANY_ATTEMPTS':
        return fail(ERRORS.OTP_ATTEMPTS, 429, 'OTP_ATTEMPTS');
      default:
        return fail('Request a new code to continue.', 400, 'OTP_NONE');
    }
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('otp-verify', error);
  }
}
