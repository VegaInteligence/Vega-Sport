"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Media, Pager, Segments, AsyncState, Empty } from "./UI.jsx";
import { date, seasonLabel } from "../services/format.js";
import { parisDay } from "../services/fixtures.js";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { cupEditionTable, cupTable } from "../services/catalog-client.js";
import { useResource } from "../services/resources.js";
import { editionArtworkUrl } from "../services/competition-artwork.js";
import { competitionCountryLabel } from "../services/competition-selector.js";
import { normalizeOpenCup, normalizeRoundSides, normalizeSupplementalCup, filterCupMatches, resultsAsOpenCup, leagueTable, numberedCupRounds, groupTables, scorerLines } from "../services/cup-matches.js";
import { combineCupLegs, knockoutStage } from "../services/knockout-bracket.js";
import { cupWorkerSnapshot } from "../services/cup-worker-client.js";
import { NATIONAL_CUP_ARCHIVES, GERMAN_CUP_FOLDER, isGermanCupSeason } from "../services/cup-archives.js";
import NationalFlag from "./NationalFlag.jsx";
import SeasonProjection from "./SeasonProjection.jsx";
import { useCupProjection } from "../services/cup-projection.js";
import MatchForecastBar from "./MatchForecastBar.jsx";
import { Term } from "./Hint.jsx";
import EditionHeader, { FollowedTeam, useEditionPage } from "./EditionHeader.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useWorldCupIndex, withWorldCupKeys } from "../services/worldcup-matches.js";
import { nationalTeamLabel, sameNationalTeam } from "../services/national-flags.js";
import { trophyArt } from "../services/trophy-art.js";

