"use client";
import Link from "next/link";
import Layout from "../components/Layout.jsx";
import CompetitionScope from "../components/CompetitionScope.jsx";
import { Card, AsyncState } from "../components/UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource, json } from "../services/resources.js";
import { EUROPE_FOCUS } from "../../../shared/competition-scope.js";
export default function SettingsPage() {
  const f = useFootball();
  const status = useResource("settings", () => json("/api/settings"));
  return (
    <Layout path="/reglages/" title="Réglages" className="settings-workspace">
      <div className="settings-grid">
        <Card title="Affichage">
          <div className="setting-row">
            <div>
              <h3>Compétitions</h3>
              <span>
                {f.focus === "europe"
                  ? "7 championnats · 3 coupes UEFA"
                  : "Toutes les compétitions"}
              </span>
            </div>
            <CompetitionScope />
          </div>
          <div className="setting-row">
            <label htmlFor="default-season">Saison au démarrage</label>
            <select
              id="default-season"
              value={f.preferences.defaultSeason}
              onChange={(e) =>
                f.savePreferences({ defaultSeason: e.target.value })
              }
            >
              <option value="">Saison en cours</option>
              {f.manifest.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-competitions">
            {EUROPE_FOCUS.map((c) => (
              <span key={c.id}>
                <small>{c.country}</small>
                {c.name}
              </span>
            ))}
          </div>
          <span className="settings-save-state">
            <span className="status-dot" />
            Préférences enregistrées sur cet appareil
          </span>
        </Card>
        <AsyncState resource={status}>
          {(value) => (
            <Card title="Collecte des données">
              <dl className="settings-status">
                <div>
                  <dt>Source</dt>
                  <dd>{value.provider}</dd>
                </div>
                <div>
                  <dt>Connexion serveur</dt>
                  <dd>
                    <span
                      className={`connection-state ${value.configured ? "connected" : ""}`}
                    >
                      {value.configured ? "Configurée" : "Non configurée"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Prochaine collecte</dt>
                  <dd>00:00 · Paris</dd>
                </div>
                <div>
                  <dt>Fréquence</dt>
                  <dd>Tous les jours</dd>
                </div>
                <div>
                  <dt>Dernière collecte réussie</dt>
                  <dd>
                    {value.sync?.completedAt
                      ? new Intl.DateTimeFormat("fr-FR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Europe/Paris",
                        }).format(new Date(value.sync.completedAt))
                      : "Pas encore exécutée"}
                  </dd>
                </div>
                <div>
                  <dt>Saison collectée</dt>
                  <dd>{value.sync?.season || f.manifest.defaultSeason}</dd>
                </div>
                {value.sync && (
                  <div>
                    <dt>Matchs actualisés</dt>
                    <dd>{value.sync.matchesUpdated}</dd>
                  </div>
                )}
                {value.revision && (
                  <div>
                    <dt>Version publiée</dt>
                    <dd>
                      <code>{value.revision}</code>
                    </dd>
                  </div>
                )}
              </dl>
              <Link
                className="button button-secondary"
                href={value.workflowUrl}
                target="_blank"
                rel="noreferrer"
              >
                Historique des collectes ↗
              </Link>
            </Card>
          )}
        </AsyncState>
      </div>
    </Layout>
  );
}
