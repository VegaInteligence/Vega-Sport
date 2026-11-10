// The media=1 home representation serves the existing overview cards. Keep
// the complete SQL/projection model separate: it remains the parity reference
// and is still returned by the plain home endpoint.
//
// Copy values verbatim, including null and false; an absent field stays absent.
const pick = (value, keys) =>
  value == null
    ? value
    : Object.fromEntries(
        keys
          .filter((key) => Object.hasOwn(value, key))
          .map((key) => [key, value[key]]),
      );
const fields = (names) => names.split(" ");
const matchFields = fields("id season leagueId league date timeUtc");
const sideFields = fields("id name imageUrl score xg");
const featuredSideFields = [
  ...sideFields,
  "shots",
  "shotsOnTarget",
  "possession",
];
const shotFields = fields(
  "id teamId playerId playerName minute xg type isGoal isOwnGoal isBlocked isOnTarget x y blockedX blockedY goalCrossedY goalCrossedZ situation shotType",
);
const displayedStats = new Set([
  "big_chance",
  "duel_won",
  "corners",
  "keeper_saves",
]);
const smallPlayerFields = fields(
  "id playerId matchId name imageUrl team rating goals assists",
);
const potwFields = [
  ...smallPlayerFields,
  ...fields(
    "duelsWon duelsLost xg shots shotsOnTarget chancesCreated passesAccurate passesAttempted touches defensiveActions minutes",
  ),
];
const leaderFields = fields(
  "playerId lastId name imageUrl team goals assists xg xa apps",
);
const tableFields = fields("leagueId played");
const tableRowFields = fields("id name imageUrl points form cumulative");

const match = (value, featured = false) => {
  if (value == null) return value;
  const out = pick(value, matchFields);
  for (const side of ["home", "away"])
    if (Object.hasOwn(value, side))
      out[side] = pick(value[side], featured ? featuredSideFields : sideFields);
  if (featured && Object.hasOwn(value, "shots"))
    out.shots =
      value.shots?.map((shot) => pick(shot, shotFields)) ?? value.shots;
  if (featured && Object.hasOwn(value, "stats"))
    out.stats =
      value.stats
        ?.filter((stat) => displayedStats.has(stat.key))
        .map((stat) => pick(stat, ["key", "home", "away"])) ?? value.stats;
  return out;
};

const upcoming = (value) => {
  if (value == null) return value;
  const out = pick(value, fields("time day personal europePriority"));
  if (Object.hasOwn(value, "fixture")) {
    out.fixture = pick(value.fixture, fields("id season home_team away_team"));
    if (value.fixture && Object.hasOwn(value.fixture, "league"))
      out.fixture.league = pick(value.fixture.league, ["id", "name"]);
  }
  return out;
};

/** Same cards, sorting, drill-down links and chart hover values; fewer bytes. */
export function compactHomePresentation(data) {
  if (data == null) return data;
  const out = { ...data };
  const apply = (key, transform) => {
    if (Object.hasOwn(data, key)) out[key] = transform(data[key]);
  };
  const list = (transform) => (values) =>
    values == null ? values : values.map(transform);
  apply(
    "results",
    list((value) => match(value)),
  );
  apply("featured", (value) => match(value, true));
  apply("bestOfFeatured", (value) => pick(value, smallPlayerFields));
  apply("potw", (value) => pick(value, potwFields));
  apply("potwMatch", (value) => match(value));
  apply("potwSeason", (value) =>
    pick(value, fields("goals assists rating apps")),
  );
  apply(
    "potwRecent",
    list((value) => pick(value, fields("id rating date timeUtc time_utc"))),
  );
  apply(
    "others",
    list((value) => pick(value, smallPlayerFields)),
  );
  apply(
    "otherMatches",
    list((value) => match(value)),
  );
  apply("leaders", (leaders) => {
    if (leaders == null) return leaders;
    return Object.fromEntries(
      ["goals", "assists", "clinical", "wasteful"]
        .filter((key) => Object.hasOwn(leaders, key))
        .map((key) => [
          key,
          list((value) => pick(value, leaderFields))(leaders[key]),
        ]),
    );
  });
  apply(
    "tables",
    list((table) => {
      const value = pick(table, tableFields);
      if (table && Object.hasOwn(table, "rows"))
        value.rows = list((row) => pick(row, tableRowFields))(table.rows);
      return value;
    }),
  );

  // Rank/form is read by the ticker, the featured match and upcoming games.
  // Other clubs' ranks have no consumer on this page.
  const rankedTeams = new Set();
  const remember = (value, sides) => {
    for (const side of sides) {
      const id = value?.[side]?.id;
      if (id != null) rankedTeams.add(id);
    }
  };
  for (const value of [...(data.results || []), data.featured])
    remember(value, ["home", "away"]);
  for (const value of data.highlights || [])
    remember(value?.fixture, ["home_team", "away_team"]);
  apply("ranks", (ranks) =>
    ranks == null
      ? ranks
      : ranks
          .filter(([id]) => rankedTeams.has(id))
          .map(([id, value]) => [id, pick(value, ["rank", "form"])]),
  );
  apply("highlights", list(upcoming));
  apply("streak", (value) =>
    pick(value, fields("id name imageUrl leagueId streak rank points played")),
  );
  apply(
    "defences",
    list((value) =>
      pick(
        value,
        fields(
          "id name imageUrl leagueId rank perGame played goalsAgainst cleanSheets",
        ),
      ),
    ),
  );
  apply("win", (value) => {
    const out = pick(value, ["margin"]);
    if (value && Object.hasOwn(value, "match")) out.match = match(value.match);
    return out;
  });
  apply("streakNext", upcoming);
  return out;
}
