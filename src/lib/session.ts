import { cookies } from 'next/headers';
import { db } from './db';
import { env } from './env';
import { generateToken, sha256 } from './crypto';
import type { AdminRole, AdminRow, ParticipantRow } from './types';

const PARTICIPANT_COOKIE = 'toap_ps';
const ADMIN_COOKIE = 'toap_as';
const PARTICIPANT_TTL_HOURS = 8;
const ADMIN_TTL_HOURS = 8;

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.mode === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

// ----------------------------------------------------------- participants
export async function createParticipantSession(
  participantId: string, eventId: string, ipHash: string | null, userAgent: string | null,
  identityConfirmed = true,
): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + PARTICIPANT_TTL_HOURS * 3600_000);
  await db().from('sessions').insert({
    participant_id: participantId, event_id: eventId, token_hash: sha256(token),
    expires_at: expiresAt.toISOString(), ip_hash: ipHash, user_agent: userAgent?.slice(0, 250) ?? null,
    identity_confirmed: identityConfirmed,
  });
  (await cookies()).set(PARTICIPANT_COOKIE, token, cookieOptions(PARTICIPANT_TTL_HOURS * 3600));
}

export interface ParticipantSession {
  sessionId: string;
  participant: ParticipantRow;
  /** False for a returning participant until they pass a fresh OTP challenge. */
  identityConfirmed: boolean;
}

/** Resolves the caller from the cookie. Identity NEVER comes from the request body. */
export async function currentSession(): Promise<ParticipantSession | null> {
  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  if (!token) return null;

  const { data } = await db()
    .from('sessions')
    .select('id, expires_at, revoked_at, identity_confirmed, participants(*)')
    .eq('token_hash', sha256(token))
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as {
    id: string; expires_at: string; revoked_at: string | null;
    identity_confirmed: boolean; participants: ParticipantRow | null;
  };
  if (row.revoked_at || !row.participants) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { sessionId: row.id, participant: row.participants, identityConfirmed: row.identity_confirmed };
}

export async function currentParticipant(): Promise<ParticipantRow | null> {
  return (await currentSession())?.participant ?? null;
}

export async function confirmSessionIdentity(sessionId: string): Promise<void> {
  await db().from('sessions').update({ identity_confirmed: true }).eq('id', sessionId);
}

export async function clearParticipantSession(): Promise<void> {
  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  if (token) {
    await db().from('sessions').update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', sha256(token));
  }
  (await cookies()).delete(PARTICIPANT_COOKIE);
}

// ----------------------------------------------------------------- admins
export async function createAdminSession(adminId: string, ipHash: string | null): Promise<void> {
  const token = generateToken();
  await db().from('admin_sessions').insert({
    admin_id: adminId, token_hash: sha256(token),
    expires_at: new Date(Date.now() + ADMIN_TTL_HOURS * 3600_000).toISOString(), ip_hash: ipHash,
  });
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(ADMIN_TTL_HOURS * 3600));
}

export interface AdminIdentity {
  id: string; email: string; fullName: string; role: AdminRole; eventId: string | null;
}

export async function currentAdmin(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const { data } = await db()
    .from('admin_sessions')
    .select('expires_at, revoked_at, admin_users(*)')
    .eq('token_hash', sha256(token))
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as {
    expires_at: string; revoked_at: string | null; admin_users: AdminRow | null;
  };
  const admin = row.admin_users;
  if (!admin || !admin.is_active || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return { id: admin.id, email: admin.email, fullName: admin.full_name,
           role: admin.role, eventId: admin.event_id };
}

export async function clearAdminSession(): Promise<void> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (token) {
    await db().from('admin_sessions').update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', sha256(token));
  }
  (await cookies()).delete(ADMIN_COOKIE);
}

/** Role gate. The role is read from the database session, never from the client. */
export async function requireAdmin(allowed: AdminRole[]): Promise<AdminIdentity | null> {
  const admin = await currentAdmin();
  if (!admin) return null;
  return allowed.includes(admin.role) ? admin : null;
}

export const ROLES = {
  all: ['SUPER_ADMIN', 'EVENT_ADMIN', 'BOOTH_OPERATOR'] as AdminRole[],
  management: ['SUPER_ADMIN', 'EVENT_ADMIN'] as AdminRole[],
  superOnly: ['SUPER_ADMIN'] as AdminRole[],
};
