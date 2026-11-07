import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compactHomePresentation } from "../dashboard/backend/services/home-presentation.js";
import {
  imageSources,
  withResolvedMedia,
} from "../dashboard/backend/services/resolved-media.js";
import {
  matchDay,
  matchWeight,
  shotMapPoints,
  upcomingDayOrder,
  xgTimeline,
} from "../dashboard/frontend/src/services/home-insights.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  frontend = path.join(root, "dashboard/frontend/src"),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  ),
  h = React.createElement,
  moduleDefault = (value) => ({ __esModule: true, default: value });

// Exercise the production JSX, including its links, image URLs and SVG values.
// Only framework navigation and context are replaced; data consumers are real.
let stateOverrides = new Map();
const react = {
  ...React,
  useState(initial) {
    const [value, set] = React.useState(initial);
    return [stateOverrides.has(value) ? stateOverrides.get(value) : value, set];
  },
};
const football = {
  season: "2026/2027",
  compactPerformanceAvailable: true,
  setPlayer() {},
  href(route, params = {}) {
    return `${route}?${new URLSearchParams(params)}`;
  },
};
const ui = {
  Media: ({ name, url, className }) =>
    h("img", { alt: name, src: url || undefined, className }),
  Segments: ({ label, value, items }) =>
    h(
      "nav",
      { "aria-label": label },
      items.map(([id, title]) =>
        h("button", { key: id, "aria-pressed": value === id }, title),
      ),
    ),
};
async function compile(file, overrides = {}) {
  const filename = path.join(frontend, file),
    source = await fs.readFile(filename, "utf8"),
    stubs = {
      react,
      "next/link": moduleDefault(
        ({ href, children, prefetch: _prefetch, ...props }) =>
          h("a", { ...props, href }, children),
      ),
      "./Icon.jsx": moduleDefault(() => null),
      "./BallonDorIcon.jsx": moduleDefault(() => null),
      "./UI.jsx": ui,
      "../hooks/FootballContext.jsx": { useFootball: () => football },
      ...overrides,
    };
  for (const found of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const name = found[1];
    if (!(name in stubs) && name.endsWith(".js"))
      stubs[name] = {
        __esModule: true,
        ...(await import(
          pathToFileURL(path.resolve(path.dirname(filename), name)).href
        )),
      };
  }
  const code = babel.transformSync(source, {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
      filename,
    }).code,
    mod = { exports: {} };
  vm.runInThisContext(
    "(function(require,module,exports,React){" + code + "\n})",
    { filename },
  )(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
    React,
  );
  return mod.exports;
}
const common = await compile("components/HomeCommon.jsx"),
  shared = { "./HomeCommon.jsx": common },
  players = await compile("components/HomePlayers.jsx", shared),
  matchday = await compile("components/HomeMatchday.jsx", shared),
  seasonCards = await compile("components/HomeSeason.jsx", shared);

const season = "2026/2027",
  now = Date.parse("2026-11-07T12:00:00Z");
