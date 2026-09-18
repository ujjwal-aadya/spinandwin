# Production readiness checklist

Sign off before the doors open. Anything unticked is a decision, not an oversight.

## Infrastructure
- [ ] Supabase project created in the Singapore region
- [ ] `0001_schema.sql` and `0002_functions.sql` applied, verified by querying `events` and `prizes`
- [ ] Row level security enabled on every table (it is, in the migration — confirm it was not relaxed)
- [ ] Database backups on; a manual snapshot taken the night before
- [ ] Application deployed and reachable over HTTPS
- [ ] `toap.credenceanalytics.com` resolving, certificate valid

## Configuration
- [ ] Event name, venue, date correct
- [ ] Registration and spin windows in Manila time, checked against the programme
- [ ] Prize quantities match the physical stock on the table
- [ ] Weights agreed with the organiser and sanity-checked against expected footfall
- [ ] Branding, privacy notice and consent text reviewed by whoever owns compliance

## Providers
- [ ] Semaphore credits topped up with headroom for resends
- [ ] Semaphore sender name approved
- [ ] Resend domain verified, DKIM/SPF/DMARC published
- [ ] `EMAIL_FROM` uses the verified domain
- [ ] Test SMS and test email received end to end

## Security
- [ ] `APP_MODE=production`
- [ ] `OTP_DEV_MODE` unset or false
- [ ] `SESSION_SECRET` and `OTP_PEPPER` freshly generated, 48 bytes, not shared with staging
- [ ] Service role key only in hosting environment variables
- [ ] Admin accounts individual, strong passwords, no shared login
- [ ] Booth staff on `BOOTH_OPERATOR` only

## Verification
- [ ] Build, lint, typecheck clean
- [ ] Unit and integration suites green against the production schema
- [ ] Concurrency test run
- [ ] Android and iPhone end-to-end from a scanned QR
- [ ] Refresh, reopen and second-spin attempts behave
- [ ] Duplicate mobile and duplicate email rejected
- [ ] Booth search and mark-collected work, double collection refused
- [ ] All six reports export

## Operations
- [ ] Printed QR tested on two phones, spare printed
- [ ] Booth network tested where attendees will stand
- [ ] `EVENT_DAY.md` printed and on the table
- [ ] Named person on call for the day, with admin access and this repository
- [ ] Paper fallback agreed for a total outage
- [ ] Data retention date agreed with the organiser
