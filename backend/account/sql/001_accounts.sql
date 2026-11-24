-- 23 Nov 2026 (VI-38): what the base keeps about a person who signed in. Identity (e-mail,
-- password, sessions) lives at Neon Auth; here, keyed by the Neon user id: the plan, the
-- preferences, the followed competitions and the lists. No e-mail, no name, no address.
-- Failure modes and expected outcomes: backend/account/FAILURE_MODES.md, section 3.
--
-- Kept apart from backend/sql: the football schemas are rebuilt from their sources at will
-- (some sixty test suites drop core, agg, ops and api and migrate again); what a person
-- saved is not. These files get their own run and their own record in stage 2.
--
-- A schema of its own, read and written by the account API alone (group role vega_account).
-- The read API (vega_read) and the worker (vega_collect, vega_calc) hold nothing on it, and
-- vega_account holds nothing on the football schemas. No foreign key to football tables:
-- entities are named by their public ids, so a purge or a re-identification there never
-- blocks or deletes a person's lists.
SET LOCAL lock_timeout = '3s';

CREATE SCHEMA account;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vega_account') THEN CREATE ROLE vega_account NOLOGIN; END IF;
END $$;

-- One row per person who signed in at least once. Deleting it erases everything below.
CREATE TABLE account.accounts (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The day of the last sign-in, not its instant: enough to know an account is in use.
  last_seen_on date NOT NULL DEFAULT current_date
);

-- What the site keeps in the browser for a visitor (orion.preferences.v1, the theme, the
-- preferred competition), kept here for an account. Typed columns, no free text.
CREATE TABLE account.preferences (
  account_id text PRIMARY KEY REFERENCES account.accounts ON DELETE CASCADE,
  focus text NOT NULL DEFAULT 'europe' CHECK (focus IN ('europe', 'all')),
  theme text CHECK (theme IN ('light', 'dark')),
  -- The country chosen by hand, as the browser keeps it (homeCountry): the base's three-letter
  -- code (FRA, ENG, BRA), or 'none' for « Aucun pays ». NULL: no choice, the detected country applies.
  country text CHECK (country ~ '^([A-Z]{3}|none)$'),
  -- « Privilégier la localisation ou l'importance du match » on the home page. NULL: no choice,
  -- the value fixed in the site's code applies (home-priority.js).
  home_priority text CHECK (home_priority IN ('location', 'importance')),
  preferred_competition text CHECK (preferred_competition ~ '^l_[A-Za-z0-9]{1,24}$'),
  onboarding_complete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Followed competitions (favoriteLeagueIds) and national teams. Favourite clubs and players are
-- not followed here: they are the clubs and players of the lists below, their single source.
CREATE TABLE account.follows (
  account_id text NOT NULL REFERENCES account.accounts ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('competition', 'nation')),
  entity_id text NOT NULL,
  followed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, entity_id),
  CHECK ((kind = 'competition' AND entity_id ~ '^l_[A-Za-z0-9]{1,24}$') OR (kind = 'nation' AND entity_id ~ '^t_[A-Za-z0-9]{1,24}$'))
);

-- Manual lists of players, clubs and matches (statarena.research.v1). The clubs and players
-- of a person's lists are the favourites of its home page.
CREATE TABLE account.lists (
  list_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES account.accounts ON DELETE CASCADE,
  -- The id the list has on the site ("main", "list-<ms>"): the key of a synchronisation.
  client_id text NOT NULL CHECK (client_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  position smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 49),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, client_id)
);

CREATE TABLE account.list_entries (
  list_id bigint NOT NULL REFERENCES account.lists ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('players', 'clubs', 'matches')),
  entity_id text NOT NULL,
  -- The season the entry was saved from ("2025/2026"), when the site knew one.
  season text CHECK (season ~ '^[0-9]{4}(/[0-9]{4})?$'),
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 4999),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, kind, entity_id),
  CHECK ((kind = 'players' AND entity_id ~ '^p_[A-Za-z0-9]{1,24}$') OR (kind = 'clubs' AND entity_id ~ '^t_[A-Za-z0-9]{1,24}$') OR (kind = 'matches' AND entity_id ~ '^m_[A-Za-z0-9]{1,24}$'))
);

-- The paying customer at Stripe, once a person started a payment. One each way.
CREATE TABLE account.stripe_customers (
  account_id text PRIMARY KEY REFERENCES account.accounts ON DELETE CASCADE,
  customer_id text NOT NULL UNIQUE CHECK (customer_id ~ '^cus_[A-Za-z0-9]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A subscription as Stripe last described it. Written by the webhook only. A level is 2
-- (Plus) or 3 (Pro); an account without a live subscription is level 1, by absence.
CREATE TABLE account.subscriptions (
  subscription_id text PRIMARY KEY CHECK (subscription_id ~ '^sub_[A-Za-z0-9]{1,64}$'),
  account_id text NOT NULL REFERENCES account.accounts ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level IN (2, 3)),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')),
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- When Stripe created the event that wrote this row: an older event never replaces it.
  event_created timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_account ON account.subscriptions (account_id);

-- The events already handled: Stripe sends an event again until it is acknowledged.
CREATE TABLE account.stripe_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9]{1,64}$'),
  type text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 80),
  event_created timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- The level of an account at an instant: 0 unknown, 1 free, else the highest level of its
-- subscriptions that still give a right (paid or in its trial, or late on a payment while
-- Stripe retries it) and whose period has not ended.
CREATE FUNCTION account.level_of(account text, at timestamptz DEFAULT now())
RETURNS smallint LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM account.accounts a WHERE a.account_id = account) THEN 0
    ELSE greatest(1, coalesce((
      SELECT max(s.level) FROM account.subscriptions s
      WHERE s.account_id = account AND s.status IN ('trialing', 'active', 'past_due') AND s.current_period_end > at), 1))
  END::smallint
$$;

-- A subscription as an event describes it; false when a more recent event already wrote it.
CREATE FUNCTION account.record_subscription(
  subscription text, account text, new_level smallint, new_status text, period_end timestamptz, at_period_end boolean, created timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  written integer;
BEGIN
  INSERT INTO account.subscriptions AS s (subscription_id, account_id, level, status, current_period_end, cancel_at_period_end, event_created)
  VALUES (subscription, account, new_level, new_status, period_end, at_period_end, created)
  ON CONFLICT (subscription_id) DO UPDATE
    SET level = EXCLUDED.level, status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end, event_created = EXCLUDED.event_created, updated_at = now()
    -- A subscription never changes hands, and an older event never replaces a newer one.
    WHERE s.account_id = EXCLUDED.account_id AND s.event_created <= EXCLUDED.event_created;
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written = 1;
END $$;

REVOKE ALL ON SCHEMA account FROM PUBLIC;
REVOKE ALL ON FUNCTION account.level_of(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION account.record_subscription(text, text, smallint, text, timestamptz, boolean, timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA account TO vega_account;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA account TO vega_account;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA account TO vega_account;
GRANT EXECUTE ON FUNCTION account.level_of(text, timestamptz) TO vega_account;
GRANT EXECUTE ON FUNCTION account.record_subscription(text, text, smallint, text, timestamptz, boolean, timestamptz) TO vega_account;
