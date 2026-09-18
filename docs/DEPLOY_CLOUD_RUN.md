# Deploying to Google Cloud Run — no DNS, no domain

Cloud Run gives every service a permanent HTTPS URL of its own:

```
https://toap-spin-win-472913084621.asia-southeast1.run.app
```

That URL is free, has a valid certificate, and needs no DNS record and no domain.
It is what the QR code points at. Use this instead of a bare IP address.

**Why not a raw IP.** A plain `http://34.x.x.x` breaks this app. Session cookies are
issued with the `Secure` flag, so a browser on plain HTTP will discard them and nobody
gets past registration. Certificates for bare IPs are awkward to obtain, and a
"Not secure" warning in front of trust officers being asked for their mobile number is
not a good look. If you genuinely need a fixed IP, see the appendix at the end.

Total cost: the Cloud Run free tier covers 2M requests, 180k vCPU-seconds and 360k
GiB-seconds a month. A one-day booth will not come close. You still need billing
enabled on the project — that is a Google requirement, not a charge.

---

## Before you start

- `gcloud` installed and signed in: `gcloud auth login`
- A Google Cloud project with billing enabled
- A Supabase project with `0001_schema.sql`, `0002_functions.sql` and `seed.sql` already applied (see `DEPLOYMENT.md` sections 1–2)
- Your Supabase URL and service role key to hand

Nothing else is installed locally. Cloud Build compiles the image in Google's
infrastructure, so you do not need Docker on your machine.

## 1. Point gcloud at the project

```bash
export PROJECT_ID=your-project-id
export REGION=asia-southeast1          # Singapore — closest to Manila
export SERVICE=toap-spin-win

gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"
```

## 2. Enable the APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

First enablement takes a minute or two.

## 3. Put the secrets in Secret Manager

Generate the two app secrets once and keep them somewhere safe — changing `OTP_PEPPER`
after the event opens invalidates every outstanding code.

```bash
openssl rand -base64 48 | gcloud secrets create toap-session-secret --data-file=-
openssl rand -base64 48 | gcloud secrets create toap-otp-pepper     --data-file=-

printf '%s' 'YOUR_SUPABASE_SERVICE_ROLE_KEY' | \
  gcloud secrets create toap-supabase-key --data-file=-

# Providers. Create these now even if empty values go in for the first deploy.
printf '%s' 'YOUR_RESEND_API_KEY'    | gcloud secrets create toap-resend-key    --data-file=-
printf '%s' 'YOUR_SEMAPHORE_API_KEY' | gcloud secrets create toap-semaphore-key --data-file=-
```

`printf` rather than `echo` matters — `echo` appends a newline and the key will fail
authentication in a way that looks like a provider outage.

Let the Cloud Run runtime service account read them:

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for s in toap-session-secret toap-otp-pepper toap-supabase-key toap-resend-key toap-semaphore-key; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

## 4. First deploy

From the repository root (the folder with `Dockerfile` in it):

```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars "APP_MODE=production,EVENT_CODE=TOAP2026,SUPABASE_URL=https://YOUR-PROJECT.supabase.co,SMS_PROVIDER=semaphore,SEMAPHORE_SENDER_NAME=YOURNAME,EMAIL_PROVIDER=resend,EMAIL_FROM=TOAP Spin & Win <noreply@yourdomain>" \
  --set-secrets "SESSION_SECRET=toap-session-secret:latest,OTP_PEPPER=toap-otp-pepper:latest,SUPABASE_SERVICE_ROLE_KEY=toap-supabase-key:latest,RESEND_API_KEY=toap-resend-key:latest,SEMAPHORE_API_KEY=toap-semaphore-key:latest"
```

The first build takes 4–6 minutes. Answer yes when it offers to create the Artifact
Registry repository. When it finishes it prints the service URL.

Note that `OTP_DEV_MODE` is not set anywhere. The app refuses to start if it is true
while `APP_MODE=production`, so leaving it out is the safe default.

## 5. Tell the app its own URL

The URL only exists after the first deploy, so set it now:

```bash
URL=$(gcloud run services describe "$SERVICE" --format='value(status.url)')
gcloud run services update "$SERVICE" --update-env-vars "NEXT_PUBLIC_APP_URL=${URL}"
echo "$URL"
```

This value is read at runtime, so no rebuild is needed.

## 6. Create the first admin

Run this from your machine against Supabase, not against Cloud Run:

```bash
SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=YOUR_KEY \
npm run seed:admin
```

Create one `SUPER_ADMIN`, one `EVENT_ADMIN`, and a `BOOTH_OPERATOR` per booth device.

## 7. Check it works

```bash
BASE_URL="$URL" npm run smoke-test
```

Then on a real phone, over mobile data:

1. Open the URL, register, receive both codes, verify, spin.
2. Refresh and reopen the browser — the same prize and winner code come back.
3. Open `<URL>/booth`, search the code, mark it collected, try collecting twice.
4. Open `<URL>/admin`, export the winners CSV.

## 8. The QR code

Encode the Cloud Run URL exactly as printed, including `https://`:

```bash
npx qrcode -o toap-qr.png -e H -w 1200 "$URL"
```

Run.app URLs are long, so print the QR at level H error correction and at least 4 cm
across. Do not also print the URL underneath for people to type — nobody will type
that correctly. Print a spare QR instead.

If the URL later needs to be shorter or branded, add the domain mapping then; the
service and its data do not change.

## 9. Redeploying after a code change

```bash
gcloud run deploy "$SERVICE" --source .
```

Environment variables and secrets stay attached across deploys. Traffic moves to the
new revision when it passes its health check; a bad revision is rolled back from the
console without touching the database.

## 10. Event-day settings

The morning of the event, eliminate cold starts:

```bash
gcloud run services update "$SERVICE" --min-instances 1
```

One warm instance costs a few cents for the day and means the first attendee of the
morning does not wait 3 seconds. Set it back to 0 afterwards:

```bash
gcloud run services update "$SERVICE" --min-instances 0
```

Keep `--max-instances 5`. The bottleneck is Supabase connections, not Cloud Run, and
capping instances protects the database if something starts hammering the URL.

Watch logs live during the event:

```bash
gcloud run services logs tail "$SERVICE"
```

---

## Appendix: if you really need a fixed IP

A Compute Engine `e2-micro` in a US region is within the always-free tier and can hold
a static external IP. You would install Node, run the app behind Caddy or Nginx, and
manage updates yourself — more moving parts than Cloud Run, on a smaller machine,
further from Manila.

For TLS without owning a domain, use a wildcard DNS service that maps hostnames to IPs:
`34-101-55-12.sslip.io` resolves to `34.101.55.12` with no DNS account, and Caddy will
obtain a Let's Encrypt certificate for that hostname automatically. That gives you HTTPS
on an IP-derived address.

It works, but for a one-day event it is more to go wrong for no gain. The run.app URL
is already free, already HTTPS, already regional, and needs nothing kept alive.
