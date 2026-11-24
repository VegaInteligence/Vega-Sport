-- The scorers of the national matches read from International Results (FAILURE_MODES.md §57; hugo, 24 Nov 2026):
-- goalscorers.csv of github.com/martj42/international_results (CC0), read by vega/sources/international_goals.py as
-- one more scope of the International Results adapter (nations-results:goalscorers).
--
-- One row per goal of a held International Results match (core.provider_ids, provider international_results), as the
-- file gives it: its rank among the match's goals in the file, the side it counts for (an own goal counts for the team
-- credited; its scorer plays for the other side), the scorer and the assist as text, the minute (NULL when the file
-- says « NA »), the own goal and penalty flags. A scorer is a name, not a person of the base: player_id is set only by
-- the reader's conservative link (one player of that team's line-ups with that name, §57.1), and cleared when the link
-- stops holding or the player goes.
--
-- Display data only: nothing of the rankings, the Elo or the models reads this table (core.match_events is not
-- written). A match withdrawn by its edition takes its goals (ON DELETE CASCADE; vega/sources/snapshot.py LAPSING).
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.international_goals (
  match_id integer NOT NULL REFERENCES core.matches(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 99),
  side core.side NOT NULL,
  scorer text CHECK (scorer IS NULL OR length(scorer) BETWEEN 1 AND 200),
  minute smallint CHECK (minute IS NULL OR minute BETWEEN 1 AND 130),
  own_goal boolean NOT NULL,
  penalty boolean NOT NULL,
  assist text CHECK (assist IS NULL OR length(assist) BETWEEN 1 AND 200),
  player_id integer REFERENCES core.players(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, position),
  CHECK (NOT (own_goal AND penalty))
);
CREATE INDEX international_goals_player ON core.international_goals (player_id) WHERE player_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON core.international_goals TO vega_collect;

-- Each goal with its public match and player ids and whether its match's list is complete: the match finished, both
-- scores known, and each side's goals equal to its score. Computed at read: a score corrected later changes it.
CREATE VIEW api.international_goals AS
SELECT g.match_id AS match_key, api.public_id('match', g.match_id) AS match_id, m.home_team_id AS home_key, m.away_team_id AS away_key,
  g.position, g.side::text AS side, g.scorer, g.minute, g.own_goal, g.penalty, g.assist,
  CASE WHEN g.player_id IS NOT NULL THEN api.public_id('player', g.player_id) END AS player_id,
  (m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
   AND (SELECT count(*) FILTER (WHERE x.side = 'home') = m.home_score AND count(*) FILTER (WHERE x.side = 'away') = m.away_score
        FROM core.international_goals x WHERE x.match_id = g.match_id)) AS complete
FROM core.international_goals g
JOIN core.matches m ON m.id = g.match_id;

GRANT SELECT ON api.international_goals TO vega_read;
