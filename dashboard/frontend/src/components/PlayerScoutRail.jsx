"use client";
import React, { useEffect, useState } from "react";
import { Media } from "./UI.jsx";
import { number } from "../services/format.js";
import { playerFacts } from "../services/player-bio.js";
import s from "./PlayerScout.module.css";

const RATING_NOTE = "Note moyenne des matchs notés";

/** Current-scope season figures, all computed from the published appearances. */
function seasonFigures(profile) {
  if (!profile?.matches) return [];
  const goals = profile.stats?.goals?.count ? profile.stats.goals.sum : null;
  const assists = profile.stats?.assists?.count
    ? profile.stats.assists.sum
    : null;
  return [
    {
      label: "Matchs",
      value: number(profile.matches),
      note:
        profile.knownStarts > 0
          ? `${number(profile.starts)} titularisations`
          : null,
    },
    {
      label: "Minutes",
      value: number(profile.minutes),
      note: `${number(profile.minutes / profile.matches)} min par match`,
    },
    goals != null && { label: "Buts", value: number(goals) },
    assists != null && { label: "Passes déc.", value: number(assists) },
    profile.rating != null && {
      label: "Note",
      value: number(profile.rating, 2),
      note: RATING_NOTE,
    },
    goals != null &&
      assists != null &&
      goals + assists > 0 && {
        label: "Min. par but ou PD",
        value: `${number(profile.minutes / (goals + assists))}′`,
      },
  ].filter(Boolean);
}

function Facts({ items, label }) {
  if (!items.length) return null;
  return (
    <dl className={s.facts} aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </dl>
  );
}

/** Identity column of the player profile: who, what, value, honours, actions. */
export default function PlayerScoutRail({
  id,
  identity,
  fallbackUrl,
  showIdentity = true,
  profile,
  record,
  season,
  team,
  honours,
  actions,
}) {
  const { facts, value } = playerFacts(record);
  const figures = seasonFigures(profile);
  const role = profile?.role;
  return (
    <aside className={s.rail} aria-label="Identité du joueur">
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
        </div>
      )}
      {facts.length > 0 && (
        <div className={s.railSection}>
          <Facts items={facts} label="Fiche du joueur" />
        </div>
      )}
      {value && (
        <div className={s.railSection}>
          <p className={s.railTitle}>
            Valeur marchande <span>{value.source}</span>
          </p>
          <div className={s.value}>{value.amount}</div>
          {value.updated && (
            <p className={s.valueMeta}>Mise à jour le {value.updated}</p>
          )}
        </div>
      )}
      {figures.length > 0 && (
        <div className={s.railSection}>
          <p className={s.railTitle}>
            Saison {season} <span>filtres actifs</span>
          </p>
          <Facts items={figures} label={`Saison ${season}`} />
        </div>
      )}
      {honours && (
        <div className={s.railSection} key={id}>
          {honours}
        </div>
      )}
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
