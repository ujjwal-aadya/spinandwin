import { Pool } from 'pg';

/**
 * Integration tests run against a real PostgreSQL database — Supabase, or a
 * local instance loaded with supabase/migrations/*.sql. They are skipped when
 * TEST_DATABASE_URL is not set.
 *
 *   createdb toap_test
 *   psql -d toap_test -f supabase/migrations/0001_schema.sql
 *   psql -d toap_test -f supabase/migrations/0002_functions.sql
 *   TEST_DATABASE_URL=postgres://…/toap_test npm run test:integration
 */
export const DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDatabase = Boolean(DATABASE_URL);

export function pool(): Pool {
  return new Pool({ connectionString: DATABASE_URL, max: 12 });
}

export interface PrizeSpec { name: string; qty: number; weight: number }

export async function createEvent(db: Pool, code: string, prizes: PrizeSpec[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into events (code, name, is_active) values ($1, $2, true) returning id`,
    [code, `Test ${code}`],
  );
  const eventId = rows[0]!.id;
  for (const [index, prize] of prizes.entries()) {
    await db.query(
      `insert into prizes (event_id, name, display_name, initial_quantity, remaining_quantity, weight, display_order)
       values ($1, $2, $3, $4, $4, $5, $6)`,
      [eventId, prize.name, prize.name, prize.qty, prize.weight, index],
    );
  }
  return eventId;
}

export async function addParticipant(
  db: Pool, eventId: string, index: number, status = 'FULLY_VERIFIED',
): Promise<string> {
  const suffix = String(100000 + index).slice(-7);
  const { rows } = await db.query<{ id: string }>(
    `insert into participants (event_id, full_name, company, mobile, email, status,
                               mobile_verified_at, email_verified_at)
     values ($1, $2, 'Test Bank', $3, $4, $5::participant_status,
             case when $5::text in ('REGISTERED') then null else now() end,
             case when $5::text in ('REGISTERED') then null else now() end)
     returning id`,
    [eventId, `Attendee ${index}`, `+639${suffix}00`, `attendee${index}.${eventId.slice(0, 8)}@example.ph`, status],
  );
  return rows[0]!.id;
}

export interface SpinOutcome {
  already_spun: boolean; status: string;
  prize: { id: string; name: string; display_name: string } | null;
  winner_code?: string;
}

export async function spin(db: Pool, eventId: string, participantId: string): Promise<SpinOutcome> {
  const { rows } = await db.query<{ allocate_spin: SpinOutcome }>(
    'select allocate_spin($1, $2, $3, $4) as allocate_spin',
    [eventId, participantId, 'test-ip-hash', null],
  );
  return rows[0]!.allocate_spin;
}
