"use client";
import React from "react";
import { Modal, AsyncState } from "./UI.jsx";
import { useResource, json } from "../services/resources.js";
import { number } from "../services/format.js";
import StadiumMap from "./StadiumMap.jsx";

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
                      Carte OpenStreetMap / OpenMapTiles / OpenFreeMap. Les
                      volumes sont simplifiés et dépendent des données
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
