"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import "flag-icons/css/flag-icons.min.css";
import Layout from "../../../src/components/Layout.jsx";
import { ResearchTabs } from "../../../src/components/ResearchUI.jsx";
import { chartTokens } from "./charts.jsx";
import s from "./ui.module.css";

const VERSIONS = [
  ["/maquettes/joueur-a", "A · Fiche scout"],
  ["/maquettes/joueur-b", "B · Console analyste"],
  ["/maquettes/joueur-c", "C · Fiche scout augmentée"],
];

/** The real site frame (header, workspace) around a mock-up page. */
export function MockShell({ version, title, children, className = "" }) {
  return (
    <Layout
      path="/joueurs/"
      title="Joueurs"
      hideHeading
      performanceComparison={false}
    >
      <div className={`${chartTokens} ${s.shell} ${className}`}>
        <div className={s.banner} role="note">
          <span>
            <strong>Maquette {version}</strong> · {title} · données de saison
            réelles, centiles, physique et marché fictifs
          </span>
          <nav aria-label="Versions de la maquette">
            <Link href="/maquettes">Sommaire</Link>
            {VERSIONS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={label.startsWith(version) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {children}
      </div>
    </Layout>
  );
}

export function Avatar({ src, name, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      className={s.avatar}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

export function Crest({ src, size = 20, alt = "" }) {
  if (!src) return null;
  return (
    <img className={s.crest} src={src} alt={alt} width={size} height={size} />
  );
}

export function Flag({ code, title }) {
  return (
    <span
      className={`fi fi-${code} ${s.flag}`}
      title={title}
      aria-hidden={title ? undefined : "true"}
    />
  );
}

/** Tab state mirrored in `?onglet=` without a navigation. */
export function useTab(items, fallback = items[0][0]) {
  const [tab, setTab] = useState(fallback);
  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get("onglet");
    if (requested && items.some(([key]) => key === requested))
      setTab(requested);
  }, [items]);
  const change = useCallback((next) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("onglet", next);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);
  return [tab, change];
}

export function Tabs({ label, items, value, onChange, panelId }) {
  return (
    <ResearchTabs
      animated
      label={label}
      value={value}
      items={items}
      onChange={onChange}
      panelId={panelId}
    />
  );
}

export function MockIndex() {
  return (
    <Layout
      path="/joueurs/"
      title="Maquettes de la page joueur"
      performanceComparison={false}
    >
      <p className={s.intro}>
        Trois propositions pour la page joueur et ses sous-onglets, construites
        dans le cadre réel du site (en-tête, typographie, thèmes clair et
        sombre). Les trois pages utilisent le même jeu de données pour comparer
        uniquement l’organisation et la lecture.
      </p>
      <div className={s.index}>
        <Link className={s.option} href="/maquettes/joueur-a">
          <span className={s.optionLabel}>Version A</span>
          <h2>Fiche scout</h2>
          <p>
            Une lecture éditoriale, du résumé vers le détail. L’identité et les
            faits clés restent à gauche ; les onglets racontent le joueur comme
            un rapport de recrutement.
          </p>
          <ul>
            <li>
              Colonne d’identité fixe : valeur, contrat, postes, disponibilité
            </li>
            <li>
              Vue d’ensemble avec centiles, indice Vega par rôle, forces et
              faiblesses
            </li>
            <li>
              Onglets : statistiques, physique, comparaison, similaires,
              carrière, projection, matchs
            </li>
          </ul>
          <span className={s.optionCta}>Ouvrir la version A →</span>
        </Link>
        <Link className={s.option} href="/maquettes/joueur-b">
          <span className={s.optionLabel}>Version B</span>
          <h2>Console analyste</h2>
          <p>
            Un poste de travail dense pour comparer à un référentiel. Un bandeau
            d’identité compact, une barre de contexte unique (poste évalué,
            référentiel, échantillon) et une navigation latérale.
          </p>
          <ul>
            <li>
              Empreinte du rôle et distribution du championnat (P10 à P90)
            </li>
            <li>
              Télémétrie en quatre piliers : technique, tactique, physique,
              mental
            </li>
            <li>
              Comparaison côte à côte, carrière et marché, projection par
              championnat
            </li>
          </ul>
          <span className={s.optionCta}>Ouvrir la version B →</span>
        </Link>
        <Link className={s.option} href="/maquettes/joueur-c">
          <span className={s.optionLabel}>Version C</span>
          <h2>Fiche scout augmentée</h2>
          <p>
            La structure de la version A, enrichie des outils d’analyse de la
            version B : un onglet Stats avancées avec son propre référentiel et
            les blocs marché, compétitions et comparaison côte à côte.
          </p>
          <ul>
            <li>
              Stats avancées : empreinte du rôle, télémétrie en quatre piliers,
              distribution complète P10 à P90
            </li>
            <li>
              Physique en distributions, carrière avec marché et faisabilité,
              matchs par compétition
            </li>
            <li>
              Comparaison en radar ou côte à côte, bandeau d’identité compact au
              défilement
            </li>
          </ul>
          <span className={s.optionCta}>Ouvrir la version C →</span>
        </Link>
      </div>
    </Layout>
  );
}
