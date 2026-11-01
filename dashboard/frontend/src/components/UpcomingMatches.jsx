"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Media, Pager } from "./UI.jsx";
import Icon from "./Icon.jsx";
import {
  dayLabel,
  fixtureWeek,
  kickoffFormatter,
  parisDay,
  shiftDay,
  upcomingFixtures,
  validDay,
} from "../services/fixtures.js";

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return now;
}
function Fixture({ entry, week, compact }) {
  const f = useFootball(),
    { fixture, kickoff, day } = entry;
  return (
    <Link
      className={`fixture-link${compact ? " fixture-tile" : ""}`}
      href={f.href("/matchs/", {
        id: fixture.id,
        competition: fixture.league?.id,
        sourceSeason: fixture.season,
        from: "upcoming",
        tab: "upcoming",
        week,
      })}
      data-fixture-id={fixture.id}
    >
      <span className="fixture-competition">{fixture.league?.name}</span>
      <span className="fixture-teams">
        {[fixture.home_team, fixture.away_team].map((team, i) => (
          <span className="fixture-team" key={i}>
            <Media name={team?.name || "Équipe"} url={team?.image_url} />
            <strong>{team?.name || "Équipe à confirmer"}</strong>
          </span>
        ))}
      </span>
      <span className="fixture-kickoff">
        {compact && (
          <span>{dayLabel(day, { weekday: "short", month: "short" })}</span>
        )}
        {kickoff === null ? (
          <strong>Horaire à confirmer</strong>
        ) : (
          <time dateTime={new Date(kickoff).toISOString()}>
            {kickoffFormatter.format(kickoff)}
          </time>
        )}
      </span>
      <Icon name="arrow" className="fixture-arrow" />
    </Link>
  );
}
export default function UpcomingMatches({ compact = false }) {
  const f = useFootball(),
    search = useSearchParams(),
    now = useClock();
  const currentWeek = fixtureWeek(parisDay(now));
  const requested = search.get("week");
  const week =
    !compact && validDay(requested) ? fixtureWeek(requested) : currentWeek;
  const current = week.start === currentWeek.start;
  const [page, setPage] = useState(1);
  const entries = useMemo(
    () =>
      upcomingFixtures(f.data.fixtures, {
        week,
        now,
        league: f.filters.league,
        query: f.filters.query,
      }),
    [f.data.fixtures, week.start, now, f.filters.league, f.filters.query],
  );
  const pageCount = Math.max(1, Math.ceil(entries.length / 40));
  const selectedPage = Math.min(page, pageCount);
  useEffect(
    () => setPage(1),
    [week.start, f.filters.league, f.filters.query, f.focus, f.season],
  );
  const visible = compact
    ? entries.slice(0, 6)
    : entries.slice((selectedPage - 1) * 40, selectedPage * 40);
  const groups = new Map();
  for (const entry of visible) {
    if (!groups.has(entry.day)) groups.set(entry.day, []);
    groups.get(entry.day).push(entry);
  }
  const calendarHref = (start) =>
    f.href("/matchs/", { tab: "upcoming", week: start });
  return (
    <section
      className={`upcoming-section${compact ? " upcoming-preview" : " weekly-calendar"}`}
      aria-label={compact ? "À venir cette semaine" : "Matchs à venir"}
    >
      <div className="upcoming-heading">
        <div>
          <h2>
            {compact
              ? "À venir cette semaine"
              : `${dayLabel(week.start, { month: "short" })} — ${dayLabel(week.end, { month: "short", year: "numeric" })}`}
          </h2>
          <span className="upcoming-meta">
            <span>
              {entries.length} match{entries.length === 1 ? "" : "s"}
            </span>
            <span>Heure de Paris</span>
          </span>
        </div>
        {compact ? (
          <Link className="inline-link" href={calendarHref(week.start)}>
            Tous les matchs à venir <Icon name="arrow" />
          </Link>
        ) : (
          <nav className="week-navigation" aria-label="Choisir la semaine">
            <Link
              className="button button-secondary week-arrow"
              aria-label="Semaine précédente"
              href={calendarHref(shiftDay(week.start, -7))}
            >
              <Icon name="back" />
            </Link>
            <Link
              className={`button ${current ? "button-primary" : "button-secondary"}`}
              aria-current={current ? "date" : undefined}
              href={calendarHref(currentWeek.start)}
            >
              Cette semaine
            </Link>
            <Link
              className="button button-secondary week-arrow"
              aria-label="Semaine suivante"
              href={calendarHref(shiftDay(week.start, 7))}
            >
              <Icon name="arrow" />
            </Link>
          </nav>
        )}
      </div>
      {entries.length ? (
        compact ? (
          <div className="fixture-preview-grid">
            {visible.map((entry) => (
              <Fixture
                key={entry.fixture.id}
                entry={entry}
                week={week.start}
                compact
              />
            ))}
          </div>
        ) : (
          <div className="fixture-days">
            {[...groups].map(([day, items]) => (
              <section
                className="fixture-day"
                key={day}
                aria-label={dayLabel(day, { weekday: "long" })}
              >
                <h3>
                  <span>
                    {day === parisDay(now)
                      ? "Aujourd’hui"
                      : dayLabel(day, {
                          weekday: "long",
                          day: undefined,
                          month: undefined,
                        })}
                  </span>
                  <time dateTime={day}>
                    {dayLabel(day, { month: "short" })}
                  </time>
                </h3>
                <div className="fixture-day-list">
                  {items.map((entry) => (
                    <Fixture
                      key={entry.fixture.id}
                      entry={entry}
                      week={week.start}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        <div className="fixtures-empty">
          <Icon name="calendar" />
          <p>
            {f.season !== f.manifest.defaultSeason
              ? "Aucun match à venir dans cette saison pour cette semaine."
              : "Aucun match à venir cette semaine pour ces filtres."}
          </p>
          {f.season !== f.manifest.defaultSeason ? (
            <Link
              className="button button-secondary"
              href={f.href("/matchs/", {
                tab: "upcoming",
                season: f.manifest.defaultSeason,
                week: currentWeek.start,
                league: "",
                q: "",
              })}
            >
              Saison en cours <Icon name="arrow" />
            </Link>
          ) : (
            <Link
              className="button button-secondary"
              href={calendarHref(shiftDay(week.start, 7))}
            >
              Semaine suivante <Icon name="arrow" />
            </Link>
          )}
        </div>
      )}
      {!compact && pageCount > 1 && (
        <Pager page={selectedPage} total={pageCount} onChange={setPage} />
      )}
    </section>
  );
}
