-- 25 Nov 2026: a level given by hand, outside Stripe, and a level above Pro for the founders.
-- Failure modes: backend/account/FAILURE_MODES.md, S18 and S19 (section 3).
--
-- Levels: 0 unknown, 1 free, 2 Plus, 3 Pro (both from Stripe, 001), 4 Fondateur (only from here).
-- A reserved read names a minimum of 2 or 3 (gate.mjs), so level 4 opens every one, today and
-- for any rule added later, without a rule of its own.
SET LOCAL lock_timeout = '3s';

-- A level given to an account by the owner of the base, not bought. One per account at most;
-- deleting the account erases it. No expiry: a grant ends when its row is deleted.
CREATE TABLE account.grants (
  account_id text PRIMARY KEY REFERENCES account.accounts ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level IN (2, 3, 4)),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 80),
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- 001's level, raised by a grant: the highest of 1, the live subscriptions and the grant.
CREATE OR REPLACE FUNCTION account.level_of(account text, at timestamptz DEFAULT now())
RETURNS smallint LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM account.accounts a WHERE a.account_id = account) THEN 0
    ELSE greatest(1, coalesce((
      SELECT max(s.level) FROM account.subscriptions s
      WHERE s.account_id = account AND s.status IN ('trialing', 'active', 'past_due') AND s.current_period_end > at), 1),
      coalesce((SELECT g.level FROM account.grants g WHERE g.account_id = account), 1))
  END::smallint
$$;

-- The account API reads grants and never writes one: only the owner gives a level. (An account's
-- deletion still removes its grant: the cascade runs as the table's owner.) Every table already
-- had SELECT; this adds it on the new one and changes nothing else.
GRANT SELECT ON ALL TABLES IN SCHEMA account TO vega_account;

-- The two founders, by their Neon user id (the account id; no e-mail is kept here). Their account
-- row is created if they have not signed in since the accounts opened, as their first session would.
INSERT INTO account.accounts (account_id) VALUES
  ('38d9b62e-78fb-4343-aad5-0cbe338c5dc7'),
  ('ff4449b2-6e9d-4f12-a729-875eb6c5932f')
ON CONFLICT DO NOTHING;
INSERT INTO account.grants (account_id, level, reason) VALUES
  ('38d9b62e-78fb-4343-aad5-0cbe338c5dc7', 4, 'fondateur (hugo)'),
  ('ff4449b2-6e9d-4f12-a729-875eb6c5932f', 4, 'fondateur (Romain)');