function fixture() {
  const leagueId = "l_3FJFUl",
    otherLeague = "l_0ErfuF";
  const team = (i) => ({
    id: `t_00000${i}`,
    name: `Club ${i}`,
    imageUrl: `https://images.example/team-${i}.webp`,
    score: i % 3,
    xg: i / 10,
    shots: 8,
    shotsOnTarget: 3,
    possession: 51,
    coach: "Unused coach",
    formation: "4-4-2",
  });
  const game = (i) => ({
    id: `m_00000${i}`,
    season,
    leagueId,
    league: "Ligue 1",
    date: "2026-11-04",
    timeUtc: "2026-11-04T20:00:00Z",
    status: "finished",
    country: "FRA",
    stadium: "Unused stadium",
    home: team(i),
    away: team(i + 1),
    shots: [],
    stats: [],
    coverage: { lineups: true },
    warnings: [],
  });
  const featured = game(1);
  featured.shots = [
    { isGoal: true, situation: "Penalty", type: "Goal" },
    { isGoal: false, isOwnGoal: true, situation: "RegularPlay", type: "Goal" },
    { isBlocked: true, blockedX: 95, blockedY: 28, type: "AttemptSaved" },
    { type: "Post", xg: 0, goalCrossedZ: null },
    { isOnTarget: true, type: "AttemptSaved", shotType: "Header" },
    { isOnTarget: false, type: "AttemptSaved", xg: null, x: null },
  ].map((s, i) => ({
    id: `shot-${i}`,
    teamId: i % 2 ? featured.away.id : featured.home.id,
    playerId: `p_00000${i}`,
    playerName: `Player ${i}`,
    minute: i * 17,
    xg: 0.34,
    x: 84,
    y: 27,
    goalCrossedY: 35,
    goalCrossedZ: 1.7,
    isGoal: false,
    isOwnGoal: false,
    isBlocked: false,
    isOnTarget: false,
    shotType: "LeftFoot",
    situation: "RegularPlay",
    keeperName: "Unused keeper",
    ...s,
  }));
  featured.stats = [
    "big_chance",
    "duel_won",
    "corners",
    "keeper_saves",
    "unused_stat",
  ].map((key, i) => ({
    key,
    home: i ? i : null,
    away: i + 1,
    label: "Unused label",
    reliable: false,
  }));
  const appearance = (i) => ({
    id: `m_000001:p_00000${i}`,
    playerId: `p_00000${i}`,
    matchId: featured.id,
    name: `Player ${i}`,
    imageUrl: `https://images.example/player-${i}.webp`,
    team: "Club 1",
    teamId: "t_000001",
    rating: 8.5 - i / 10,
    goals: 3,
    assists: 2,
    duelsWon: 4,
    duelsLost: null,
    xg: 0.7,
    shots: 4,
    shotsOnTarget: 3,
    chancesCreated: 2,
    passesAccurate: 20,
    passesAttempted: 25,
    touches: 40,
    defensiveActions: 7,
    minutes: 90,
    date: "2026-11-04",
    season,
    shirtNumber: 10,
    starter: false,
    keeperSaves: null,
    unusedMetric: 999,
  });
  const totals = Array.from({ length: 3 }, (_, i) => ({
    ...appearance(i),
    lastId: appearance(i).id,
    apps: 9,
    xa: i / 10,
    ratingSum: 999,
    ratingMinutes: 900,
    xgMatches: 9,
    xaMatches: 9,
  }));
  const table = (league) => ({
    leagueId: league,
    played: 9,
    games: 38,
    teamCount: 20,
    rows: Array.from({ length: 6 }, (_, i) => ({
      ...team(i + 1),
      points: 20 - i,
      rank: i + 1,
      played: 9,
      form: ["W", "D", "L"],
      cumulative: [3, 4, 4, 7, 10, 13, 16, 17, 20 - i],
      results: ["W", "D", "L"],
      cleanSheets: 4,
      goalsAgainst: 8,
      leagueId: league,
      perGame: 8 / 9,
      streak: 4,
    })),
  });
  const future = (i) => ({
    time: now + i * 3600000,
    day: "2026-11-07",
    personal: i % 2,
    europePriority: i % 3,
    weight: 9,
    fixture: {
      id: `m_future${i}`,
      season,
      date: "2026-11-07",
      league: { id: leagueId, name: "Ligue 1", image_url: "unused-league.png" },
      home_team: {
        id: `t_00000${i}`,
        name: `Club ${i}`,
        image_url: `https://images.example/team-${i}.webp`,
      },
      away_team: {
        id: `t_00000${i + 1}`,
        name: `Club ${i + 1}`,
        image_url: `https://images.example/team-${i + 1}.webp`,
      },
      time_utc: "2026-11-07T20:00:00Z",
      score_home: null,
      score_away: null,
    },
  });
  return {
    period: {
      start: "2026-11-02",
      end: "2026-11-08",
      current: true,
      asOf: now,
      asOfDay: "2026-11-07",
    },
    resultCount: 2,
    results: [game(1), game(3)],
    featured,
    bestOfFeatured: appearance(2),
    potw: appearance(0),
    potwMatch: game(1),
    potwSeason: totals[0],
    potwRecent: [
      appearance(0),
      { ...appearance(1), timeUtc: "2026-11-03T23:30:00Z" },
    ],
    others: [appearance(1), appearance(2)],
    otherMatches: [game(1)],
    leaders: {
      goals: totals,
      assists: [...totals].reverse(),
      clinical: totals,
      wasteful: [...totals].reverse(),
      rating: totals,
      ratedMin: 450,
    },
    tables: [table(leagueId), table(otherLeague)],
    ranks: Array.from({ length: 9 }, (_, i) => [
      `t_00000${i + 1}`,
      { id: `t_00000${i + 1}`, rank: i + 1, form: ["W", "D"], leagueId },
    ]),
    highlights: [future(1), future(2), future(3)],
    streak: table(leagueId).rows[0],
    defences: table(leagueId).rows.slice(0, 3),
    win: { match: game(1), margin: 3, goals: 5 },
    streakNext: future(1),
    seasonProgress: 0.3,
    hasSeasonPlayers: true,
    raceOpen: false,
    competitions: [
      {
        id: leagueId,
        name: "Ligue 1",
        imageUrl: "https://images.example/league.webp",
      },
      { id: otherLeague, name: "LaLiga" },
    ],
  };
}

