#!/usr/bin/env bash
# Deploy TOAP Spin & Win to Cloud Run. See docs/DEPLOY_CLOUD_RUN.md for the
# one-time setup (APIs, secrets, IAM) this script assumes is already done.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-toap-spin-win}"
SUPABASE_URL="${SUPABASE_URL:?set SUPABASE_URL}"
EVENT_CODE="${EVENT_CODE:-TOAP2026}"
EMAIL_FROM="${EMAIL_FROM:?set EMAIL_FROM}"
SEMAPHORE_SENDER_NAME="${SEMAPHORE_SENDER_NAME:?set SEMAPHORE_SENDER_NAME}"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud config set run/region "$REGION" >/dev/null

gcloud run deploy "$SERVICE" \
  --source . \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --min-instances "${MIN_INSTANCES:-0}" \
  --max-instances "${MAX_INSTANCES:-5}" \
  --set-env-vars "APP_MODE=production,EVENT_CODE=${EVENT_CODE},SUPABASE_URL=${SUPABASE_URL},SMS_PROVIDER=semaphore,SEMAPHORE_SENDER_NAME=${SEMAPHORE_SENDER_NAME},EMAIL_PROVIDER=resend,EMAIL_FROM=${EMAIL_FROM}" \
  --set-secrets "SESSION_SECRET=toap-session-secret:latest,OTP_PEPPER=toap-otp-pepper:latest,SUPABASE_SERVICE_ROLE_KEY=toap-supabase-key:latest,RESEND_API_KEY=toap-resend-key:latest,SEMAPHORE_API_KEY=toap-semaphore-key:latest"

URL="$(gcloud run services describe "$SERVICE" --format='value(status.url)')"
gcloud run services update "$SERVICE" --update-env-vars "NEXT_PUBLIC_APP_URL=${URL}" >/dev/null

echo
echo "Deployed: $URL"
echo "QR target: $URL"
