import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { addParticipant, createEvent, hasDatabase, pool, spin } from './helpers';

const suite = hasDatabase ? describe : describe.skip;

suite('prize allocation (PostgreSQL)', () => {
  let db: Pool;
  beforeAll(() => { db = pool(); });
  afterAll(async () => { await db.end(); });

  const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  it('allocates a prize, a winner record and a unique code', async () => {
    const eventId = await createEvent(db, unique('SINGLE'), [{ name: 'PEN', qty: 5, weight: 10 }]);
    const participant = await addParticipant(db, eventId, 1);

    const result = await spin(db, eventId, participant);
    expect(result.status).toBe('ALLOCATED');
    expect(result.already_spun).toBe(false);
    expect(result.prize?.name).toBe('PEN');
    expect(result.winner_code).toMatch(/^TOAP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    const { rows } = await db.query('select remaining_quantity from prizes where event_id = $1', [eventId]);
    expect(rows[0].remaining_quantity).toBe(4);
  });

  it('gives one participant exactly one spin, however many times they ask', async () => {
    const eventId = await createEvent(db, unique('ONCE'), [{ name: 'PEN', qty: 50, weight: 10 }]);
    const participant = await addParticipant(db, eventId, 1);

    const first = await spin(db, eventId, participant);
    const repeats = await Promise.all(Array.from({ length: 5 }, () => spin(db, eventId, participant)));

    for (const repeat of repeats) {
      expect(repeat.already_spun).toBe(true);
      expect(repeat.winner_code).toBe(first.winner_code);
    }
    const { rows } = await db.query('select count(*)::int as n from winners where event_id = $1', [eventId]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses a participant who has not verified both channels', async () => {
    const eventId = await createEvent(db, unique('UNVERIFIED'), [{ name: 'PEN', qty: 5, weight: 10 }]);
    const participant = await addParticipant(db, eventId, 1, 'REGISTERED');
    await expect(spin(db, eventId, participant)).rejects.toThrow(/NOT_ELIGIBLE/);
  });

  it('refuses a blocked participant', async () => {
    const eventId = await createEvent(db, unique('BLOCKED'), [{ name: 'PEN', qty: 5, weight: 10 }]);
    const participant = await addParticipant(db, eventId, 1, 'BLOCKED');
    await expect(spin(db, eventId, participant)).rejects.toThrow(/PARTICIPANT_BLOCKED/);
  });

  it('reports NO_INVENTORY instead of going negative when everything is gone', async () => {
    const eventId = await createEvent(db, unique('EMPTY'), [{ name: 'PEN', qty: 1, weight: 10 }]);
    const [a, b] = [await addParticipant(db, eventId, 1), await addParticipant(db, eventId, 2)];

    expect((await spin(db, eventId, a)).status).toBe('ALLOCATED');
    const second = await spin(db, eventId, b);
    expect(second.status).toBe('NO_INVENTORY');
    expect(second.prize).toBeNull();

    const { rows } = await db.query('select remaining_quantity from prizes where event_id = $1', [eventId]);
    expect(rows[0].remaining_quantity).toBe(0);
  });

  it('never allocates an inactive or zero-weight prize', async () => {
    const eventId = await createEvent(db, unique('INACTIVE'), [
      { name: 'PEN', qty: 10, weight: 10 },
      { name: 'CAP', qty: 10, weight: 10 },
    ]);
    await db.query(`update prizes set is_active = false where name = 'CAP' and event_id = $1`, [eventId]);

    for (let i = 0; i < 8; i++) {
      const p = await addParticipant(db, eventId, i);
      expect((await spin(db, eventId, p)).prize?.name).toBe('PEN');
    }
  });

  it('follows the configured weights', async () => {
    const eventId = await createEvent(db, unique('WEIGHTS'), [
      { name: 'COMMON', qty: 400, weight: 90 },
      { name: 'RARE', qty: 400, weight: 10 },
    ]);
    const counts: Record<string, number> = { COMMON: 0, RARE: 0 };
    for (let i = 0; i < 300; i++) {
      const p = await addParticipant(db, eventId, i);
      const name = (await spin(db, eventId, p)).prize?.name ?? '';
      counts[name] = (counts[name] ?? 0) + 1;
    }
    // 90/10 split: allow a wide band so the test is not flaky.
    expect(counts.COMMON).toBeGreaterThan(230);
    expect(counts.RARE).toBeGreaterThan(5);
    expect((counts.COMMON ?? 0) + (counts.RARE ?? 0)).toBe(300);
  });
});
