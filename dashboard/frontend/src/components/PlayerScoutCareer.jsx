"use client";
import React, { useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { hasBoundedSearch } from "../services/global-search-client.js";
import {
  loadPlayerHistory,
  playerHistoryKey,
} from "../services/scouting-history.js";
import { playerTeamSeasons } from "../services/player-team-seasons.js";
import { nationalTeamName } from "../services/national-flags.js";
import { seasonMetric } from "../services/season-player.js";
import { number } from "../services/format.js";
import {
  loadPlayerMarketValues,
  marketValue,
  playerMarketValuesKey,
} from "../services/player-market-values.js";
import { AsyncState, Media } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { fmt } from "./PlayerScoutCharts.jsx";
import PlayerMarketValueCard from "./PlayerMarketValueCard.jsx";
import {
  FAKE_CAREER_STAGE,
  FAKE_FACTS,
  FakeBadge,
  InjuriesSection,
  VegaIndexHistoryCard,
} from "./PlayerScoutDemo.jsx";
import s from "./PlayerScout.module.css";

const total = (profile, key) => {
  const metric = seasonMetric(profile, key, "total");
  return metric.count ? metric.value : null;
};

function sumRows(rows) {
  const goals = rows.map((row) => total(row.profile, "goals"));
  const assists = rows.map((row) => total(row.profile, "assists"));
  return {
    matches: rows.reduce((sum, row) => sum + row.profile.matches, 0),
    minutes: rows.reduce((sum, row) => sum + row.profile.minutes, 0),
    goals: goals.some((v) => v != null)
      ? goals.reduce((sum, v) => sum + (v || 0), 0)
      : null,
    assists: assists.some((v) => v != null)
      ? assists.reduce((sum, v) => sum + (v || 0), 0)
      : null,
  };
}

const show = (value, decimals = 0) =>
  value == null ? "—" : number(value, decimals);

/** « Carrière et marché » of mock-up C: career figures from every collected
 *  season, market and injury blocks as labelled placeholders. */
export default function PlayerScoutCareer({
  id,
  profile,
  team,
  season,
  children,
}) {
  const f = useFootball();
  const market = useResource(
    playerMarketValuesKey(id),
    ({ signal }) => loadPlayerMarketValues(id, { signal }),
    Boolean(id),
  );
  const values = market.value?.history || [];
  const latestValue = values.at(-1);
  const history = useResource(playerHistoryKey(f.manifest, id), ({ signal }) =>
    loadPlayerHistory(f.manifest, id, { signal }),
  );
  const seasons = useMemo(
    () =>
      playerTeamSeasons(history.value ?? []).sort(
        (a, b) =>
          b.season.localeCompare(a.season) ||
          (a.kind === "selection") - (b.kind === "selection"),
      ),
    [history.value],
  );
  const clubs = seasons.filter((row) => row.kind !== "selection");
  const selections = seasons.filter((row) => row.kind === "selection");
  const clubTotals = sumRows(clubs);
  const selectionTotals = sumRows(selections);
  const contract = FAKE_FACTS.find((item) => item.label === "Fin de contrat");
  const kpis = [
    ["Club actuel", team?.name || "—"],
    ["Fin de contrat", contract.value, false, true],
    ["Valeur", latestValue ? marketValue(latestValue.valueEur) : "—", true],
    ["Matchs en club", show(clubTotals.matches)],
    ["Minutes en club", show(clubTotals.minutes)],
    [
      "Buts · PD",
      `${show(clubTotals.goals)} B · ${show(clubTotals.assists)} PD`,
    ],
    ["Stade de carrière", FAKE_CAREER_STAGE, true, true],
    [
      "Sélection",
      selections.length
        ? `${show(selectionTotals.matches)} sél. · ${show(selectionTotals.goals)} B`
        : "—",
    ],
  ];
  return (
    <div className={s.overview}>
      <div className={`${s.block} ${s.stack}`}>
        <div className={s.kpiStrip}>
          {kpis.map(([label, value, accent, fake]) => (
            <div key={label}>
              <span>
                {label} {fake && <FakeBadge short />}
              </span>
              <strong className={accent ? s.kpiAccent : undefined}>
                {(label === "Valeur"
                  ? market.loading
                  : history.loading && !fake && label !== "Club actuel")
                  ? "…"
                  : value}
              </strong>
            </div>
          ))}
        </div>
      </div>
      <div className={`${s.block} ${s.grid2}`}>
        <VegaIndexHistoryCard />
        <PlayerMarketValueCard
          key={id}
          values={values}
          loading={market.loading}
          error={market.error}
          teams={[team, ...clubs.map((row) => row.teamInfo)].filter(Boolean)}
          lookupSeason={
            !history.loading && hasBoundedSearch(f.manifest) ? season : null
          }
        />
      </div>
      <section className={s.block}>
        <div className={s.sectionHead}>
          <div>
            <h2>Saison par saison</h2>
            <p>Toutes les saisons collectées · club et sélection</p>
          </div>
        </div>
        <AsyncState resource={history}>
          {() =>
            seasons.length ? (
              <div className={s.tableCard}>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Saison</th>
                        <th>Équipe</th>
                        <th>Compétitions</th>
                        <th className={s.num}>MJ</th>
                        <th className={s.num}>Tit.</th>
                        <th className={s.num}>Min</th>
                        <th className={s.num}>Buts</th>
                        <th className={s.num}>PD</th>
                        <th className={s.num}>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasons.map((row) => {
                        const leagues = [
                          ...new Set(
                            row.profile.rows
                              .map((item) => item.league)
                              .filter(Boolean),
                          ),
                        ];
                        return (
                          <tr key={row.key}>
                            <th scope="row">{row.season}</th>
                            <td>
                              <span className={s.cell}>
                                {row.kind === "selection" ? (
                                  <NationalFlag
                                    name={row.team}
                                    season={row.season}
                                  />
                                ) : (
                                  <Media
                                    name={row.team}
                                    url={row.teamInfo?.imageUrl}
                                  />
                                )}
                                {row.kind === "selection"
                                  ? nationalTeamName(row.team, row.season)
                                  : row.team}
                              </span>
                            </td>
                            <td>
                              <div className={s.compChips}>
                                {leagues.map((name) => (
                                  <span key={name}>{name}</span>
                                ))}
                              </div>
                            </td>
                            <td className={s.num}>
                              {number(row.profile.matches)}
                            </td>
                            <td className={s.num}>
                              {row.profile.knownStarts > 0
                                ? number(row.profile.starts)
                                : "—"}
                            </td>
                            <td className={s.num}>
                              {number(row.profile.minutes)}
                            </td>
                            <td className={s.num}>
                              {show(total(row.profile, "goals"))}
                            </td>
                            <td className={s.num}>
                              {show(total(row.profile, "assists"))}
                            </td>
                            <td className={s.num}>
                              {row.profile.rating == null
                                ? "—"
                                : fmt(row.profile.rating, 2)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className={s.totalRow}>
                        <th scope="row">Total club</th>
                        <td>{team?.name || ""}</td>
                        <td />
                        <td className={s.num}>{show(clubTotals.matches)}</td>
                        <td />
                        <td className={s.num}>{show(clubTotals.minutes)}</td>
                        <td className={s.num}>{show(clubTotals.goals)}</td>
                        <td className={s.num}>{show(clubTotals.assists)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className={s.note}>
                Aucune apparition collectée par équipe pour ce joueur.
              </p>
            )
          }
        </AsyncState>
      </section>
      <InjuriesSection />
      {children}
    </div>
  );
}
