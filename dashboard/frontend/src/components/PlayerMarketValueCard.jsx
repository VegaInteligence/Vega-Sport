"use client";
import React, { useMemo, useState } from "react";
import { marketDate, marketValue } from "../services/player-market-values.js";
import {
  loadMarketClubCrests,
  marketClubCrest,
} from "../services/player-market-clubs.js";
import { careerMoves } from "../services/career-moves.js";
import { moveNote, moveTip } from "../services/player-transfers.js";
import { useResource } from "../services/resources.js";
import { LineChart, TipBody } from "./PlayerScoutCharts.jsx";
import { Media, Skeleton } from "./UI.jsx";
import s from "./PlayerScout.module.css";

const day = 86_400_000;
const time = (date) => Date.parse(`${date}T00:00:00Z`);
const timeFormats = [
  { day: "numeric", month: "short" },
  { month: "short", year: "2-digit" },
  { year: "numeric" },
].map(
  (options) =>
    new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }),
);

/** From the first valuation to the last, or to a transfer made since. */
function timeTicks(points, end) {
  const first = points[0].time;
  const span = end - first;
  if (!span) return [{ value: first, label: points[0].x }];
  const count = Math.max(2, Math.min(5, points.length));
  const format = timeFormats[span < 180 * day ? 0 : span < 1461 * day ? 1 : 2];
  return Array.from({ length: count }, (_, i) => {
    const value = first + (span * i) / (count - 1);
    return { value, label: format.format(value) };
  });
}

function valueScale(points) {
  const maximum = Math.max(1, ...points.map((point) => point.y));
  const unit = 10 ** Math.floor(Math.log10(maximum / 4));
  const factor = [1, 2, 2.5, 5, 10].find((n) => n * unit * 4 >= maximum);
  const step = Math.max(1, factor * unit);
  const intervals = Math.ceil(maximum / step);
  return {
    domain: [0, (intervals + 0.35) * step],
    ticks: Array.from({ length: intervals + 1 }, (_, i) => i * step),
  };
}

/** `transfers`: the player's transfers, null when they were not read; nothing is drawn of
 * them while they load (`transfersPending`), so the valuations' clubs never flash first. */
export default function PlayerMarketValueCard({
  values,
  transfers,
  transfersPending,
  loading,
  error,
  teams,
  lookupSeason,
}) {
  const [active, setActive] = useState(null);
  const latest = values.at(-1);
  const moves = useMemo(
    () =>
      transfersPending
        ? { curve: [], list: [] }
        : careerMoves(values, transfers),
    [values, transfers, transfersPending],
  );
  const points = values.map((value) => ({
    x: marketDate(value.date),
    y: value.valueEur,
    time: time(value.date),
    club: value.club?.name,
  }));
  // A club of ours comes with its crest; another one is looked for by its name.
  const known = (club) => club.image_url || marketClubCrest(club.name, teams);
  const missing = [
    ...new Set(
      [...moves.curve, ...moves.list]
        .filter((move) => !known(move.club))
        .map((move) => move.club.name),
    ),
  ].sort();
  const lookup = useResource(
    `market-crests:${lookupSeason}:${JSON.stringify(missing)}`,
    ({ signal }) => loadMarketClubCrests(missing, lookupSeason, { signal }),
    Boolean(lookupSeason && missing.length),
  );
  const crest = (club) => (
    <Media
      name={club.name}
      url={known(club) || lookup.value?.[club.name]}
      className={s.marketClubCrest}
    />
  );
  const badges = moves.curve.map((move) => {
    const tip = moveTip(move);
    return {
      key: move.key,
      x: time(move.at),
      name: [tip.title, ...tip.rows.map((row) => row.join(" "))].join(", "),
      icon: crest(move.club),
      tip: <TipBody title={tip.title} rows={tip.rows} />,
      onActive: (on) => setActive(on ? move.key : null),
    };
  });

  return (
    <section className={s.card}>
      <div className={s.marketHeading}>
        <div>
          <h2>Valeur marchande</h2>
          <p className={s.note}>Historique des estimations</p>
        </div>
        {latest && (
          <div className={s.marketLatest}>
            <strong>{marketValue(latest.valueEur)}</strong>
            <p className={s.note}>Au {marketDate(latest.date)}</p>
          </div>
        )}
      </div>
      {latest ? (
        <>
          <div className={s.marketPlot}>
            <LineChart
              {...valueScale(points)}
              width={560}
              height={226}
              leftMargin={64}
              points={points}
              xValue={(point) => point.time}
              xTicks={timeTicks(
                points,
                Math.max(points.at(-1).time, ...badges.map((badge) => badge.x)),
              )}
              badges={badges}
              format={marketValue}
              tip={(point) => (
                <TipBody
                  title={point.x}
                  rows={[
                    ["Valeur", marketValue(point.y)],
                    ...(point.club ? [["Club", point.club]] : []),
                  ]}
                />
              )}
              ariaLabel="Historique des estimations de valeur marchande"
            />
          </div>
          {moves.list.length > 0 && (
            <ol className={s.marketClubs}>
              {moves.list.map((move) => (
                <li
                  key={move.key}
                  className={
                    move.key === active ? s.marketClubActive : undefined
                  }
                >
                  {crest(move.club)}
                  <div>
                    <strong>{move.club.name}</strong>
                    <small>{moveNote(move)}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className={s.note}>
          {loading
            ? <Skeleton kind="inline" label="Chargement de l’historique…" />
            : error
              ? "Historique indisponible."
              : "Aucune estimation disponible."}
        </p>
      )}
    </section>
  );
}
