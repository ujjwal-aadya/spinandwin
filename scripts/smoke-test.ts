/**
 * End-to-end check against a running deployment, using the attendee HTTP API
 * exactly as a phone would. Requires OTP_DEV_MODE=true on the target so the
 * codes come back in the response instead of by SMS/email.
 *
 *   BASE_URL=https://toap-staging.example.com npx tsx scripts/smoke-test.ts
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

let cookie = '';

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      origin: BASE,
      ...(init?.headers ?? {}),
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;
  const payload = await res.json() as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) throw new Error(`${path} → ${res.status} ${payload.error}`);
  return payload.data as T;
}

async function main() {
  const suffix = String(Date.now()).slice(-7);
  const person = {
    fullName: 'Smoke Test', company: 'Credence Analytics', designation: 'QA',
    mobile: `+63917${suffix}`, email: `smoke.${suffix}@example.ph`, consent: true,
  };

  console.log('1. config');
  await call('/api/config');

  console.log('2. register');
  await call('/api/register', { method: 'POST', json: person });

  for (const channel of ['MOBILE', 'EMAIL'] as const) {
    console.log(`3. ${channel.toLowerCase()} otp`);
    const sent = await call<{ devCode?: string }>('/api/otp/send', { method: 'POST', json: { channel } });
    if (!sent.devCode) throw new Error('No dev code returned — set OTP_DEV_MODE=true on the target.');
    await call('/api/otp/verify', { method: 'POST', json: { channel, code: sent.devCode } });
  }

  console.log('4. spin');
  const result = await call<{ prize: { displayName: string } | null; winnerCode: string | null }>(
    '/api/spin', { method: 'POST', headers: { 'Idempotency-Key': `smoke-${suffix}` } });
  console.log(`   won: ${result.prize?.displayName ?? 'nothing left'} (${result.winnerCode ?? '—'})`);

  console.log('5. second spin must return the same result');
  const again = await call<{ alreadySpun: boolean; winnerCode: string | null }>(
    '/api/spin', { method: 'POST', headers: { 'Idempotency-Key': `smoke-${suffix}` } });
  if (!again.alreadySpun || again.winnerCode !== result.winnerCode) {
    throw new Error('One-spin rule broken.');
  }

  console.log('\nSmoke test passed. Remember to remove the test participant before the event.');
}

main().catch((error) => { console.error('\nFAILED:', error.message); process.exit(1); });
