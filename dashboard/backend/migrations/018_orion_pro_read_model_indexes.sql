-- Approved 6 Nov 2026 (docs/architecture/orion-read-models-20261105/PLAN.md, section 3).
-- Index-only: no table, column, constraint, trigger, grant or data change.
-- Serves the per-build read models filled by the publisher.

-- Exact017 parent: 87aac35a93b8b0455a7dcf13fde5bb0be468d1183a0bf4a96f36b04b4b770458.

CREATE INDEX "analytics_metric_totals_build_kind_metric_value_idx" ON "analytics"."metric_totals" ("build_id", "subject_kind", "metric_code", "numeric_value" DESC NULLS LAST);

CREATE INDEX "analytics_metric_totals_build_kind_player_idx" ON "analytics"."metric_totals" ("build_id", "subject_kind", "player_id");

CREATE INDEX "analytics_metric_totals_build_kind_team_idx" ON "analytics"."metric_totals" ("build_id", "subject_kind", "team_id");

CREATE INDEX "analytics_player_competition_team_stats_build_team_idx" ON "analytics"."player_competition_team_stats" ("build_id", "team_id");

CREATE INDEX "analytics_player_competition_team_stats_player_idx" ON "analytics"."player_competition_team_stats" ("player_id");

CREATE INDEX "analytics_player_competition_stats_player_idx" ON "analytics"."player_competition_stats" ("player_id");
