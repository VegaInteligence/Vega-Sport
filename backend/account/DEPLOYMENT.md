# Account API: what deploying it takes

> Résumé : la pile `vega-v2-account` (`infra/aws/account.yaml`) et le code de `backend/account`
> sont écrits et testés en local ; rien n'est branché dans `deploy.sh`, rien n'existe chez Neon,
> AWS ou Vercel. Ce document liste, dans l'ordre, ce qui doit changer dans les fichiers partagés,
> ce que le propriétaire doit créer à la main, et comment `backend/account/sql` sera appliqué.

- **Status (24 Nov 2026):** template and code written; nothing created, applied or deployed.
  `cfn-lint` was not installed where the template was written: it was parsed as YAML with the
  CloudFormation tags, not linted.
- **Shared files left untouched on purpose** (other sessions own them now): `infra/aws/deploy.sh`,
  `deploy-roles.yaml`, `database.yaml`, `api.yaml`, `worker.yaml`, `package_api.py`,
  `ci/secrets.sh`, `backend/vega/migrate.py`. Each change below is for whoever lands this stage.

## 1. What the stack holds

| Resource | What it is |
|---|---|
| `vega-v2-account-front` | Node 24 arm64, **no VPC** (it reaches Neon for its key set and for deletions, and the Lambda API). Function URL `AuthType: NONE` (the Neon session is the proof), CORS answered by the code from `SiteOrigins`. Reserved concurrency 10. 256 MB, 10 s. |
| `vega-v2-account-store` | Node 24 arm64, **in the VPC** (security group `vega-v2-account-sg`), no URL. The only code with a connection to schema `account` (login `vega_v2_account`, group `vega_account`, one connection per copy). Reserved concurrency 8. 256 MB, 10 s. |
| Roles | The front's role may invoke the store (`lambda:InvokeFunction` on its ARN) and write its log; the store's role writes its log and manages its ENIs. No other role of the stack can invoke the store. Account administrators still can (IAM in one account cannot exclude them). |
| Log groups | `/aws/lambda/vega-v2-account-front`, `/aws/lambda/vega-v2-account-store`, 14 days. One line per request or command; never a token, an account id, an IP or a body. |

Parameters: `FrontReleaseKey`, `StoreReleaseKey` (`releases/v2-account/<sha256>.zip`),
`AccountDatabaseUrl` (NoEcho), `NeonAuthUrl`, `SiteOrigins`, `PassKeys` (NoEcho), `PassKeyCurrent`,
`NeonApiKey` (NoEcho, empty: `DELETE /account` answers 503 and erases nothing), `NeonProjectId`,
`NeonBranchId`. Output: `FrontUrl` (export `vega-v2-account-url`).

Secrets reach the functions as NoEcho parameters, then environment variables, as for the read API
(`api.yaml`). The front could read SSM at run time (it has Internet), but that needs an IAM grant,
a cold-start call, and a second way of doing what the read API already does; the cost is that
anyone allowed `lambda:GetFunctionConfiguration` on it sees the values.

## 2. Changes to shared files, in the order they must land

1. **`infra/aws/deploy-roles.yaml`** (the owner updates the stack `vega-v2-deploy-roles` from his
   Mac, before the Deploy that brings the stack; otherwise both the deploy and its rollback fail):
   - `Logs`: add `log-group:/aws/lambda/vega-v2-account*`;
   - `Roles`: add `role/vega-v2-account-*` (CloudFormation names the roles `vega-v2-account-<Id>-<random>`);
   - `Functions`: add `function:vega-v2-account*` (`lambda:*` covers the Function URL and its
     permissions, `lambda:AddPermission` with `Principal: '*'` included);
   - `ReleaseRead`: add `releases/v2-account/*`.
2. **`infra/aws/database.yaml`**: a security group `AccountSG` as `ApiSG` is
   (`GroupDescription: Vega v2 account store Lambda, 5432 to the v2 database only`, egress replaced
   by the database rule), `AccountToDatabase` (egress 5432 to `DatabaseSG`), `DatabaseFromAccount`
   (ingress 5432 from `AccountSG`, `Description: v2 account store`), output `AccountSecurityGroup`
   exported as **`vega-v2-account-sg`** (imported by `account.yaml`).
