# Security

The threat model is a public URL printed on a card at a banking conference, handed to
a few hundred people, some of whom work in technology and will poke at it. The value at
risk is small (a power bank) but the embarrassment is not, and the app holds personal
data covered by the Philippine Data Privacy Act.

## Principle

The backend and the database are authoritative. Nothing that decides an outcome is ever
read from the request: not the participant id, not the prize id, not the inventory count,
not eligibility, not spin status, not the admin role.

## Controls

| Threat | Control |
|---|---|
| Prize chosen in the browser | The prize is selected inside `allocate_spin()` in PostgreSQL. The wheel animates to a result it is handed |
| Second spin after a refresh, new tab or new browser | `unique (event_id, participant_id)` on `spins`, plus an advisory lock per participant. Replays return the first result |
| Double tap, duplicate request, retry after a timeout | Same transaction returns `already_spun: true`. Optional `Idempotency-Key` header. The button disables on click as a courtesy, not as a control |
| Two people winning the last item | `SELECT … FOR UPDATE` on the candidate prizes, then `UPDATE … WHERE remaining_quantity > 0` with a row-count check. Verified by `tests/integration/concurrency.test.ts` |
| Negative inventory | `check (remaining_quantity >= 0)` on the column, on top of the guarded update |
| Tampering with prize ids or quantities | Neither is accepted from the client on any endpoint |
| SQL injection | Parameterised queries and RPC arguments only; no string-built SQL |
| XSS | React escaping, no `dangerouslySetInnerHTML`, input rejects angle brackets and control characters, security headers set in `next.config.mjs` |
| CSRF | Same-origin check on every mutating route, `SameSite=Lax` cookies |
| Session theft | Opaque 32-byte tokens; only a SHA-256 hash is stored. `httpOnly`, `Secure`, revocable server-side |
| OTP brute force | 6 digits, 5 attempts per code, code burned on the fifth, 5-minute expiry, per-destination and per-IP rate limits |
| OTP interception or replay | Consumed on first success, constant-time comparison, never reusable |
| OTP stored or logged in the clear | HMAC-SHA256 with a server-side `OTP_PEPPER`; codes appear in logs only in dev mode |
| Account enumeration | Registration and OTP responses do not reveal whether a mobile or email is already in use |
| Brute force on admin login | bcrypt, 5 attempts per email and 10 per IP per 15 minutes, lockout with a cooling-off period, failures audited |
| Privilege escalation | Role is fetched from `admin_users` on every request. Middleware only decides which page to show; it grants nothing |
| Mass assignment | Zod schemas with explicit fields; unknown keys are dropped |
| Data exposure to the browser | Booth operators see masked mobile and email. No personal data in URLs or query strings |
| Direct database access with a leaked anon key | RLS enabled on every table with no public policy. All access uses the service role key, server-side only |
| Secrets in the repository | `.env` is git-ignored, `.env.example` holds placeholders only, no key is referenced from client code |
| Information leakage in errors | Client errors are generic with a machine code; details, stack traces and correlation ids stay in the server log |

## Data privacy

Collected: name, company, designation, mobile, email — the minimum needed to verify one
entry and hand over one prize. The consent line and privacy notice are stored in
`event_settings` and shown before the first field is filled.

Not collected: location, device fingerprints, third-party analytics. IP addresses are
hashed before storage and used only for rate limiting. OTP values never enter the audit
log. Participant records are exportable and deletable by SQL for a data-subject request;
audit rows keep the action without re-stating the personal details.

Agree a retention date with the organiser — the seeded notice says 90 days — and delete
the participant table for the event after the prizes are handed out and the report is filed.

## Pre-event security checklist

- [ ] `OTP_DEV_MODE` unset or false in production
- [ ] `SESSION_SECRET` and `OTP_PEPPER` are unique 48-byte random values, not reused from staging
- [ ] Service role key present only in the hosting environment variables
- [ ] No `.env` file committed; repository scanned for keys
- [ ] HTTPS enforced, certificate valid, HTTP redirects
- [ ] Admin accounts created individually, no shared login, no default password
- [ ] Booth operators are `BOOTH_OPERATOR`, not admins
- [ ] Rate limits exercised against the deployed URL
- [ ] Concurrency test run against the production schema
- [ ] Reports export works and is restricted to management roles
