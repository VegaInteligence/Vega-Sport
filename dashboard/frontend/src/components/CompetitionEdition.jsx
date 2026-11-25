"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Pager, AsyncState, Segments, Empty } from "./UI.jsx";
import { MatchLink } from "./MatchLink.jsx";
import MatchdaySchedule from "./MatchdaySchedule.jsx";
import { LeagueHistoryRail, LeagueHistoryView } from "./LeagueHistory.jsx";
import {
  isHistorySeason,
  useLeagueHistory,
  withHistorySeasons,
} from "../services/league-history.js";
import {
  defaultCompetitionMatchStatus,
  orderCompetitionMatches,
} from "../services/competition-matches.js";
import { editionArtworkUrl } from "../services/competition-artwork.js";
import { seasonLabel } from "../services/format.js";
import { useResource } from "../services/resources.js";
import { competitionFixturePreview } from "../services/fixture-pages.js";
import { compactGeneration } from "../services/compact-reads.js";
import { parisDay } from "../services/fixtures.js";
import CompetitionHighlights from "./CompetitionHighlights.jsx";
import LeagueRoundCards from "./LeagueRoundCards.jsx";
import LeagueRace from "./LeagueRace.jsx";
import { useLeagueRounds } from "../services/league-rounds.js";
import NativeKnockoutBracket from "./NativeKnockoutBracket.jsx";
import {
  EUROPE_FOCUS_IDS,
  inEuropeFocus,
} from "../../../shared/competition-scope.js";
import CompetitionStandings from "./CompetitionStandings.jsx";
import SeasonProjection from "./SeasonProjection.jsx";
import { useSeasonProjection } from "../services/forecasts.js";
import { WORLD_CUP_ID } from "../services/cup-catalog.js";
import EditionHeader, { FollowedTeam } from "./EditionHeader.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { nationalTeamLabel } from "../services/national-flags.js";
import { trophyArt } from "../services/trophy-art.js";
import { FEATURED_EUROPE_IDS } from "../services/competition-selector.js";
import { seasonSnapshotFixtures } from "../services/season-snapshot-fixtures.js";
/**
 * A collected competition's page. A cup's (`hasKnockout`) has the edition's head: the page that holds it may offer a
 * sister competition's editions in the same selector (`editions`, `onEdition`: the World Cup's archive), open a view
 * (`initialView`), follow a team through the bracket (`highlight`, `onHighlight`) and be told of the view chosen
 * (`onView`, `onSeason`: its address follows). `embedded` (a match's « Classement » tab, FAILURE_MODES § 63): the same
 * head, views and tables, without the side cards and without changing the site's season.
 */
