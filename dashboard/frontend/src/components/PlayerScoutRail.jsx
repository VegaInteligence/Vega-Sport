"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { PhoneFoldToggle, usePhoneFold } from "./PhoneFold.jsx";
import useActorRead from "../hooks/useActorRead.js";
import { useResource } from "../services/resources.js";
import { actorReadParams } from "../services/actor-reads.js";
import {
  compactGeneration,
  supportsCompactRead,
} from "../services/compact-reads.js";
import { playerPlayingTime } from "../services/player-playing-time.js";
import { loadPlayerHalfMinutes } from "../services/player-half-minutes.js";
import {
  loadPlayerHistory,
  playerHistoryKey,
} from "../services/scouting-history.js";
import { playerTeamSeasons } from "../services/player-team-seasons.js";
import { Media } from "./UI.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { number } from "../services/format.js";
import { playerFacts } from "../services/player-bio.js";
import {
  loadPlayerMarketValues,
  marketDate,
  marketValue,
  MARKET_VALUES_UNSERVED,
  playerMarketValuesKey,
  servesMarketValues,
} from "../services/player-market-values.js";
import {
  nationalFlagCode,
  nationalTeamName,
} from "../services/national-flags.js";
import { PositionsPitch } from "./PlayerScoutCharts.jsx";
import {
  FAKE_AVAILABILITY,
  FAKE_FACTS,
  FAKE_POTENTIAL,
  FakeBadge,
} from "./PlayerScoutDemo.jsx";
import s from "./PlayerScout.module.css";

// Formation lines placed on a horizontal pitch, attack to the right.
const LINE_SPOTS = {
  Gardien: ["GAR", 6],
  Défenseur: ["DÉF", 24],
  Milieu: ["MIL", 46],
  "Milieu offensif": ["MO", 64],
  Attaquant: ["ATT", 84],
};

/** Positions held in the current scope, from the published appearances. */
function heldPositions(profile) {
  return [...(profile?.positions || new Map())]
    .filter(([label, item]) => LINE_SPOTS[label] && item.minutes > 0)
    .map(([label, item]) => ({
      code: LINE_SPOTS[label][0],
      label,
      x: LINE_SPOTS[label][1],
      y: 50,
      minutes: item.minutes,
    }));
}

/** National-team caps over every collected season. */
function selection(history) {
  const rows = playerTeamSeasons(history || []).filter(
    (row) => row.kind === "selection",
  );
  if (!rows.length) return null;
  const caps = rows.reduce((sum, row) => sum + row.profile.matches, 0);
  const goals = rows.reduce(
    (sum, row) => sum + (row.profile.stats?.goals?.sum || 0),
    0,
  );
  const { team, season } = rows[0];
  return {
    team,
    season,
    label: "Sélection",
    value: `${number(caps)} sél.`,
    note: `${number(goals)} but${goals > 1 ? "s" : ""} · ${nationalTeamName(team, season)}`,
  };
}

/** Club competition holding most of the player's minutes. */
function mainCompetition(profile, season) {
  const minutes = new Map();
  for (const row of profile?.rows || [])
    if (row.league && !nationalFlagCode(row.team, season))
      minutes.set(row.league, (minutes.get(row.league) || 0) + row.minutes);
  return [...minutes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function Facts({ items, label }) {
  if (!items.length) return null;
  return (
    <dl className={s.facts} aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>
            {item.label}
            {item.fake && <FakeBadge short />}
          </dt>
          <dd>{item.value}</dd>
          {item.note && <small title={item.title}>{item.note}</small>}
        </div>
      ))}
    </dl>
  );
}

/** Identity column of mock-up C: who, facts, value, Vega index, positions,
 *  availability and actions. Values without a source wear a « Fictif » tag. */
