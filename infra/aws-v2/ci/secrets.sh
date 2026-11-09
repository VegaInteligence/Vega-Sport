#!/usr/bin/env bash
# Secrets of the v2 base (vega-football-db-postgres), created once in SSM SecureStrings:
# the three login passwords (random, generated here), the PitchAPI key (from the
# workflow secret) and the connection URLs built from the database stack's endpoint.
# Values go through mode-0600 files, never the command line, the log or the shell trace.
set -euo pipefail
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
exists() { aws ssm get-parameter --name "$1" >/dev/null 2>&1; }
put() { exists "$1" || aws ssm put-parameter --name "$1" --type SecureString --value "file://$2" >/dev/null; }
read_secret() { aws ssm get-parameter --name "$1" --with-decryption --query Parameter.Value --output text; }

for role in collect calc read; do
  openssl rand -hex 24 | tr -d '\n' > "$work/$role"
  put "/vega/v2/password-$role" "$work/$role"
done
if [ -n "${PITCHAPI_API_KEY:-}" ]; then
  printf '%s' "$PITCHAPI_API_KEY" > "$work/pitchapi"
  put /vega/v2/pitchapi-key "$work/pitchapi"
fi
endpoint=$(aws cloudformation describe-stacks --stack-name vega-v2-database \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" --output text)
# The worker verifies TLS against the bundled CA (sslrootcert); the API passes the CA itself,
# so its URL carries no sslmode (an sslmode in the URL would replace the CA option).
for role in collect calc read; do
  password=$(read_secret "/vega/v2/password-$role")
  if [ "$role" = read ]; then
    printf 'postgresql://vega_v2_%s:%s@%s:5432/vega_v2' "$role" "$password" "$endpoint" > "$work/url-$role"
  else
    printf 'postgresql://vega_v2_%s:%s@%s:5432/vega_v2?sslmode=verify-full&sslrootcert=/app/rds-ca.pem' "$role" "$password" "$endpoint" > "$work/url-$role"
  fi
  put "/vega/v2/$role-database-url" "$work/url-$role"
done
echo "v2 secrets present in SSM (/vega/v2/*)"