export default function CompetitionEdition({
  competition,
  day,
  initialSeason,
  initialView,
  editions,
  onEdition,
  onView,
  onSeason,
  highlight = "",
  onHighlight,
  heading = false,
  embedded = false,
  highlightTeams,
}) {
  const f = useFootball();
  // The five big leagues also offer their archived seasons, 2010/11–2020/21 (services/league-history.js).
  const seasons = withHistorySeasons(competition);
  const [season, setSeason] = useState(
    (initialSeason &&
      seasons.find(
        (s) => String(s) === initialSeason || seasonLabel(s) === initialSeason,
      )) ||
      competition?.seasons?.find((s) => seasonLabel(s) === f.season) ||
      competition?.seasons?.[0] ||
      f.season,
  );
  const supported = !day;
  const archived =
    !day && isHistorySeason(competition?.id, seasonLabel(season));
  const history = useLeagueHistory(
    archived ? competition?.id : null,
    seasonLabel(season),
  );
  const hasKnockout = Boolean(
    competition &&
    (competition.id === WORLD_CUP_ID ||
      FEATURED_EUROPE_IDS.includes(competition.id) ||
      competition.cupWorker),
  );
  // The World Cup opens on its bracket (mock-up of 18 Nov 2026), any other competition on its table.
  const worldCup = competition?.id === WORLD_CUP_ID;
  const asked = initialView === "groups" ? "standings" : initialView;
  const [view, setViewState] = useState(
    !supported
      ? "matches"
      : asked === "standings" ||
          asked === "matches" ||
          (asked === "bracket" && hasKnockout) ||
          (asked === "players" && !hasKnockout)
        ? asked
        : worldCup
          ? "bracket"
          : "standings",
  );
  const setView = (next) => {
    setViewState(next);
    onView?.(next);
  };
  function pickSeason(value) {
    const other = (editions || []).find(
      (edition) =>
        edition.season === String(value) && edition.id !== competition.id,
    );
    if (other) return onEdition?.(other);
    setSeason(value);
    onSeason?.(String(value));
    const next = seasonLabel(value);
    if (!embedded && f.manifest.seasons.some((s) => s.id === next))
      f.changeSeason(next);
    setPage(1);
  }
  const changeView = (next) => {
    if (next === "matches" && view !== "matches") {
      setStatus("finished");
      setPage(1);
    }
    setView(next);
  };
  useEffect(() => {
    if (competition?.seasons?.includes(season)) return;
    const equivalent = competition?.seasons?.find(
      (item) => seasonLabel(item) === seasonLabel(season),
    );
    if (equivalent) setSeason(equivalent);
  }, [competition?.seasons, season]);
  const [status, setStatus] = useState(() =>
    defaultCompetitionMatchStatus(day),
  );
  const [page, setPage] = useState(1);
  // A league's table is read from the API for any season (the official one, else the one
  // the base computes from the results), so the standings view needs a preview of the
  // fixtures, not the season's whole calendar. CompetitionStandings asks for the
  // calendar when that table cannot be shown (needFixtures below).
  const previewEnabled =
    !day &&
    !archived &&
    Boolean(competition) &&
    !hasKnockout &&
    f.manifest.capabilities?.fixturePaginationOrder === true;
  const fixtureScope = `${competition?.id}:${season}`;
  const [fallbackScope, setFallbackScope] = useState(null);
  const needFixtures = useCallback(
    () => setFallbackScope(fixtureScope),
    [fixtureScope],
  );
  const needsFullCalendar =
    !previewEnabled || view !== "standings" || fallbackScope === fixtureScope;
  const preview = useResource(
    `competition-preview:${fixtureScope}:${compactGeneration(f.manifest)}:${parisDay(Date.now())}`,
    ({ signal }) =>
      competitionFixturePreview(
        {
          league: competition.id,
          season,
          generation: compactGeneration(f.manifest),
        },
        { signal },
      ).catch((error) => {
        if (error.status === 409) void f.refreshManifest().catch(() => {});
        throw error;
      }),
    previewEnabled && view === "standings",
  );
  const resource = useResource(
    "fixtures:" +
      competition?.id +
      ":" +
      season +
      ":" +
      day +
      ":" +
      f.configured +
      ":" +
      (f.manifest.publicationVersion ||
        f.manifest.scouting?.sourceDigest ||
        "") +
      // The match's tab may read the season's partition (below): its value is kept apart from the page's.
      (embedded ? ":match" : ""),
    async ({ signal }) => {
      const scoped = Object.assign(Object.create(f.client), {
        // The shared resource owns freshness. A client's older in-memory map
        // must not override a newly published season or a deliberate retry.
        fixtures: new Map(),
        browseMode: day ? "day" : "catalog",
        day,
        competitionId: competition?.id,
        season,
        competition,
        useCupSnapshot: hasKnockout || Boolean(competition?.cupWorker),
      });
      await f.client.loadFixtures.call(scoped, { signal });
      // A match outside the site's season (§ 63.7): its tab reads that season's partition when the snapshot is empty.
      if (embedded && !day)
        return seasonSnapshotFixtures(f, scoped, competition, season, {
          signal,
        });
      return scoped.fixtures.get(
        day ? "date:" + day : competition.id + ":" + season,
      );
    },
    f.statusKnown && needsFullCalendar && !archived,
  );
  const showHighlights =
    !embedded && supported && view === "standings" && !archived;
  // The league replayed to its end, where the base projects it (a domestic league in progress).
  const projection = useSeasonProjection(
    supported && !archived ? competition?.id : null,
    seasonLabel(season),
  );
  // A league with a closed round has the whole Player of the Season race (VI-44); a cup has no rounds.
  const leagueRounds = useLeagueRounds(
    supported && !hasKnockout && !archived ? competition?.id : null,
    seasonLabel(season),
  );
  const hasRace = Boolean(leagueRounds.value?.latest);
  // Asked for by its address, the view gives way to the table where the league has no race.
  const noRace =
    !archived && view === "players" && !leagueRounds.loading && !hasRace;
  useEffect(() => {
    if (noRace) setViewState("standings");
  }, [noRace]);
  const views = archived
    ? [
        ["standings", "Classement"],
        ["matches", "Matchs"],
        ["players", "Joueurs"],
      ]
    : worldCup
      ? [
          ["bracket", "Tableau"],
          ["standings", "Groupes"],
          ["matches", "Matchs"],
        ]
      : [
          ["standings", "Classement"],
          ["matches", "Matchs"],
          ...(hasKnockout ? [["bracket", "Tableau"]] : []),
          ...(projection ? [["projection", "Projection"]] : []),
          ...(hasRace ? [["players", "Joueurs"]] : []),
        ];
  // Every competition, league or cup, has the edition's head on one row (#61).
  const editionHead = !day;
  const overviewFixtures = resource.value || preview.value;
  const artwork =
    resource.error || resource.refreshError
      ? null
      : overviewFixtures?.editionArtwork;
  const imageUrl = editionArtworkUrl(
    competition?.id,
    competition?.imageUrl,
    artwork,
  );
  return (
    <div
      className={
        "competition-detail-layout" +
        (showHighlights || archived
          ? " competition-detail-layout--overview"
          : "")
      }
    >
      <Card
        title={editionHead ? null : "Calendrier par date"}
        className={"competition-detail" + (editionHead ? " edition-card" : "")}
      >
        {editionHead && (
          <EditionHeader
            imageUrl={imageUrl}
            name={competition.name}
            heading={heading}
            label="Saison de compétition"
            season={String(season)}
            onSeason={pickSeason}
            editions={
              editions ||
              seasons.map((value) => ({
                season: String(value),
                id: competition.id,
              }))
            }
          >
            {highlight && worldCup && (
              <FollowedTeam
                label={nationalTeamLabel(highlight)}
                flag={<NationalFlag name={highlight} season={season} />}
                onClear={() => onHighlight?.("")}
              />
            )}
            {supported && (
              <Segments
                value={view}
                onChange={changeView}
                label="Vue de la compétition"
                items={views}
              />
            )}
          </EditionHeader>
        )}
        {archived ? (
          <LeagueHistoryView resource={history} view={view} />
        ) : supported && view === "standings" ? (
          <CompetitionStandings
            competition={competition}
            season={season}
            matches={overviewFixtures?.matches || []}
            source={resource.value?.source}
            fixturesLoading={!resource.value}
            fixturesError={resource.error}
            onRetry={resource.retry}
            onNeedFixtures={needFixtures}
            highlightTeams={highlightTeams}
            served
          />
        ) : supported &&
          view === "players" &&
          !hasKnockout &&
          (hasRace || leagueRounds.loading) ? (
          <LeagueRace
            key={seasonLabel(season)}
            competition={competition?.id}
            season={seasonLabel(season)}
          />
        ) : supported && view === "projection" && projection ? (
          <SeasonProjection
            projection={projection}
            competition={competition}
            season={season}
          />
        ) : (
          <AsyncState resource={resource}>
            {(value) => {
              const rows = orderCompetitionMatches(
                (value.matches || []).filter(
                  (m) =>
                    f.focus !== "europe" ||
                    inEuropeFocus(competition) ||
                    EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId),
                ),
                { status, day: Boolean(day) },
              );
              const pages = Math.max(1, Math.ceil(rows.length / 30)),
                current = Math.min(page, pages);
              return (
                <>
                  {supported && view === "bracket" && hasKnockout ? (
                    <NativeKnockoutBracket
                      competition={competition}
                      season={season}
                      matches={value.matches || []}
                      rounds={value.rounds}
                      highlight={highlight}
                      trophy={trophyArt({
                        title: competition.name,
                        trophyYear: Number(String(season).slice(0, 4)),
                      })}
                    />
                  ) : supported ? (
                    <MatchdaySchedule
                      key={competition.id + ":" + season}
                      competition={competition}
                      season={season}
                      initialStatus={status}
                      matches={(value.matches || []).filter(
                        (m) =>
                          f.focus !== "europe" ||
                          inEuropeFocus(competition) ||
                          EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId),
                      )}
                    />
                  ) : (
                    <>
                      <Segments
                        value={status}
                        onChange={(v) => {
                          setStatus(v);
                          setPage(1);
                        }}
                        label="Statut des rencontres"
                        items={[
                          ["finished", "Résultats"],
                          ["not_started", "À venir"],
                          ["all", "Tous"],
                        ]}
                      />
                      {!day && (
                        <p className="competition-matches-order">
                          {status === "finished"
                            ? "Les résultats les plus récents en premier"
                            : status === "not_started"
                              ? "Les prochaines rencontres en premier"
                              : "Résultats récents, puis rencontres à venir"}
                        </p>
                      )}
                      {rows.slice((current - 1) * 30, current * 30).map((m) => (
                        <MatchLink key={m.id} match={m} />
                      ))}
                      {!rows.length && (
                        <Empty>
                          {status === "finished"
                            ? "Aucun match terminé disponible pour cette saison."
                            : "Aucune rencontre collectée."}
                        </Empty>
                      )}
                      <Pager page={current} total={pages} onChange={setPage} />
                    </>
                  )}
                </>
              );
            }}
          </AsyncState>
        )}
      </Card>
      {archived && history.value && <LeagueHistoryRail value={history.value} />}
      {showHighlights && overviewFixtures && (
        <CompetitionHighlights
          matches={overviewFixtures.matches || []}
          competition={competition}
          season={season}
          onShowMatches={(next) => {
            setStatus(next);
            setPage(1);
            setView("matches");
          }}
        />
      )}
      {showHighlights && !hasKnockout && (
        <LeagueRoundCards
          competition={competition?.id}
          season={seasonLabel(season)}
          onAllPlayers={() => setView("players")}
        />
      )}
    </div>
  );
}
