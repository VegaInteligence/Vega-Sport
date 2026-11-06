"use client";
import Link from "next/link";
import React from "react";
import Layout from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
export default function MethodPage() {
  const f = useFootball();
  return (
    <Layout path="/methode/" title="Données & méthode">
      <div className="method-layout">
        <article className="method-prose">
          <section>
            <h2>Données</h2>
            <p>
              Les observations sont conservées dans PostgreSQL sur AWS, par saison et entité.
              Une valeur absente reste distincte d’un zéro observé. Les saisons
              civiles sont regroupées par année de début.
            </p>
          </section>
          <section>
            <h2>Notes et classement</h2>
            <p>
              Les notes affichées sont les notes de match. Le classement
              STATARENA, ses pondérations par rôle et son agrégation saisonnière
              restent à calibrer et à valider.
            </p>
          </section>
          <section>
            <h2>Coefficients UEFA</h2>
            <p>
              Les coefficients UEFA des associations mesurent les résultats de
              leurs clubs européens. Ils ne classent pas la force des sélections
              nationales.
            </p>
            <p>
              Les tableaux historiques UEFA ne garantissent pas la valeur connue
              avant chaque match. Les périodes et dates de mise à jour restent
              distinctes.
            </p>
          </section>
          {/* Credits that the data licences require; the only place they appear. */}
          <section>
            <h2>Licences</h2>
            <p>
              Certaines archives sont réutilisées sous licence :{" "}
              <a href="https://www.openligadb.de/">OpenLigaDB</a> (
              <a href="https://opendatacommons.org/licenses/odbl/1-0/">
                ODbL 1.0
              </a>
              ),{" "}
              <a href="https://github.com/schochastics/football-data">
                schochastics/football-data
              </a>{" "}
              (
              <a href="https://opendatacommons.org/licenses/by/1-0/">
                ODC-BY 1.0
              </a>
              ),{" "}
              <a href="https://github.com/jalapic/engsoccerdata">
                engsoccerdata
              </a>{" "}
              et{" "}
              <a href="https://github.com/oladeeayo/open-matchday">
                open-matchday
              </a>{" "}
              (usage non commercial avec attribution). Les titres de joueurs
              disponibles proviennent aussi de{" "}
              <a href="https://www.thesportsdb.com/">TheSportsDB</a>. Fonds de
              carte ©{" "}
              <a href="https://www.openstreetmap.org/copyright">
                contributeurs OpenStreetMap
              </a>
              .
            </p>
            <p>
              <a href="https://github.com/OrionQuantPlatform/STATARENA/blob/main/docs/TROPHY_IMAGE_CREDITS.md">
                Crédits des images de trophées
              </a>
            </p>
            <p>
              Drapeaux :{" "}
              <a href="https://github.com/lipis/flag-icons">flag-icons</a>,
              Panayiotis Lipiridis (
              <a href="/flag-icons-LICENSE.txt">licence MIT</a>).
            </p>
          </section>
          <Link
            className="inline-link"
            href="https://github.com/OrionQuantPlatform/STATARENA/tree/main/docs"
          >
            Documentation du projet <Icon name="external" />
          </Link>
        </article>
        <aside
          className="card method-coverage"
          aria-label="Couverture de la saison"
        >
          <div className="card-header">
            <h2 className="card-title">Couverture de la saison</h2>
          </div>
          <dl className="method-figures">
            {[
              ["Saison", f.season],
              ["Matchs collectés", number(f.data.matches.length)],
              ["Apparitions", number(f.data.appearances.length)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </Layout>
  );
}
