# TOAP Spin & Win

A mobile-first web app for the Trust Officers Association of the Philippines booth:
an attendee scans a QR code, registers, verifies mobile and email by OTP, gets **one**
spin, and receives a winner code to redeem at the booth.

One verified participant = one spin = one prize. That rule is enforced in PostgreSQL,
not in the browser.

---

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind | One deployable unit; server components keep the public page small |
| Backend | Next.js route handlers (`/src/app/api/*`) | A modular monolith. No microservices for a one-day booth |
| Database | Supabase PostgreSQL | Managed Postgres, transactional guarantees, easy export |
| Prize allocation | `allocate_spin()` PL/pgSQL function | Advisory lock + row locks + guarded decrement in one transaction |
| Participant auth | Opaque session token, SHA-256 hashed in `sessions`, httpOnly cookie | No participant id or eligibility flag ever comes from the client |
| Admin auth | Email + bcrypt password, server-side session in `admin_sessions`, role read from the DB | Separate cookie and separate table from attendees |
| OTP | 6-digit, HMAC-hashed with a server pepper, 5-minute TTL | Plaintext codes are never stored or logged |
| SMS / Email | Provider interface with Semaphore and Resend implementations, plus a console provider | Swap providers without touching call sites |

### The spin path

```
POST /api/spin  (same-origin check, session cookie, IP rate limit, event window)
        |
        v
allocate_spin(event, participant, ip_hash, idempotency_key)   -- one transaction
        |-- pg_advisory_xact_lock on the participant           serialises retries
        |-- existing spin?  -> return the same prize, already_spun = true
        |-- eligibility read from participants, not the request
        |-- SELECT ... FOR UPDATE on active prizes with stock  serialises inventory
        |-- weighted pick over remaining prizes
        |-- UPDATE prizes SET remaining = remaining - 1 WHERE remaining > 0
        |-- INSERT spins (unique on event + participant), INSERT winners, audit rows
        v
{ prize, winnerCode }  ->  the wheel animates to a result it was given
```

The browser sends no participant id, no prize id, no eligibility flag. It receives
an outcome. A refresh, a second tab, a double tap or a lost connection all return
the same winner record.

---

## Project layout

```
src/app/            public flow (/), admin dashboard (/admin), booth screen (/booth)
src/app/api/        route handlers — register, otp, spin, me, admin/*
src/lib/            db, session, otp, validation, rate-limit, audit, providers
src/components/     SpinFlow (attendee state machine), Wheel, shared UI
supabase/migrations 0001_schema.sql (tables, indexes, RLS), 0002_functions.sql (logic)
supabase/seed.sql   TOAP 2026 event, settings, four prizes. No admin passwords.
tests/unit          OTP, winner codes, weighted selection, validation, CSV
tests/integration   allocation, concurrency, collection — against a real PostgreSQL
scripts/            create-admin, smoke-test, concurrency-test
docs/               deployment, admin, event day, security, API, database, testing
```

## Quick start

```bash
npm install
cp .env.example .env.local        # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
openssl rand -base64 48           # -> SESSION_SECRET
openssl rand -base64 48           # -> OTP_PEPPER

# load the schema into your Supabase project (SQL editor or psql)
psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_functions.sql
psql "$DATABASE_URL" -f supabase/seed.sql

npm run seed:admin                # creates the first SUPER_ADMIN, prompts for a password
npm run dev
```

With `OTP_DEV_MODE=true` no SMS or email is sent — both codes are printed to the
server console. The app refuses to start with that flag on while `APP_MODE=production`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript, ESLint |
| `npm test` | All vitest suites (integration skips itself without `TEST_DATABASE_URL`) |
| `npm run test:integration` | Allocation, concurrency and collection against real PostgreSQL |
| `npm run seed:admin` | Create an admin user interactively |
| `npm run smoke-test` | Post-deploy check against `BASE_URL` |
| `npm run concurrency-test` | Fires N simultaneous spins at the last item |

## Verification status

Run on this build:

- `tsc --noEmit` — clean
- `next build` — succeeds, 23 routes
- `vitest run tests/unit` — 25 passed
- `vitest run tests/integration` against PostgreSQL 16 — 15 passed, run repeatedly to
  check for flakiness, including the last-unit concurrency race and double-collection

Not runnable outside a deployed environment, and listed in `docs/TESTING.md` as
manual steps before the event: live Semaphore SMS delivery, live Resend email
delivery, and the QR-to-phone end-to-end pass on Android and iOS.

## Documentation

- `docs/DEPLOYMENT.md` — Supabase, Resend, Semaphore, hosting, DNS, QR code
- `docs/DATABASE.md` — ERD, tables, constraints, functions
- `docs/API.md` — every endpoint, request, response and error code
- `docs/SECURITY.md` — threat-by-threat control list
- `docs/ADMIN_GUIDE.md` — dashboard, prizes, inventory, reports
- `docs/EVENT_DAY.md` — booth operations, one page
- `docs/TESTING.md` — what is covered and how to run it
- `docs/PRODUCTION_CHECKLIST.md` — sign-off before the doors open
