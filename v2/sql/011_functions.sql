-- Shared formulas: views and the calculator call these instead of repeating them.

CREATE SCHEMA api;

-- Percentage; NULL when the total is zero or absent.
CREATE FUNCTION core.pct(made double precision, total double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN total > 0 AND made IS NOT NULL THEN 100 * made / total END
$$;

-- Value per 90 minutes; NULL without covered minutes.
CREATE FUNCTION core.per90(value double precision, minutes double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN minutes > 0 AND value IS NOT NULL THEN 90 * value / minutes END
$$;

-- Age in whole years at a date; never stored, it changes every day.
CREATE FUNCTION core.age_on(birth_date date, on_date date)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN birth_date IS NOT NULL AND on_date IS NOT NULL
    THEN extract(year FROM age(on_date, birth_date))::integer END
$$;

-- Expected points, version 1: each side scores Poisson(xG) goals, 0 to 10, xG floored
-- at 0.01 (same model as the current club page, club-scout.js outcomeChances).
CREATE TYPE agg.xpts_result AS (p_win real, p_draw real, p_loss real, xpts real);

CREATE FUNCTION agg.xpts_v1(xg_for double precision, xg_against double precision)
RETURNS agg.xpts_result LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH l AS (
    SELECT greatest(xg_for, 0.01) AS a, greatest(xg_against, 0.01) AS b
    WHERE xg_for IS NOT NULL AND xg_against IS NOT NULL
  ), pa AS (
    SELECT i, exp(-l.a) * power(l.a, i) / factorial(i)::double precision AS p
    FROM l, generate_series(0, 10) AS i
  ), pb AS (
    SELECT j, exp(-l.b) * power(l.b, j) / factorial(j)::double precision AS p
    FROM l, generate_series(0, 10) AS j
  ), o AS (
    SELECT sum(pa.p * pb.p) FILTER (WHERE i > j) AS w,
           sum(pa.p * pb.p) FILTER (WHERE i = j) AS d
    FROM pa CROSS JOIN pb
  )
  SELECT CASE WHEN o.w IS NULL THEN NULL
    ELSE ROW(o.w, o.d, greatest(0, 1 - o.w - o.d), 3 * o.w + o.d)::agg.xpts_result END
  FROM o
$$;
