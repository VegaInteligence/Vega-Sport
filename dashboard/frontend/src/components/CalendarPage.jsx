"use client";
/* The calendar as a thread of days (FAILURE_MODES § 87; piste A of https://claude.ai/artifact/Uw76VAiFvpWqZoUowgt52o,
 * chosen by hugo on 27 Nov 2026, 20 h 41 « POUR Calendrier va pour le A »): the title and the bar Saison ·
 * Compétition · search; the week's seven days in one strip, each with its number of matches; the chosen day's matches
 * on one 22 px card, by competition, results and matches to come together. The week is read by pages of 50
 * (services/calendar-week.js); choosing another day of it reads nothing. */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import useFavourites from "../hooks/useFavourites.js";
import { recordPreselectionChange } from "../hooks/usePreselect.js";
import { useResource } from "../services/resources.js";
import { competitionIndex, fixtureCompetition } from "../services/competition-identity.js";
import { orderedCompetitions } from "../services/competition-selector.js";
import { involvesFavourite } from "../services/preference-effects.js";
import { kickoffFormatter, parisDay, shiftDay } from "../services/fixtures.js";
import {
  byDay,
  calendarPlace,
  coveredDay,
  dayInSentence,
  dayNumber,
  dayTitle,
  fixtureState,
  groupByCompetition,
  plural,
  readWeek,
  seasonBounds,
  sharedRound,
  shortWeekday,
  weekFilters,
  weekTitle,
  DAY_PAGES,
} from "../services/calendar-week.js";
import Icon from "./Icon.jsx";
import { Media } from "./UI.jsx";
import MatchForecastBar from "./MatchForecastBar.jsx";
import SeasonSelect from "./SeasonSelect.jsx";
import { CompetitionPicker, EUROPE_SCOPE } from "./CompetitionPicker.jsx";
import { ResearchLists } from "./ResearchUI.jsx";
import { CalendarBodySkeleton } from "./CalendarSkeleton.jsx";

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

/** The search of the bar: a round button that opens into a pill with its field and a cross. */
function CalendarSearch() {
  const f = useFootball(),
    external = f.filters.query;
  const [open, setOpen] = useState(Boolean(external));
  const [value, setValue] = useState(external);
  const committed = useRef(external),
    timer = useRef(null),
    field = useRef(null);
  useEffect(() => {
    if (external === committed.current) return;
    committed.current = external;
    window.clearTimeout(timer.current);
    setValue(external);
    if (external) setOpen(true);
  }, [external]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const commit = (text) => {
    window.clearTimeout(timer.current);
    if (text === committed.current) return;
    committed.current = text;
    f.setFilters((v) => ({ ...v, query: text }));
  };
  if (!open)
    return (
      <button
        type="button"
        className="home-settings-segment calendar-search"
        aria-label="Rechercher un club ou une compétition"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => field.current?.focus());
        }}
      >
        <Icon name="search" />
      </button>
    );
  return (
    <label className="home-settings-segment calendar-search is-open">
      <Icon name="search" />
      <input
        ref={field}
        type="search"
        aria-label="Filtrer par club ou compétition"
        placeholder="Club, compétition…"
        autoComplete="off"
        spellCheck="false"
        maxLength={100}
        value={value}
        onChange={(event) => {
          const text = event.target.value;
          setValue(text);
          window.clearTimeout(timer.current);
          if (!text) commit(text);
          else timer.current = window.setTimeout(() => commit(text), 220);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(value);
          if (event.key === "Escape" && !value) setOpen(false);
        }}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
      />
      <button
        type="button"
        className="calendar-search-clear"
        aria-label="Effacer la recherche"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setValue("");
          commit("");
          setOpen(false);
        }}
      >
        <Icon name="close" />
      </button>
    </label>
  );
}

/** Saison · Compétition · search, in one 40 px track (the archives' and the competition page's bar, § 82). */
function CalendarBar() {
  const f = useFootball();
  const competitions = useMemo(
    () => orderedCompetitions(f.allCompetitions || f.competitions),
    [f.allCompetitions, f.competitions],
  );
  return (
    <div className="home-settings calendar-bar" role="group" aria-label="Réglages du calendrier">
      <SeasonSelect
        bare
        controlId="season-filter"
        value={f.season}
        seasons={f.manifest.seasons.map((season) => season.id)}
        onChange={(season) => {
          if (season === f.season) return;
          f.changeSeason(season);
          // Another season opens on its own days, not on the day left in the address.
          const url = new URL(window.location.href);
          url.searchParams.delete("day");
          url.searchParams.delete("week");
          window.history.replaceState(null, "", url.pathname + url.search + url.hash);
        }}
      />
      <CompetitionPicker
        bare
        controlId="league-filter"
        competitions={competitions}
        value={f.filters.league === "all" && f.focus === "europe" ? EUROPE_SCOPE : f.filters.league}
        topEurope
        onChange={(value) => {
          const preset = value === "all" || value === EUROPE_SCOPE;
          const focus = value === EUROPE_SCOPE ? "europe" : "all";
          const league = preset ? "all" : value;
          // A scope change can remount the view before its preselection effect observes the clear.
          recordPreselectionChange("matches", league);
          if (preset ? f.focus !== focus : !f.competitions.some((competition) => competition.id === value))
            f.changeFocus(focus);
          f.setFilters((v) => ({ ...v, league, leagues: [], match: "all" }));
        }}
      />
      <CalendarSearch />
    </div>
  );
}

