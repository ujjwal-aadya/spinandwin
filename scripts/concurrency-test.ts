/**
 * Booth-day confidence check: fires N simultaneous spins at a live database
 * and proves that inventory cannot go negative and nobody spins twice.
 *
 *   TEST_DATABASE_URL=postgres://… npx tsx scripts/concurrency-test.ts 25
 */
import { Pool } from 'pg';

const CONNECTION = process.env.TEST_DATABASE_URL;
const SPINNERS = Number(process.argv[2] ?? 20);

async function main() {
  if (!CONNECTION) throw new Error('Set TEST_DATABASE_URL (use a test database, never production).');
  const db = new Pool({ connectionString: CONNECTION, max: Math.min(SPINNERS, 20) });
  const code = `CONCURRENCY-${Date.now()}`;

  const { rows: [event] } = await db.query(
    `insert into events (code, name, is_active) values ($1, 'Concurrency check', true) returning id`, [code]);
  await db.query(
    `insert into prizes (event_id, name, display_name, initial_quantity, remaining_quantity, weight, display_order)
     values ($1,'POWER_BANK','Power Bank',1,1,20,0), ($1,'PEN','Pen',$2,$2,100,1)`,
    [event.id, SPINNERS]);

  const participants: string[] = [];
  for (let i = 0; i < SPINNERS; i++) {
    const { rows } = await db.query(
      `insert into participants (event_id, full_name, mobile, email, status, mobile_verified_at, email_verified_at)
       values ($1, $2, $3, $4, 'FULLY_VERIFIED', now(), now()) returning id`,
      [event.id, `Tester ${i}`, `+63917${String(1000000 + i).slice(-7)}`, `tester${i}.${code}@example.ph`]);
    participants.push(rows[0].id);
  }

  const started = Date.now();
  const results = await Promise.all(participants.map((id) =>
    db.query('select allocate_spin($1, $2, $3, $4) as r', [event.id, id, 'script', null])
      .then((r) => r.rows[0].r as { status: string; prize: { name: string } | null })));
  const elapsed = Date.now() - started;

  const { rows: inventory } = await db.query(
    'select name, remaining_quantity from prizes where event_id = $1 order by name', [event.id]);
  const { rows: [counts] } = await db.query(
    `select (select count(*)::int from spins where event_id = $1) as spins,
            (select count(*)::int from winners where event_id = $1) as winners,
            (select count(distinct winner_code)::int from winners where event_id = $1) as codes`, [event.id]);

  const powerBanks = results.filter((r) => r.prize?.name === 'POWER_BANK').length;
  const negative = inventory.filter((p) => p.remaining_quantity < 0);

  console.log(`\n${SPINNERS} simultaneous spins in ${elapsed}ms`);
  console.table(inventory);
  console.log({ ...counts, powerBanksIssued: powerBanks });

  const failures: string[] = [];
  if (powerBanks !== 1) failures.push(`expected exactly 1 Power Bank, got ${powerBanks}`);
  if (negative.length) failures.push('inventory went negative');
  if (counts.spins !== SPINNERS) failures.push(`expected ${SPINNERS} spins, got ${counts.spins}`);
  if (counts.codes !== counts.winners) failures.push('duplicate winner codes');

  await db.query('delete from events where id = $1', [event.id]);
  await db.end();

  if (failures.length) { console.error('\nFAILED:', failures.join('; ')); process.exit(1); }
  console.log('\nPASSED — one prize per attendee, no negative inventory, unique codes.');
}

main().catch((error) => { console.error(error); process.exit(1); });
