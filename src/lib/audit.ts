import { db } from './db';

export type AuditAction =
  | 'PARTICIPANT_REGISTERED' | 'OTP_SENT' | 'OTP_VERIFIED' | 'OTP_FAILED'
  | 'SPIN_INITIATED' | 'PRIZE_ALLOCATED' | 'WINNER_CREATED' | 'SPIN_NO_INVENTORY'
  | 'PRIZE_COLLECTED' | 'COLLECTION_REJECTED' | 'INVENTORY_CHANGED' | 'PRIZE_CONFIG_CHANGED'
  | 'EVENT_CONFIG_CHANGED' | 'ADMIN_LOGIN' | 'ADMIN_LOGOUT' | 'ADMIN_LOGIN_FAILED'
  | 'REPORT_EXPORTED' | 'RATE_LIMITED';

export interface AuditInput {
  eventId?: string | null;
  adminId?: string | null;
  participantId?: string | null;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_KEYS = ['code', 'otp', 'password', 'token', 'secret', 'code_hash'];

/** Audit writes never block the user flow and never carry OTPs or credentials. */
export async function audit(input: AuditInput): Promise<void> {
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.metadata ?? {})) {
    if (!FORBIDDEN_KEYS.includes(k.toLowerCase())) metadata[k] = v;
  }
  try {
    await db().from('audit_logs').insert({
      event_id: input.eventId ?? null,
      admin_id: input.adminId ?? null,
      participant_id: input.participantId ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entity_id: input.entityId ?? null,
      ip_hash: input.ipHash ?? null,
      metadata,
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', context: 'audit', action: input.action,
      message: error instanceof Error ? error.message : String(error) }));
  }
}