export default function PlayerScoutRail({
  id,
  identity,
  fallbackUrl,
  showIdentity = true,
  profile,
  record,
  season,
  team,
  playingTime,
  vega,
  actions,
  onTab,
}) {
  const { facts: published, value: publishedValue } = playerFacts(record);
  const f = useFootball();
  // On a phone the header opens on the identity and the actions.
  const more = usePhoneFold();
  const marketServed = servesMarketValues(f.manifest);
  const marketRead = useResource(
    playerMarketValuesKey(id),
    ({ signal }) => loadPlayerMarketValues(id, { signal }),
    Boolean(id) && marketServed,
  );
  const market = marketServed ? marketRead : MARKET_VALUES_UNSERVED;
  const latestValue = market.value?.history.at(-1);
  const valuation = latestValue
    ? {
        amount: marketValue(latestValue.valueEur),
        updated: marketDate(latestValue.date),
      }
    : publishedValue;
  const history = useResource(
    playerHistoryKey(f.manifest, id),
    ({ signal }) => loadPlayerHistory(f.manifest, id, { signal }),
    Boolean(id && f.manifest),
  );
  const nation = useMemo(() => selection(history.value), [history.value]);
  const known = new Set(published.map((item) => item.label));
  const timeTeam = playingTime?.team;
  const playerMeta = f.data?.meta;
  const generation = compactGeneration(f.manifest);
  const complete =
    playerMeta?.complete === true &&
    playerMeta.actor?.kind === "player" &&
    playerMeta.actor.id === id &&
    playerMeta.currentSeason === season &&
    playerMeta.generation === generation;
  const calendar = useActorRead(
    f.manifest,
    "club",
    {
      ...actorReadParams(f.manifest, "club", {
        id: timeTeam?.id,
        season,
        leagues: f.actorScope || "all",
      }),
      // Coverage and lineup confirmation are available on the full read.
      detail: undefined,
      limit: 100,
    },
    {
      enabled:
        complete &&
        supportsCompactRead(f.manifest, "club") &&
        /^t_[A-Za-z0-9]{6}$/.test(timeTeam?.id || ""),
      refreshManifest: f.refreshManifest,
    },
  );
  const timeFilters = {
    from: f.filters.advanced?.from,
    to: f.filters.advanced?.to,
    league: f.filters.league,
    leagues: f.filters.leagues,
    competition: playingTime?.competition,
    matchId: f.filters.match,
  };
  const observed = complete
    ? playerPlayingTime(
        calendar.value,
        playingTime?.rows,
        timeTeam?.id,
        timeFilters,
      )
    : null;
  const missing = observed?.missingMinutes || [];
  const canRecover =
    Boolean(f.client && missing.length) &&
    !observed.incompleteCalendar &&
    observed.covered + missing.length === observed.matches;
  const halfMinutes = useResource(
    `playing-time-halves:${generation}:${id}:${timeTeam?.id}:${missing.map((game) => game.id).join(",")}`,
    ({ signal }) =>
      loadPlayerHalfMinutes(f.client, missing, id, timeTeam.id, signal),
    canRecover,
  );
  const time =
    canRecover && halfMinutes.value?.size
      ? playerPlayingTime(
          calendar.value,
          playingTime.rows,
          timeTeam.id,
          timeFilters,
          halfMinutes.value,
        )
      : observed;
  const timeFact = { label: "Temps de jeu", value: "—", note: "Indisponible" };
  if (time?.percentage != null) {
    timeFact.value = `${number(time.percentage, 1)} %`;
    const minutes = `${number(time.minutes)} / ${number(time.totalMinutes)} min`;
    timeFact.note =
      timeTeam.id === team?.id
        ? `${minutes} · 90 min/match`
        : `${timeTeam.name} · ${minutes} · 90 min/match`;
    timeFact.title = `${timeTeam.name} · ${number(time.matches)} matchs terminés`;
    if (time.recovered) {
      const games = time.recovered === 1 ? "match" : "matchs";
      timeFact.title += ` · Minutes issues des mi-temps pour ${number(time.recovered)} ${games}`;
    }
  } else if (time?.incompleteCalendar) {
    timeFact.note = "Calendrier incomplet";
  } else if (time) {
    timeFact.note = `Couverture partielle · ${time.covered}/${time.matches}`;
  } else if (calendar.loading) {
    timeFact.note = "Chargement…";
  }
  const facts = [
    ...published.filter((item) => item.label !== "Nom complet"),
    ...FAKE_FACTS.filter((item) => !known.has(item.label)),
    timeFact,
  ];
  if (nation) facts.splice(Math.min(4, facts.length), 0, nation);
  const role = profile?.role;
  const league = mainCompetition(profile, season);
  const positions = heldPositions(profile);
  return (
    <aside className={s.rail} aria-label="Identité du joueur" {...more.fold}>
      {showIdentity && (
        <div className={s.identity}>
          <div className={s.portrait}>
            <Media
              name={identity.name}
              url={identity.imageUrl}
              fallbackUrl={fallbackUrl}
              className="player-avatar season-player-portrait"
            />
            {team?.imageUrl && (
              <span className={s.portraitCrest} title={team.name}>
                <Media name={team.name} url={team.imageUrl} />
              </span>
            )}
          </div>
          <div>
            <h1 className="player-profile-name">{identity.name}</h1>
            {role?.label && <p className={s.role}>{role.label}</p>}
            {role?.peers && <p className={s.peers}>Comparé aux {role.peers}</p>}
          </div>
          {nation && (
            <div className={s.nations}>
              <span>
                <NationalFlag name={nation.team} season={nation.season} />
                {nationalTeamName(nation.team, nation.season)}
              </span>
            </div>
          )}
          {(team || league) && (
            <div className={s.chips}>
              {team && (
                <span className={s.chip}>
                  {team.imageUrl && (
                    <Media name={team.name} url={team.imageUrl} />
                  )}
                  {team.name}
                </span>
              )}
              {league && <span className={s.chip}>{league}</span>}
            </div>
          )}
        </div>
      )}
      <div className={`${s.railSection} phone-fold-row`}>
        <PhoneFoldToggle
          {...more.toggle}
          label="Fiche, valeur, indice et postes"
        />
      </div>
      <div className={`${s.railSection} phone-fold-part`}>
        <Facts items={facts} label="Fiche du joueur" />
      </div>
      <div className={`${s.railSection} phone-fold-part`}>
        <p className={s.railTitle}>Valeur marchande</p>
        <div className={s.value}>{valuation?.amount ?? "—"}</div>
        {valuation ? (
          valuation.updated && (
            <p className={s.valueMeta}>Estimation au {valuation.updated}</p>
          )
        ) : (
          <p className={s.valueMeta}>
            {market.loading
              ? "Chargement…"
              : market.error
                ? "Données indisponibles"
                : "Aucune estimation disponible"}
          </p>
        )}
      </div>
      <div className={`${s.railSection} phone-fold-part`}>
        <p className={s.railTitle}>
          Indice Vega <span>sur 100</span>
        </p>
        <div className={s.indexRow}>
          <div>
            <strong>{vega?.value ?? "—"}</strong>
            <span>Niveau actuel</span>
          </div>
          <div>
            <strong>{FAKE_POTENTIAL}</strong>
            <span>Potentiel</span>
            <div>
              <FakeBadge short />
            </div>
          </div>
          <div>
            <strong>
              {vega?.rank ? (vega.rank === 1 ? "1er" : `${vega.rank}e`) : "—"}
            </strong>
            <span>
              {vega?.of ? `sur ${number(vega.of)} au poste` : "au poste"}
            </span>
          </div>
        </div>
      </div>
      {positions.length > 0 && (
        <div className={`${s.railSection} phone-fold-part`}>
          <p className={s.railTitle}>
            Postes occupés <span>{season}</span>
          </p>
          <PositionsPitch positions={positions} total={profile.minutes} />
        </div>
      )}
      <div className={`${s.railSection} phone-fold-part`}>
        <p className={s.railTitle}>
          Disponibilité <FakeBadge />
        </p>
        <div className={s.indexRow}>
          <div>
            <strong>{FAKE_AVAILABILITY.count}</strong>
            <span>absences</span>
          </div>
          <div>
            <strong>{FAKE_AVAILABILITY.weeks} sem.</strong>
            <span>d’arrêt cumulé</span>
          </div>
          <div>
            <strong>{FAKE_AVAILABILITY.current} j</strong>
            <span>cette saison</span>
          </div>
        </div>
        {onTab && (
          <button
            type="button"
            className={s.railLink}
            onClick={() => onTab("evolution")}
          >
            Historique des blessures →
          </button>
        )}
      </div>
      {actions && <div className={s.railSection}>{actions}</div>}
    </aside>
  );
}

