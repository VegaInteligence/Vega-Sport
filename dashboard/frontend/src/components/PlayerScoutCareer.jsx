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
import { playerContractFact, playerFacts } from "../services/player-bio.js";
import { nationalTeamName } from "../services/national-flags.js";
import { seasonMetric } from "../services/season-player.js";
import { number } from "../services/format.js";
import {
  loadPlayerMarketValues,
  latestMarketEstimate,
  MARKET_VALUES_UNSERVED,
  playerMarketValuesKey,
  servesMarketValues,
} from "../services/player-market-values.js";
import { AsyncState, Media } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { fmt } from "./PlayerScoutCharts.jsx";
import PlayerMarketValueCard from "./PlayerMarketValueCard.jsx";
import { PlayerInjuries, VegaIndexHistory } from "./PlayerCareerCards.jsx";
import s from "./PlayerScout.module.css";
import { Term } from "./Hint.jsx";

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
  record,
  team,
  season,
  children,
}) {
  const f = useFootball();
  const marketServed = servesMarketValues(f.manifest);
  const marketRead = useResource(
    playerMarketValuesKey(id),
    ({ signal }) => loadPlayerMarketValues(id, { signal }),
    Boolean(id) && marketServed,
  );
  const market = marketServed ? marketRead : MARKET_VALUES_UNSERVED;
  const values = market.value?.history || [];
  const valuation = latestMarketEstimate(values, playerFacts(record).value);
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
  const contract = playerContractFact(record);
  const kpis = [
    ["Club actuel", team?.name || "—"],
    ["Fin de contrat", contract?.summary || "—"],
    ["Valeur marchande", valuation?.amount || "—", true],
    ["Matchs en club", show(clubTotals.matches)],
    ["Minutes en club", show(clubTotals.minutes)],
    [
      "Buts · PD",
      `${show(clubTotals.goals)} B · ${show(clubTotals.assists)} PD`,
    ],
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
          {kpis.map(([label, value, accent]) => (
            <div key={label}>
              <span>
                <Term>{label}</Term>
              </span>
              <strong className={accent ? s.kpiAccent : undefined}>
                {(
                  label === "Valeur marchande"
                    ? market.loading && !valuation
                    : history.loading &&
                      label !== "Club actuel" &&
                      label !== "Fin de contrat"
                )
                  ? "…"
                  : value}
              </strong>
            </div>
          ))}
        </div>
      </div>
      <div className={`${s.block} ${s.grid2}`}>
        <VegaIndexHistory id={id} />
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
                        <th><Term>Saison</Term></th>
                        <th><Term>Équipe</Term></th>
                        <th><Term>Compétitions</Term></th>
                        <th className={s.num}><Term>MJ</Term></th>
                        <th className={s.num}><Term>Tit.</Term></th>
                        <th className={s.num}><Term>Min</Term></th>
                        <th className={s.num}><Term>Buts</Term></th>
                        <th className={s.num}><Term>PD</Term></th>
                        <th className={s.num}><Term>Note Vega</Term></th>
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
                              {row.profile.grade == null
                                ? "—"
                                : fmt(row.profile.grade, 0)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className={s.totalRow}>
                        <th scope="row"><Term>Total club</Term></th>
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
      <PlayerInjuries id={id} />
      {children}
    </div>
  );
}
