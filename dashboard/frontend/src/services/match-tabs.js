/**
 * What the match page's header, line-ups, players and analyses read from the match's
 * families (/api/matches/{id}/{family}): the team statistics by period, the cards, the
 * players' figures in one row each, and each side's line-up with what happened to every
 * player (goals, cards, the minute he came on or went off, his Vega grade).
 */

const num = (value) => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** { All | FirstHalf | SecondHalf: { key: { home, away } } } from the team statistics family. */
export function teamStatsByPeriod(payload) {
  const out = {};
  for (const period of payload?.periods || []) {
    const stats = (out[period.period] = {});
    for (const group of period.groups || [])
      for (const item of group.items || []) stats[item.key] = { home: num(item.home), away: num(item.away) };
  }
  return out;
}

const CARD = { yellowcard: "yellow", secondyellow: "second", redcard: "red" };

/** The match's cards in order: minute, side, player and kind (yellow, second yellow, red). */
export function cardsOf(events, match) {
  return (events || [])
    .filter((e) => CARD[e.event_type])
    .map((e) => ({
      minute: e.minute, added: e.minute_added ?? null, kind: CARD[e.event_type],
      side: e.team_id === match?.home?.id ? "home" : e.team_id === match?.away?.id ? "away" : null,
      player: e.player || null,
    }))
    .sort((a, b) => a.minute - b.minute || (a.added ?? 0) - (b.added ?? 0));
}

/** Yellow and red cards by side; a second yellow counts as a red. */
export function cardCount(cards) {
  const count = { home: { yellow: 0, red: 0 }, away: { yellow: 0, red: 0 } };
  for (const card of cards) {
    if (!card.side) continue;
    if (card.kind === "yellow") count[card.side].yellow++;
    else count[card.side].red++;
  }
  return count;
}

/** A penalty shoot-out's period, normalized or in the provider's spelling (club-scout.js matchShots). */
const SHOOTOUT_PERIODS = new Set(["penalties", "Penalties"]);
/**
 * A side's players by their shots: how many, their xG and goals, the most dangerous first. A
 * shooter's xG is known only when each of his shots has one (VI-23 B5); an unknown xG comes after
 * the known ones. A shoot-out kick is no shot of the match; an in-match penalty and an extra-time
 * shot are (VI-23 stage 7, §16.4).
 */
export function shootersOf(shots, teamId, limit = 3) {
  const by = new Map();
  for (const s of shots || []) {
    if (s.teamId !== teamId || s.isOwnGoal || SHOOTOUT_PERIODS.has(s.period))
      continue;
    const key = s.playerId || s.playerName;
    const row = by.get(key) || { id: s.playerId || null, name: s.playerName || "—", shots: 0, xg: 0, goals: 0 };
    row.shots++;
    if (row.xg !== null)
      row.xg =
        typeof s.xg === "number" && Number.isFinite(s.xg)
          ? row.xg + s.xg
          : null;
    if (s.isGoal) row.goals++;
    by.set(key, row);
  }
  return [...by.values()]
    .sort(
      (a, b) =>
        (a.xg === null) - (b.xg === null) ||
        (b.xg ?? 0) - (a.xg ?? 0) ||
        b.shots - a.shots,
    )
    .slice(0, limit);
}

/* ------------------------------------------------------------- players */

const KEYS = {
  minutes: "minutes_played", grade: "vega_grade", goals: "goals", assists: "assists", xg: "expected_goals",
  xa: "expected_assists", shots: "total_shots", shotsOnTarget: "ShotsOnTarget", chancesCreated: "chances_created",
  passes: "accurate_passes", touches: "touches", dribbles: "dribbles_succeeded", tackles: "matchstats.headers.tackles",
  interceptions: "interceptions", recoveries: "recoveries", duelsWon: "duel_won", duelsLost: "duel_lost",
  defensiveActions: "defensive_actions", saves: "saves", goalsPrevented: "goals_prevented", fouls: "fouls",
};

/** One row per player of the players family: his figures by name, a fraction as value and total. */
export function playerRows(payload) {
  return (Array.isArray(payload) ? payload : []).map((entry) => {
    const found = {};
    for (const group of entry.stats || [])
      for (const item of Object.values(group.stats || {})) if (item?.key && item.stat) found[item.key] = item.stat;
    const row = {
      id: entry.player?.id || null, name: entry.player?.name || "—", imageUrl: entry.player?.image_url || null,
      teamId: entry.team_id, keeper: "saves" in found,
    };
    for (const [name, key] of Object.entries(KEYS)) {
      const stat = found[key];
      row[name] = stat ? num(stat.value) : null;
      if (stat?.total != null) row[`${name}Total`] = num(stat.total);
    }
    return row;
  });
}