/** Compact identity bar shown once the rail's portrait leaves the screen. */
export function PlayerScoutStrip({
  railRef,
  identity,
  profile,
  team,
  actions,
}) {
  const [visible, setVisible] = useState(false);
  // Mounted on first use so its images never delay the initial page reveal.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const update = () => {
      const rail = railRef.current?.getBoundingClientRect();
      const next = Boolean(rail && rail.top < -240);
      setVisible(next);
      if (next) setMounted(true);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [railRef]);
  const goals = profile?.stats?.goals?.count ? profile.stats.goals.sum : null;
  const assists = profile?.stats?.assists?.count
    ? profile.stats.assists.sum
    : null;
  const items = [
    team?.name && { label: "Club", value: team.name },
    profile?.matches && { label: "Matchs", value: number(profile.matches) },
    profile?.matches && { label: "Minutes", value: number(profile.minutes) },
    goals != null && {
      label: "Buts · PD",
      value: `${number(goals)} · ${number(assists ?? 0)}`,
    },
    profile?.rating != null && {
      label: "Note",
      value: number(profile.rating, 2),
    },
  ].filter(Boolean);
  if (!mounted) return null;
  return (
    <div
      className={s.floating}
      data-visible={visible}
      aria-hidden={!visible || undefined}
      inert={!visible || undefined}
    >
      <div className={s.floatingWho}>
        <Media
          name={identity.name}
          url={identity.imageUrl}
          className="player-avatar"
        />
        <strong>{identity.name}</strong>
        {profile?.role?.label && (
          <span className={s.pos}>{profile.role.label}</span>
        )}
      </div>
      <dl className={s.floatingFacts}>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {actions && <div className={s.floatingActions}>{actions}</div>}
    </div>
  );
}
