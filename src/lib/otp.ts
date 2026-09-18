import { db } from './db';
import { env } from './env';
import { generateOtp, hashOtp, safeEqual } from './crypto';
import { checkRateLimit, LIMITS } from './rate-limit';
import { smsProvider } from './providers/sms';
import { emailProvider, otpEmailTemplate } from './providers/email';
import { audit } from './audit';
import type { EventSettings } from './event';
import type { OtpChannel, ParticipantRow } from './types';

export type SendOutcome =
  | { status: 'SENT'; expiresInSeconds: number; cooldownSeconds: number; devCode?: string }
  | { status: 'COOLDOWN'; retryAfterSeconds: number }
  | { status: 'RATE_LIMITED'; retryAfterSeconds: number }
  | { status: 'PROVIDER_ERROR' }
  | { status: 'ALREADY_VERIFIED' };

export type VerifyOutcome =
  | { status: 'VERIFIED'; fullyVerified: boolean }
  | { status: 'INVALID'; attemptsLeft: number }
  | { status: 'EXPIRED' }
  | { status: 'TOO_MANY_ATTEMPTS' }
  | { status: 'NO_ACTIVE_CODE' }
  | { status: 'ALREADY_VERIFIED' };

function verifiedAt(p: ParticipantRow, channel: OtpChannel): string | null {
  return channel === 'MOBILE' ? p.mobile_verified_at : p.email_verified_at;
}

function destinationOf(p: ParticipantRow, channel: OtpChannel): string {
  return channel === 'MOBILE' ? p.mobile : p.email;
}

export type OtpPurpose = 'VERIFY' | 'CHALLENGE';

export async function sendOtp(
  participant: ParticipantRow, channel: OtpChannel, eventName: string,
  settings: EventSettings, ipHash: string | null, purpose: OtpPurpose = 'VERIFY',
): Promise<SendOutcome> {
  // CHALLENGE re-identifies someone who already verified on an earlier device.
  if (purpose === 'VERIFY' && verifiedAt(participant, channel)) return { status: 'ALREADY_VERIFIED' };

  const destination = destinationOf(participant, channel);
  const { ttl_seconds, resend_cooldown_seconds, max_sends_per_hour, max_attempts } = settings.otp;

  // Resend cooldown, measured from the last code we actually sent.
  const { data: last } = await db()
    .from('otp_verifications')
    .select('created_at')
    .eq('participant_id', participant.id).eq('channel', channel)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (last) {
    const elapsed = (Date.now() - new Date((last as { created_at: string }).created_at).getTime()) / 1000;
    if (elapsed < resend_cooldown_seconds) {
      return { status: 'COOLDOWN', retryAfterSeconds: Math.ceil(resend_cooldown_seconds - elapsed) };
    }
  }

  const perDestination = await checkRateLimit({
    bucket: `otp_send_${channel.toLowerCase()}`, key: destination,
    limit: max_sends_per_hour, windowSeconds: LIMITS.otpSendPerDestination.windowSeconds,
  });
  if (!perDestination.allowed) {
    await audit({ eventId: participant.event_id, participantId: participant.id, action: 'RATE_LIMITED',
      entity: 'otp', ipHash, metadata: { channel, scope: 'destination' } });
    return { status: 'RATE_LIMITED', retryAfterSeconds: perDestination.retryAfterSeconds };
  }

  if (ipHash) {
    const perIp = await checkRateLimit({ bucket: 'otp_send_ip', key: ipHash, ...LIMITS.otpSendPerIp });
    if (!perIp.allowed) return { status: 'RATE_LIMITED', retryAfterSeconds: perIp.retryAfterSeconds };
  }

  const code = generateOtp(6);
  const expiresAt = new Date(Date.now() + ttl_seconds * 1000);

  // A new code invalidates every earlier one on this channel.
  await db().from('otp_verifications')
    .update({ invalidated_at: new Date().toISOString() })
    .eq('participant_id', participant.id).eq('channel', channel)
    .is('consumed_at', null).is('invalidated_at', null);

  const { data: inserted, error } = await db().from('otp_verifications').insert({
    event_id: participant.event_id, participant_id: participant.id, channel, purpose, destination,
    code_hash: hashOtp(code, env.otpPepper, participant.id),
    expires_at: expiresAt.toISOString(), max_attempts, ip_hash: ipHash,
  }).select('id').single();
  if (error) throw new Error(`otp insert failed: ${error.message}`);

  const message = `${code} is your ${eventName} verification code. It expires in ${Math.round(ttl_seconds / 60)} minutes.`;
  const result = channel === 'MOBILE'
    ? await smsProvider().send(destination, message)
    : await (async () => {
        const tpl = otpEmailTemplate(eventName, code, Math.round(ttl_seconds / 60));
        return emailProvider().send(destination, `Your ${eventName} code: ${code}`, tpl.html, tpl.text);
      })();

  if (!result.ok) {
    await db().from('otp_verifications')
      .update({ invalidated_at: new Date().toISOString() })
      .eq('id', (inserted as { id: string }).id);
    console.error(JSON.stringify({ level: 'error', context: 'otp-delivery', channel, error: result.error }));
    return { status: 'PROVIDER_ERROR' };
  }

  await db().from('otp_verifications')
    .update({ provider_ref: result.providerRef ?? null }).eq('id', (inserted as { id: string }).id);

  await audit({ eventId: participant.event_id, participantId: participant.id, action: 'OTP_SENT',
    entity: 'otp', entityId: (inserted as { id: string }).id, ipHash, metadata: { channel } });

  return {
    status: 'SENT',
    expiresInSeconds: ttl_seconds,
    cooldownSeconds: resend_cooldown_seconds,
    // Only ever populated when OTP_DEV_MODE is on, which production refuses.
    ...(env.otpDevMode ? { devCode: code } : {}),
  };
}