/* ------------------------------------------------------------ coverage */

/**
 * « Statistiques incohérentes » only on team statistics that exist (FAILURE_MODES § 67): the read API's
 * `teamStatsReliable` is false for every match whose team statistics are not read yet (before and during it) or
 * that the provider does not have, which is not an inconsistency.
 */
export function teamStatsFlagged(match) {
  return match?.coverage?.teamStatsReliable === false && (match.stats?.length ?? 0) > 0;
}

/* ------------------------------------------------------------- line-ups */

/**
 * Each side's line-up with what happened to its players: goals and own goals, cards, the minute
 * a starter went off and a substitute came on (and for whom), his grade and photo.
 */
export function lineupView(payload, events, rows, grades, images) {
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const goals = new Map(), owns = new Map(), cards = new Map(), off = new Map(), on = new Map();
  const add = (map, id, value) => id && map.set(id, [...(map.get(id) || []), value]);
  for (const e of events || []) {
    const id = e.player?.id;
    if (e.event_type === "goal") add(e.is_own_goal ? owns : goals, id, e.minute);
    else if (CARD[e.event_type]) add(cards, id, { minute: e.minute, kind: CARD[e.event_type] });
    else if (e.event_type === "substitution") {
      if (id) off.set(id, { minute: e.minute, by: e.sub_in_player || null });
      if (e.sub_in_player?.id) on.set(e.sub_in_player.id, { minute: e.minute, for: e.player || null });
    }
  }
  const person = (p) => {
    const row = byId.get(p.player_id), grade = grades?.get?.(p.player_id);
    return {
      id: p.player_id || null, name: p.name, shirt: p.shirt_number || null, captain: Boolean(p.is_captain),
      x: p.pitch_x, y: p.pitch_y, positionId: p.position_id ?? null,
      // The line-up's own photo (FAILURE_MODES § 67) is there before the statistics and the grades.
      imageUrl: row?.imageUrl || grade?.imageUrl || p.image_url || images?.get?.(p.player_id) || null,
      grade: grade?.grade ?? row?.grade ?? null, minutes: row?.minutes ?? grade?.minutes ?? null,
      goals: goals.get(p.player_id) || [], ownGoals: owns.get(p.player_id) || [], cards: cards.get(p.player_id) || [],
      off: off.get(p.player_id) || null, on: on.get(p.player_id) || null,
    };
  };
  const side = (key) => {
    const lineup = payload?.[key];
    if (!lineup) return null;
    const subs = (lineup.subs || []).map(person);
    return {
      team: payload[`${key}_team`] || null, formation: lineup.formation || null, confirmed: lineup.confirmed ?? null,
      coach: lineup.coach?.name || null,
      starters: (lineup.starters || []).map(person),
      // Those who came on first, in the order they came on; then the bench that stayed there.
      entered: subs.filter((p) => p.on).sort((a, b) => a.on.minute - b.on.minute),
      bench: subs.filter((p) => !p.on),
    };
  };
  return { home: side("home"), away: side("away") };
}

// The methods whose `share` is a starter's starts in the basis / its elevens (« Titulaire N fois sur M »). probable-v2's
// and probable-v3's is a score, not a count (FAILURE_MODES §61.3, §61.4): their markers carry no share.
const STARTS_SHARE = new Set(["probable-v1"]);

/**
 * Our probable XI of each side (GET /api/matches/{id}/lineups/probable, methods probable-v1 to probable-v3):
 * { data: { match_id, method, computedAt, home|away: { formation, basis: { lineups, from, to },
 * starters: [{ player_id, name, shirt_number, position_id, pitch_x, pitch_y, share, replaces?,
 * image_url? }], absent: [{ player_id, name, kind, label, expectedReturn, matchesRemaining?,
 * image_url? }] } | null } }. The starters in the shape of lineupView's, with no grade, goal or card
 * (their share only when it counts starts); the absent in the shape of the absences' rows
 * (services/team-absences.js).
 */