function editionLabel(competition, season) {
  return competition.sourceKey === "euro" && season === "2020" ? "2020 (joué en 2021)" : season;
}
/** A complementary league's standings, from the results its source gives (VI-19). */
function LeagueStandings({ name, matches }) {
  const rows = useMemo(() => leagueTable(matches), [matches]);
  if (!rows.length) return <Empty>Aucun résultat disponible pour cette édition.</Empty>;
  return <>
    <div className="table-scroll" role="region" aria-label={"Classement de la " + name} tabIndex={0}>
      <table className="data-table nations-table" aria-label={"Classement de la " + name}>
        <thead><tr><th scope="col">#</th><th scope="col"><Term>Équipe</Term></th><th scope="col"><Term>J</Term></th><th scope="col"><Term>G</Term></th><th scope="col"><Term>N</Term></th><th scope="col"><Term>D</Term></th><th scope="col"><Term>BP</Term></th><th scope="col"><Term>BC</Term></th><th scope="col"><Term>Diff.</Term></th><th scope="col"><Term>Pts</Term></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.name}><td>{row.position}</td><th scope="row"><span className="cup-match-team">{row.name}</span></th><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.difference > 0 ? "+" : ""}{row.difference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody>
      </table>
    </div>
    <p className="nations-note">Classement calculé à partir des résultats disponibles.</p>
  </>;
}
/** A tournament's groups (the archives' World Cups and Euros): one table a group, computed from its results. */
function GroupTables({ matches, competition, season, highlight }) {
  const today = parisDay(Date.now());
  const tables = useMemo(() => groupTables(matches, { competition, season, today }), [matches, competition, season, today]);
  if (!tables.length) return <Empty>Cette édition ne s’est pas jouée en groupes.</Empty>;
  return (
    <>
      <div className="edition-groups">
        {tables.map((table) => (
          <section className="edition-group" key={table.name}>
            <h3>{table.name}</h3>
            <table className="data-table" aria-label={table.name}>
              <thead><tr><th scope="col">#</th><th scope="col">Équipe</th><th scope="col" title="Matchs joués">J</th><th scope="col" title="Différence de buts">Diff.</th><th scope="col" title="Points">Pts</th></tr></thead>
              <tbody>{table.rows.map((row) => (
                <tr key={row.name} className={highlight && sameNationalTeam(row.name, highlight) ? "edition-own" : undefined}>
                  <td title={row.tied ? "Départage indisponible" : undefined}>{row.position == null ? "—" : row.position + (row.tied ? "=" : "")}</td>
                  <th scope="row"><span className="cup-match-team"><NationalFlag name={row.name} season={season} /><span title={nationalTeamLabel(row.name)}>{nationalTeamLabel(row.name)}</span></span></th>
                  <td>{row.played}</td><td>{row.difference == null ? "—" : (row.difference > 0 ? "+" : "") + row.difference}</td><td><strong>{row.points ?? "—"}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="nations-note">Classements calculés à partir des résultats disponibles.</p>
    </>
  );
}
/**
 * A cup's match, in the main lists' design (date, teams around the score, round), and its forecast before kick-off.
 * A club's badge is the crest of its own side (homeImage, awayImage: the row's foreign key, VI-30), else its initials.
 */
function CupMatch({ match, nationalTeams, season, highlight, hrefForMatch }) {
  const badge = (name, image) => (nationalTeams ? <NationalFlag name={name} season={season || match.date} /> : <Media name={name} url={image} />);
  const label = (name) => (nationalTeams ? nationalTeamLabel(name) : name);
  // A match with a page of its own (an archived World Cup match) opens it.
  const href = match.id && hrefForMatch ? hrefForMatch(match.id) : null;
  const Row = href ? Link : "div";
  // International Results' scorers, only when the list is complete (§57).
  const scorers = scorerLines(match.scorers);
  return (
    <Row {...(href ? { href, prefetch: false } : {})} className={"match-row cup-match" + (highlight && nationalTeams && [match.home, match.away].some((name) => sameNationalTeam(name, highlight)) ? " cup-match-own" : "")}>
      <span className="match-date">{match.date ? date(match.date) : "Date à préciser"}</span>
      <span className="match-teams">
        <span className="team-name home-team"><span>{label(match.home)}</span>{badge(match.home, match.homeImage)}</span>
        <strong className="score">{match.status === "canceled" ? "Annulé" : match.score ? match.score[0] + " – " + match.score[1] : "À venir"}</strong>
        <span className="team-name">{badge(match.away, match.awayImage)}<span>{label(match.away)}</span></span>
        {match.notes?.length > 0 && <span className="cup-match-notes">{match.notes.join(" · ")}</span>}
        {scorers && <span className="cup-match-notes cup-match-scorers" aria-label="Buteurs"><span>{scorers.home}</span><span>{scorers.away}</span></span>}
        {match.status === "scheduled" && <MatchForecastBar home={match.home} away={match.away} forecast={match.forecast} />}
      </span>
      <span className="match-league">{match.round || ""}</span>
    </Row>
  );
}

/**
 * A cup's page. The page that holds it may name it otherwise (`name`: the World Cup's archive is the World Cup), offer
 * the editions of a sister competition in the same selector (`editions`, `onEdition`), open a view (`initialView`),
 * follow a team through the edition (`highlight`, `onHighlight`) and be told of the edition and view chosen
 * (`onSeason`, `onView`: its address follows).
 */
export default function CupCompetition({ competition, initialSeason, name = competition.name, editions, onEdition, initialView, onSeason, onView, highlight = "", onHighlight, heading = false }) {
  const titled = useEditionPage();
  const [season, setSeason] = useState(
    () =>
      (initialSeason &&
        competition.seasons?.find((value) => String(value) === initialSeason || seasonLabel(value) === initialSeason)) ||
      competition.defaultSeason,
  );
  // A complementary league (VI-19): its standings first, its matches, its projection; no bracket.
  const league = competition.kind === "league";
  const supportsBracket = !league && (competition.source === "openfootball" || competition.source === "open-matchday");
  const nationalTeams = ["euro", "world-cup-history", "afcon", "copa-america", "asian-cup", "gold-cup"].includes(competition.sourceKey);
  // A national teams' tournament with rounds (the World Cup's archive, the Euro) opens on its bracket and has its groups.
  const tournament = nationalTeams && supportsBracket;
  const finalPool = competition.sourceKey === "world-cup-history" && season === "1950";
  const tournamentViews = finalPool
    ? [["groups", "Groupes"], ["bracket", "Tableau"], ["matches", "Matchs"]]
    : [["bracket", "Tableau"], ["groups", "Groupes"], ["matches", "Matchs"]];
  const views = tournament ? tournamentViews.map(([value]) => value) : league ? ["standings", "matches", "projection"] : supportsBracket ? ["matches", "bracket", "projection"] : ["matches"];
  const [preferredView, setViewState] = useState(initialView === "projection" ? "" : initialView);
  const view = views.includes(preferredView) ? preferredView : views[0];
  const setView = (next) => { setViewState(next); onView?.(next); };
  const archive = NATIONAL_CUP_ARCHIVES[competition.folder];
  const germany = competition.folder === GERMAN_CUP_FOLDER;
  // A domestic cup whose next round is drawn: its rounds replayed (124); a complementary league replayed to its end (VI-19).
  const projection = useCupProjection(competition, typeof season === "string" ? season : String(season));
  const projected = projection?.format === "knockout" || (!projection?.format && projection?.teams?.length > 0);
  const showProjection = view === "projection" && projected;
  const [status, setStatus] = useState(
    (competition.source === "open-matchday" && !Number(competition.tables?.results?.rows)) ||
    (competition.sourceKey === "euro" && season === "2028") ? "scheduled" : "finished",
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const tables = competition.editions?.[season] || (season === competition.defaultSeason ? competition.tables : null);
  const version = competition.source === "open-matchday" ? [tables?.results?.sha256, tables?.fixtures?.sha256].join(":") : season;
  const mode = competition.source === "nations-results" ? "results"
    : competition.source !== "open-matchday" ? "openfootball"
    : view === "bracket" && germany && isGermanCupSeason(season) ? "openligadb"
    : view === "bracket" && archive && season === archive.season ? "archive"
    : tables ? "supplemental"
    : germany && isGermanCupSeason(season) ? "openligadb"
    : archive && season === archive.season ? "archive"
    : "unavailable";
  const resource = useResource("cup:" + competition.id + ":" + mode + ":" + view + ":" + season + ":" + version, async ({ signal }) => {
    if (mode === "supplemental") {
      const payload = competition.canonicalId
        ? await cupEditionTable(competition.canonicalId, season, { signal }).catch(() => {
            signal.throwIfAborted();
            return null;
          })
        : null;
      const validTable = Array.isArray(payload?.results) && Array.isArray(payload?.fixtures);
      const [results, fixtures] = validTable ? [payload.results, payload.fixtures] : await Promise.all(["results", "fixtures"].map(kind => tables?.[kind] && Number(tables[kind].rows) !== 0 ? cupTable(competition.folder, season, kind, { signal }) : []));
      // A cup's numbered rounds named by their ties (its bracket, VI-19); a league's matches as they are.
      const normalized = normalizeSupplementalCup(results, fixtures);
      const matches = league ? normalized : numberedCupRounds(normalized);
      const editionArtwork = validTable ? payload.editionArtwork : undefined;
      if (view !== "bracket") return { matches, editionArtwork };
      return matches.some((match) => knockoutStage(match.roundName))
        ? { matches: combineCupLegs(matches), editionArtwork }
        : { matches, unavailable: true, editionArtwork };
    }
    if (mode === "unavailable") return { matches: [], unavailable: true };
    if (mode === "openligadb") {
      const payload = await cupWorkerSnapshot("openligadb", "germany-cup", season, "/api/openligadb?competition=germany-cup&season=" + encodeURIComponent(season), { signal });
      return { ...payload, matches: normalizeRoundSides(payload.matches) };
    }
    if (mode === "results") {
      // International Results: played matches only, without rounds (results-v1).
      const payload = await cupWorkerSnapshot("nations-results", competition.sourceKey, season, null, { signal });
      return { matches: normalizeOpenCup(resultsAsOpenCup(payload.matches)), source: payload.source, editionArtwork: payload.editionArtwork };
    }
    const key = mode === "archive" ? archive.key : competition.sourceKey;
    const payload = await cupWorkerSnapshot("open-cups", key, season, "/api/open-cups?competition=" + encodeURIComponent(key) + "&season=" + encodeURIComponent(season), { signal });
    const matches = normalizeOpenCup(payload.matches);
    return { matches: mode === "archive" && archive.twoLegged && view === "bracket" ? combineCupLegs(matches) : matches, source: payload.source, editionArtwork: payload.editionArtwork };
  });
  // The edition's own emblem when the API attests it, else the competition's logo where it is no edition's (VI-30).
  const artwork = resource.error || resource.refreshError ? null : resource.value?.editionArtwork;
  const imageUrl = editionArtworkUrl(competition.id, competition.imageUrl, artwork);
  // An archived World Cup's matches open their page (the Fjelstul World Cup Database): the edition's index gives each
  // its key; without it (a failed read, an edition it does not hold) the matches stay as they are.
  const f = useFootball();
  const archivedWorldCup = competition.sourceKey === "world-cup-history";
  const pages = useWorldCupIndex(String(season), archivedWorldCup);
  const hrefForMatch = archivedWorldCup ? (key) => f.href("/matchs/", { cdm: key }) : undefined;
  const withPages = (matches) => (archivedWorldCup && pages.value?.length ? withWorldCupKeys(matches, pages.value) : matches);
  function pickSeason(next) {
    const other = (editions || []).find((edition) => edition.season === next && edition.id !== competition.id);
    if (other) return onEdition?.(other);
    setSeason(next);
    setStatus(competition.sourceKey === "euro" && next === "2028" ? "scheduled" : "finished");
    setPage(1);
    onSeason?.(next);
  }
  // On the competition page (§ 82) the head is the page's title, above the card.
  const head = (
      <EditionHeader imageUrl={imageUrl} name={name} heading={heading} season={season} onSeason={pickSeason} label="Édition de la coupe"
        editions={(editions || competition.seasons.map((value) => ({ season: value, id: competition.id }))).map((edition) => ({ ...edition, label: editionLabel(competition, edition.season) }))}>
        {highlight && nationalTeams && <FollowedTeam label={nationalTeamLabel(highlight)} flag={<NationalFlag name={highlight} season={season} />} onClear={() => onHighlight?.("")} />}
        {tournament && <Segments label="Vue de la compétition" value={view} onChange={setView} items={tournamentViews} />}
        {supportsBracket && !tournament && <Segments label="Vue de la compétition" value={view} onChange={setView} items={[["matches", "Matchs"], ["bracket", "Tableau"], ...(projected ? [["projection", "Projection"]] : [])]} />}
        {league && <Segments label="Vue de la compétition" value={view} onChange={setView} items={[["standings", "Classement"], ["matches", "Matchs"], ...(projected ? [["projection", "Projection"]] : [])]} />}
      </EditionHeader>
  );
  return (
    <>{titled && head}<Card className="cup-detail edition-card">
      {!titled && head}
      {view === "matches" && <div className="cup-controls">
        <Segments label="Vue des matchs" value={status} onChange={(next) => { setStatus(next); setPage(1); }} items={[["finished", "Résultats"], ["scheduled", "À venir"], ["all", "Tous"]]} />
        <input type="search" aria-label="Rechercher une équipe dans la coupe" placeholder="Rechercher une équipe…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
      </div>}
      {showProjection ? <SeasonProjection projection={projection} competition={competition} season={season} /> : <>
      {tournament && view !== "matches" ? null : mode === "archive" ? <p className="cup-source">Archive {season}</p> : mode === "openligadb" ? <p className="cup-source">Résultats et calendrier</p> : competition.source === "open-matchday" ? (competition.sourceDate && <p className="cup-source">Données du {date(competition.sourceDate)}</p>) : <p className="cup-source">{competition.coverage || "Résultats et calendrier"}</p>}
      {competition.sourceKey === "euro" && season === "2028" && <p className="cup-source">Les équipes indiquées par des codes restent à déterminer.</p>}
      <AsyncState resource={resource}>
        {(value) => value.unavailable ? <div className="cup-bracket-unavailable"><Empty>Les tours de cette édition ne sont pas disponibles.</Empty>{archive && season !== archive.season && <button className="button button-secondary" onClick={() => setSeason(archive.season)}>Voir le tableau {archive.season}</button>}</div> : <>
          {value.matches.some((match) => match.status === "scheduled" && match.date && match.date < parisDay(Date.now())) && <p className="cup-source">Certains scores de cette édition ne sont pas encore renseignés.</p>}
          {view === "bracket" ? <KnockoutBracket matches={withPages(value.matches)} hrefForMatch={hrefForMatch} nationalTeams={nationalTeams} competition={competition.sourceKey} season={season} highlight={highlight} trophy={trophyArt({ title: name, trophyYear: Number(String(season).slice(0, 4)) })} /> : view === "groups" ? <GroupTables matches={value.matches} competition={competition.sourceKey} season={season} highlight={highlight} /> : view === "standings" ? <LeagueStandings name={competition.name} matches={value.matches} /> : <CupMatchList matches={withPages(value.matches)} hrefForMatch={hrefForMatch} status={status} query={query} page={page} onPage={setPage} nationalTeams={nationalTeams} season={season} highlight={highlight} />}
        </>}
      </AsyncState>
      </>}
    </Card></>
  );
}
export function CupMatchList({ matches, status, query, page, onPage, nationalTeams = false, season, highlight = "", hrefForMatch }) {
  const rows = useMemo(() => filterCupMatches(matches, status, query, Date.now(), nationalTeams ? nationalTeamLabel : undefined), [matches, status, query, nationalTeams]);
  const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
  return <>
    <div className="cup-match-list">{rows.slice((current - 1) * 30, current * 30).map((match) => <CupMatch key={match.key} match={match} nationalTeams={nationalTeams} season={season} highlight={highlight} hrefForMatch={hrefForMatch} />)}</div>
    {!rows.length && <Empty>{status === "scheduled" ? "Aucune rencontre à venir disponible." : "Aucun résultat disponible pour cette sélection."}</Empty>}
    <Pager page={current} total={pages} onChange={onPage} />
  </>;
}
