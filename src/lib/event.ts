import { db } from './db';
import { env } from './env';
import type { EventRow } from './types';

export interface EventSettings {
  branding: { organisation: string; short_name: string; logo_url?: string; partner?: string; tagline?: string };
  privacy_notice: { text: string };
  consent_text: { text: string };
  form_fields: Record<string, { required: boolean }>;
  otp: { ttl_seconds: number; max_attempts: number; resend_cooldown_seconds: number; max_sends_per_hour: number };
}

export const DEFAULT_SETTINGS: EventSettings = {
  branding: { organisation: 'Trust Officers Association of the Philippines', short_name: 'TOAP',
              partner: 'Powered by Credence Analytics', tagline: 'Scan. Verify. Spin. Win.' },
  privacy_notice: { text: 'We collect your details only to verify your entry and hand over your prize at the booth.' },
  consent_text: { text: 'I agree to the collection and use of my details for this event.' },
  form_fields: { company: { required: true }, designation: { required: false } },
  otp: { ttl_seconds: 300, max_attempts: 5, resend_cooldown_seconds: 60, max_sends_per_hour: 5 },
};

/** The event the public site is serving. EVENT_CODE pins it; otherwise the active one. */
export async function activeEvent(): Promise<EventRow | null> {
  const code = process.env.EVENT_CODE;
  const query = db().from('events').select('*').eq('is_active', true);
  const { data, error } = code
    ? await query.eq('code', code).maybeSingle()
    : await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  // A database problem must not be reported to attendees as "no event".
  if (error) throw new Error(`event lookup failed: ${error.message}`);
  return (data as EventRow | null) ?? null;
}

export async function eventSettings(eventId: string): Promise<EventSettings> {
  const { data } = await db().from('event_settings').select('key, value').eq('event_id', eventId)
    .returns<{ key: string; value: unknown }[]>();
  const merged: EventSettings = structuredClone(DEFAULT_SETTINGS);
  for (const row of data ?? []) {
    (merged as unknown as Record<string, unknown>)[row.key] = row.value;
  }
  return merged;
}

export type WindowState = 'OPEN' | 'NOT_STARTED' | 'ENDED' | 'DISABLED' | 'INACTIVE';

export function registrationWindow(event: EventRow, now = new Date()): WindowState {
  if (!event.is_active) return 'INACTIVE';
  if (!event.registration_enabled) return 'DISABLED';
  return within(event.registration_start, event.registration_end, now);
}

export function spinWindow(event: EventRow, now = new Date()): WindowState {
  if (!event.is_active) return 'INACTIVE';
  if (!event.spin_enabled) return 'DISABLED';
  return within(event.spin_start, event.spin_end, now);
}

function within(start: string | null, end: string | null, now: Date): WindowState {
  if (start && now < new Date(start)) return 'NOT_STARTED';
  if (end && now > new Date(end)) return 'ENDED';
  return 'OPEN';
}

/** ADMIN_EVENT_OVERRIDE lets staff smoke-test outside event hours. */
export function windowBlocked(state: WindowState): boolean {
  if (state === 'OPEN') return false;
  return !env.adminEventOverride;
}

export function windowMessage(state: WindowState): string {
  switch (state) {
    case 'NOT_STARTED': return 'Registration opens when the event starts. See you at the booth.';
    case 'ENDED': return 'This event has closed. Thank you for joining.';
    case 'DISABLED': return 'Entries are paused. Please check with the booth staff.';
    case 'INACTIVE': return 'This event is not currently running.';
    default: return '';
  }
}