function cardCases(data) {
  const competitions = new Map(data.competitions.map((c) => [c.id, c])),
    ranks = new Map(data.ranks),
    matches = new Map(
      [...data.results, ...data.otherMatches].map((m) => [m.id, m]),
    );
  return [
    [
      "ticker",
      matchday.HomeTicker,
      { results: data.results, ranks, competitions, period: data.period },
    ],
    [
      "featured",
      matchday.MatchOfTheWeek,
      {
        match: data.featured,
        ranks,
        competition: competitions.get(data.featured.leagueId),
        bestPlayer: data.bestOfFeatured,
        period: data.period,
      },
    ],
    [
      "player",
      players.PlayerOfTheWeek,
      {
        performance: data.potw,
        match: data.potwMatch,
        season: data.potwSeason,
        recent: data.potwRecent,
        period: data.period,
      },
    ],
    [
      "others",
      players.AlsoShone,
      { performances: data.others, matches, period: data.period },
    ],
    [
      "margin",
      matchday.NumberOfTheWeek,
      {
        win: data.win,
        competition: competitions.get(data.win.match.leagueId),
        period: data.period,
      },
    ],
    ...data.tables.map((table) => [
      "table " + table.leagueId,
      seasonCards.TitleRace,
      { tables: data.tables, competitions, initial: table.leagueId },
    ]),
    [
      "upcoming",
      seasonCards.NextMatches,
      { highlights: data.highlights, ranks, competitions, now },
    ],
    [
      "finishing clinical",
      players.Finishing,
      { leaders: data.leaders, scopeIds: ["l_3FJFUl"] },
    ],
    [
      "finishing wasteful",
      players.Finishing,
      { leaders: data.leaders, scopeIds: ["l_3FJFUl"] },
      new Map([["clinical", "wasteful"]]),
    ],
    [
      "scorers",
      players.SeasonScorers,
      { leaders: data.leaders, scopeIds: ["l_3FJFUl"] },
    ],
    [
      "assists",
      players.SeasonScorers,
      { leaders: data.leaders, scopeIds: ["l_3FJFUl"] },
      new Map([["goals", "assists"]]),
    ],
    [
      "streak",
      seasonCards.WinStreak,
      { streak: data.streak, competitions, next: data.streakNext, now },
    ],
    [
      "defence",
      seasonCards.BestDefence,
      {
        defence: data.defences[0],
        contenders: data.defences.slice(1),
        competitions,
      },
    ],
    [
      "race teaser",
      seasonCards.BallonDorTeaser,
      { progress: data.seasonProgress, ranking: null, raceOpen: data.raceOpen },
    ],
  ];
}
function assertPresentation(before) {
  const after = compactHomePresentation(before),
    cases = cardCases(before),
    compact = cardCases(after);
  for (let i = 0; i < cases.length; i++) {
    const [label, Component, props, overrides = new Map()] = cases[i];
    stateOverrides = overrides;
    assert.equal(
      renderToStaticMarkup(h(Component, compact[i][2])),
      renderToStaticMarkup(h(Component, props)),
      label,
    );
  }
  stateOverrides = new Map();
  assert.deepEqual(
    xgTimeline(after.featured),
    xgTimeline(before.featured),
    "all xG hover/scorer values",
  );
  assert.deepEqual(
    shotMapPoints(after.featured),
    shotMapPoints(before.featured),
    "all shot hover/click values",
  );
  for (let i = 0; i < before.results.length; i++) {
    assert.equal(matchDay(after.results[i]), matchDay(before.results[i]));
    assert.equal(
      matchWeight(after.results[i], new Map(after.ranks)),
      matchWeight(before.results[i], new Map(before.ranks)),
    );
    assert.equal(
      common.matchHref(football, after.results[i]),
      common.matchHref(football, before.results[i]),
    );
  }
  assert.deepEqual(
    [...after.highlights].sort(upcomingDayOrder).map((v) => v.fixture.id),
    [...before.highlights].sort(upcomingDayOrder).map((v) => v.fixture.id),
  );
  for (let i = 0; i < before.highlights.length; i++)
    assert.equal(
      common.fixtureHref(football, after.highlights[i].fixture),
      common.fixtureHref(football, before.highlights[i].fixture),
    );
  for (const key of ["potw", "bestOfFeatured"])
    assert.equal(after[key]?.id, before[key]?.id, key + " performance target");
  for (const key of ["goals", "assists", "clinical", "wasteful"])
    assert.deepEqual(
      after.leaders[key].map((p) => p.lastId),
      before.leaders[key].map((p) => p.lastId),
      key + " performance targets",
    );
  assert.deepEqual(
    after.others.map((p) => p.id),
    before.others.map((p) => p.id),
  );
  return {
    before: Buffer.byteLength(JSON.stringify(before)),
    after: Buffer.byteLength(JSON.stringify(after)),
    cards: cases.length,
  };
}

