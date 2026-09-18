import { activeEvent, eventSettings } from '@/lib/event';
import { currentSession } from '@/lib/session';
import { otpSendSchema } from '@/lib/validation';
import { sendOtp } from '@/lib/otp';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');

    const session = await currentSession();
    if (!session) return fail(ERRORS.UNAUTHORISED, 401, 'NO_SESSION');

    const { channel } = otpSendSchema.parse(await readJson(req));
    const event = await activeEvent();
    if (!event || event.id !== session.participant.event_id) {
      return fail('No event is running right now.', 404, 'NO_EVENT');
    }

    const settings = await eventSettings(event.id);
    const purpose = session.identityConfirmed ? 'VERIFY' : 'CHALLENGE';
    const outcome = await sendOtp(session.participant, channel, event.name, settings, ipHash(req), purpose);

    switch (outcome.status) {
      case 'SENT':
        return ok({ sent: true, expiresInSeconds: outcome.expiresInSeconds,
                    cooldownSeconds: outcome.cooldownSeconds, devCode: outcome.devCode });
      case 'COOLDOWN':
        return fail(`Please wait ${outcome.retryAfterSeconds}s before requesting another code.`,
                    429, 'COOLDOWN', { retryAfterSeconds: outcome.retryAfterSeconds });
      case 'RATE_LIMITED':
        return fail(ERRORS.RATE_LIMITED, 429, 'RATE_LIMITED',
                    { retryAfterSeconds: outcome.retryAfterSeconds });
      case 'ALREADY_VERIFIED':
        return ok({ sent: false, alreadyVerified: true });
      default:
        return fail('We could not send the code right now. Please try again or ask the booth staff.',
                    502, 'PROVIDER_ERROR');
    }
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('otp-send', error);
  }
}
