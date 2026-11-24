#!/usr/bin/env bash
# Secrets of the base (vega-football-db-postgres), created once in SSM SecureStrings:
# the three login passwords and the status page's key (random, generated here), the
# PitchAPI key (from the workflow secret) and the connection URLs built from the
# database stack's endpoint. With VEGA_ACCOUNT=on (deploy.sh, once SSM /vega/v2/account-deploy
# is on), the account API's too: the login's password, its URL and the pass key.
# Values go through mode-0600 files, never the command line, the log or the shell trace.
set -euo pipefail
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
exists() { aws ssm get-parameter --name "$1" >/dev/null 2>&1; }
put() { exists "$1" || aws ssm put-parameter --name "$1" --type SecureString --value "file://$2" >/dev/null; }
read_secret() { aws ssm get-parameter --name "$1" --with-decryption --query Parameter.Value --output text; }

roles=(collect calc read)
[ "${VEGA_ACCOUNT:-}" = on ] && roles+=(account)
for role in "${roles[@]}"; do
  openssl rand -hex 24 | tr -d '\n' > "$work/$role"
  put "/vega/v2/password-$role" "$work/$role"
done
if [ -n "${PITCHAPI_API_KEY:-}" ]; then
  printf '%s' "$PITCHAPI_API_KEY" > "$work/pitchapi"
  put /vega/v2/pitchapi-key "$work/pitchapi"
fi
# The key of the read API's /api/ops/status, read by the private status page (Vega Status).
openssl rand -hex 32 | tr -d '\n' > "$work/ops"
put /vega/v2/ops-key "$work/ops"
# VI-35: the key the site's server sends as X-Vega-Edge-Key, out of the distribution's
# per-address limit (waf.yaml); the Vercel project holds it as VEGA_API_EDGE_KEY.
openssl rand -hex 32 | tr -d '\n' > "$work/edge"
put /vega/v2/edge-key "$work/edge"
# VI-38: the key that signs the account API's pass (account.yaml PassKeys k1): 32 random bytes,
# base64url without padding (43 characters). The CloudFront gate will hold the same key.
if [ "${VEGA_ACCOUNT:-}" = on ]; then
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > "$work/pass-key"
  put /vega/v2/pass-key/k1 "$work/pass-key"
fi
endpoint=$(aws cloudformation describe-stacks --stack-name vega-v2-database \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" --output text)
# The worker verifies TLS against the bundled CA (sslrootcert); the read API and the account store
# pass the CA themselves, so their URLs carry no sslmode (an sslmode in the URL would replace the CA option).
for role in "${roles[@]}"; do
  password=$(read_secret "/vega/v2/password-$role")
  if [ "$role" = read ] || [ "$role" = account ]; then
    printf 'postgresql://vega_v2_%s:%s@%s:5432/vega_v2' "$role" "$password" "$endpoint" > "$work/url-$role"
  else
    printf 'postgresql://vega_v2_%s:%s@%s:5432/vega_v2?sslmode=verify-full&sslrootcert=/app/rds-ca.pem' "$role" "$password" "$endpoint" > "$work/url-$role"
  fi
  put "/vega/v2/$role-database-url" "$work/url-$role"
done
echo "v2 secrets present in SSM (/vega/v2/*)"
