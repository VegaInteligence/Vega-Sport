"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Media } from "./UI.jsx";
import { useResource } from "../services/resources.js";
import { loadClubFacts } from "../services/club-facts.js";
import { clubRoster, ROSTER_GROUPS } from "../services/club-roster.js";
import { date, normalizeText, number } from "../services/format.js";
import StadiumDialog from "./StadiumDialog.jsx";

export function ClubFacts({ club, matches }) {
  const [stadiumOpen, setStadiumOpen] = useState(false);
  const finished = matches
    .filter((m) => m.status === "finished")
    .sort((a, b) =>
      (b.timeUtc || b.date || "").localeCompare(a.timeUtc || a.date || ""),
    );
  const latest = finished[0],
    home = finished.find((m) => m.home?.id === club.id);
  const result = useResource(
    `club-facts:${club.id}:${club.country || "none"}:${latest?.id || "none"}:${home?.id || "none"}`,
    () =>
      loadClubFacts(club.id, matches, fetch, {
        name: club.name,
        country: club.country,
      }),
  );
  const value = result.value,
    wiki = value?.wiki;
  const coach = wiki?.coach || value?.observedCoach;
  const isWikiCoach = Boolean(wiki?.coach);
  const observedDiffers =
    wiki?.coach &&
    value?.observedCoach &&
    normalizeText(wiki.coach.name) !== normalizeText(value.observedCoach.name);
  const stadium = wiki?.stadium || value?.observedStadium?.name;
  const photo = isWikiCoach ? wiki.coach.photo : null;
  const alias = wiki?.stadiumAlias;
  return (
    <Card title="Le club en bref" className="club-facts-card">
      {result.loading ? (
        <div className="loading-state" role="status">
          Chargement des informations du club…
        </div>
      ) : (
        <>
          <div className="club-facts-grid">
            <div className="club-coach">
              <Media
                name={coach?.name || "?"}
                url={photo?.url}
                className="club-coach-photo"
              />
              <div className="club-fact-copy">
                <span className="club-fact-label">Entraîneur</span>
                <strong>{coach?.name || "Non renseigné"}</strong>
                <small>
                  {isWikiCoach
                    ? "Entraîneur référencé par Wikidata"
                    : coach
                      ? `Observé le ${date(coach.date)} · PitchAPI`
                      : "Aucune donnée disponible"}
                </small>
                {observedDiffers && (
                  <small>
                    Dernier match de la saison : {value.observedCoach.name} ·{" "}
                    {date(value.observedCoach.date)}
                  </small>
                )}
                {photo?.sourceUrl && (
                  <small className="club-photo-credit">
                    <a
                      href={photo.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Photo : {photo.author || "Wikimedia Commons"}
                      {photo.license
                        ? ` · ${photo.license}`
                        : " · Wikimedia Commons"}
                    </a>
                  </small>
                )}
              </div>
            </div>
            <div className="club-fact">
              <span className="club-fact-label">Stade</span>
              {stadium ? (
                <button
                  type="button"
                  className="stadium-link"
                  onClick={() => setStadiumOpen(true)}
                >
                  {stadium}
                  <span aria-hidden="true"> ↗</span>
                </button>
              ) : (
                <strong>Non renseigné</strong>
              )}
              {alias && normalizeText(alias) !== normalizeText(stadium) && (
                <small>Également appelé {alias}</small>
              )}
              <small>
                {wiki?.stadium
                  ? "Stade référencé par Wikidata"
                  : stadium
                    ? `Dernier match à domicile · ${date(value.observedStadium.date)}`
                    : "Aucune donnée disponible"}
              </small>
            </div>
            <div className="club-fact">
              <span className="club-fact-label">Fondation</span>
              <strong>{wiki?.founded || "Non renseignée"}</strong>
              <small>
                {wiki?.founded
                  ? "Année référencée par Wikidata"
                  : "Aucune donnée disponible"}
              </small>
            </div>
          </div>
          {stadiumOpen && stadium && (
            <StadiumDialog
              name={stadium}
              id={wiki?.stadiumId}
              onClose={() => setStadiumOpen(false)}
            />
          )}
          <p className="club-facts-source">
            {wiki?.sourceUrl ? (
              <>
                <a
                  href={wiki.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Wikidata
                </a>{" "}
                · consultation du {date(wiki.fetchedAt)}.{" "}
              </>
            ) : null}
            Les informations du club peuvent évoluer indépendamment de la saison
            sélectionnée.
          </p>
        </>
      )}
    </Card>
  );
}

export function ClubRoster({ clubId, appearances, href, season }) {
  const groups = useMemo(
    () => clubRoster(appearances, clubId),
    [appearances, clubId],
  );
  const total = Object.values(groups).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  return (
    <Card
      title="Joueurs référencés"
      action={
        <span className="club-roster-count">
          {number(total)} joueurs · {season}
        </span>
      }
    >
      <p className="club-roster-note">
        Joueurs inscrits dans les matchs collectés cette saison. Le poste
        correspond au dernier poste renseigné dans une composition ; cette liste
        ne représente pas nécessairement l’effectif actuel complet.
      </p>
      {total ? (
        ROSTER_GROUPS.filter(([key]) => groups[key].length > 0).map(
          ([key, label]) => (
            <section className="club-roster-section" key={key}>
              <h3>
                {label} <span>{groups[key].length}</span>
              </h3>
              <div className="club-roster">
                {groups[key].map(({ row, role }) => (
                  <Link
                    className="roster-player"
                    key={row.playerId}
                    href={href("/joueurs/", { id: row.playerId })}
                  >
                    <Media
                      name={row.name}
                      url={row.imageUrl}
                      className="player-avatar"
                    />
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {role?.label || "Poste non renseigné"}
                        {row.shirtNumber ? ` · n° ${row.shirtNumber}` : ""}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ),
        )
      ) : (
        <p>Aucun joueur référencé pour cette sélection.</p>
      )}
    </Card>
  );
}
