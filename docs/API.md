# API

All endpoints return JSON. Success is `{ ok: true, ... }`, failure is
`{ ok: false, error: "human readable", code: "MACHINE_CODE" }`. Stack traces,
SQL errors and provider errors never reach the client; they go to the server log
with a correlation id.

Mutating endpoints require a same-origin `Origin`/`Referer` header and reject
cross-site calls with `403 CSRF`. Session cookies are `httpOnly`, `Secure`,
`SameSite=Lax`.

## Public — attendee

### `GET /api/config`
Branding, privacy notice, consent text, active prize names for the wheel, and whether
registration and spinning are currently open. No personal data.

### `POST /api/register`
```json
{ "fullName": "Maria Santos", "company": "BDO Trust", "designation": "Trust Officer",
  "mobile": "0917 123 4567", "email": "maria@example.com", "consent": true }
```
Mobile is normalised to `+639XXXXXXXXX`; email is lower-cased and trimmed. Returns a
session cookie and the verification state. Re-registering the same unverified number
resumes that record and returns the same response shape, so the endpoint cannot be used
to test whether a number is already registered.

Errors: `VALIDATION` (400, with per-field messages), `EVENT_CLOSED` (403),
`RATE_LIMITED` (429), `DUPLICATE` (409, only for an already *verified* identity).

### `POST /api/otp/send`
```json
{ "channel": "MOBILE" }
```
Issues a 6-digit code to the channel on the session's participant record. Destinations
are never accepted from the request. Enforces a 60-second resend cooldown, 5 sends per
destination per hour, 12 per IP per hour. In dev mode the code is logged, not sent.

Errors: `COOLDOWN` (429, with `retryAfterSeconds`), `RATE_LIMITED` (429),
`PROVIDER_UNAVAILABLE` (502 — the code stays valid, the attendee can retry).

### `POST /api/otp/verify`
```json
{ "channel": "EMAIL", "code": "418205" }
```
Constant-time compare against the stored HMAC. Consumes the code on success, so it
cannot be replayed. Five wrong attempts burn the code. Returns the updated verification
state, including `eligibleToSpin` once both channels are verified.

Errors: `INVALID_CODE` (400), `EXPIRED` (410), `TOO_MANY_ATTEMPTS` (429).

### `POST /api/spin`
No body. Optional `Idempotency-Key` header. The server takes the participant from the
session cookie and everything else from the database.

```json
{ "ok": true, "alreadySpun": false, "noInventory": false,
  "prize": { "id": "…", "displayName": "Power Bank", "color": "#17605A" },
  "winnerCode": "TOAP-8F4K72", "wonAt": "2026-11-12T03:11:47Z",
  "collectionStatus": "PENDING", "participantName": "Maria Santos" }
```

A repeat call returns the same prize with `alreadySpun: true`. When every prize is out
of stock the response is `noInventory: true` with a null prize — no winner record is
created and no inventory moves.

Errors: `NO_SESSION` (401), `NOT_ELIGIBLE` (403), `EVENT_CLOSED` (403),
`BLOCKED` (403), `RATE_LIMITED` (429).

### `GET /api/me`
Current participant state: verification flags, spin result if any, winner code,
collection status. This is what the page reads after a refresh or a browser restart.

### `POST /api/logout`
Revokes the session row and clears the cookie.

## Admin

`POST /api/admin/login` takes email and password, returns an admin session cookie.
Rate limited to 5 attempts per email and 10 per IP per 15 minutes; repeated failures
lock the account for a cooling-off period. `POST /api/admin/logout` revokes the session.
`GET /api/admin/me` returns the identity and role.

Roles are read from the database on every request, never from the cookie payload or a
request field.

| Endpoint | Method | Roles | Notes |
|---|---|---|---|
| `/api/admin/stats` | GET | all | Dashboard counters from `event_stats()` |
| `/api/admin/prizes` | GET | all | Inventory table: initial, allocated, remaining, collected, weight, status |
| `/api/admin/prizes` | POST / PATCH | SUPER_ADMIN, EVENT_ADMIN | Add or edit a prize; name is normalised, colour must be a hex value |
| `/api/admin/prizes/inventory` | POST | SUPER_ADMIN, EVENT_ADMIN | `{ prizeId, adjustment, reason, confirm: true }`. Refuses to go below zero, writes an adjustment and audit row |
| `/api/admin/winners` | GET | all | `?q=` matches winner code, mobile, email, name or company; `?prize=`, `?status=`, `?limit=` (max 200). Booth operators receive masked contact details |
| `/api/admin/winners/collect` | POST | all | `{ winnerId, notes }`. Idempotent — a second call reports the first collection |
| `/api/admin/event` | GET / PATCH | SUPER_ADMIN, EVENT_ADMIN | Event windows, active flag, registration and spin toggles |
| `/api/admin/reports` | GET | SUPER_ADMIN, EVENT_ADMIN | `?type=registrations\|spins\|winners\|inventory\|collections\|audit`, CSV download, export itself is audited |
| `/api/admin/audit` | GET | SUPER_ADMIN, EVENT_ADMIN | `?action=`, `?limit=` (max 500) |

There is no delete endpoint for winners, spins or participants. Corrections are made by
blocking a participant or adjusting inventory, both of which leave an audit trail.

## Rate limits

| Bucket | Limit |
|---|---|
| OTP send per destination | 5 per hour, 60s cooldown between sends |
| OTP send per IP | 12 per hour |
| OTP verify per IP | 30 per hour |
| Registration per IP | 15 per hour |
| Spin per IP | 20 per hour |
| Admin login | 5 per email and 10 per IP per 15 minutes |

IPs are stored hashed, never in the clear.
