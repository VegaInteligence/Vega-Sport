-- Expected points, version 2 (VI-23 B6, calculation audit of 16 November 2026, finding 10;
-- docs/calculs/09-audit-2026-11/FAILURE_MODES.md §7.4). Version 1 (011) stopped each side's
-- Poisson law at ten goals and gave the missing mass to the defeat: 6 xG against 6 xG gave
-- 40.04 % of wins for 48.38 % of defeats, and more xG for could lower the xPts.
--
-- Version 2 is the law of club-scout.js outcomeChances, the same computation: xG floored at 0.01
-- (the documented choice), a negative, not-a-number or infinite xG rejected (NULL), and an xG
-- above 100 too: the supported domain, an engineering guard and not a sporting limit (no match
-- nears it; exp(-750) would underflow, an error, and a huge rate exhaust the support). Each
-- side's probabilities of 0 to ⌈rate + 12√rate + 12⌉ goals (the goals left out weigh less than
-- 1e-12); win, draw and loss each summed, then divided by their total (NULL unless it is finite
-- and positive). A numerical approximation of the infinite sums, not an exact one. Version 1 is
-- kept, unchanged, for what was computed with it.
--
-- The calculator's xPts (calculator.py) and api.match_xpts read version 2. The view keeps its
-- columns, their order and their types (012), and calls the law once per row, as one function scan
-- (VI-23 stage 5, FAILURE_MODES §14.6): `(SELECT (agg.xpts_v2(...)).*)` expanded into one call per
-- output column, four per row. A NULL law (an impossible xG) is a row of NULLs, as before.
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION agg.xpts_v2(xg_for double precision, xg_against double precision)
RETURNS agg.xpts_result LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  a double precision;
  b double precision;
  pa double precision[] := ARRAY[]::double precision[];
  pb double precision[] := ARRAY[]::double precision[];
  p double precision;
  n integer;
  k integer;
  below double precision;
  win double precision := 0;
  draw double precision := 0;
  loss double precision := 0;
  total double precision;
BEGIN
  IF xg_for IS NULL OR xg_against IS NULL OR xg_for < 0 OR xg_against < 0
     OR xg_for IN ('NaN'::double precision, 'Infinity'::double precision)
     OR xg_against IN ('NaN'::double precision, 'Infinity'::double precision)
     OR xg_for > 100 OR xg_against > 100 THEN
    RETURN NULL;
  END IF;
  a := greatest(xg_for, 0.01);
  b := greatest(xg_against, 0.01);
  -- Index k + 1 holds the chance of k goals.
  n := ceil(a + 12 * sqrt(a) + 12);
  p := exp(-a);
  FOR k IN 0..n LOOP
    pa := pa || p;
    p := p * a / (k + 1);
  END LOOP;
  n := ceil(b + 12 * sqrt(b) + 12);
  p := exp(-b);
  FOR k IN 0..n LOOP
    pb := pb || p;
    p := p * b / (k + 1);
  END LOOP;
  -- A win: k goals for, fewer against; a defeat the other way round.
  below := 0;
  FOR k IN 1..array_length(pa, 1) LOOP
    win := win + pa[k] * below;
    IF k <= array_length(pb, 1) THEN below := below + pb[k]; END IF;
  END LOOP;
  below := 0;
  FOR k IN 1..array_length(pb, 1) LOOP
    loss := loss + pb[k] * below;
    IF k <= array_length(pa, 1) THEN below := below + pa[k]; END IF;
  END LOOP;
  FOR k IN 1..least(array_length(pa, 1), array_length(pb, 1)) LOOP
    draw := draw + pa[k] * pb[k];
  END LOOP;
  total := win + draw + loss;
  IF NOT (total > 0) OR total = 'Infinity'::double precision THEN
    RETURN NULL;
  END IF;
  RETURN ROW(win / total, draw / total, loss / total, (3 * win + draw) / total)::agg.xpts_result;
END
$$;
GRANT EXECUTE ON FUNCTION agg.xpts_v2(double precision, double precision) TO vega_calc, vega_read;

CREATE OR REPLACE VIEW api.match_xpts AS
SELECT o.season_id, o.match_id, o.team_id, p.team_id AS opponent_id, o.xg, p.xg AS xg_against,
  x.p_win, x.p_draw, x.p_loss, x.xpts
FROM core.team_match_stats o
JOIN core.team_match_stats p ON p.season_id = o.season_id AND p.match_id = o.match_id
  AND p.period = o.period AND p.team_id <> o.team_id
CROSS JOIN LATERAL agg.xpts_v2(o.xg, p.xg) x
WHERE o.period = 'all';
