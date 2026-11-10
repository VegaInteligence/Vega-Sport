-- Live (doc "Live"): one provider feed per match in progress, broadcast by AWS to every
-- viewer, in a store of its own (DynamoDB, infra/aws-v2/live.yaml) that never touches
-- core and is deleted after the match. PitchAPI fills core afterwards as for every match
-- and wins on any difference. Only those differences are kept here, to judge the live
-- provider's reliability (vega_v2/live/handoff.py writes them).
CREATE TABLE ops.live_discrepancies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id integer NOT NULL,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9_]{1,40}$'),
  field text NOT NULL CHECK (field ~ '^[a-z0-9_.:]{1,80}$'),
  live_value text,
  final_value text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, provider, field)
);
CREATE INDEX live_discrepancies_detected ON ops.live_discrepancies(detected_at);

-- How often each provider disagreed with the final data, by field.
CREATE VIEW ops.live_reliability AS
SELECT provider, split_part(field, ':', 1) AS field, count(DISTINCT match_id)::int AS matches, count(*)::int AS discrepancies,
  max(detected_at) AS latest
FROM ops.live_discrepancies GROUP BY 1, 2;
