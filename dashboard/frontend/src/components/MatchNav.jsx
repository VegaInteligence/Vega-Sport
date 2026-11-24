"use client";
/* The match page's way across its competition: the previous and next matches in kick-off
 * order (into the neighbouring round at either end) and a picker of every round's matches,
 * with a club search over the whole season. Nothing is drawn when the season has no list. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import {
  loadMatchNav,
  navPosition,
  navRounds,
  navSearch,
} from "../services/match-nav.js";
import { number } from "../services/format.js";
import { ClubCrest, Modal } from "./UI.jsx";
import Icon from "./Icon.jsx";
import s from "./MatchNav.module.css";

const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});
const instant = (m) => {
  const value = Date.parse(m.timeUtc || m.date || "");
  return Number.isFinite(value) ? new Date(value) : null;
};
const played = (m) =>
  m.status !== "not_started" &&
  m.home.score != null &&
  m.away.score != null;
/** « 2 – 1 », or the kick-off time of a match to come. */
const result = (m) =>
  played(m)
    ? `${number(m.home.score)} – ${number(m.away.score)}`
    : instant(m) && m.timeUtc
      ? timeFormat.format(instant(m))
      : "–";
const day = (m) => (instant(m) ? dayFormat.format(instant(m)) : "");
const short = (group) => (/^\d+$/.test(group.name) ? group.name : group.label);
const describe = (m) =>
  `${m.home.name} ${played(m) ? `${m.home.score}–${m.away.score}` : "contre"} ${m.away.name}${played(m) ? "" : `, ${day(m)} ${result(m)}`}`;

function useMatchHref(league, season) {
  const f = useFootball();
  const view = useSearchParams().get("view");
  return (m) =>
    f.href("/matchs/", {
      tab: m.status === "not_started" ? "upcoming" : "results",
      id: m.id,
      competition: league,
      sourceSeason: season,
      ...(view ? { view } : {}),
    });
}

function Step({ match, href, direction }) {
  if (!match) return <span className={s.step} aria-hidden="true" />;
  const label = `${direction === "previous" ? "Match précédent" : "Match suivant"} : ${describe(match)}`;
  return (
    <Link
      className={`${s.step} ${direction === "next" ? s.stepNext : ""}`.trim()}
      href={href(match)}
      aria-label={label}
      title={label}
      prefetch={false}
    >
      <Icon name={direction === "previous" ? "back" : "arrow"} />
      <span className={s.stepTeams}>
        <ClubCrest club={match.home} size={20} />
        <span className={s.stepName}>{match.home.name}</span>
        <strong className={played(match) ? s.score : s.kickoff}>
          {played(match) ? result(match) : `${day(match)} ${result(match)}`}
        </strong>
        <span className={s.stepName}>{match.away.name}</span>
        <ClubCrest club={match.away} size={20} />
      </span>
    </Link>
  );
}

function Row({ match, current, href, onPick }) {
  return (
    <li>
      <Link
        className={s.row}
        href={href(match)}
        aria-current={current ? "page" : undefined}
        aria-label={describe(match)}
        prefetch={false}
        onClick={onPick}
      >
        <span className={s.rowDay}>{day(match)}</span>
        <span className={`${s.rowTeam} ${s.rowHome}`}>
          <span>{match.home.name}</span>
          <ClubCrest club={match.home} size={20} />
        </span>
        <strong className={played(match) ? s.score : s.kickoff}>
          {result(match)}
        </strong>
        <span className={s.rowTeam}>
          <ClubCrest club={match.away} size={20} />
          <span>{match.away.name}</span>
        </span>
      </Link>
    </li>
  );
}

