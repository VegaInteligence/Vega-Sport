-- 24 Nov 2026 (VI-38, stage 2a): what the account API needs beyond 001.
-- Failure modes: backend/account/FAILURE_MODES.md, S16 (section 3), D10 and X4 to X9.
SET LOCAL lock_timeout = '3s';

-- An erased account. A Neon session stays valid up to 15 minutes after the person is deleted at
-- Neon and is verified offline: without this row, a second device's next call would create the
-- account again. No foreign key, so that it outlives the account row; the id and the instant only.
CREATE TABLE account.erasures (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  erased_at timestamptz NOT NULL DEFAULT now()
);

-- 001 granted the tables that existed then; this grants the new one (and changes nothing else).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA account TO vega_account;
