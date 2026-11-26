"use client";
/* The match page's head (FAILURE_MODES § 63.6, direction C « Le fil des matchs » chosen by hugo): the way back, the
 * competition's button (its round picker, every round's matches with a club search over the whole season), the
 * page's actions, then the thread of matches: the previous and next matches in kick-off order (into the
 * neighbouring round at either end) around a strip of the six before and six after. Without the season's list the
 * button is plain text and there is no thread. */
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  m.status !== "not_started" && m.home.score != null && m.away.score != null;
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
  const previous = direction === "previous";
  if (!match)
    return (
      <span className={`${s.step} ${s.stepOff}`} aria-hidden="true">
        <Icon name={previous ? "back" : "arrow"} />
      </span>
    );
  const label = `${previous ? "Match précédent" : "Match suivant"} : ${describe(match)}`;
  return (
    <Link
      className={s.step}
      href={href(match)}
      aria-label={label}
      title={label}
      prefetch={false}
    >
      <Icon name={previous ? "back" : "arrow"} />
    </Link>
  );
}

/** A round's short name on a tile: « J14 » for a numbered round, else its label. */
const roundTag = (group) =>
  /^\d+$/.test(group.name) ? `J${group.name}` : group.label;

function Tile({ match, group, current, href }) {
  const score = played(match);
  return (
    <li>
      <Link
        className={s.tile}
        href={href(match)}
        data-match-tile={match.id}
        aria-current={current ? "page" : undefined}
        aria-label={describe(match)}
        prefetch={false}
      >
        <small className={s.tileHead}>
          {roundTag(group)} · {day(match)}
          {!score && instant(match) && match.timeUtc
            ? ` · ${result(match)}`
            : ""}
        </small>
        {[match.home, match.away].map((side, i) => (
          <span key={i} className={s.tileSide}>
            <ClubCrest club={side} size={16} />
            <span className={s.tileName}>{side.name}</span>
            {score && <strong className={s.score}>{number(side.score)}</strong>}
          </span>
        ))}
      </Link>
    </li>
  );
}

const longDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});
/** A match's score, its kick-off time, or « à venir » while its time is not set. */
const middle = (m) =>
  played(m) || (instant(m) && m.timeUtc) ? result(m) : "à venir";

function Row({ match, current, href, onPick, showDay = false }) {
  return (
    <li>
      <Link
        className={s.row}
        href={href(match)}
        aria-current={current ? "page" : undefined}
        aria-label={describe(match)}
        prefetch={false}
        onClick={onPick}
        data-day={showDay || undefined}
      >
        {showDay && <span className={s.rowDay}>{day(match)}</span>}
        <span className={`${s.rowTeam} ${s.rowHome}`}>
          <span>{match.home.name}</span>
          <ClubCrest club={match.home} size={20} />
        </span>
        <strong className={played(match) ? s.score : s.kickoff}>
          {middle(match)}
        </strong>
        <span className={s.rowTeam}>
          <ClubCrest club={match.away} size={20} />
          <span>{match.away.name}</span>
        </span>
      </Link>
    </li>
  );
}

/** A round's matches under the day they are played. */
function Days({ matches, current, href, onPick }) {
  const days = [];
  for (const m of matches) {
    const name = instant(m) ? longDay.format(instant(m)) : "Date à venir";
    if (days.at(-1)?.name !== name) days.push({ name, matches: [] });
    days.at(-1).matches.push(m);
  }
  return days.map((d) => (
    <section key={d.name} className={s.day}>
      <h4>{d.name}</h4>
      <ul className={s.list}>
        {d.matches.map((m) => (
          <Row
            key={m.id}
            match={m}
            current={m.id === current}
            href={href}
            onPick={onPick}
          />
        ))}
      </ul>
    </section>
  ));
}

const numbered = (g) => /^\d+$/.test(g.name);
const complete = (g) => g.matches.every(played);
/** Rounds per row of the numbered grid on a computer: one row up to 19, else rows as even as can be (17 + 17 for 34). */
const perRow = (n) => Math.ceil(n / Math.ceil(n / 19));

