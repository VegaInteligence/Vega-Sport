/**
 * The match's « Qui a dominé, minute par minute », its data: the source's pressure points
 * (-100 … 100, positive for the home side) split by period, each with its share of the pressure
 * and a 5-minute average, and the goals placed on them with the score they made.
 *
 * The source writes stoppage time as fractional minutes (45.5, 90.5, 90.75, 105.5, 120.5…): each
 * belongs to the period it ends, never to the next minute. Extra time (from 91) is a third panel.
 */

const PANELS = [
  { key: "first", label: "1re mi-temps", period: "FirstHalf", ticks: [0, 15, 30, 45], holds: (m) => m < 46 },
  { key: "second", label: "2e mi-temps", period: "SecondHalf", ticks: [60, 75, 90], holds: (m) => m >= 46 && m < 91 },
  { key: "extra", label: "Prolongation", period: "ExtraTime", ticks: [105, 120], holds: (m) => m >= 91 },
];
const AVERAGE_SPAN = 2; // points on each side: a 5-minute centred mean

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const minuteLabel = (m) => (Number.isInteger(m) ? `${m}′` : `${Math.floor(m)}+`);

function shareOf(points) {
  let home = 0, away = 0;
  for (const p of points) {
    if (p.value > 0) home += p.value;
    else away -= p.value;
  }
  if (!(home + away)) return null;
  const h = Math.round((100 * home) / (home + away));
  return { home: h, away: 100 - h };
}

function panelIndex(goal, panels) {
  const byPeriod = panels.findIndex((p) => p.period === goal.period);
  if (byPeriod >= 0) return byPeriod;
  return panels.findIndex((p) => p.holds(goal.minute));
}

/** The slot a goal is drawn at: in stoppage time, its panel's first fractional slot after the minute. */
function slotOf(goal, panel) {
  const minutes = panel.points.map((p) => p.minute);
  if (goal.minute_added > 0) {
    const stoppage = minutes.find((m) => !Number.isInteger(m) && m > goal.minute);
    if (stoppage != null) return stoppage;
  }
  let best = minutes[0];
  for (const m of minutes) if (Math.abs(m - goal.minute) < Math.abs(best - goal.minute)) best = m;
  return best;
}

/**
 * `points`: the momentum section's points; `events`: the events section's events; `homeId`: the home
 * team's id. Null when no point carries a number.
 */
export function momentumPanels(points, events, { homeId } = {}) {
  const byMinute = new Map();
  for (const p of points || []) if (finite(p?.minute) && finite(p?.value)) byMinute.set(p.minute, p.value);
  if (!byMinute.size) return null;
  const sorted = [...byMinute].sort((a, b) => a[0] - b[0]).map(([minute, value]) => ({ minute, value }));
  const panels = PANELS.map((def) => {
    const own = sorted.filter((p) => def.holds(p.minute));
    return {
      key: def.key,
      label: def.label,
      period: def.period,
      holds: def.holds,
      ticks: def.ticks.filter((t) => own.some((p) => p.minute === t)),
      share: shareOf(own),
      points: own.map((p, i) => {
        const window = own.slice(Math.max(0, i - AVERAGE_SPAN), i + AVERAGE_SPAN + 1);
        return { ...p, label: minuteLabel(p.minute), avg: window.reduce((a, w) => a + w.value, 0) / window.length };
      }),
    };
  }).filter((p) => p.points.length);

  const ordered = (events || [])
    .filter((e) => e?.event_type === "goal" && finite(e.minute))
    .map((e, i) => ({ e, i, at: e.minute + (e.minute_added > 0 ? e.minute_added / 100 : 0) }))
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const score = [0, 0];
  const goals = [];
  for (const { e } of ordered) {
    const scorerHome = e.team_id === homeId;
    const side = scorerHome !== Boolean(e.is_own_goal) ? "home" : "away";
    score[side === "home" ? 0 : 1]++;
    const panel = panelIndex(e, panels);
    if (panel < 0) continue;
    goals.push({
      panel,
      slot: slotOf(e, panels[panel]),
      label: e.minute_added > 0 ? `${e.minute}+${e.minute_added}′` : `${e.minute}′`,
      player: e.player?.name || e.player_name || null,
      side,
      ownGoal: Boolean(e.is_own_goal),
      score: [...score],
    });
  }
  return { panels: panels.map(({ holds, ...p }) => p), goals };
}
