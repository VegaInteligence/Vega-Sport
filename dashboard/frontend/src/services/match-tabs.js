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

/** A side's players by their shots: how many, their xG and goals, the most dangerous first. */
export function shootersOf(shots, teamId, limit = 3) {
  const by = new Map();
  for (const s of shots || []) {
    if (s.teamId !== teamId || s.isOwnGoal) continue;
    const key = s.playerId || s.playerName;
    const row = by.get(key) || { id: s.playerId || null, name: s.playerName || "—", shots: 0, xg: 0, goals: 0 };
    row.shots++;
    row.xg += s.xg || 0;
    if (s.isGoal) row.goals++;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.xg - a.xg || b.shots - a.shots).slice(0, limit);
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

/* ------------------------------------------------------------- line-ups */

/**
 * Each side's line-up with what happened to its players: goals and own goals, cards, the minute
 * a starter went off and a substitute came on (and for whom), his grade and photo.
 */
export function lineupView(payload, events, rows, grades) {
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
      x: p.pitch_x, y: p.pitch_y, imageUrl: row?.imageUrl || grade?.imageUrl || null,
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
        threat: (r.xg ?? 0) + (r.xa ?? 0),
        recovered: r.tackles == null && r.interceptions == null ? null : (r.tackles ?? 0) + (r.interceptions ?? 0),
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
