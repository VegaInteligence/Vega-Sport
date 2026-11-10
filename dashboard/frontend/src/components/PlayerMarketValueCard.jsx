"use client";
import React from "react";
import { marketDate, marketValue } from "../services/player-market-values.js";
import {
  loadMarketClubCrests,
  marketClubCrest,
} from "../services/player-market-clubs.js";
import { useResource } from "../services/resources.js";
import { LineChart, TipBody } from "./PlayerScoutCharts.jsx";
import { Media } from "./UI.jsx";
import s from "./PlayerScout.module.css";

const day = 86_400_000;
const timeFormats = [
  { day: "numeric", month: "short" },
  { month: "short", year: "2-digit" },
  { year: "numeric" },
].map(
  (options) =>
    new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }),
);

function timeTicks(points) {
  const first = points[0].time;
  const span = points.at(-1).time - first;
  if (!span) return [{ value: first, label: points[0].x }];
  const count = Math.min(5, points.length);
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

export default function PlayerMarketValueCard({
  values,
  loading,
  error,
  teams,
  lookupSeason,
}) {
  const latest = values.at(-1);
  const clubs = [];
  let previousClub;
  const points = values.map((value, index) => {
    const x = marketDate(value.date);
    const name =
      typeof value.clubName === "string" ? value.clubName.trim() : "";
    const club = name && (value.clubId || name);
    if (club && club !== previousClub) {
      clubs.push({ index, name, date: x, crest: marketClubCrest(name, teams) });
      previousClub = club;
    }
    return {
      x,
      y: value.valueEur,
      time: Date.parse(`${value.date}T00:00:00Z`),
      club: name,
    };
  });
  const missing = [
    ...new Set(clubs.filter((club) => !club.crest).map((club) => club.name)),
  ].sort();
  const lookup = useResource(
    `market-crests:${lookupSeason}:${JSON.stringify(missing)}`,
    ({ signal }) => loadMarketClubCrests(missing, lookupSeason, { signal }),
    Boolean(lookupSeason && missing.length),
  );
  const markers = clubs.map((club) => ({
    ...club,
    icon: (
      <Media
        name={club.name}
        url={club.crest || lookup.value?.[club.name]}
        className={s.marketClubCrest}
      />
    ),
  }));

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
              xTicks={timeTicks(points)}
              markers={markers}
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
          {clubs.length > 0 && (
            <div className={s.marketClubs}>
              <p className={s.note}>Clubs aux dates des estimations</p>
              <ol>
                {markers.map(({ index, name, date, icon }) => (
                  <li key={index}>
                    {icon}
                    <div>
                      <strong>{name}</strong>
                      <small>{date}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      ) : (
        <p className={s.note}>
          {loading
            ? "Chargement…"
            : error
              ? "Historique indisponible."
              : "Aucune estimation disponible."}
        </p>
      )}
    </section>
  );
}