test("home media presentation preserves real cards, alternate tabs, charts and drill-downs", () => {
  const data = fixture(),
    original = structuredClone(data);
  const measured = assertPresentation(data);
  assert.deepEqual(
    data,
    original,
    "never mutates the full SQL model/projection",
  );
  assert.ok(measured.after < measured.before);
});

test("home representation preserves null, false, zero and absent fields", () => {
  assert.equal(compactHomePresentation(null), null);
  assert.deepEqual(compactHomePresentation({}), {});
  const before = {
      featured: {
        home: { id: "t_a", score: 0, xg: null },
        away: { id: "t_b" },
        shots: [
          { id: "s", isGoal: false, isOwnGoal: false, isOnTarget: null, xg: 0 },
        ],
        stats: null,
      },
      potw: null,
      others: null,
      potwRecent: [],
      leaders: { goals: [], clinical: null },
      tables: null,
      ranks: null,
      highlights: [],
      streak: null,
      defences: null,
      win: null,
      streakNext: null,
    },
    after = compactHomePresentation(before);
  assert.deepEqual(after, before);
  assert.equal(Object.hasOwn(after.featured.away, "score"), false);
});

test("home compact representation versions ETags and resolves only displayed media", async () => {
  const data = fixture(),
    body = { data, meta: { generation: "1" } },
    full = JSON.stringify(body),
    home = "https://api.example/api/read/home?season=2026%2F2027&media=1",
    oldTag = 'W/"media-v1-old"',
    lookups = [],
    read = async (_sql, [sources]) => {
      lookups.push(sources);
      return [];
    },
    invoke = async () =>
      new Response(full, {
        headers: {
          ETag: 'W/"source-v1"',
          "Cache-Control": "public, s-maxage=30",
        },
      });
  const response = await withResolvedMedia(
      new Request(home, { headers: { "if-none-match": oldTag } }),
      invoke,
      read,
      "https://assets.example",
    ),
    result = await response.json(),
    tag = response.headers.get("etag");
  assert.equal(response.status, 200);
  assert.match(tag, /^W\/"media-home-v2-/);
  assert.deepEqual(result.data, compactHomePresentation(data));
  assert.deepEqual(lookups[0], [...imageSources(result.data)]);
  assert.equal(JSON.stringify(body), full);
  assert.equal(
    (
      await withResolvedMedia(
        new Request(home, { headers: { "if-none-match": tag } }),
        invoke,
        read,
        "https://assets.example",
      )
    ).status,
    304,
  );
  const head = await withResolvedMedia(
    new Request(home, { method: "HEAD" }),
    invoke,
    read,
    "https://assets.example",
  );
  assert.equal(head.headers.get("etag"), tag);
  assert.equal(await head.text(), "");
  const other = await withResolvedMedia(
    new Request(home.replace("/home?", "/players?")),
    invoke,
    read,
    "https://assets.example",
  );
  assert.deepEqual(
    (await other.json()).data,
    data,
    "other compact APIs retain their contract",
  );
  assert.match(other.headers.get("etag"), /^W\/"media-v1-/);
});

test(
  "captured public home sample preserves every real card",
  { skip: !process.env.VEGA_HOME_PRESENTATION_SAMPLE },
  async (t) => {
    const body = JSON.parse(
      await fs.readFile(process.env.VEGA_HOME_PRESENTATION_SAMPLE, "utf8"),
    );
    t.diagnostic(JSON.stringify(assertPresentation(body.data)));
  },
);
