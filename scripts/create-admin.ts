/**
 * Creates an administrator with a password you type in — no default
 * credentials are ever written to the repository or the seed file.
 *
 *   npx tsx scripts/create-admin.ts
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const ROLES = ['SUPER_ADMIN', 'EVENT_ADMIN', 'BOOTH_OPERATOR'] as const;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');

  const rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('Email: ')).trim().toLowerCase();
  const fullName = (await rl.question('Full name: ')).trim();
  const role = (await rl.question(`Role (${ROLES.join(' / ')}): `)).trim().toUpperCase();
  const password = (await rl.question('Password (min 12 characters): ')).trim();
  rl.close();

  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('That email does not look right.');
  if (!ROLES.includes(role as (typeof ROLES)[number])) throw new Error(`Role must be one of ${ROLES.join(', ')}`);
  if (password.length < 12) throw new Error('Use at least 12 characters.');

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from('admin_users').insert({
    email, full_name: fullName, role, password_hash: await bcrypt.hash(password, 12), is_active: true,
  });
  if (error) throw new Error(error.message);

  console.log(`Created ${role} ${email}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
