"use client";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Segments, Rating, Media, Empty } from "../components/UI.jsx";
import { DeferredScatterPlot } from "../components/Charts.jsx";
import { number, date } from "../services/format.js";
import { isNumber, topRows } from "../model.js";
import { MatchLink } from "../components/MatchLink.jsx";
import UpcomingMatches from "../components/UpcomingMatches.jsx";
import {
  followedRecords,
  recentFinishedMatches,
  recentRecords,
  RECENT_PERFORMANCE_DAYS,
  selectFeaturedMatch,
} from "../services/home.js";
export default function OverviewPage() {
  const f = useFootball(),
    [scatter, setScatter] = useState("attack"),
    [metric, setMetric] = useState("rating"),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const favoriteLeagueIds =
      f.filters.league !== "all" ? [] : f.preferences.favoriteLeagueIds,
    matches = f.matches;
  const homeRows = useMemo(
    () => followedRecords(f.rows, favoriteLeagueIds),
    [f.rows, favoriteLeagueIds],
  );
  const homeMatches = useMemo(
    () => followedRecords(matches, favoriteLeagueIds),
    [matches, favoriteLeagueIds],
  );
  const recentMatches = useMemo(
    () => recentFinishedMatches(homeMatches, now),
    [homeMatches, now],
  );
  const recentPerformances = useMemo(
    () => recentRecords(homeRows, now, RECENT_PERFORMANCE_DAYS),
    [homeRows, now],
  );
  const leaders = useMemo(
    () =>
      topRows(
        recentPerformances.filter((r) => isNumber(r[metric])),
        metric,
        5,
      ),
    [recentPerformances, metric],
  );
  const coverage = useMemo(() => {
    const result = {
      players: 0,
      shotMatches: 0,
      xg: 0,
      ratings: 0,
    };
    for (const m of homeMatches) {
      for (const key of ["players", "xg", "ratings"])
        if (m.coverage?.[key]) result[key]++;
      if (m.coverage?.shots) result.shotMatches++;
    }
    return result;
  }, [homeMatches]);
  const featured = useMemo(
    () => selectFeaturedMatch(recentMatches, now),
    [recentMatches, now],
  );
  return (
    <Layout path="/" title="Vue d’ensemble" filters filterKind="home">
      <UpcomingMatches compact />
      {featured && (
        <section
          className="hero-strip featured-match"
          aria-label="Match à explorer"
        >
          <div className="hero-copy">
            <div className="featured-meta">
              <span>Match récent à explorer</span>
              <span>
                {featured.league} · {date(featured.date)}
              </span>
            </div>
            <div className="featured-score">
              <span>
                <Media
                  name={featured.home.name}
                  url={featured.home.imageUrl}
                  className="crest featured-crest"
                />
                <strong>{featured.home.name}</strong>
              </span>
              <b>
                {number(featured.home.score)}
                <i>:</i>
                {number(featured.away.score)}
              </b>
              <span>
                <Media
                  name={featured.away.name}
                  url={featured.away.imageUrl}
                  className="crest featured-crest"
                />
                <strong>{featured.away.name}</strong>
              </span>
            </div>
          </div>
          <div className="featured-action">
            <Link
              className="button button-primary"
              href={f.href("/matchs/", { id: featured.id })}
            >
              Explorer le match <Icon name="arrow" />
            </Link>
          </div>
        </section>
      )}
      <div className="dashboard-grid">
        <Card
          title="Performances"
          className="span-8"
          action={
            <Segments
              label="Dimensions du graphique"
              value={scatter}
              items={[
                ["attack", "Attaque"],
                ["balance", "Création & défense"],
              ]}
              onChange={setScatter}
            />
          }
        >
          <DeferredScatterPlot
            appearances={homeRows}
            {...(scatter === "balance"
              ? {
                  xKey: "chancesCreated",
                  yKey: "defensiveActions",
                  xLabel: "Occasions créées",
                  yLabel: "Actions défensives",
                }
              : {})}
            onPlayer={f.setPlayer}
          />
        </Card>
        <Card
          title="Performances récentes"
          className="span-4 leaders-card"
          footer={
            <Link className="inline-link" href={f.href("/joueurs/")}>
              Tous les joueurs <Icon name="arrow" />
            </Link>
          }
        >
          <p className="home-card-caption">
            Meilleures performances des 30 derniers jours
          </p>
          <div className="leader-controls">
            <Segments
              label="Trier les performances"
              value={metric}
              items={[
                ["rating", "Note PitchAPI"],
                ["xg", "xG"],
                ["chancesCreated", "Création"],
              ]}
              onChange={setMetric}
            />
          </div>
          <ol className="leaderboard">
            {leaders.map((r, i) => (
              <li key={r.id}>
                <button
                  className="leader-row"
                  onClick={() => f.setPlayer(r.id)}
                >
                  <span className="leader-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Media
                    name={r.name}
                    url={r.imageUrl}
                    className="player-avatar"
                  />
                  <span className="player-copy">
                    <strong className="player-name">{r.name}</strong>
                    <span className="player-meta">
                      Club du match : {r.team} · {date(r.date)} ·{" "}
                      {number(r.minutes)} min
                    </span>
                  </span>
                  <span className="leader-value">
                    {metric === "rating" ? (
                      <Rating value={r.rating} />
                    ) : (
                      number(r[metric], 2)
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {!leaders.length && (
            <Empty>
              Aucune performance collectée durant les 30 derniers jours pour
              cette sélection.
            </Empty>
          )}
        </Card>
        <Card
          title="Matchs récents"
          className="span-8 match-list-card"
          action={
            <Link
              className="inline-link"
              href={f.href("/matchs/", { tab: "results" })}
            >
              Tous les matchs <Icon name="arrow" />
            </Link>
          }
        >
          <p className="home-card-caption">
            Matchs terminés collectés au cours des 14 derniers jours
          </p>
          {recentMatches.slice(0, 5).map((m) => (
            <MatchLink key={m.id} match={m} />
          ))}
          {!recentMatches.length && (
            <Empty>
              Aucun match collecté ces 14 derniers jours pour cette sélection.
              {f.season !== f.manifest.defaultSeason && (
                <>
                  {" "}
                  <Link
                    className="inline-link"
                    href={f.href("/", {
                      season: f.manifest.defaultSeason,
                      league: "",
                      q: "",
                    })}
                  >
                    Voir la saison en cours
                  </Link>
                  .
                </>
              )}
            </Empty>
          )}
        </Card>
        <Card title="Couverture" className="span-4">
          <div className="coverage-list">
            {[
              ["players", "Statistiques joueurs"],
              ["shotMatches", "Tirs"],
              ["xg", "xG"],
              ["ratings", "Notes"],
            ].map(([key, label]) => (
              <div className="coverage-row" key={key}>
                <span className="coverage-label">{label}</span>
                <strong className="coverage-value">
                  {number(coverage[key])}{" "}
                  <span>/ {number(homeMatches.length)}</span>
                </strong>
                <span className="coverage-track">
                  <span
                    className={`coverage-fill${coverage[key] < homeMatches.length ? " partial" : ""}`}
                    style={{
                      width: `${homeMatches.length ? (coverage[key] / homeMatches.length) * 100 : 0}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="coverage-footnote">
            {number(homeMatches.length)} matchs collectés dans la sélection de
            cette saison.
          </p>
        </Card>
      </div>
    </Layout>
  );
}
