"use client";
import Link from "next/link";
import React from "react";
import Layout from "../components/Layout.jsx";
import { Card } from "../components/UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
export default function MethodPage() {
  const f = useFootball();
  return (
    <Layout path="/methode/" title="Données & méthode">
      <Card title="Couverture de la saison">
        <dl className="data-fields">
          {[
            ["Saison", f.season],
            ["Matchs collectés", number(f.data.matches.length)],
            ["Apparitions", number(f.data.appearances.length)],
            ["Source principale", "PitchAPI"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p>
          Les observations sont conservées dans la base JSON par saison et
          entité. Une valeur absente reste distincte d’un zéro observé. Les
          saisons civiles sont regroupées par année de début.
        </p>
        <p>
          Les notes affichées sont celles de PitchAPI. Le classement Orion, ses
          pondérations par rôle et son agrégation saisonnière restent à calibrer
          et à valider.
        </p>
        <p>
          Les coefficients UEFA des associations mesurent les résultats de leurs
          clubs européens. Ils ne classent pas la force des sélections
          nationales.
        </p>
        <p>
          Les tableaux historiques UEFA ne garantissent pas la valeur connue
          avant chaque match. Les périodes et dates de mise à jour restent
          distinctes.
        </p>
        <Link href="https://github.com/OrionQuantPlatform/Football_Ranking/tree/main/docs">
          Documentation du projet
        </Link>
      </Card>
    </Layout>
  );
}
