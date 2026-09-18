import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { addParticipant, createEvent, hasDatabase, pool, spin } from './helpers';

const suite = hasDatabase ? describe : describe.skip;

suite('collection, inventory adjustment and the acceptance scenario', () => {
  let db: Pool;
  let adminId: string;

  beforeAll(async () => {
    db = pool();
    const { rows } = await db.query<{ id: string }>(
      `insert into admin_users (email, full_name, password_hash, role)
       values ($1, 'Test Admin', 'x', 'EVENT_ADMIN') returning id`,
      [`admin-${Date.now()}@example.ph`]);
    adminId = rows[0]!.id;
  });
  afterAll(async () => { await db.end(); });

  const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  async function collect(winnerId: string) {
    const { rows } = await db.query('select collect_prize($1, $2, $3, $4) as result',
      [winnerId, adminId, 'handed over at booth', 'ip']);
    return rows[0].result as { ok: boolean; reason?: string };
  }

  it('marks a prize collected once and refuses the second attempt', async () => {
    const eventId = await createEvent(db, unique('COLLECT'), [{ name: 'PEN', qty: 5, weight: 10 }]);
    const participant = await addParticipant(db, eventId, 1);
    await spin(db, eventId, participant);

    const { rows } = await db.query('select id from winners where event_id = $1', [eventId]);
    const winnerId = rows[0].id as string;

    expect((await collect(winnerId)).ok).toBe(true);
    const second = await collect(winnerId);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('ALREADY_COLLECTED');

    const { rows: after } = await db.query(
      `select w.collection_status, p.status,
              (select count(*)::int from prize_collections where winner_id = w.id) as records
         from winners w join participants p on p.id = w.participant_id where w.id = $1`, [winnerId]);
    expect(after[0].collection_status).toBe('COLLECTED');
    expect(after[0].status).toBe('PRIZE_COLLECTED');
    expect(after[0].records).toBe(1);
  });

  it('records inventory adjustments and refuses to go negative', async () => {
    const eventId = await createEvent(db, unique('STOCK'), [{ name: 'POWER_BANK', qty: 2, weight: 10 }]);
    const { rows } = await db.query('select id from prizes where event_id = $1', [eventId]);
    const prizeId = rows[0].id as string;

    const { rows: added } = await db.query('select adjust_inventory($1, $2, $3, $4) as r',
      [prizeId, 10, 'Additional stock received', adminId]);
    expect(added[0].r).toMatchObject({ previous: 2, adjustment: 10, new: 12 });

    await expect(db.query('select adjust_inventory($1, $2, $3, $4)',
      [prizeId, -99, 'typo', adminId])).rejects.toThrow(/NEGATIVE_INVENTORY/);

    const { rows: ledger } = await db.query(
      'select count(*)::int as n from prize_inventory_adjustments where prize_id = $1', [prizeId]);
    expect(ledger[0].n).toBe(1);
  });

  it('runs the final acceptance scenario end to end', async () => {
    // Pen 3, Cap 2, Power Bank 1, Earphones 1 = 7 prizes for 9 attendees.
    const eventId = await createEvent(db, unique('ACCEPTANCE'), [
      { name: 'PEN', qty: 3, weight: 100 },
      { name: 'CAP', qty: 2, weight: 50 },
      { name: 'POWER_BANK', qty: 1, weight: 20 },
      { name: 'EARPHONES', qty: 1, weight: 10 },
    ]);

    const participants = await Promise.all(
      Array.from({ length: 9 }, (_, i) => addParticipant(db, eventId, i)));
    const results = await Promise.all(participants.map((p) => spin(db, eventId, p)));

    expect(results.filter((r) => r.status === 'ALLOCATED')).toHaveLength(7);
    expect(results.filter((r) => r.status === 'NO_INVENTORY')).toHaveLength(2);

    const { rows: totals } = await db.query(
      `select coalesce(sum(remaining_quantity), 0)::int as remaining,
              (select count(*)::int from winners where event_id = $1) as winners,
              (select count(distinct winner_code)::int from winners where event_id = $1) as codes,
              (select count(*)::int from spins where event_id = $1) as spins
         from prizes where event_id = $1`, [eventId]);
    expect(totals[0]).toMatchObject({ remaining: 0, winners: 7, codes: 7, spins: 9 });

    // Every audit event the organisers need afterwards is present.
    const { rows: actions } = await db.query(
      `select distinct action from audit_logs where event_id = $1`, [eventId]);
    const names = actions.map((a) => a.action);
    expect(names).toContain('PRIZE_ALLOCATED');
    expect(names).toContain('WINNER_CREATED');
    expect(names).toContain('SPIN_NO_INVENTORY');

    // And no audit row ever carries an OTP value.
    const { rows: leaks } = await db.query(
      `select count(*)::int as n from audit_logs
        where event_id = $1 and (metadata ? 'code' or metadata ? 'otp')`, [eventId]);
    expect(leaks[0].n).toBe(0);
  });
});
