#!/bin/bash
# One-time setup: pulls API keys for the verdolo-staging Supabase project and
# 1) writes them to .env.staging.local (gitignored)
# 2) sets them as Vercel Preview-environment env vars (Production is untouched)
#
# Run this yourself, in your own terminal - it fetches and uses the secret
# service-role key locally without ever printing it or sending it anywhere
# other than your local file and Vercel's env-var API.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF=shozpqsssaqjouruwoxd

echo "Fetching staging API keys..."
KEYS_JSON=$(npx supabase projects api-keys --project-ref "$PROJECT_REF" --reveal --output json)

URL="https://${PROJECT_REF}.supabase.co"
PUBLISHABLE=$(echo "$KEYS_JSON" | jq -r '.[] | select(.type=="publishable") | .api_key')
SECRET=$(echo "$KEYS_JSON" | jq -r '.[] | select(.type=="secret") | .api_key')

if [[ -z "$PUBLISHABLE" || -z "$SECRET" ]]; then
  echo "Could not read publishable/secret key from Supabase CLI output - aborting." >&2
  exit 1
fi

cat > .env.staging.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE
SUPABASE_SECRET_KEY=$SECRET
EOF
echo "Wrote .env.staging.local"

echo "Setting Vercel Preview env vars..."
npx vercel env add NEXT_PUBLIC_SUPABASE_URL preview --force -y --value "$URL" >/dev/null
npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview --force -y --value "$PUBLISHABLE" >/dev/null
npx vercel env add SUPABASE_SECRET_KEY preview --sensitive --force -y --value "$SECRET" >/dev/null

echo "Done. Preview deploys now point at verdolo-staging; Production is untouched."
echo "To use staging locally: cp .env.staging.local .env.local (back up your current .env.local first if you want to switch back easily)."
