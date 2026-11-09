"use client";
/* Projection tab: every club of a Top 7 championship sorted by how the
 * player compares with its regulars at his position, and his place in the
 * chosen club. Clubs and players come from the published compact reads. */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import useCompactRead from "../hooks/useCompactRead.js";
import { compactGeneration } from "../services/compact-reads.js";
import { buildCohorts } from "../services/scouting.js";
import { MIN_SEASON_MINUTES } from "../services/season-player.js";
import {
  clubLeagueId,
  homeLeagueId,
  LEVEL_MARGIN,
  levelCompatibility,
  projectionLeagues,
  SHORT_SAMPLE_MINUTES,
} from "../services/player-projection.js";
import { number } from "../services/format.js";
import { Picture } from "./ClubScoutUI.jsx";
import scout from "./PlayerScout.module.css";
import s from "./PlayerProjection.module.css";

const signed = (value) =>
  value == null
    ? "—"
    : `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), 0)}`;
const ordinal = (n) => (n === 1 ? "1er" : `${n}e`);
const VERDICT = {
  above: "au-dessus de ses titulaires",
  level: "au niveau de ses titulaires",
  below: "en dessous de ses titulaires",
};

function Crests({ clubs, selected, onSelect, describe, dashed }) {
  return (
    <div className={s.crests}>
      {clubs.map((club) => (
        <button
          key={club.id}
          type="button"
          className={s.crest}
          data-short={(dashed && club.short) || undefined}
          aria-pressed={selected === club.id}
          title={describe(club)}
          aria-label={describe(club)}
          onClick={() => onSelect(club.id)}
        >
          <Picture name={club.name} url={club.imageUrl} className={s.logo} />
        </button>
      ))}
    </div>
  );
}