export function probableView(payload) {
  const counts = STARTS_SHARE.has(payload?.method);
  const side = (key) => {
    const probable = payload?.[key];
    if (!probable?.starters?.length) return null;
    const absent = (probable.absent || []).map((a) => ({
      key: a.player_id || a.name,
      player: { id: a.player_id || null, name: a.name, imageUrl: a.image_url || null, role: null },
      kind: a.kind || null, label: a.label || null, expectedReturn: a.expectedReturn || null,
      matchesRemaining: a.matchesRemaining ?? null,
    }));
    const kindOf = new Map(absent.map((a) => [a.player.id, a.kind]));
    return {
      state: "probable", formation: probable.formation || null, basis: probable.basis || null, coach: null,
      starters: (probable.starters || []).map((p) => ({
        id: p.player_id || null, name: p.name, shirt: p.shirt_number || null, captain: false,
        x: p.pitch_x, y: p.pitch_y, positionId: p.position_id ?? null, imageUrl: p.image_url || null, grade: null, minutes: null,
        goals: [], ownGoals: [], cards: [], off: null, on: null, probable: true,
        share: counts && Number.isFinite(p.share) ? p.share : null,
        replaces: p.replaces ? { id: p.replaces.player_id || null, name: p.replaces.name, kind: kindOf.get(p.replaces.player_id) || null } : null,
      })),
      absent, entered: [], bench: [],
    };
  };
  return { home: side("home"), away: side("away") };
}

/**
 * The line-up each side shows: the provider's when it sent one (« official » when confirmed,
 * « forecast » otherwise), else our probable XI, else none.
 */
export function lineupSides(view, probable) {
  const pick = (key) => {
    const provided = view?.[key];
    // Official only when the provider says so: an eleven whose confirmation is unknown is its forecast.
    if (provided) return { ...provided, state: provided.confirmed === true ? "official" : "forecast" };
    return probable?.[key] || null;
  };
  return { home: pick("home"), away: pick("away") };
}

// The line-ups are read again every minute from 90 minutes before the kick-off to 30 minutes after it.
export const LINEUPS_WATCH = { every: 60_000, before: 90 * 60_000, after: 30 * 60_000 };
const kickoffOf = (match) => Date.parse(match?.timeUtc || "");

/** Not kicked off yet at `now` (the status first; it may lag behind the clock, then the kick-off and the score). */
export function lineupsBeforeKickoff(match, now) {
  if (match?.status === "not_started") return true;
  if (["finished", "postponed", "canceled", "abandoned", "in_play", "live", "inplay"].includes(match?.status)) return false;
  const kickoff = Date.parse(match?.timeUtc || match?.date || "");
  return Number.isFinite(kickoff) && kickoff > now && match?.home?.score == null && match?.away?.score == null;
}

/** Whether the line-ups (GET …/lineups, `payload`) are read again at `now`: within the watch, until both are official. */
export function lineupsWatched(match, payload, now) {
  const kickoff = kickoffOf(match);
  const official = payload?.home?.confirmed === true && payload?.away?.confirmed === true;
  return Number.isFinite(kickoff) && !official && now >= kickoff - LINEUPS_WATCH.before && now <= kickoff + LINEUPS_WATCH.after;
}

/** Our probable eleven is read before the kick-off only, while a side lacks the provider's eleven. */
export function probableWanted(before, payload) {
  return Boolean(before) && (!payload?.home || !payload?.away);
}

/** The portraits our probable XI carries (starters and absent), by player id. */
export function probableImages(payload) {
  const images = new Map();
  for (const key of ["home", "away"])
    for (const p of [...(payload?.[key]?.starters || []), ...(payload?.[key]?.absent || [])])
      if (p.player_id && p.image_url) images.set(p.player_id, p.image_url);
  return images;
}

/* ------------------------------------------------------- players board */

// The board's columns: a figure, its total (« 37 / 49 ») or its share (« 5 (3) »), and its digits.
export const BOARD_COLUMNS = [
  { key: "minutes", label: "Min" },
  { key: "grade", label: "Note Vega" },
  { key: "goals", label: "B" },
  { key: "assists", label: "PD" },
  { key: "xg", label: "xG", digits: 2 },
  { key: "xa", label: "xA", digits: 2 },
  { key: "shots", label: "Tirs (cadrés)", extra: "shotsOnTarget" },
  { key: "chancesCreated", label: "Occasions créées" },
  { key: "passes", label: "Passes réussies", total: "passesTotal" },
  { key: "dribbles", label: "Dribbles réussis", total: "dribblesTotal" },
  { key: "duelsWon", label: "Duels gagnés" },
  { key: "recovered", label: "Tacles + interc.", hint: "Tacles et interceptions réunis." },
  { key: "recoveries", label: "Récupérations" },
  { key: "saves", label: "Arrêts" },
];

