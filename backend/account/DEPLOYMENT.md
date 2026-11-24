# Account API: what deploying it takes

> Résumé : la pile `vega-v2-account` (`infra/aws/account.yaml`) et le code de `backend/account`
> sont écrits, testés et branchés dans `deploy.sh`, derrière un seul interrupteur : le paramètre
> SSM `/vega/v2/account-deploy`, que le propriétaire crée en dernier. Tant qu'il n'est pas `on`,
> un Deploy fait exactement ce qu'il faisait avant, plus une ligne de journal. La section 3 est la
> marche à suivre du propriétaire, commande par commande, depuis son Mac.

- **Status (24 Nov 2026):** the shared files are wired (section 2) on the branch
  `claude/vi-38-comptes-plans`; nothing is created at Neon (beyond the project with Auth), AWS or
  Vercel, nothing applied or deployed. `cfn-lint` 1.43.0 (CI's) is clean on every template.
  Tests: `backend/tests/test_account_deploy.py` (the real `deploy.sh` offline, with a stand-in
  `aws`), `test_account_migrations.py` (the real `python -m vega.migrate` on PostgreSQL 18),
  `test_account_capacity.py`; failure modes in `FAILURE_MODES.md`, section 10.
- **The switch:** SSM `/vega/v2/account-deploy` (String), `on` or `off`. Why a parameter of its
  own and not `/vega/v2/neon-auth-url`: the auth URL is the first value the owner holds, and once
  the switch is on a missing prerequisite stops every Deploy (both people's); with its own switch
  the values are written and checked in any order, the account is turned on in one last step, and
  paused (`off`) without deleting anything.

## What a Deploy does, in each state

| State | What the Deploy does |
|---|---|
| Nothing prepared (no switch; today) | Exactly what it did before this change (same stacks, same overrides, same task, same uploads, no SSM parameter written; checked against 12e645e's `deploy.sh`), plus one line: `account: off (no SSM parameter /vega/v2/account-deploy): …`. |
| The roles updated only, or the Neon values written, without the switch | The same. |
| Switch `on`, something missing or malformed | The preflight, before step 1, names every problem (the roles' output `AccountGrants`, each SSM value, a generated secret already there but malformed, an account stack CloudFormation cannot update) and stops: **nothing is changed**. The last line says how to deploy without the account: set the switch to `off`. |
| Switch `on`, everything prepared | Step 1 database with `Account=true` (security group); step 2 creates the account's password, URL and pass key; steps 3 and 6 worker with `Account=true` (the migrate task gets the password); step 5 the migrate task applies `backend/account/sql` then sets the login; steps 6b to 10 as always (the alerts with `Account=true`); step 11, last: both packages, then the stack `vega-v2-account`; the log ends with `account API: <FrontUrl>` and `done`. |
| Switch `off` after `on` | As « nothing prepared »; what exists stays: the stacks keep `Account=true` (a parameter not passed keeps its value), so the security group the account stack imports and the migrate task's password are never removed; the account stack is not updated. |

What each prerequisite does to a Deploy when it is missing, the switch being `on` (when the switch
is not `on`, none of them is read):

| Prerequisite | Missing |
|---|---|
| Stack `vega-v2-deploy-roles` updated (output `AccountGrants` = 2) | Refused by the preflight. Without the check: the deploy role cannot upload to `releases/v2-account/`, or the CloudFormation role cannot create the account's roles, functions and log groups, after the database and the migrate task have changed. |
| `/vega/v2/neon-auth-url`, `/vega/v2/neon-project-id`, `/vega/v2/neon-branch-id`, `/vega/v2/site-origins` (String) | Refused by the preflight, each named (also when malformed, or stored as SecureString). |
| `/vega/v2/neon-api-key` (SecureString) | Not required: the stack gets an empty key, one line says `DELETE /account` answers 503 and erases nothing. A Deploy after it is written passes it. |
| `/vega/v2/password-account`, `/vega/v2/account-database-url`, `/vega/v2/pass-key/k1` | Created by step 2 of that Deploy. Present but malformed: refused by the preflight. |
| Stack `vega-v2-account` in `ROLLBACK_COMPLETE`, `*_FAILED`, `*_IN_PROGRESS` | Refused by the preflight, with the owner's recovery command (the deploy role cannot delete a stack). |

`deploy-roles.yaml` is the one change no Deploy can make: the workflow's role cannot change its
own permissions. It is deployed by the owner; the Deploy only reads its output.

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

## 2. What is wired, file by file

1. **`infra/aws/deploy-roles.yaml`** (deployed by the owner, section 3): the CloudFormation role's
   `Logs` (`/aws/lambda/vega-v2-account*`), `Roles` (`role/vega-v2-account-*`), `Functions`
   (`function:vega-v2-account*`, which covers the Function URL and its public permissions) and
   `ReleaseRead` (`releases/v2-account/*`); the deploy role's `Release` (`s3:PutObject` on
   `releases/v2-account/*`: deploy.sh uploads the packages as the deploy role, which the first plan
   missed); `SecurityGroupCreate` names the VPC beside `security-group/*` (EC2 authorizes
   `ec2:CreateSecurityGroup` on both and sets `ec2:Vpc` for neither; the first plan held that the
   group needed nothing new, and Deploy 132 stopped at step 1: `FAILURE_MODES.md` W14); the output
   `AccountGrants: '2'`.
2. **`infra/aws/database.yaml`**: parameter `Account` (`false` by default), condition `HasAccount`;
   under it `AccountSG` (as `ApiSG`), `AccountToDatabase` (egress 5432 to `DatabaseSG`),
   `DatabaseFromAccount` (ingress 5432 from `AccountSG`) and the output `AccountSecurityGroup`
   exported as `vega-v2-account-sg`.
3. **`infra/aws/ci/secrets.sh`**: with `VEGA_ACCOUNT=on` (set by deploy.sh), `account` joins both
   loops (`/vega/v2/password-account`, `/vega/v2/account-database-url` without sslmode, as `read`)
   and `/vega/v2/pass-key/k1` is created once: `openssl rand -base64 32`, made base64url, no padding
   (43 characters; `basenc` does not exist on a Mac). Values through mode-0600 files.
4. **`backend/vega/migrate.py`**: `LOGINS` gains `account`, `CONNECTION_LIMITS["account"] = 2 × 8 +
   ACCOUNT_MARGIN (2) = 18`; the run of `backend/account/sql` (section 4) after `migrate()` and before
   `ensure_logins()`, only when `V2_ACCOUNT_PASSWORD` is set. Budget on db.t4g.medium (about 400):
   collect 6 + calc 4 + read 68 + account 18 = 96. `backend/tests/test_account_capacity.py` reads
   the 8 copies from `account.yaml`, `max: 1` and `idleSessionMs` from `lambda/store-index.mjs`.
5. **`infra/aws/worker.yaml`**: parameter `Account`, condition `HasAccount`; under it the migrate
   task's secret `V2_ACCOUNT_PASSWORD` from `${PasswordParameterPrefix}-account` (the execution
   role already reads `${PasswordParameterPrefix}-*`). Off, the task names no parameter that may
   not exist (such a task does not start).
6. **`backend/Dockerfile`**: `COPY backend/account/sql account/sql` (`/app/account/sql`, where
   `migrate.ACCOUNT_SQL` looks), and its `.dockerignore` lets it in. CI's image job checks it.
7. **`infra/aws/package_api.py`**: kinds `account-front` (entry `backend/account/lambda/front-index.mjs`,
   `--external @aws-sdk/*`, offline check 503 `NOT_CONFIGURED`) and `account-store` (entry
   `store-index.mjs`, with `rds-ca.pem`, offline check `{ ok: false, code: 'NOT_CONFIGURED' }`); each
   kind has its own check. The `api` and `live` ZIPs are byte-identical to before. CI's package job
   builds both.
8. **`infra/aws/deploy.sh`**: the preflight (before step 1); `Account=true` passed to the database,
   worker and alerts stacks only when on; `VEGA_ACCOUNT` for `secrets.sh`; step 11 after the alerts:
   `npm ci --prefix backend/account`, both packages uploaded to `releases/v2-account/`, then
   `stack vega-v2-account account.yaml --capabilities CAPABILITY_IAM` with `FrontReleaseKey`,
   `StoreReleaseKey`, `AccountDatabaseUrl`, `NeonAuthUrl`, `SiteOrigins`, `PassKeys=k1:…`,
   `PassKeyCurrent=k1`, `NeonApiKey` (empty without the parameter), `NeonProjectId`, `NeonBranchId`.
   The secrets are `NoEcho` parameters on the command line, as the read API's URL is, and masked in
   the workflow's log (`::add-mask::`). Last, so that its failure leaves everything else deployed.
9. **`infra/aws/alerts.yaml`** (not in the first plan: `test_alerts.py` ties the connections alarm
   to the logins' sum): parameter `Account`; the alarm's threshold is 106 with the account, 88
   without, as today.
10. **`infra/aws/api.yaml`**: nothing for this stage. The site reaches the Function URL through
    its own relay (`dashboard/frontend/app/api/account`, same origin for the browser), never from
    the browser. A later `account/*` behaviour on the distribution (custom domain, cookie pass) is
    stage 3; the gate's key store must then hold the same pass keys.
11. **Vercel** (Production and Preview, not wired here; `docs/COMPTES_SITE.md`, section 1):
    `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` (32 characters or more) turn the site's
    sign-in on; `ACCOUNT_API_ORIGIN` = the stack's `FrontUrl` without its final slash turns the
    synchronisation on. All three are server-side (nothing is `NEXT_PUBLIC_`), and the site reads
    them at build time too: a change needs a new deployment of the site. Without the first two
    the site is the one before accounts; without the third, sign-in works and preferences stay
    in the browser. The relay calls the account API from Vercel's servers, without an `Origin`,
    so a preview works without being listed in `SiteOrigins`; Neon Auth, however, accepts
    sign-in only from its trusted domains (add a preview's exact host there to test on it).

CI (`ci.yml`): `cfn-lint` already lints `infra/aws/*.yaml`, `account.yaml` included (clean); the
package job builds both account packages; the image job checks the account's SQL files are in
the image; `backend/ci/test_databases.py` gives the runner's test its own base.

Changed from the first plan of this document (24 Nov 2026): a switch of its own instead of
`/vega/v2/neon-auth-url`; every shared-template change behind a parameter `Account`, so that a
Deploy is unchanged until the switch; the deploy role's upload grant (missing); the alerts'
threshold (missing); the generated secrets created by the Deploy, not by the owner running
`secrets.sh`; the pass key made without `basenc`; the account stack after the alerts rather than
right after the migrate task; the runner tied to `V2_ACCOUNT_PASSWORD` rather than run always; the
roles updated from `main` after the merge, not before it from the branch.

## 3. What the owner does by hand, in this order

From the Mac, in the repository's folder, AWS profile `statarena`, region `us-east-2`. Each
step can wait for the next; nothing happens to a Deploy until step 5.

**1. After this work is merged into `main`**, update the roles from `main` (not from the branch:
`main` may hold grants of other work that the branch lacks, which deploying the branch's template
would remove). This is how the roles stack is updated today (`infra/aws/README.md`, « One-time
setup »):

```sh
aws login --profile statarena
git checkout main && git pull --ff-only
grep -c "AccountGrants: {Value: '2'}" infra/aws/deploy-roles.yaml   # 1: this main holds the account's grants
aws cloudformation deploy --profile statarena --region us-east-2 --stack-name vega-v2-deploy-roles \
  --template-file infra/aws/deploy-roles.yaml --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-stacks --profile statarena --region us-east-2 --stack-name vega-v2-deploy-roles \
  --query "Stacks[0].Outputs[?OutputKey=='AccountGrants'].OutputValue" --output text   # 2
```

**2. Neon** (console, project `sweet-queen-11955006`, production branch
`br-mute-bonus-be23014e`; the project and its Auth exist): add `https://vegasport.vercel.app` as a
trusted domain; set up the sign-in methods and an SMTP sender; turn off « Allow localhost » before
launch.

**3. The four Neon values in SSM** (String; `aws login` is CLI v2, which stores an `https://`
value as written):

```sh
aws ssm put-parameter --profile statarena --region us-east-2 --type String --name /vega/v2/neon-auth-url \
  --value 'https://ep-steep-boat-bekuqo4w.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth'
aws ssm put-parameter --profile statarena --region us-east-2 --type String --name /vega/v2/neon-project-id --value sweet-queen-11955006
aws ssm put-parameter --profile statarena --region us-east-2 --type String --name /vega/v2/neon-branch-id --value br-mute-bonus-be23014e
aws ssm put-parameter --profile statarena --region us-east-2 --type String --name /vega/v2/site-origins --value https://vegasport.vercel.app
```

Check (an empty `InvalidParameters` means all four exist):

```sh
aws ssm get-parameters --profile statarena --region us-east-2 \
  --names /vega/v2/neon-auth-url /vega/v2/neon-project-id /vega/v2/neon-branch-id /vega/v2/site-origins \
  --query '{found: Parameters[].[Name, Type, Value], InvalidParameters: InvalidParameters}'
```

The password, the database URL and the pass key are **not** created by hand: the first Deploy with
the switch on creates them (step 2 of `deploy.sh`).

**4. The switch, last:**

```sh
aws ssm put-parameter --profile statarena --region us-east-2 --type String --name /vega/v2/account-deploy --value on
```

**5. The Deploy** (GitHub, Actions, « Deploy », on `main`, as usual). Its log shows
`account: on: every prerequisite is present…`, then `== 11. Account API`, then
`account API: https://<id>.lambda-url.us-east-2.on.aws/` and `done`. If the preflight refuses,
its lines name what to fix; the Deploy changed nothing. Then the checks of section 5, and the
Vercel variables (section 2, item 11).

**Later, the Neon API key** (Neon console, an API key that can delete the branch's auth users;
until it exists `DELETE /account` answers 503 and erases nothing). Through a file, so that the key
is never on a command line; the next Deploy passes it to the stack:

```sh
umask 077; pbpaste > /tmp/neon-api-key   # the key copied from the Neon console
aws ssm put-parameter --profile statarena --region us-east-2 --type SecureString --name /vega/v2/neon-api-key \
  --value file:///tmp/neon-api-key
rm /tmp/neon-api-key
```

**To pause the account** (every other Deploy goes on; nothing is deleted):

```sh
aws ssm put-parameter --profile statarena --region us-east-2 --type String --name /vega/v2/account-deploy --overwrite --value off
```

**If the first creation of the stack failed** (the preflight then reports `ROLLBACK_COMPLETE`):
read why, delete it, and run the Deploy again:

```sh
aws cloudformation describe-stack-events --profile statarena --region us-east-2 --stack-name vega-v2-account \
  --query "StackEvents[?contains(ResourceStatus, 'FAILED')].[LogicalResourceId, ResourceStatusReason]" --output text
aws cloudformation delete-stack --profile statarena --region us-east-2 --stack-name vega-v2-account
```

Concurrency: reserved today 32 (read API) + 10 (live); with 10 + 8 here, 60 of the account's 1000,
well under the 900 that may be reserved.

## 4. Applying `backend/account/sql`

The account files stay out of `backend/sql`: the football schemas are rebuilt at will (some sixty
test suites drop `core, agg, ops, api` and migrate again), a person's data must not follow them.
They get their own run, in `migrate.py` (`migrate_account`), as the owner, in the migrate task:

- **When:** only when `V2_ACCOUNT_PASSWORD` is set, which the migrate task gets once the switch is
  on (`worker.yaml`, `Account=true`); the football suites never set it. After `migrate()`, before
  `ensure_logins()` (001 creates the group `vega_account` that the login joins). The task's line
  gains `account applied=N total=M`.
- **Record of applied files:** schema `account_admin`, owned by the owner, granted to no one, table
  `account_admin.applied (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  created by the runner if absent. It is not in schema `account`, which `001_accounts.sql` creates.
- **Order:** the files `NNN_name.sql` of `backend/account/sql` (`/app/account/sql` in the image), by
  name. Each file not recorded is run in its own transaction together with the insert of its
  record (the sha256 of its bytes): a file is applied whole or not at all, and recorded exactly
  when it is applied.
- **An applied file never changes:** a recorded file whose sha256 differs stops the run with
  `ACCOUNT_SQL_CHANGED <name>`; the task exits non-zero and the Deploy stops at step 5, before the
  account stack. No file was applied anywhere on 24 Nov 2026.
- **No files:** with the password set and no file in the directory, `ACCOUNT_SQL_MISSING` before
  any migration.
- **Locks:** each file sets `lock_timeout = 3s`; each transaction of the runner takes
  `pg_advisory_xact_lock(hashtext('vega-account-migrations'))` before it reads the record, so two
  migrate tasks never apply a file twice.
- **Tests:** `backend/tests/test_account_migrations.py` (M1 to M10), on its own base
  (`VEGA_V2_ACCOUNT_MIGRATE_TEST_DSN`); `backend/account/test/support.mjs` applies the same files
  in the same order for the account suite.
- **PostgreSQL version:** the runner's test and the account suite ran on PostgreSQL 18.7 (CI's
  image `pgvector/pgvector:pg18`), the account suite also on 16.

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