3. **`infra/aws/ci/secrets.sh`**: add `account` to both loops, which gives
   `/vega/v2/password-account` and `/vega/v2/account-database-url`
   (`postgresql://vega_v2_account:<password>@<endpoint>:5432/vega_v2`, **without sslmode**, like
   `read`: the store passes the CA itself). Add the pass key, once:
   `openssl rand 32 | basenc --base64url | tr -d '=\n'` into `/vega/v2/pass-key/k1` (SecureString).
4. **`backend/vega/migrate.py`**:
   - `LOGINS = ("collect", "calc", "read", "account")`;
   - `CONNECTION_LIMITS["account"] = 2 * 8 + 2` (= 18: 8 copies of the store, two generations during
     a deploy, a margin of 2), and a capacity test beside `backend/tests/test_api_capacity.py` that
     reads `ReservedConcurrentExecutions: 8` from `account.yaml`, `max: 1` and `idleSessionMs` from
     `backend/account/lambda/store-index.mjs`, and the limit from `migrate.py`;
   - the run of `backend/account/sql` (section 4), **after** `migrate()` and **before**
     `ensure_logins()` (001 creates the group `vega_account` that the login joins).
   - Connection budget on db.t4g.medium (about 400): collect 6 + calc 4 + read 68 + account 18 = 96.
5. **`infra/aws/worker.yaml`** (task `vega-v2-migrate`): a secret
   `V2_ACCOUNT_PASSWORD` from `${PasswordParameterPrefix}-account` (the task role already reads
   `${PasswordParameterPrefix}-*`).
6. **`backend/Dockerfile`**: `COPY backend/account/sql account-sql` (or the path the runner reads),
   so the migrate task holds the files.
7. **`infra/aws/package_api.py`**: two kinds, built from `backend/account/lambda/` after
   `npm ci --prefix backend/account`:
   - `account-front`: entry `../../backend/account/lambda/front-index.mjs`, no extra file,
     `--external @aws-sdk/*` (the runtime's SDK invokes the store). Offline check: any request
     answers **503 `NOT_CONFIGURED`** (not 404: without settings the front serves nothing), so the
     check of a kind needs its own expected answer;
   - `account-store`: entry `../../backend/account/lambda/store-index.mjs`, file `rds-ca.pem`.
     Offline check: `handler({command:'session',accountId:'a1'})` gives
     `{ ok: false, code: 'NOT_CONFIGURED' }`.
   `test/lambda.test.mjs` already runs both checks on the unbundled entries.
8. **`infra/aws/deploy.sh`**, after the database stack and after the migrate task (the login and the
   security group must exist): build and upload both ZIPs to `releases/v2-account/`; read
   `/vega/v2/account-database-url`, `/vega/v2/pass-key/k1`, `/vega/v2/neon-api-key` (optional) and
   the plain parameters `/vega/v2/neon-auth-url`, `/vega/v2/neon-project-id`,
   `/vega/v2/neon-branch-id`, `/vega/v2/site-origins`; then
   `stack vega-v2-account account.yaml --capabilities CAPABILITY_IAM --parameter-overrides FrontReleaseKey=… StoreReleaseKey=… AccountDatabaseUrl=… NeonAuthUrl=… SiteOrigins=… PassKeys=k1:… PassKeyCurrent=k1 NeonApiKey=… NeonProjectId=… NeonBranchId=…`.
   Without `/vega/v2/neon-auth-url` the step is skipped (no stack rather than a front that answers
   503 to everyone).
9. **`infra/aws/api.yaml`**: nothing for this stage. The site calls the Function URL directly. A
   later `account/*` behaviour on the distribution (custom domain, cookie pass) is stage 3; the
   gate's key store must then hold the same pass keys.
10. **Vercel** (Production and Preview): `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (the site's
    sign-in), `NEXT_PUBLIC_ACCOUNT_ORIGIN` = the stack's `FrontUrl` without its final slash. A
    preview's origin is random: it is not in `SiteOrigins`, so the account API refuses it (403)
    unless its exact origin is added.

## 3. What the owner does by hand, in this order

1. **Neon**: create the project (region `aws-us-east-2` proposed), enable Auth on its production
   branch; note the auth URL, the project id and the branch id; add the site's domain as trusted
   domain, turn off « Allow localhost » before launch, set up the sign-in methods and an SMTP
   sender. Create a **Neon API key** that can delete the branch's auth users (for
   `DELETE /account`); until it exists, deletion answers 503 and erases nothing.
2. **SSM** (`us-east-2`): `/vega/v2/neon-auth-url`, `/vega/v2/neon-project-id`,
   `/vega/v2/neon-branch-id`, `/vega/v2/site-origins` (`https://vegasport.vercel.app`) as String;
   `/vega/v2/neon-api-key` as SecureString. Then run `infra/aws/ci/secrets.sh` (once changed, 2.3)
   for the password, the database URL and the pass key.
3. **Update the stack `vega-v2-deploy-roles`** from the Mac with the widened role (2.1).
4. Merge, then the Deploy: database stack (security group), migrate task (account SQL, login),
   account stack.
5. Vercel variables (2.10), then the site's sign-in (a later stage of VI-38).

Concurrency: reserved today 32 (read API) + 10 (live); with 10 + 8 here, 60 of the account's 1000,
well under the 900 that may be reserved.

## 4. Applying `backend/account/sql`

The account files stay out of `backend/sql`: the football schemas are rebuilt at will (some sixty
test suites drop `core, agg, ops, api` and migrate again), a person's data must not follow them.
They get their own run, in `migrate.py`, as the owner:

- **Record of applied files:** schema `account_admin`, owned by the owner, granted to no one, table
  `account_admin.applied (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  created by the runner if absent (`CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). It
  is not in schema `account`, which `001_accounts.sql` creates.
