"use client";
import React, { useState } from "react";
import { Modal, AsyncState } from "./UI.jsx";
import { useResource, json } from "../services/resources.js";
import { number } from "../services/format.js";
import StadiumMap from "./StadiumMap.jsx";
import ApiImage from "./ApiImage.jsx";
import { apiUrl } from "../data-url.js";

function stadiumDate(value) {
  if (!value) return "Non renseignée";
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return "Non renseignée";
  const options = { year: "numeric", timeZone: "UTC" };
  if (match[2]) options.month = "long";
  if (match[3]) options.day = "numeric";
  return new Intl.DateTimeFormat("fr-FR", options).format(
    new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2] || 1) - 1,
        Number(match[3] || 1),
      ),
    ),
  );
}

function PlanImage({ plan }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="stadium-plan-unavailable" role="status">
        L’aperçu est indisponible.{" "}
        <a href={plan.url} target="_blank" rel="noopener noreferrer">
          Consulter le site officiel ↗
        </a>
      </p>
    );
  }
  return (
    <a
      className="stadium-plan-image-link"
      href={`/api/assets?url=${encodeURIComponent(plan.imageUrl)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Agrandir le plan des tribunes"
    >
      <ApiImage
        className="stadium-plan-image"
        src={apiUrl(`/api/assets?url=${encodeURIComponent(plan.imageUrl)}`)}
        alt="Plan des tribunes"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function StadiumPlans({ plans }) {
  return (
    <section className="stadium-plans">
      <h3>Plans officiels</h3>
      {plans.length ? (
        <>
          <p>Plans et vues des tribunes.</p>
          <ul className="stadium-plan-list">
            {plans.map((plan) => (
              <li key={plan.url}>
                {plan.embedded || plan.imageUrl ? (
                  <div className="stadium-embedded-plan">
                    <div className="stadium-embedded-heading">
                      <div className="stadium-plan-copy">
                        <strong>{plan.title}</strong>
                        <small>{plan.detail}</small>
                      </div>
                      <div className="stadium-embedded-actions">
                        <a
                          href={plan.imageUrl || plan.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ouvrir en grand <span aria-hidden="true">↗</span>
                        </a>
                      </div>
                    </div>
                    {plan.imageUrl ? (
                      <PlanImage plan={plan} />
                    ) : (
                      <iframe
                        className="stadium-official-frame"
                        src={plan.url}
                        title={plan.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        allow={
                          plan.allowGeolocation ? "geolocation" : undefined
                        }
                        allowFullScreen
                      />
                    )}
                  </div>
                ) : (
                  <a
                    className="stadium-plan-link"
                    href={plan.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${plan.title}, ouvre un nouvel onglet`}
                  >
                    <span className="stadium-plan-format">{plan.format}</span>
                    <span className="stadium-plan-copy">
                      <strong>{plan.title}</strong>
                      <small>{plan.detail}</small>
                    </span>
                    <span className="stadium-plan-open">
                      Ouvrir <span aria-hidden="true">↗</span>
                    </span>
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p>Les secteurs peuvent varier selon le match ou les travaux.</p>
        </>
      ) : (
        <p>Pas encore de plan officiel référencé pour ce stade.</p>
      )}
    </section>
  );
}

export default function StadiumDialog({ name, id, onClose }) {
  const resource = useResource(
    `stadium:${id || "unknown"}`,
    () => json(`/api/stadium?id=${encodeURIComponent(id)}`),
    Boolean(id),
  );
  return (
    <Modal title={name} onClose={onClose} className="stadium-dialog">
      {!id ? (
        <p>
          Les informations détaillées de ce stade ne sont pas encore
          disponibles.
        </p>
      ) : (
        <AsyncState resource={resource}>
          {(stadium) => (
            <>
              <StadiumPlans plans={stadium.plans || []} />
              <div className="stadium-overview">
                <div className="stadium-capacity">
                  <span>Capacité maximale référencée</span>
                  <strong>
                    {stadium.capacity == null
                      ? "Non renseignée"
                      : number(stadium.capacity)}
                  </strong>
                  {stadium.capacity != null && <span>places</span>}
                  {stadium.capacityAsOf && (
                    <small>
                      Valeur datée du {stadiumDate(stadium.capacityAsOf)}
                    </small>
                  )}
                </div>
                <dl className="stadium-dates">
                  <div>
                    <dt>Création</dt>
                    <dd>{stadiumDate(stadium.created)}</dd>
                  </div>
                  <div>
                    <dt>Ouverture</dt>
                    <dd>{stadiumDate(stadium.opened)}</dd>
                  </div>
                </dl>
              </div>
              <p className="stadium-capacity-note">
                La capacité référencée peut différer des places disponibles
                selon les travaux ou les événements.
              </p>
              <section className="stadium-location">
                <div className="stadium-location-heading">
                  <div>
                    <h3>Autour du stade en 3D</h3>
                    <p>
                      Déplacez et inclinez la carte pour explorer les environs.
                    </p>
                  </div>
                </div>
                {stadium.coordinates ? (
                  <>
                    <StadiumMap name={name} coordinates={stadium.coordinates} />
                    <p className="stadium-map-note">
                      Les volumes sont simplifiés et dépendent des données
                      disponibles ; le stade peut ne pas être modélisé en
                      détail.
                    </p>
                  </>
                ) : (
                  <p className="stadium-map-empty">
                    Les coordonnées ne sont pas disponibles pour ce stade.
                  </p>
                )}
              </section>
            </>
          )}
        </AsyncState>
      )}
    </Modal>
  );
}