/** Every player who came on, with his grade, the minute he came on or went off. */
export function boardRows(payload, events, grades) {
  const on = new Map(), off = new Map();
  for (const e of events || [])
    if (e.event_type === "substitution") {
      if (e.player?.id) off.set(e.player.id, e.minute);
      if (e.sub_in_player?.id) on.set(e.sub_in_player.id, e.minute);
    }
  return playerRows(payload)
    .filter((r) => r.minutes > 0)
    .map((r) => {
      const g = grades?.get?.(r.id);
      return {
        ...r,
        imageUrl: r.imageUrl || g?.imageUrl || null,
        grade: g?.grade ?? r.grade,
        on: on.get(r.id) ?? null,
        off: off.get(r.id) ?? null,
        // Each needs both its terms: the family leaves out what the source did not publish, and
        // no zero is invented for it (VI-23 B5).
        threat: r.xg != null && r.xa != null ? r.xg + r.xa : null,
        recovered:
          r.tackles != null && r.interceptions != null
            ? r.tackles + r.interceptions
            : null,
      };
    });
}

/** Rows by a column, a missing value always last; ties by grade then name. */
export function sortRows(rows, { key, direction }) {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return (b.grade ?? -1) - (a.grade ?? -1) || a.name.localeCompare(b.name, "fr");
    if (x == null) return 1;
    if (y == null) return -1;
    return sign * (x - y) || (b.grade ?? -1) - (a.grade ?? -1) || a.name.localeCompare(b.name, "fr");
  });
}

/** The best grade, and the most dangerous, present and solid players of the match. */
export function leaders(rows) {
  const top = (key) => [...rows].filter((r) => r[key] != null).sort((a, b) => b[key] - a[key])[0] || null;
  return { grade: top("grade"), threat: top("threat"), passes: top("passes"), duels: top("duelsWon") };
}

/* --------------------------------------------------------- team style */

/**
 * The two teams' play side by side, by phase (the advanced family): each row a label, the home
 * and away values, its digits, unit, and `lower` when less is better (PPDA).
 */
export function styleGroups(teams, match) {
  const home = (teams || []).find((t) => t.team?.id === match?.home?.id);
  const away = (teams || []).find((t) => t.team?.id === match?.away?.id);
  if (!home || !away) return null;
  const row = (label, get, more = {}) => {
    const h = get(home), a = get(away);
    return h == null || a == null ? null : { label, home: h, away: a, ...more };
  };
  const groups = [
    ["Construction", [
      row("Possession", (t) => t.territory?.possession_pct, { unit: " %" }),
      row("Passes par action", (t) => t.tempo?.passes_per_sequence, { digits: 1 }),
      row("Attaques directes", (t) => t.tempo?.direct_attacks),
      row("Réussite des passes", (t) => t.passing?.pass_accuracy, { unit: " %" }),
    ]],
    ["Progression", [
      row("Passes vers l’avant", (t) => t.passing?.progressive_passes),
      row("Courses vers l’avant", (t) => t.carrying?.progressive_carries),
      row("Entrées dans le dernier tiers", (t) => t.territory?.final_third_entries),
      row("Entrées dans la surface", (t) => t.territory?.box_entries),
    ]],
    ["Création", [
      row("Actions menant à un tir", (t) => t.creation?.sca),
      row("Actions menant à un but", (t) => t.creation?.gca),
      row("Passes clés", (t) => t.passing?.key_passes),
    ]],
    ["Pressing et territoire", [
      row("Territoire (field tilt)", (t) => t.territory?.field_tilt, { unit: " %" }),
      row("PPDA", (t) => t.defending?.ppda, { digits: 1, lower: true }),
      row("Ballons repris haut", (t) => t.defending?.high_turnovers),
      row("Repris dans les 5 s", (t) => t.defending?.counterpress_regains_5s),
    ]],
    ["Valeur des actions", [
      row("Valeur offensive", (t) => t.possession_value?.vaep_offensive, { digits: 2 }),
      row("Valeur défensive", (t) => t.possession_value?.vaep_defensive, { digits: 2 }),
    ]],
  ];
  const out = groups.map(([title, rows]) => ({ title, rows: rows.filter(Boolean) })).filter((g) => g.rows.length);
  return out.length ? out : null;
}