- **Order:** the files `NNN_name.sql` of `backend/account/sql`, by name. Each file not recorded is
  run in its own transaction together with the insert of its record: a file is applied whole or
  not at all, and recorded exactly when it is applied.
- **An applied file never changes:** a recorded file whose sha256 differs stops the run with an
  error naming it (the files are edited only until they were applied once; on 24 Nov 2026 none
  was, which is why 001 was reshaped in place when the preferences became one document).
- **Locks:** each file sets `lock_timeout = 3s`; the runner takes
  `pg_advisory_xact_lock(hashtext('vega-account-migrations'))` so two migrate tasks never run them
  at once.
- **Tests:** `backend/account/test/support.mjs` applies the same files in the same order on the
  local base; a test of the runner itself (applies, records, refuses an edited file) belongs with
  the `migrate.py` change, in Python, beside the existing suites.
- **PostgreSQL version:** the account suite ran on PostgreSQL 16 locally; production is 18 and CI
  runs 18. Nothing in the files is specific to either (`hashtextextended`, `jsonb @>`,
  `idle_session_timeout` exist in both).

## 5. Checks after the first deploy (none run yet)

- `curl -i -X OPTIONS -H 'Origin: https://vegasport.vercel.app' <FrontUrl>account/session`:
  `204` with `Access-Control-Allow-Origin` that origin; from another origin, `403`.
- `curl -i -X POST <FrontUrl>account/session`: `401 SESSION_REQUIRED`, `Cache-Control: no-store`.
- With a real Neon token (from the site): `POST /account/session` gives level 1 and a pass;
  `GET /account/preferences` gives `{ contract: null, revision: null }`; the store's log has
  one `session` line; the database has one row in `account.accounts`, none elsewhere.
- **Unverified until then:** Neon's token header and claims (`kid`, `sub` format, `iss`/`aud`), the
  deletion endpoint and the API key's scope, the Lambda Invoke path (IAM, throttling), the
  latency of the extra invoke.
