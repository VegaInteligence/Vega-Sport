"use client";
import Link from "next/link";
import React, { useMemo, useState } from "react";
import Layout from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Segments, Rating, Media, Empty } from "../components/UI.jsx";
import { ScatterPlot } from "../components/Charts.jsx";
import { number, date } from "../services/format.js";
import { isNumber, sortRows } from "../model.js";
import { MatchLink } from "../components/MatchLink.jsx";
import UpcomingMatches from "../components/UpcomingMatches.jsx";
export default function OverviewPage() {
  const f = useFootball(),
    [scatter, setScatter] = useState("attack"),
    [metric, setMetric] = useState("rating");
  const leaders = useMemo(
    () =>
      sortRows(
        f.rows.filter((r) => isNumber(r[metric])),
        metric,
      ).slice(0, 5),
    [f.rows, metric],
  );
  const coverage = useMemo(() => {
    const result = {
      shots: 0,
      competitions: new Set(),
      players: 0,
      shotMatches: 0,
      xg: 0,
      ratings: 0,
    };
    for (const m of f.matches) {
      result.shots += m.shots?.length || 0;
      result.competitions.add(m.leagueId);
      for (const key of ["players", "xg", "ratings"])
        if (m.coverage?.[key]) result[key]++;
      if (m.coverage?.shots) result.shotMatches++;
    }
    return result;
  }, [f.matches]);
  const featured = f.matches.find(
    (m) =>
      m.finished !== false && m.home?.score != null && m.away?.score != null,
  );
  return (
    <Layout path="/" title="Vue d’ensemble" filters>
      <UpcomingMatches compact />
      {featured && (
        <section
          className="hero-strip featured-match"
          aria-label="Match à explorer"
        >
          <div className="hero-copy">
            <div className="featured-meta">
              <span>Match à explorer</span>
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
      <section className="metric-grid" aria-label="Chiffres de la collecte">
        {[
          ["Apparitions affichées", f.rows.length, "players"],
          ["Matchs", f.matches.length, "pitch"],
          ["Compétitions", coverage.competitions.size, "globe"],
          ["Événements de tir", coverage.shots, "target"],
        ].map(([label, value, icon]) => (
          <article className="metric-card" key={label}>
            <div className="metric-label">{label}</div>
            <span className="metric-icon">
              <Icon name={icon} />
            </span>
            <div className="metric-value">{number(value)}</div>
          </article>
        ))}
      </section>
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
          <ScatterPlot
            appearances={f.rows}
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
          title="Performances observées"
          className="span-4 leaders-card"
          footer={
            <Link className="inline-link" href={f.href("/joueurs/")}>
              Tous les joueurs <Icon name="arrow" />
            </Link>
          }
        >
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
                      {r.team} · {number(r.minutes)} min
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
            <Empty>Aucune performance pour ces filtres.</Empty>
          )}
        </Card>
        <Card
          title="Matchs collectés"
          className="span-8 match-list-card"
          action={
            <Link className="inline-link" href={f.href("/matchs/")}>
              Tous les matchs <Icon name="arrow" />
            </Link>
          }
        >
          {f.matches.slice(0, 5).map((m) => (
            <MatchLink key={m.id} match={m} />
          ))}
          {!f.matches.length && <Empty>Aucun match pour ces filtres.</Empty>}
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
                  <span>/ {number(f.matches.length)}</span>
                </strong>
                <span className="coverage-track">
                  <span
                    className={`coverage-fill${coverage[key] < f.matches.length ? " partial" : ""}`}
                    style={{
                      width: `${f.matches.length ? (coverage[key] / f.matches.length) * 100 : 0}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="coverage-footnote">
            {number(f.data.meta.collectedMatches)} /{" "}
            {number(f.data.meta.expectedFinishedMatches)} matchs terminés
            collectés.
          </p>
        </Card>
      </div>
    </Layout>
  );
}
