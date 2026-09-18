import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { addParticipant, createEvent, hasDatabase, pool, spin } from './helpers';

const suite = hasDatabase ? describe : describe.skip;

/**
 * The scenario that decides whether this system is safe to run at a live booth:
 * several attendees tapping SPIN at the same moment while one item is left.
 */
suite('concurrency and idempotency', () => {
  let db: Pool;
  beforeAll(() => { db = pool(); });
  afterAll(async () => { await db.end(); });

  const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  it('gives the single Power Bank to at most one of eight simultaneous spinners', async () => {
    const eventId = await createEvent(db, unique('LASTITEM'), [
      { name: 'POWER_BANK', qty: 1, weight: 20 },
      { name: 'PEN', qty: 20, weight: 100 },
    ]);
    const participants = await Promise.all(
      Array.from({ length: 8 }, (_, i) => addParticipant(db, eventId, i)));

    const results = await Promise.all(participants.map((p) => spin(db, eventId, p)));

    // Which prize any one spinner draws is random, so the assertions are the
    // invariants: everyone wins something, nobody wins the same unit twice, and
    // stock always equals what was handed out.
    const powerBanks = results.filter((r) => r.prize?.name === 'POWER_BANK');
    expect(powerBanks.length).toBeLessThanOrEqual(1);
    expect(results.filter((r) => r.status === 'ALLOCATED')).toHaveLength(8);

    const { rows } = await db.query(
      `select p.name, p.initial_quantity, p.remaining_quantity,
              (select count(*)::int from winners w where w.prize_id = p.id) as won
         from prizes p where p.event_id = $1 order by p.name`, [eventId]);
    for (const row of rows) {
      expect(row.remaining_quantity).toBeGreaterThanOrEqual(0);
      expect(row.remaining_quantity).toBe(row.initial_quantity - row.won);
    }
    expect(rows.reduce((total, r) => total + r.won, 0)).toBe(8);
  });

  it('lets exactly one of eight win when a single unit is all that is left', async () => {
    // The spec's scenario with the randomness removed: one item, one winner,
    // everybody else is told the prizes are gone rather than handed a phantom.
    const eventId = await createEvent(db, unique('LASTONE'),
      [{ name: 'POWER_BANK', qty: 1, weight: 20 }]);
    const participants = await Promise.all(
      Array.from({ length: 8 }, (_, i) => addParticipant(db, eventId, i)));

    const results = await Promise.all(participants.map((p) => spin(db, eventId, p)));

    expect(results.filter((r) => r.status === 'ALLOCATED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'NO_INVENTORY')).toHaveLength(7);

    const { rows } = await db.query(
      `select remaining_quantity, (select count(*)::int from winners where event_id = $1) as winners
         from prizes where event_id = $1`, [eventId]);
    expect(rows[0].remaining_quantity).toBe(0);
    expect(rows[0].winners).toBe(1);
  });

  it('keeps inventory exactly at zero when 30 people chase 10 prizes at once', async () => {
    const eventId = await createEvent(db, unique('STAMPEDE'), [{ name: 'CAP', qty: 10, weight: 10 }]);
    const participants = await Promise.all(
      Array.from({ length: 30 }, (_, i) => addParticipant(db, eventId, i)));

    const results = await Promise.all(participants.map((p) => spin(db, eventId, p)));

    expect(results.filter((r) => r.status === 'ALLOCATED')).toHaveLength(10);
    expect(results.filter((r) => r.status === 'NO_INVENTORY')).toHaveLength(20);

    const { rows } = await db.query(
      `select remaining_quantity, (select count(*)::int from winners where event_id = $1) as winners
         from prizes where event_id = $1`, [eventId]);
    expect(rows[0].remaining_quantity).toBe(0);
    expect(rows[0].winners).toBe(10);
  });

  it('is idempotent when the same participant fires ten parallel requests', async () => {
    const eventId = await createEvent(db, unique('DOUBLETAP'), [{ name: 'PEN', qty: 50, weight: 10 }]);
    const participant = await addParticipant(db, eventId, 1);

    const results = await Promise.all(Array.from({ length: 10 }, () => spin(db, eventId, participant)));
    const codes = new Set(results.map((r) => r.winner_code));

    expect(codes.size).toBe(1);
    const { rows } = await db.query(
      `select (select count(*)::int from spins where event_id = $1) as spins,
              (select count(*)::int from winners where event_id = $1) as winners,
              (select remaining_quantity from prizes where event_id = $1) as remaining`, [eventId]);
    expect(rows[0].spins).toBe(1);
    expect(rows[0].winners).toBe(1);
    expect(rows[0].remaining).toBe(49);      // exactly one item left the shelf
  });

  it('issues unique winner codes across a burst of spins', async () => {
    const eventId = await createEvent(db, unique('CODES'), [{ name: 'PEN', qty: 200, weight: 10 }]);
    const participants = await Promise.all(
      Array.from({ length: 60 }, (_, i) => addParticipant(db, eventId, i)));
    const results = await Promise.all(participants.map((p) => spin(db, eventId, p)));
    expect(new Set(results.map((r) => r.winner_code)).size).toBe(60);
  });
});