const OFF = {
  postponed: "Reporté",
  canceled: "Annulé",
  abandoned: "Interrompu",
};
function Row({ entry, now, day, favourite }) {
  const f = useFootball(),
    { fixture, kickoff } = entry,
    state = fixtureState(fixture, kickoff, now);
  const home = fixture.home_team || {},
    away = fixture.away_team || {};
  const sh = fixture.score_home,
    sa = fixture.score_away,
    ph = fixture.score_penalty_home,
    pa = fixture.score_penalty_away;
  const scored = state === "over" && Number.isFinite(sh) && Number.isFinite(sa);
  const penalties = scored && sh === sa && Number.isFinite(ph) && Number.isFinite(pa);
  const winner = !scored
    ? null
    : sh !== sa
      ? sh > sa
        ? "home"
        : "away"
      : penalties && ph !== pa
        ? ph > pa
          ? "home"
          : "away"
        : null;
  const hour = kickoff === null ? "À confirmer" : kickoffFormatter.format(kickoff);
  const team = (side, info) => (
    <span
      className={`calendar-team is-${side}${winner === side ? " is-win" : ""}${scored && winner && winner !== side ? " is-lost" : ""}`}
    >
      <span className="calendar-team-name">{info.name || "Équipe à confirmer"}</span>
      <Media name={info.name || "Équipe"} url={info.image_url || info.imageUrl} className="crest calendar-crest" />
    </span>
  );
  return (
    <Link
      className={`calendar-row${favourite ? " is-favourite" : ""}`}
      data-state={state}
      data-fixture-id={fixture.id}
      prefetch={false}
      href={f.href("/matchs/", {
        id: fixture.id,
        competition: fixture.league?.id || "",
        sourceSeason: fixture.season || "",
        from: "calendar",
        day,
      })}
    >
      {team("home", home)}
      {state === "live" ? (
        <strong className="calendar-mid" data-state="live">
          <i aria-hidden="true" />
          En direct
        </strong>
      ) : scored ? (
        <strong className="calendar-mid" data-state="over" title={penalties ? `Tirs au but ${ph} – ${pa}` : undefined}>
          {`${sh} – ${sa}`}
        </strong>
      ) : state === "off" ? (
        <strong className="calendar-mid" data-state="off">
          {OFF[fixture.status]}
        </strong>
      ) : (
        <strong className="calendar-mid" data-state={state}>
          {kickoff === null ? hour : <time dateTime={new Date(kickoff).toISOString()}>{hour}</time>}
        </strong>
      )}
      {team("away", away)}
      {penalties && (
        <small className="calendar-note">
          Tirs au but {ph} – {pa}
        </small>
      )}
      {state === "upcoming" && <MatchForecastBar home={home.name} away={away.name} forecast={fixture.forecast} />}
    </Link>
  );
}

