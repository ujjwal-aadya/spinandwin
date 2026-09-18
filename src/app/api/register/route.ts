import { db } from '@/lib/db';
import { activeEvent, eventSettings, registrationWindow, windowBlocked, windowMessage } from '@/lib/event';
import { registrationSchema } from '@/lib/validation';
import { createParticipantSession } from '@/lib/session';
import { participantState } from '@/lib/state';
import { checkRateLimit, LIMITS } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import type { ParticipantRow } from '@/lib/types';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const ip = ipHash(req);

    if (ip) {
      const limit = await checkRateLimit({ bucket: 'register_ip', key: ip, ...LIMITS.registerPerIp });
      if (!limit.allowed) return fail(ERRORS.RATE_LIMITED, 429, 'RATE_LIMITED',
        { retryAfterSeconds: limit.retryAfterSeconds });
    }

    const input = registrationSchema.parse(await readJson(req));

    const event = await activeEvent();
    if (!event) return fail('No event is running right now.', 404, 'NO_EVENT');

    const state = registrationWindow(event);
    if (windowBlocked(state)) return fail(windowMessage(state), 403, 'EVENT_CLOSED');

    if (event.max_participants) {
      const { count } = await db().from('participants')
        .select('id', { count: 'exact', head: true }).eq('event_id', event.id);
      if ((count ?? 0) >= event.max_participants) {
        return fail('Entries for this event are full.', 403, 'EVENT_FULL');
      }
    }

    // Duplicate handling. A returning attendee is re-attached to their own
    // record; nothing about them is revealed until they pass a fresh code,
    // so the response is indistinguishable from a first-time registration.
    const { data: byMobile } = await db().from('participants').select('*')
      .eq('event_id', event.id).eq('mobile', input.mobile).maybeSingle();
    const { data: byEmail } = await db().from('participants').select('*')
      .eq('event_id', event.id).eq('email', input.email).maybeSingle();

    const existing = (byMobile ?? byEmail) as ParticipantRow | null;
    let participant: ParticipantRow;
    let identityConfirmed = true;

    if (existing) {
      if (existing.status === 'BLOCKED') return fail(ERRORS.FORBIDDEN, 403, 'BLOCKED');

      const partlyVerified = Boolean(existing.mobile_verified_at || existing.email_verified_at);
      if (partlyVerified) {
        participant = existing;
        identityConfirmed = false;   // must pass an OTP challenge before anything is shown
      } else {
        // Abandoned registration on the same details: refresh and continue.
        const { data, error } = await db().from('participants').update({
          full_name: input.fullName, company: input.company,
          designation: input.designation || null, mobile: input.mobile, email: input.email,
          consent_at: new Date().toISOString(), ip_hash: ip,
          user_agent: req.headers.get('user-agent')?.slice(0, 250) ?? null,
        }).eq('id', existing.id).select('*').single();
        if (error) throw new Error(error.message);
        participant = data as ParticipantRow;
      }
    } else {
      const { data, error } = await db().from('participants').insert({
        event_id: event.id, full_name: input.fullName, company: input.company,
        designation: input.designation || null, mobile: input.mobile, email: input.email,
        status: 'REGISTERED', consent_at: new Date().toISOString(), ip_hash: ip,
        user_agent: req.headers.get('user-agent')?.slice(0, 250) ?? null,
      }).select('*').single();

      if (error) {
        // Unique index on a verified mobile/email: treat as a returning attendee.
        if (error.code === '23505') return fail('Please check your details and try again.', 409, 'DUPLICATE');
        throw new Error(error.message);
      }
      participant = data as ParticipantRow;
      await audit({ eventId: event.id, participantId: participant.id, action: 'PARTICIPANT_REGISTERED',
        entity: 'participant', entityId: participant.id, ipHash: ip, metadata: { company: input.company } });
    }

    await createParticipantSession(participant.id, event.id, ip,
      req.headers.get('user-agent'), identityConfirmed);

    const settings = await eventSettings(event.id);
    return ok({
      ...(await participantState({ sessionId: '', participant, identityConfirmed })),
      otp: { cooldownSeconds: settings.otp.resend_cooldown_seconds, ttlSeconds: settings.otp.ttl_seconds },
    });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('register', error);
  }
}
