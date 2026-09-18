# Deployment

Target: `https://toap.credenceanalytics.com`. Allow half a day, and do it at least a
week before the event so the SMS sender name has time to be approved.

## 1. Supabase project

Create a project in the region closest to Manila (Singapore). Note the project URL,
the anon key and the service role key from Project settings → API. Keep the service
role key out of everything except the hosting environment variables.

## 2. Schema

SQL editor, or `psql` with the connection string from Project settings → Database:

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_functions.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

`seed.sql` creates the TOAP 2026 event, its settings and the four prizes at the
example quantities. It creates no admin accounts and no passwords.

Check it took:

```sql
select code, name, is_active from events;
select name, initial_quantity, remaining_quantity, weight from prizes order by display_order;
```

## 3. Resend (email OTP)

Add the sending domain, publish the DKIM, SPF and DMARC records Resend gives you, wait
for verification, then create an API key. `EMAIL_FROM` must use the verified domain —
a mismatch is the usual cause of silent non-delivery. Send yourself a test email from
the Resend dashboard before moving on.

## 4. Semaphore (SMS OTP)

Buy credits and register the sender name. Sender name approval is manual and is the
long pole in this list; unapproved names fall back to a generic sender or fail. Note
the API key. Budget roughly one message per attendee plus resends.

## 5. Hosting

Any platform that runs Next.js 16 with middleware works. Vercel is the shortest path
and what the build has been verified against; a Node container on Cloud Run or
Railway is equivalent if you prefer to keep everything in one cloud account. The app
needs a Node runtime — a pure static export will not work, because every route that
matters is server-side.

Deploy from the repository, then set environment variables in the hosting dashboard
(values from `.env.example`):

```
APP_MODE=production
NEXT_PUBLIC_APP_URL=https://toap.credenceanalytics.com
EVENT_CODE=TOAP2026
SUPABASE_URL=…
SUPABASE_SERVICE_ROLE_KEY=…
SESSION_SECRET=…                 # openssl rand -base64 48
OTP_PEPPER=…                     # openssl rand -base64 48
SMS_PROVIDER=semaphore
SEMAPHORE_API_KEY=…
SEMAPHORE_SENDER_NAME=…
EMAIL_PROVIDER=resend
RESEND_API_KEY=…
EMAIL_FROM="TOAP Spin & Win <noreply@credenceanalytics.com>"
OTP_DEV_MODE=false
ADMIN_EVENT_OVERRIDE=false
```

`OTP_PEPPER` must never change after the event opens — existing codes become
unverifiable. `SESSION_SECRET` rotation logs everyone out.

## 6. Domain and HTTPS

`toap.credenceanalytics.com` is a subdomain of a domain you may not control. Send
whoever runs DNS for `credenceanalytics.com` a single record:

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | `toap` | the hostname your host gives you (e.g. `cname.vercel-dns.com`) | 300 |

If the DNS provider will not allow a CNAME at that level, ask for the A record the
host offers instead. Certificates are issued automatically once the record resolves —
usually minutes, occasionally an hour. Ask for the record at least three working days
ahead; DNS changes at banks are rarely same-day.

## 7. First admin

With the production environment variables loaded locally:

```bash
npm run seed:admin
```

Create one `SUPER_ADMIN` for yourself, one `EVENT_ADMIN` for whoever runs the booth,
and a `BOOTH_OPERATOR` per staff device. Booth operators can search winners and mark
prizes collected, nothing else. Use a password manager; do not share one login.

## 8. Smoke test

```bash
BASE_URL=https://toap.credenceanalytics.com npm run smoke-test
```

Then by hand, on a real phone on mobile data, not office wifi:

1. Open the URL, register with your own number and email.
2. Confirm the SMS arrives within 30 seconds and the email within 60.
3. Verify both, spin, note the winner code.
4. Refresh, close the browser, reopen: the same code and prize come back.
5. Open `/booth`, search that code, mark it collected, try to collect it again.
6. `/admin` → reports → export the winners CSV.
7. Delete your test participant only if you must: use SQL, and expect the audit rows
   to remain. It is cleaner to leave it and filter it out of the final report.

## 9. QR code

The QR contains nothing but the URL:

```
https://toap.credenceanalytics.com
```

Generate at high error correction (level H) so a printed logo in the centre still
scans, at least 300 dpi, and no smaller than 4 cm across for a table tent or 15 cm for
a standee. Any reputable generator or, offline:

```bash
npx qrcode -o toap-qr.png -e H -w 1200 https://toap.credenceanalytics.com
```

Print a test copy and scan it with an old Android phone and an iPhone before sending
the artwork to the printer. Keep a second printed QR at the booth as a spare, and put
the plain URL underneath the code in readable type for anyone whose camera struggles.

## 10. Go live

On the morning of the event, in `/admin` → event: confirm the registration and spin
windows match the programme in Manila time, confirm prize quantities against the
physical stock on the table, and confirm `OTP_DEV_MODE` is absent from the production
environment. The app will refuse to boot if it is set to `true` with
`APP_MODE=production`, which is the intended safety net rather than something to rely on.

## Rollback

The database is the state. A bad deploy is rolled back from the hosting dashboard
without touching data. Do not re-run `seed.sql` after the event opens — it is guarded
by `on conflict do nothing`, but there is no reason to take the risk.