function Picker({ title, groups, current, currentGroup, href, onClose }) {
  const [selected, setSelected] = useState(currentGroup.key);
  const [query, setQuery] = useState("");
  const grid = useRef(null);
  const at = groups.findIndex((g) => g.key === selected);
  const group = groups[at] || currentGroup;
  const found = useMemo(() => navSearch(groups, query), [groups, query]);
  const allNumbered = groups.every(numbered);
  const nextKey = groups.find((g) => !complete(g))?.key;
  const done = groups.filter(complete).length;
  const move = (by, focus = false) => {
    const next = groups[Math.min(groups.length - 1, Math.max(0, at + by))];
    if (!next) return;
    setSelected(next.key);
    if (focus)
      queueMicrotask(() =>
        grid.current
          ?.querySelector(`[data-round="${CSS.escape(next.key)}"]`)
          ?.focus(),
      );
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
    const first = g.matches[0],
      last = g.matches.at(-1);
    return day(first) === day(last)
      ? day(first)
      : `${day(first)} – ${day(last)}`;
  };
  const state = (g) => {
    const n = g.matches.filter(played).length;
    if (n === g.matches.length)
      return `${n} ${n > 1 ? "matchs joués" : "match joué"}`;
    return n ? `${n} joués sur ${g.matches.length}` : "à venir";
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
          <div
            ref={grid}
            className={s.rounds}
            role="group"
            aria-label="Journées"
            data-numbered={allNumbered || undefined}
            style={
              allNumbered
                ? { "--round-cols": perRow(groups.length) }
                : undefined
            }
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              move(e.key === "ArrowLeft" ? -1 : 1, true);
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
                title={`${g.label} · ${span(g)}`}
                data-state={
                  complete(g)
                    ? "played"
                    : g.key === nextKey
                      ? "next"
                      : undefined
                }
                data-current={g.key === currentGroup.key || undefined}
                tabIndex={g.key === group.key ? 0 : -1}
                onClick={() => setSelected(g.key)}
              >
                {short(g)}
              </button>
            ))}
          </div>
          {allNumbered && (
            <div className={s.progress} data-round-progress="">
              <i aria-hidden="true">
                <b style={{ width: `${(done / groups.length) * 100}%` }} />
              </i>
              <span>
                {done} {done > 1 ? "journées jouées" : "journée jouée"} sur{" "}
                {groups.length}
              </span>
            </div>
          )}
          <div className={s.groupHead}>
            <div>
              <h3>{group.label}</h3>
              <small>
                {span(group)} · {state(group)}
              </small>
            </div>
            <button
              type="button"
              className={s.roundStep}
              onClick={() => move(-1)}
              disabled={at <= 0}
              aria-label="Journée précédente"
            >
              <Icon name="back" />
            </button>
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
          <Days
            matches={group.matches}
            current={current}
            href={href}
            onPick={onClose}
          />
        </>
      )}
      {searching &&
        (byRound.length ? (
          byRound.map(({ group: g, matches }) => (
            <section key={g.key} className={s.found}>
              <h3 className={s.foundHead}>
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
                    showDay
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

/** The tiles around the current match: up to `around` before and after, in the season's order. */
function windowOf(groups, id, around = 6) {
  const order = groups.flatMap((group) =>
    group.matches.map((match) => ({ match, group })),
  );
  const at = order.findIndex((item) => item.match.id === id);
  return at < 0 ? [] : order.slice(Math.max(0, at - around), at + around + 1);
}

function Thread({ groups, position, current, href }) {
  const strip = useRef(null);
  const tiles = useMemo(() => windowOf(groups, current), [groups, current]);
  // The current tile in the middle of the strip, without moving the page.
  useLayoutEffect(() => {
    const box = strip.current,
      tile = box?.querySelector('[aria-current="page"]');
    if (!box || !tile) return;
    const li = tile.parentElement;
    box.scrollLeft = li.offsetLeft - (box.clientWidth - li.offsetWidth) / 2;
  }, [current, tiles]);
  return (
    <nav className={s.thread} aria-label="Matchs de la compétition">
      <Step match={position.previous} href={href} direction="previous" />
      <ol ref={strip} className={s.strip} data-match-strip="">
        {tiles.map(({ match, group }) => (
          <Tile
            key={match.id}
            match={match}
            group={group}
            current={match.id === current}
            href={href}
          />
        ))}
      </ol>
      <Step match={position.next} href={href} direction="next" />
    </nav>
  );
}

/** The head of the match page: `back` (the way back), `logo` (the competition's), `actions` (report, bookmark). */
export default function MatchHead({ match, competition, back, logo, actions }) {
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
  const name = match.league || competition?.name || "Compétition";
  const label = (
    <>
      {logo}
      <span className={s.centerName}>{name}</span>
      {season && <span className={s.centerSeason}>{season}</span>}
      {position && (
        <>
          <span className={s.centerDot} aria-hidden="true">
            ·
          </span>
          <span>{position.group.label}</span>
          <Icon name="chevron" />
        </>
      )}
    </>
  );
  const loading =
    Boolean(league && season) && resource.loading && !resource.value;
  return (
    <div className="match-head">
      <div className={s.top}>
        <div className={s.crumbs}>
          {back}
          {position ? (
            <button
              type="button"
              className={s.center}
              data-match-picker=""
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              {label}
            </button>
          ) : (
            <span className={`${s.center} ${s.centerStatic}`}>{label}</span>
          )}
        </div>
        <div className={s.actions}>{actions}</div>
      </div>
      {loading && (
        <div className={s.threadLoading} data-loading aria-hidden="true" />
      )}
      {position && (
        <Thread
          groups={groups}
          position={position}
          current={match.id}
          href={href}
        />
      )}
      {open && position && (
        <Picker
          title={`${name} · ${season}`}
          groups={groups}
          current={match.id}
          currentGroup={position.group}
          href={href}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