function DayCard({ entries, now, day }) {
  const f = useFootball(),
    favouriteClubs = useFavourites().clubs;
  const index = useMemo(
    () => competitionIndex(f.competitions, f.data?.competitions, f.catalog),
    [f.competitions, f.data?.competitions, f.catalog],
  );
  const followed = useMemo(() => new Set(f.preferences?.favoriteLeagueIds || []), [f.preferences?.favoriteLeagueIds]);
  const favourite = (fixture) => involvesFavourite(fixture, favouriteClubs);
  const groups = groupByCompetition(entries, {
    followed,
    favourite,
    name: (id) => index.get(id)?.name || id,
  });
  return (
    <section className="calendar-card" aria-label={`Matchs du ${dayInSentence(day)}`}>
      {groups.map(({ id, entries: list }) => {
        const competition = fixtureCompetition(list[0].fixture, index),
          round = sharedRound(list);
        return (
          <div className="calendar-group" key={id} data-league={id} aria-label={competition.name}>
            <header className="calendar-group-head">
              <Media name={competition.name} url={competition.imageUrl} className="crest calendar-group-logo" />
              <span className="calendar-group-name">{competition.name}</span>
              <span className="calendar-group-meta">
                {competition.country}
                {round && (
                  <>
                    {competition.country ? " · " : ""}
                    {round}
                    <sup>e</sup> journée
                  </>
                )}
              </span>
            </header>
            <div className="calendar-rows">
              {list.map((entry) => (
                <Row key={entry.fixture.id} entry={entry} now={now} day={day} favourite={favourite(entry.fixture)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

const Empty = ({ text, children }) => (
  <div className="calendar-empty">
    <p>{text}</p>
    {children}
  </div>
);

export default function CalendarPage({ saved = false }) {
  const f = useFootball(),
    search = useSearchParams(),
    now = useClock(),
    today = parisDay(now);
  const bounds = seasonBounds(f.manifest, f.season);
  const place = calendarPlace({
    day: search.get("day"),
    week: search.get("week"),
    today,
    bounds,
  });
  const { week } = place;
  const publication = f.manifest.publicationVersion || f.manifest.scouting?.sourceDigest || "";
  const scope = {
    manifest: f.manifest,
    season: f.season,
    focus: f.focus,
    league: f.filters.league,
    query: f.filters.query,
  };
  const filters = weekFilters({ ...scope, range: week });
  const listKey = JSON.stringify(filters);
  const [attempt, setAttempt] = useState(0);
  const resource = useResource(`calendar-week:${publication}:${listKey}:${attempt}`, ({ signal } = {}) =>
    readWeek(filters, { signal }),
  );
  // The week shown stays while the same week is read again (a new publication, « Actualiser »): no flash.
  const shown = useRef(null);
  const fresh = resource.value && !resource.value.publicationUnsettled ? resource.value : null;
  useEffect(() => {
    if (fresh) shown.current = { key: listKey, value: fresh };
  }, [fresh, listKey]);
  const kept = shown.current?.key === listKey ? shown.current.value : null;
  const read = fresh || kept;
  const unsettled = Boolean(resource.value?.publicationUnsettled);
  const days = useMemo(() => (read ? byDay(read.matches, week) : null), [read, week.start]);
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDay(week.start, i));
  // The week's first day with matches when the address names none of it (a former `week=`, another season).
  const day =
    place.day && !place.pick
      ? place.day
      : days
        ? weekDays.find((d) => days.get(d)?.length) ||
          (place.day && weekDays.includes(place.day) ? place.day : week.start)
        : null;
  // A week longer than its pages: the chosen day, beyond what they covered, read on its own.
  const dayFilters =
    read && day && !coveredDay(day, read) ? weekFilters({ ...scope, range: { start: day, end: day } }) : null;
  const dayResource = useResource(
    `calendar-day:${publication}:${JSON.stringify(dayFilters)}:${attempt}`,
    ({ signal } = {}) => readWeek(dayFilters, { signal, pages: DAY_PAGES }),
    Boolean(dayFilters),
  );
  const dayRead = dayFilters ? dayResource.value : null;
  const dayError = dayFilters && dayResource.error && !dayRead ? dayResource.error : null;
  const dayUnsettled = Boolean(dayRead?.publicationUnsettled);
  // The day itself longer than its pages: what was read is shown, said to be cut (never as the whole day).
  const dayCut = Boolean(dayRead && !dayRead.publicationUnsettled && !dayRead.complete);
  const entries = dayFilters
    ? dayRead && !dayRead.publicationUnsettled
      ? byDay(dayRead.matches, { start: day, end: day }).get(day) || []
      : null
    : days && day
      ? days.get(day) || []
      : null;
  const again = () => {
    setAttempt((n) => n + 1);
    void Promise.resolve(f.refreshManifest?.()).catch(() => {});
  };
  const currentWeek =
    bounds && (today < bounds.start || today > bounds.end) ? null : week.start <= today && today <= week.end;
  const href = (params) => f.href("/matchs/", params);
  const dayHref = (d) => href({ day: d });

  let body;
  if (saved)
    body = (
      <div className="calendar-saved-list">
        <ResearchLists kind="matches" />
      </div>
    );
  else if (resource.error && !read)
    body = (
      <div role="alert" className="notice notice-warning calendar-error">
        {resource.error}{" "}
        <button className="button button-secondary" onClick={resource.retry}>
          Réessayer
        </button>
      </div>
    );
  else if (dayError)
    body = (
      <div role="alert" className="notice notice-warning calendar-error">
        {dayError}{" "}
        <button className="button button-secondary" onClick={dayResource.retry}>
          Réessayer
        </button>
      </div>
    );
  else if ((!read && unsettled) || dayUnsettled)
    body = (
      <p role="status" className="calendar-notice">
        Les matchs de cette semaine se mettent à jour.{" "}
        <button type="button" className="calendar-pill" onClick={again}>
          Actualiser
        </button>
      </p>
    );
  else if (!read || !day || entries === null) body = <CalendarBodySkeleton />;
  else if (!entries.length && !dayCut) {
    const later = weekDays.find((d) => d > day && days.get(d)?.length),
      earlier = [...weekDays].reverse().find((d) => d < day && days.get(d)?.length),
      target = later || earlier,
      // A week cut before its end is never declared empty: its days not read stay in the strip.
      weekEmpty = !target && read.complete;
    body = (
      <Empty text={weekEmpty ? "Aucun match cette semaine." : `Aucun match le ${dayInSentence(day)}.`}>
        {target ? (
          <Link className="calendar-pill is-filled" href={dayHref(target)} scroll={false}>
            {dayTitle(target, today)}
            <Icon name="right" />
          </Link>
        ) : weekEmpty ? (
          <Link
            className="calendar-pill is-filled"
            href={href({
              week: shiftDay(week.start, bounds && week.start >= bounds.end ? -7 : 7),
            })}
            scroll={false}
          >
            {bounds && week.start >= bounds.end ? "Semaine précédente" : "Semaine suivante"}
            <Icon name="right" />
          </Link>
        ) : null}
      </Empty>
    );
  } else {
    const states = entries.map((e) => fixtureState(e.fixture, e.kickoff, now));
    const live = states.filter((s) => s === "live").length,
      over = states.filter((s) => s === "over").length;
    body = (
      <>
        <div className="calendar-day-head">
          <h2>{dayTitle(day, today)}</h2>
          <span className="calendar-day-summary">
            {dayCut
              ? entries.length
                ? `Au moins ${plural(entries.length, "match")}`
                : "Liste incomplète"
              : plural(entries.length, "match")}
            {live ? ` · ${live} en direct` : ""}
            {over && over < entries.length ? ` · ${plural(over, "terminé")}` : ""}
            {" · heure de Paris"}
          </span>
        </div>
        {unsettled && (
          <p role="status" className="calendar-notice">
            Les matchs de cette semaine se mettent à jour.{" "}
            <button type="button" className="calendar-pill" onClick={again}>
              Actualiser
            </button>
          </p>
        )}
        {dayCut && (
          <p role="status" className="calendar-notice">
            Ce jour compte trop de matchs pour les montrer tous : choisissez une compétition ou cherchez un club.
          </p>
        )}
        {entries.length > 0 && <DayCard entries={entries} now={now} day={day} />}
      </>
    );
  }

  return (
    <div className="calendar" aria-busy={resource.loading || undefined}>
      <header className="calendar-head">
        <h1 className="page-title">Calendrier</h1>
        <CalendarBar />
      </header>
      <div className="calendar-nav">
        <div className="calendar-strip" role="group" aria-label={`Semaine du ${weekTitle(week)}`}>
          <Link
            className="calendar-arrow"
            aria-label="Semaine précédente"
            href={href({ week: shiftDay(week.start, -7) })}
            scroll={false}
          >
            <Icon name="left" />
          </Link>
          <div className="calendar-days">
            {weekDays.map((d) => {
              const n = days?.get(d)?.length || 0,
                known = Boolean(days) && coveredDay(d, read),
                count = !known ? "" : n ? plural(n, "match") : "—";
              return (
                <Link
                  key={d}
                  className={`calendar-day${d === today ? " is-today" : ""}${known && !n ? " is-empty" : ""}`}
                  aria-current={!saved && d === day ? "date" : undefined}
                  aria-label={`${dayTitle(d, today)}${count && count !== "—" ? `, ${count}` : ""}`}
                  href={dayHref(d)}
                  scroll={false}
                >
                  <span className="calendar-day-name">{d === today ? "Aujourd’hui" : shortWeekday(d)}</span>
                  <span className="calendar-day-number">{dayNumber(d)}</span>
                  <span className="calendar-day-count" data-short={known ? (n ? String(n) : "—") : ""}>
                    {count ||
                      (days ? "" : <span className="skeleton-line calendar-day-count-skeleton" aria-hidden="true" />)}
                  </span>
                </Link>
              );
            })}
          </div>
          <Link
            className="calendar-arrow"
            aria-label="Semaine suivante"
            href={href({ week: shiftDay(week.start, 7) })}
            scroll={false}
          >
            <Icon name="right" />
          </Link>
        </div>
        <div className="calendar-side">
          <span className="calendar-week">{weekTitle(week)}</span>
          {currentWeek === false && (
            <Link className="calendar-pill" href={href({})} scroll={false}>
              Aujourd’hui
            </Link>
          )}
          <Link
            className={`calendar-pill calendar-saved${saved ? " is-filled" : ""}`}
            aria-current={saved ? "page" : undefined}
            href={saved ? dayHref(day || week.start) : href({ tab: "saved", day: day || "" })}
            scroll={false}
          >
            Mes matchs
          </Link>
        </div>
      </div>
      {body}
    </div>
  );
}
