"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { Card, Media, Pager, Segments } from "../components/UI.jsx";
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

const TABS = [
  ["players", "Joueurs"],
  ["clubs", "Clubs"],
];
const UNIVERSES = [
  ["men", "Hommes"],
  ["women", "Femmes"],
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
  const [universe, setUniverse] = useUrlState("universe", "men", ["men", "women"]);
  const [role, setRole] = useUrlState("role", "", RANKING_ROLES.map(([id]) => id));
  const [page, setPage] = useState(1);
  const resource = useWholeRanking(season, { page, role, universe });
  const body = resource.value;
  const pages = body ? Math.max(1, Math.ceil(body.total / PLAYERS_PER_PAGE)) : 1;
  const head = (
    <thead>
      <tr>
        <th scope="col">Rang</th>
        <th scope="col">Joueur</th>
        <th scope="col">Poste</th>
        <th scope="col">Club</th>
        <th scope="col" title="Score Vega de la saison sur 100">Score</th>
      </tr>
    </thead>
  );
  return (
    <>
      <div className="match-section-toolbar">
        <Segments label="Classement" value={universe} items={UNIVERSES} onChange={(v) => (setUniverse(v), setPage(1))} />
        <Segments label="Poste" value={role} items={RANKING_ROLES} onChange={(v) => (setRole(v), setPage(1))} />
      </div>
      <Card
        title="Classement des joueurs"
        text={
          body
            ? `${number(body.total)} joueurs classés${role ? " à ce poste" : ""} · un rang provisoire est marqué, avec sa raison`
            : "Tous les joueurs qui ont joué cette saison, classés par leur score Vega"
        }
      >
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
    <Card title="Classement des clubs" text="Force de chaque club, mesurée par son Elo sur tous ses matchs ; la variation porte sur la saison">
      <div className="table-scroll">
        <table className="data-table power-ranking-table">
          <thead>
            <tr>
              <th scope="col">Rang</th>
              <th scope="col">Club</th>
              <th scope="col">Pays</th>
              <th scope="col">Elo</th>
              <th scope="col">Variation</th>
              <th scope="col">Matchs</th>
            </tr>
          </thead>
          <tbody>
            {resource.loading ? (
              <SkeletonRows columns={6} />
            ) : !resource.value?.length ? (
              <tr>
                <td colSpan={6}>{resource.error || "Aucun classement publié pour cette saison."}</td>
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
                  <td>
                    <strong>{number(r.elo, 0)}</strong>
                  </td>
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