export async function verifyOtp(
  participant: ParticipantRow, channel: OtpChannel, code: string, ipHash: string | null,
  purpose: OtpPurpose = 'VERIFY',
): Promise<VerifyOutcome> {
  if (purpose === 'VERIFY' && verifiedAt(participant, channel)) return { status: 'ALREADY_VERIFIED' };

  const { data } = await db()
    .from('otp_verifications')
    .select('id, code_hash, expires_at, attempts, max_attempts')
    .eq('participant_id', participant.id).eq('channel', channel).eq('purpose', purpose)
    .is('consumed_at', null).is('invalidated_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const row = data as null | {
    id: string; code_hash: string; expires_at: string; attempts: number; max_attempts: number;
  };
  if (!row) return { status: 'NO_ACTIVE_CODE' };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db().from('otp_verifications')
      .update({ invalidated_at: new Date().toISOString() }).eq('id', row.id);
    return { status: 'EXPIRED' };
  }

  if (row.attempts >= row.max_attempts) {
    await db().from('otp_verifications')
      .update({ invalidated_at: new Date().toISOString() }).eq('id', row.id);
    return { status: 'TOO_MANY_ATTEMPTS' };
  }

  const matches = safeEqual(row.code_hash, hashOtp(code, env.otpPepper, participant.id));
  if (!matches) {
    const attempts = row.attempts + 1;
    await db().from('otp_verifications').update({ attempts }).eq('id', row.id);
    await audit({ eventId: participant.event_id, participantId: participant.id, action: 'OTP_FAILED',
      entity: 'otp', entityId: row.id, ipHash, metadata: { channel, attempts } });
    return { status: 'INVALID', attemptsLeft: Math.max(0, row.max_attempts - attempts) };
  }

  // Consumed immediately: a code can never be replayed.
  await db().from('otp_verifications')
    .update({ consumed_at: new Date().toISOString(), attempts: row.attempts + 1 }).eq('id', row.id);

  if (purpose === 'CHALLENGE') {
    await audit({ eventId: participant.event_id, participantId: participant.id, action: 'OTP_VERIFIED',
      entity: 'participant', entityId: participant.id, ipHash, metadata: { channel, purpose } });
    return { status: 'VERIFIED', fullyVerified: Boolean(participant.mobile_verified_at && participant.email_verified_at) };
  }

  const now = new Date().toISOString();
  const mobileAt = channel === 'MOBILE' ? now : participant.mobile_verified_at;
  const emailAt = channel === 'EMAIL' ? now : participant.email_verified_at;
  const fullyVerified = Boolean(mobileAt && emailAt);
  const status = fullyVerified ? 'FULLY_VERIFIED' : channel === 'MOBILE' ? 'MOBILE_VERIFIED' : 'EMAIL_VERIFIED';

  const { error } = await db().from('participants')
    .update({ mobile_verified_at: mobileAt, email_verified_at: emailAt, status })
    .eq('id', participant.id)
    // Do not downgrade someone who has already spun.
    .in('status', ['REGISTERED', 'MOBILE_VERIFIED', 'EMAIL_VERIFIED', 'FULLY_VERIFIED', 'SPIN_ELIGIBLE']);

  if (error) {
    // Unique index hit: this mobile/email is already verified by someone else.
    if (error.code === '23505') return { status: 'INVALID', attemptsLeft: 0 };
    throw new Error(`participant verification update failed: ${error.message}`);
  }

  await audit({ eventId: participant.event_id, participantId: participant.id, action: 'OTP_VERIFIED',
    entity: 'participant', entityId: participant.id, ipHash, metadata: { channel } });

  return { status: 'VERIFIED', fullyVerified };
}