function ClubDepth({ club, result, profile }) {
  const f = useFootball();
  const value = result.own.value;
  const rows = [
    ...club.squad.map((row) => ({ ...row, value: row.index.value })),
    { id: profile.id, name: `${profile.name} (projeté)`, value, self: true },
  ].sort((a, b) => b.value - a.value);
  const peers = profile.role?.peers || "joueurs du poste";
  return (
    <section className={scout.card}>
      <div className={scout.cardHead}>
        <div className={s.depthHead}>
          <Picture name={club.name} url={club.imageUrl} className={s.logo} />
          <div>
            <h3>
              {peers[0].toUpperCase() + peers.slice(1)} · {club.name}
            </h3>
            <p>
              {club.level == null
                ? "Aucun titulaire mesurable au poste."
                : `Titulaires à ${number(club.level, 0)} : ${profile.name} serait ${VERDICT[club.tier]} (${signed(club.gap)}), ${ordinal(club.place)} sur ${club.depth} au poste.`}
            </p>
          </div>
        </div>
      </div>
      <div className="table-scroll">
        <table className={`data-table ${s.depth}`}>
          <caption className="sr-only">
            Joueurs de {club.name} au poste, classés par indice Vega
          </caption>
          <thead>
            <tr>
              <th>Joueur</th>
              <th className={s.num}>Minutes</th>
              <th className={s.num}>Indice Vega</th>
              <th className={s.num}>Écart</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-self={row.self || undefined}>
                <th scope="row">
                  {row.self ? (
                    <strong>{row.name}</strong>
                  ) : (
                    <Link
                      href={f.href("/joueurs/", {
                        id: row.id,
                        q: "",
                        playerView: "projection",
                      })}
                    >
                      {row.name}
                    </Link>
                  )}
                  {club.regulars.has(row.id) && (
                    <span className={s.regular}>Titulaire</span>
                  )}
                  {row.index && (
                    <small className={s.role}>{row.index.label}</small>
                  )}
                </th>
                <td className={s.num}>
                  {row.self ? "—" : number(row.minutes)}
                </td>
                <td className={s.num}>{number(row.value, 0)}</td>
                <td className={s.num}>
                  {row.self ? "—" : signed(value - row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PlayerProjection({ profile, profiles, team, ready }) {
  const f = useFootball();
  const leagues = useMemo(
    () => projectionLeagues(f.manifest, f.season),
    [f.manifest, f.season],
  );
  const leagueIds = useMemo(
    () => new Set(leagues.map((league) => league.id)),
    [leagues],
  );
  const clubsRead = useCompactRead(
    "clubs",
    {
      season: f.season,
      leagues: [...leagueIds].sort().join(","),
      generation: compactGeneration(f.manifest),
      page: 1,
      limit: 100,
    },
    {
      enabled: leagueIds.size > 0,
      allPages: true,
      refreshManifest: f.refreshManifest,
    },
  );
  const clubs = clubsRead.value?.data.clubs;
  const cohorts = useMemo(
    () => buildCohorts(profiles, MIN_SEASON_MINUTES),
    [profiles],
  );
  const home = useMemo(
    () => (clubs ? homeLeagueId(clubs, profile, team?.id, leagues) : null),
    [clubs, profile, team?.id, leagues],
  );
  const [picked, setPicked] = useState(null);
  const leagueId = picked || home || leagues[0]?.id;
  const league = leagues.find((item) => item.id === leagueId);
  const result = useMemo(
    () =>
      clubs && ready && leagueId
        ? levelCompatibility({
            profile,
            cohorts,
            clubs: clubs.filter(
              (club) => clubLeagueId(club, leagueIds) === leagueId,
            ),
            teamId: team?.id,
          })
        : null,
    [clubs, ready, leagueId, leagueIds, profile, cohorts, team?.id],
  );
  const [selectedId, setSelectedId] = useState(null);
  const selected =
    result?.clubs.find((club) => club.id === selectedId) ||
    result?.tiers.find((tier) => tier.id === "level")?.clubs[0] ||
    result?.clubs[0];

  if (!leagues.length)
    return (
      <p className="notice" role="status">
        Aucun championnat du Top 7 européen n’est publié pour cette saison.
      </p>
    );
  if (clubsRead.error)
    return (
      <p className="notice notice-warning" role="alert">
        Clubs indisponibles. {clubsRead.error}{" "}
        <button onClick={clubsRead.retry}>Réessayer</button>
      </p>
    );
  if (!clubs || !ready)
    return (
      <p className="loading-state" data-page-loading="" role="status">
        Lecture des clubs et des joueurs du même poste…
      </p>
    );
  if (!result?.own)
    return (
      <p className="notice" role="status">
        Indice Vega indisponible pour {profile.name} : il faut au moins{" "}
        {MIN_SEASON_MINUTES} minutes et des indicateurs renseignés sur tous ses
        matchs.
      </p>
    );

  const peers = profile.role?.peers || "joueurs du même poste";
  const describe = (club) =>
    club.level == null
      ? `${club.name} : aucun titulaire mesurable au poste`
      : `${club.name} : titulaires à ${number(club.level, 0)}, écart ${signed(club.gap)}${club.short ? " · échantillon court" : ""}`;
  const shortClubs = result.clubs.filter((club) => club.short).length;
  // Early season every club is short: one sentence, no dashed outlines.
  const allShort = shortClubs > 0 && shortClubs === result.clubs.length;

  return (
    <div className={s.root}>
      <div className={`${scout.overview} ${scout.block}`}>
        <div className={scout.sectionHead}>
          <div>
            <h2>Où peut-il jouer ?</h2>
            <p>
              Indice Vega {number(result.own.value, 0)} ({result.own.label})
              face aux {peers}
              {f.focus === "europe" ? " du Top 7 européen" : " comparés"} ·
              saison {f.season}
            </p>
          </div>
        </div>
        <div
          className={s.leagues}
          role="group"
          aria-label="Championnat projeté"
        >
          {leagues.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === leagueId}
              onClick={() => {
                setPicked(item.id);
                setSelectedId(null);
              }}
            >
              {item.name}
              {item.id === home ? " · actuel" : ""}
            </button>
          ))}
        </div>
      </div>

      <section className={`${scout.card} ${scout.block}`}>
        <div className={scout.cardHead}>
          <div>
            <h3>
              Compatibilité par niveau{" "}
              <span className={s.count}>· {result.clubs.length}</span>
            </h3>
            <p>
              {league?.name} · titulaires = les plus utilisés au poste, pondérés
              par leurs minutes · « au niveau » à ±{LEVEL_MARGIN} points
              {team?.name && home === leagueId ? ` · hors ${team.name}` : ""}
            </p>
          </div>
        </div>
        {(result.short || shortClubs > 0) && (
          <p className={s.warning}>
            <strong>Échantillon encore court.</strong>{" "}
            {result.short
              ? `${profile.name} compte ${number(profile.minutes)} minutes : ses verdicts peuvent encore évoluer nettement.`
              : allShort
                ? `Les titulaires comparés ici comptent moins de ${SHORT_SAMPLE_MINUTES} minutes en moyenne : ces verdicts peuvent encore évoluer nettement.`
                : `Les titulaires de ${shortClubs} club${shortClubs > 1 ? "s" : ""} (logos en pointillé) ont moins de ${SHORT_SAMPLE_MINUTES} minutes en moyenne : ces verdicts peuvent encore évoluer.`}
          </p>
        )}
        {result.tiers.map((tier) => (
          <div className={s.tier} data-tier={tier.id} key={tier.id}>
            <span className={s.tierLabel}>
              <i aria-hidden="true" />
              {tier.label} <small>({tier.clubs.length})</small>
            </span>
            {tier.clubs.length ? (
              <Crests
                clubs={tier.clubs}
                selected={selected?.id}
                onSelect={setSelectedId}
                describe={describe}
                dashed={!allShort}
              />
            ) : (
              <span className={s.none}>Aucun club</span>
            )}
          </div>
        ))}
      </section>

      {selected && (
        <div className={scout.block}>
          <ClubDepth club={selected} result={result} profile={profile} />
        </div>
      )}
    </div>
  );
}
