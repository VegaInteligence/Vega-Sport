// FIFA's 1950 final pool and the six dated OpenFootball results checked against it (VI-27 B).
// https://www.fifa.com/es/articles/cuantas-finales-mundial-participo-uruguay-historial
export const WORLD_CUP_1950_EDITION = "open-cups:world-cup-history:1950";
const PLACES = ["Uruguay", "Brazil", "Sweden", "Spain"];
const GAMES = [
  { date: "1950-07-09", home: "Uruguay", away: "Spain", score: [2, 2] },
  { date: "1950-07-09", home: "Brazil", away: "Sweden", score: [7, 1] },
  { date: "1950-07-13", home: "Brazil", away: "Spain", score: [6, 1] },
  { date: "1950-07-13", home: "Uruguay", away: "Sweden", score: [3, 2] },
  { date: "1950-07-16", home: "Sweden", away: "Spain", score: [3, 1] },
  { date: "1950-07-16", home: "Uruguay", away: "Brazil", score: [2, 1] },
];

const signature = ({ date, home, away, score }) =>
  JSON.stringify([date, ...(home < away ? [home, away, score?.[0], score?.[1]] : [away, home, score?.[1], score?.[0]])]);

function corroborates(matches, expected) {
  if (matches.length !== expected.length) return false;
  const observed = new Set(matches.map(signature));
  return expected.every((match) => observed.has(signature(match)));
}

export const isFinalPool1950 = (matches) => corroborates(matches, GAMES);

export function finalPoolPosition1950(matches, team) {
  const index = PLACES.indexOf(team);
  if (index < 0) return null;
  const expected = GAMES.filter(({ home, away }) => team === home || team === away);
  return corroborates(matches, expected) ? index + 1 : null;
}
