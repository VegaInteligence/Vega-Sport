"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Media, Skeleton } from "./UI.jsx";
import { useResource } from "../services/resources.js";
import { loadClubFacts } from "../services/club-facts.js";
import { clubRoster, ROSTER_GROUPS } from "../services/club-roster.js";
import { date, normalizeText, number } from "../services/format.js";
import StadiumDialog from "./StadiumDialog.jsx";

export function ClubFacts({ club, matches, more = [] }) {
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
      loadClubFacts(club.id, matches, fetch),
  );
  const value = result.value,
    wiki = value?.wiki;
  const coach = wiki?.coach || value?.observedCoach;
  const isWikiCoach = Boolean(wiki?.coach);
  const stadium = wiki?.stadium || value?.observedStadium?.name;
  const photo = (isWikiCoach ? wiki.coach.photo : null) || value?.coachPhoto;
  const photoCredit = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(
    photo?.sourceUrl || "",
  )
    ? photo.sourceUrl
    : null;
  const alias = wiki?.stadiumAlias;
  return (
    <Card fold title="Le club en bref" className="club-facts-card">
      {result.loading ? (
        <Skeleton data-page-loading="" label="Chargement des informations du club…" />
      ) : (
        <>
          <div className="club-facts-grid">
            <div className="club-coach">
              {photoCredit && (photo.author || photo.license) ? (
                // The licence's credit: on the photo (hover), its file page behind it.
                <a
                  href={photoCredit}
                  target="_blank"
                  rel="noreferrer"
                  title={`Photo : ${[photo.author, photo.license].filter(Boolean).join(" · ")}`}
                >
                  <Media
                    name={coach?.name || "?"}
                    url={photo?.url}
                    className="club-coach-photo"
                  />
                </a>
              ) : (
                <Media
                  name={coach?.name || "?"}
                  url={photo?.url}
                  className="club-coach-photo"
                />
              )}
              <div className="club-fact-copy">
                <span className="club-fact-label">Entraîneur</span>
                <strong>{coach?.name || "Non renseigné"}</strong>
                {!isWikiCoach && (
                  <small>
                    {coach
                      ? `Observé le ${date(coach.date)}`
                      : "Aucune donnée disponible"}
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
              {!wiki?.stadium && (
                <small>
                  {stadium
                    ? `Dernier match à domicile · ${date(value.observedStadium.date)}`
                    : "Aucune donnée disponible"}
                </small>
              )}
            </div>
            <div className="club-fact">
              <span className="club-fact-label">Fondation</span>
              <strong>{wiki?.founded || "Non renseignée"}</strong>
              {!wiki?.founded && <small>Aucune donnée disponible</small>}
            </div>
            {more.map((fact) => (
              <div key={fact.label} className="club-fact">
                <span className="club-fact-label">{fact.label}</span>
                <strong>{fact.value}</strong>
                {fact.note && <small>{fact.note}</small>}
              </div>
            ))}
          </div>
          {stadiumOpen && stadium && (
            <StadiumDialog
              name={stadium}
              id={wiki?.stadiumId}
              clubId={club.id}
              onClose={() => setStadiumOpen(false)}
            />
          )}
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
      title="Joueurs"
      action={
        <span className="club-roster-count">
          {number(total)} joueurs · {season}
        </span>
      }
    >
      <p className="club-roster-note">
        Le poste indiqué est le dernier renseigné ; l’effectif affiché peut être
        incomplet.
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
        <p>Aucun joueur disponible pour cette sélection.</p>
      )}
    </Card>
  );
}
