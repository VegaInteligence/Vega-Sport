"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { Card, Grade, Media, Pager, Segments } from "../components/UI.jsx";
import SeasonSelect from "../components/SeasonSelect.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import {
  PLAYERS_PER_PAGE,
  PROVISIONAL_SHORT,
  RANKING_ROLES,
  useClubRanking,
  useWholeRanking,
} from "../services/power-ranking.js";
import { Term } from "../components/Hint.jsx";

const TABS = [
  ["players", "Joueurs"],
  ["clubs", "Clubs"],
];

/** The page's state lives in its URL, so a view can be shared. */
function useUrlState(key, fallback, allowed) {
  const params = useSearchParams();
  const initial = params.get(key);
  const [value, setValue] = useState(allowed.includes(initial) ? initial : fallback);
  const set = (next) => {
    setValue(next);
    const url = new URL(window.location.href);
    if (next === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, next);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  return [value, set];
}

/** Rows standing in for a page of the ranking while it loads. */
function SkeletonRows({ count = 12, columns = 5 }) {
  return Array.from({ length: count }, (_, i) => (
    <tr key={i} aria-hidden="true">
      {Array.from({ length: columns }, (_, j) => (
        <td key={j}>
          <span className="skeleton-line" style={{ width: j === 1 ? "70%" : "45%" }} />
        </td>
      ))}
    </tr>
  ));
}

function PlayersTab({ season }) {
  const f = useFootball();
  const [role, setRole] = useUrlState("role", "", RANKING_ROLES.map(([id]) => id));
  const [page, setPage] = useState(1);
  const resource = useWholeRanking(season, { page, role });
  const body = resource.value;
  const pages = body ? Math.max(1, Math.ceil(body.total / PLAYERS_PER_PAGE)) : 1;
  const head = (
    <thead>
      <tr>
        <th scope="col"><Term>Rang</Term></th>
        <th scope="col"><Term>Joueur</Term></th>
        <th scope="col"><Term>Poste</Term></th>
        <th scope="col"><Term>Club</Term></th>
        <th scope="col"><Term hint="Score Vega sur 100 : ce qu’il apporte, corrigé du niveau où il joue. En début de saison, sa saison précédente compte encore un peu.">Score</Term></th>
      </tr>
    </thead>
  );
  return (
    <>
      <div className="match-section-toolbar">
        <Segments label="Poste" value={role} items={RANKING_ROLES} onChange={(v) => (setRole(v), setPage(1))} />
      </div>
      <Card
        title="Classement des joueurs"
      >
        {(
          body
            ? `${number(body.total)} joueurs classés${role ? " à ce poste" : ""} · un rang provisoire est marqué, avec sa raison`
            : "Tous les joueurs qui ont joué cette saison, classés par leur score Vega"
        ) && <p className="card-note">{
          body
            ? `${number(body.total)} joueurs classés${role ? " à ce poste" : ""} · un rang provisoire est marqué, avec sa raison`
            : "Tous les joueurs qui ont joué cette saison, classés par leur score Vega"
        }</p>}
        <div className="table-scroll">
          <table className="data-table power-ranking-table">
            {head}
            <tbody>
              {resource.loading ? (
                <SkeletonRows columns={5} />
              ) : resource.error ? (
                <tr>
                  <td colSpan={5}>
                    {resource.error}{" "}
                    <button className="button button-secondary" onClick={resource.retry}>
                      Réessayer
                    </button>
                  </td>
                </tr>
              ) : !body?.rows?.length ? (
                <tr>
                  <td colSpan={5}>Aucun classement publié pour cette sélection.</td>
                </tr>
              ) : (
                body.rows.map((r) => (
                  <tr key={r.playerId}>
                    <td>{number(role ? r.roleRank : r.rank)}</td>
                    <td>
                      <Link className="power-ranking-name" href={f.href("/joueurs/", { id: r.playerId })} prefetch={false}>
                        <Media name={r.name} url={r.imageUrl} className="player-avatar" />
                        <span>
                          <strong>{r.name}</strong>
                          {r.provisionalReason && <small title="Rang provisoire">{PROVISIONAL_SHORT[r.provisionalReason]}</small>}
                        </span>
                      </Link>
                    </td>
                    <td>{r.position}</td>
                    <td>
                      {r.teamId ? (
                        <Link href={f.href("/clubs/", { id: r.teamId })} prefetch={false}>
                          {r.team}
                        </Link>
                      ) : (
                        r.team || "—"
                      )}
                    </td>
                    <td>
                      <strong>{number(r.score, 1)}</strong>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={pages} onChange={setPage} label="Pages du classement" />
      </Card>
    </>
  );
}

function ClubsTab({ season }) {
  const f = useFootball();
  const resource = useClubRanking(season);
  return (
    <Card title="Classement des clubs">
      <p className="card-note">
        Force de chaque club, mesurée par son Elo sur tous ses matchs ; la variation porte sur la saison. Le score sur 100 est sa
        chance de battre un club moyen des premières divisions mesurées sur terrain neutre, un nul comptant pour moitié.
      </p>
      <div className="table-scroll">
        <table className="data-table power-ranking-table">
          <thead>
            <tr>
              <th scope="col"><Term>Rang</Term></th>
              <th scope="col"><Term>Club</Term></th>
              <th scope="col"><Term>Pays</Term></th>
              <th scope="col"><Term hint="Force du club (Elo) ramenée sur 100.">Score</Term></th>
              <th scope="col"><Term>Elo</Term></th>
              <th scope="col"><Term>Variation</Term></th>
              <th scope="col"><Term>Matchs</Term></th>
            </tr>
          </thead>
          <tbody>
            {resource.loading ? (
              <SkeletonRows columns={7} />
            ) : !resource.value?.length ? (
              <tr>
                <td colSpan={7}>{resource.error || "Aucun classement publié pour cette saison."}</td>
              </tr>
            ) : (
              resource.value.map((r) => (
                <tr key={r.teamId}>
                  <td>{number(r.rank)}</td>
                  <td>
                    <Link className="power-ranking-name" href={f.href("/clubs/", { id: r.teamId })} prefetch={false}>
                      <Media name={r.name} url={r.imageUrl} className="player-avatar" />
                      <strong>{r.name}</strong>
                    </Link>
                  </td>
                  <td>{r.country || "—"}</td>
                  <td>{r.score == null ? "—" : <Grade value={r.score} title="Score du club sur 100" />}</td>
                  <td>{number(r.elo, 0)}</td>
                  <td>{r.eloChange == null ? "—" : `${r.eloChange > 0 ? "+" : ""}${number(r.eloChange, 0)}`}</td>
                  <td>{number(r.matches)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function PowerRankingPage() {
  const f = useFootball(),
    seasons = f.manifest?.seasons || [];
  const [tab, setTab] = useUrlState("tab", "players", ["players", "clubs"]);
  return (
    <Layout path="/power-ranking/" title="Power Ranking">
      <div className="match-section-toolbar">
        <Segments label="Classement" value={tab} items={TABS} onChange={setTab} />
        {seasons.length > 1 && (
          <SeasonSelect label="Saison" value={f.season} seasons={seasons.map((s) => s.id)} onChange={f.changeSeason} />
        )}
      </div>
      {tab === "players" ? <PlayersTab season={f.season} /> : <ClubsTab season={f.season} />}
    </Layout>
  );
}
