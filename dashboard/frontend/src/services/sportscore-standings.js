// Explicit PitchAPI-to-SportScore mappings verified against competition names and countries.
export const SPORTSCORE_LEAGUES = Object.freeze({
  l_0275VP: "french-ligue-2",
  l_0aEfof: "united-arab-emirates-adnoc-pro-league",
  l_0ahLw8: "english-football-league-one",
  l_0ALvwF: "italian-serie-a",
  l_0bfbkO: "uefa-champions-league",
  l_0eg6C9: "united-states-major-league-soccer",
  l_0ErfuF: "spanish-la-liga",
  l_0F4I4F: "czech-chance-liga",
  l_0jy5yE: "italian-serie-b",
  l_0kSJLz: "romanian-super-liga",
  l_0Lpz1f: "saudi-professional-league",
  l_0S1uaf: "turkish-super-league",
  l_0uqFK8: "norwegian-eliteserien",
  l_16Sq13: "israel-premier-league",
  l_1BFfna: "turkish-first-league",
  l_1D8Xrl: "brazilian-serie-a",
  l_1dmt9H: "ligapro-serie-a",
  l_1eJSA7: "ireland-premier-division",
  l_1Isor4: "bundesliga",
  l_1Kknkl: "south-africa-premier-soccer-league",
  l_1LMdEO: "scottish-premiership",
  l_1pQOHK: "belgian-challenger-pro-league",
  l_1qpFVw: "indian-super-league",
  l_1rPvVD: "danish-1st-division",
  l_1TTHxD: "iceland-besta-deild-karla",
  l_1TVRZW: "venezuela-primera-division",
  l_1W6idJ: "english-football-league-two",
  l_1XLtP0: "fifa-world-cup",
  l_1XsMdH: "sweden-allsvenskan",
  l_1xXulJ: "categoria-primera-a",
  l_20pNSc: "chinese-football-super-league",
  l_214sqK: "pko-bank-polski-ekstraklasa",
  l_271pqa: "korean-k-league-2",
  l_2ApGa4: "japanese-j1-league",
  l_2EKrnc: "korean-k-league-1",
  l_2L6d1F: "belgian-pro-league",
  l_2Mh0jT: "russian-premier-league",
  l_2tFk9k: "croatian-football-league",
  l_2WZ2tt: "uefa-europa-conference-league",
  l_2xBPKk: "serbian-mozzart-bet-superliga",
  l_38d9HA: "uefa-europa-league",
  l_3CB6qX: "saudi-arabia-division-1",
  l_3Ci5Cg: "finnish-veikkausliiga",
  l_3fglZv: "japanese-j3-league",
  l_3FJFUl: "french-ligue-1",
  l_3hvsne: "german-bundesliga-2",
  l_3hW1NO: "thai-league-1",
  l_3Kf7Ni: "usl-league-one",
  l_3kyHLd: "spanish-segunda-division",
  l_3qNjzC: "chi-liga-de-primera",
  l_3qUkB8: "brazilian-serie-b",
  l_3Tn1kG: "mls-next-pro",
  l_3UiOcj: "canadian-premier-league",
  l_3uNwVX: "peruvian-liga-1",
  l_3v84VE: "mexico-liga-mx",
  l_3wr44B: "qatar-stars-league",
  l_3xwVF2: "greek-super-league",
  l_3yVUAO: "usl-championship",
  l_3zsMpo: "austrian-bundesliga",
  l_45VZuL: "argentine-division-1",
  l_45xKXM: "latvian-higher-league",
  l_46aZMC: "egyptian-premier-league",
  l_47077Y: "german-3liga",
  l_49KZaB: "netherlands-eerste-divisie",
  l_49Zmno: "danish-superliga",
  l_4auCPk: "switzerland-challenge-league",
  l_4d6Bwl: "switzerland-super-league",
  l_4DWyTT: "english-football-league-championship",
  l_4dzm4e: "bolivian-primera-division",
  l_4FPF2L: "paraguayan-primera-division",
  l_4H43wr: "netherlands-eredivisie",
  l_4MPd7x: "australia-a-league",
  l_4MU9Yh: "slovak-nike-liga",
  l_4QexZg: "portuguese-primera-liga",
  l_4V6jPs: "brazilian-campeonato-paulista-a1",
  l_4WFCIZ: "english-premier-league",
});

const safeNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// Preserve the provider's group boundaries and positions; it does not return a season.
export function normalizeSportscore(payload, slug) {
  if (
    payload?.sport !== "football" ||
    payload?.competition_slug !== slug ||
    !Array.isArray(payload.tables)
  )
    return null;
  const tables = payload.tables
    .slice(0, 30)
    .map((table) => ({
      name: typeof table.group === "string" ? table.group.trim() : "",
      rows: Array.isArray(table.rows)
        ? table.rows
            .slice(0, 100)
            .filter((row) => typeof row?.team === "string" && row.team.trim())
            .map((row) => ({
              name: row.team.trim(),
              imageUrl: typeof row.team_logo === "string" ? row.team_logo : "",
              position: safeNumber(row.pos),
              played: safeNumber(row.p),
              wins: safeNumber(row.w),
              draws: safeNumber(row.d),
              losses: safeNumber(row.l),
              goalsFor: safeNumber(row.gf),
              goalsAgainst: safeNumber(row.ga),
              difference: safeNumber(row.gd),
              points: safeNumber(row.pts),
            }))
        : [],
    }))
    .filter((table) => table.rows.length);
  return tables.length ? { competition: payload.competition, tables } : null;
}