function Picker({ title, groups, current, currentGroup, href, onClose }) {
  const [selected, setSelected] = useState(currentGroup.key);
  const [query, setQuery] = useState("");
  const strip = useRef(null);
  const at = groups.findIndex((g) => g.key === selected);
  const group = groups[at] || currentGroup;
  const found = useMemo(() => navSearch(groups, query), [groups, query]);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selected]);
  const move = (by) => {
    const next = groups[Math.min(groups.length - 1, Math.max(0, at + by))];
    if (next) setSelected(next.key);
  };
  const searching = query.trim().length > 0;
  const byRound = searching
    ? groups
        .map((g) => ({
          group: g,
          matches: found.filter((f) => f.group === g).map((f) => f.match),
        }))
        .filter((g) => g.matches.length)
    : [];
  const span = (g) => {
    const first = g.matches[0], last = g.matches.at(-1);
    return day(first) === day(last) ? day(first) : `${day(first)} – ${day(last)}`;
  };
  return (
    <Modal title={title} onClose={onClose} className={s.picker}>
      <label className={s.search}>
        <Icon name="search" />
        <input
          className={s.searchInput}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une équipe"
          aria-label="Rechercher une équipe"
          autoComplete="off"
        />
      </label>
      {!searching && (
        <>
          <div className={s.rounds}>
            <button
              type="button"
              className={s.roundStep}
              onClick={() => move(-1)}
              disabled={at <= 0}
              aria-label="Journée précédente"
            >
              <Icon name="back" />
            </button>
            <div
              ref={strip}
              className={s.strip}
              role="group"
              aria-label="Journées"
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const next =
                  groups[
                    Math.min(
                      groups.length - 1,
                      Math.max(0, at + (e.key === "ArrowLeft" ? -1 : 1)),
                    )
                  ];
                if (!next) return;
                setSelected(next.key);
                queueMicrotask(() =>
                  strip.current
                    ?.querySelector(`[data-round="${CSS.escape(next.key)}"]`)
                    ?.focus(),
                );
              }}
            >
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  data-round={g.key}
                  className={s.round}
                  aria-pressed={g.key === group.key}
                  aria-label={g.label}
                  data-current={g.key === currentGroup.key || undefined}
                  tabIndex={g.key === group.key ? 0 : -1}
                  onClick={() => setSelected(g.key)}
                >
                  {short(g)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={s.roundStep}
              onClick={() => move(1)}
              disabled={at >= groups.length - 1}
              aria-label="Journée suivante"
            >
              <Icon name="arrow" />
            </button>
          </div>
          <h3 className={s.groupHead}>
            <span>{group.label}</span>
            <small>{span(group)}</small>
          </h3>
          <ul className={s.list}>
            {group.matches.map((m) => (
              <Row
                key={m.id}
                match={m}
                current={m.id === current}
                href={href}
                onPick={onClose}
              />
            ))}
          </ul>
        </>
      )}
      {searching &&
        (byRound.length ? (
          byRound.map(({ group: g, matches }) => (
            <section key={g.key} className={s.found}>
              <h3 className={s.groupHead}>
                <span>{g.label}</span>
                <small>{span({ matches })}</small>
              </h3>
              <ul className={s.list}>
                {matches.map((m) => (
                  <Row
                    key={m.id}
                    match={m}
                    current={m.id === current}
                    href={href}
                    onPick={onClose}
                  />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className={s.none}>Aucune équipe trouvée.</p>
        ))}
    </Modal>
  );
}

export default function MatchNav({ match, competition }) {
  const f = useFootball();
  const league = match.leagueId || competition?.id || "";
  const season = match.season || "";
  const resource = useResource(
    `match-nav:${league}:${season}:${f.manifest?.publicationVersion || ""}`,
    ({ signal }) => loadMatchNav(f, { league, season }, { signal }),
    Boolean(league && season && f.statusKnown),
  );
  const groups = useMemo(() => navRounds(resource.value), [resource.value]);
  const position = useMemo(
    () => navPosition(groups, match.id),
    [groups, match.id],
  );
  const href = useMatchHref(league, season);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [match.id]);
  if (!league || !season) return null;
  if (resource.loading && !resource.value)
    return <div className={s.bar} data-loading aria-hidden="true" />;
  if (!position) return null;
  const name = match.league || competition?.name || "Compétition";
  return (
    <nav className={s.bar} aria-label="Matchs de la compétition">
      <Step match={position.previous} href={href} direction="previous" />
      <button
        type="button"
        className={s.center}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={s.centerName}>{name}</span>
        <span className={s.centerDot} aria-hidden="true">·</span>
        <span>{position.group.label}</span>
        <Icon name="chevron" />
      </button>
      <Step match={position.next} href={href} direction="next" />
      {open && (
        <Picker
          title={`${name} · ${season}`}
          groups={groups}
          current={match.id}
          currentGroup={position.group}
          href={href}
          onClose={() => setOpen(false)}
        />
      )}
    </nav>
  );
}
