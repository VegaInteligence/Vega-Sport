"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { Card, Media, Pager, Segments } from "../components/UI.jsx";
import SeasonSelect from "../components/SeasonSelect.jsx";
import SettingsPicker from "../components/SettingsPicker.jsx";
import RankingSkeleton from "../components/RankingSkeleton.jsx";
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
import { powerRankingTarget } from "../services/preference-effects.js";

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

/** A score out of 100 as a pill, filled from 90 (§ 87). */
function Score({ value, digits = 1, title }) {
  return (
    <span className={`power-score${value >= 90 ? " is-high" : ""}`} title={title}>
      {number(value, digits)}
    </span>
  );
}

/** The first three of a ranking on three cards of one height (§ 87, piste B); `children(row)` is a card's body. */
function TopThree({ rows, label, children }) {
  if (!rows?.length) return null;
  return (
    <ol className="power-top3" role="list" aria-label={label}>
      {rows.slice(0, 3).map((row, index) => (
        <li key={row.playerId || row.teamId} className={`power-top3-card power-top3-${index + 1}`} data-team-id={row.playerId ? undefined : row.teamId}>
          <span className="power-top3-rank" aria-hidden="true">{index + 1}</span>
          {children(row)}
        </li>
      ))}
    </ol>
  );
}

function PlayersTab({ season, role }) {
  const f = useFootball();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [role]);
  const resource = useWholeRanking(season, { page, role });
  const body = resource.value;
  const pages = body ? Math.max(1, Math.ceil(body.total / PLAYERS_PER_PAGE)) : 1;
  // The first page opens on its first three, on cards; the table goes on from the fourth.
  const top = page === 1 && !resource.loading && !resource.error && body?.rows?.length > 3 ? body.rows.slice(0, 3) : null;
  const tableRows = top ? body.rows.slice(3) : body?.rows;
  const head = (
    <thead>
      <tr>
        <th scope="col"><Term>Rang</Term></th>
        <th scope="col"><Term>Joueur</Term></th>
        <th scope="col"><Term>Poste</Term></th>
        <th scope="col"><Term>Club</Term></th>
        <th scope="col" className="power-score-head"><Term hint="Score Vega sur 100 : ce qu’il apporte, corrigé du niveau où il joue. En début de saison, sa saison précédente compte encore un peu.">Score</Term></th>
      </tr>
    </thead>
  );
  const rank = (r) => number(role ? r.roleRank : r.rank);
  return (
    <>
      {top && (
        <TopThree rows={top} label="Les trois premiers">
          {(r) => (
            <>
              <Link className="power-top3-who" href={f.href("/joueurs/", { id: r.playerId })} prefetch={false}>
                <Media name={r.name} url={r.imageUrl} className="player-avatar" />
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.teamImageUrl && <Media name={r.team} url={r.teamImageUrl} />}
                    {r.team || "—"} · {r.position}
                  </small>
                  {r.provisionalReason && (
                    <em className="power-top3-provisional" title="Rang provisoire">
                      {PROVISIONAL_SHORT[r.provisionalReason]}
                    </em>
                  )}
                </span>
              </Link>
              <Score value={r.score} />
            </>
          )}
        </TopThree>
      )}
      <Card title="Classement des joueurs">
        <p className="card-note">
          {body
            ? `${number(body.total)} joueurs classés${role ? " à ce poste" : ""} · un rang provisoire est marqué, avec sa raison`
            : "Tous les joueurs qui ont joué cette saison, classés par leur score Vega"}
        </p>
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
                tableRows.map((r) => (
                  <tr key={r.playerId}>
                    <td className="power-rank">{rank(r)}</td>
                    <td>
                      <Link className="power-ranking-name" href={f.href("/joueurs/", { id: r.playerId })} prefetch={false}>
                        <Media name={r.name} url={r.imageUrl} className="player-avatar" />
                        <span>
                          <strong>{r.name}</strong>
                          {r.provisionalReason && <small title="Rang provisoire">{PROVISIONAL_SHORT[r.provisionalReason]}</small>}
                        </span>
                      </Link>
                    </td>
                    <td className="power-muted">{r.position}</td>
                    <td className="power-club">
                      {r.teamId ? (
                        <Link href={f.href("/clubs/", { id: r.teamId })} prefetch={false}>
                          <Media name={r.team} url={r.teamImageUrl} />
                          {r.team}
                        </Link>
                      ) : (
                        <>
                          <Media name={r.team || ""} url={r.teamImageUrl} />
                          {r.team || "—"}
                        </>
                      )}
                    </td>
                    <td>
                      <Score value={r.score} />
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
  // Effect 12: the table opens at the visitor's country's first club (scrolled to it, nothing added); never
  // after the visitor scrolled, nor with an anchor in the address.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !f.preferencesReady || !resource.value?.length) return;
    scrolled.current = true;
    const target = powerRankingTarget(resource.value, f.preferences?.homeCountry);
    if (!target || window.location.hash || window.scrollY > 0) return;
    document.querySelector(`.power-ranking-page [data-team-id="${target}"]`)?.scrollIntoView({ block: "center" });
  }, [f.preferencesReady, f.preferences?.homeCountry, resource.value]);
  const top = resource.value?.length > 3 ? resource.value.slice(0, 3) : null;
  return (
    <>
    {top && (
      <TopThree rows={top} label="Les trois premiers clubs">
        {(r) => (
          <>
            <Link className="power-top3-who" href={f.href("/clubs/", { id: r.teamId })} prefetch={false}>
              <Media name={r.name} url={r.imageUrl} />
              <span>
                <strong>{r.name}</strong>
                <small>
                  {r.country || "—"} · Elo {number(r.elo, 0)}
                </small>
              </span>
            </Link>
            {r.score == null ? "—" : <Score value={r.score} digits={0} title="Score du club sur 100" />}
          </>
        )}
      </TopThree>
    )}
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
              (top ? resource.value.slice(3) : resource.value).map((r) => (
                <tr key={r.teamId} data-team-id={r.teamId}>
                  <td className="power-rank">{number(r.rank)}</td>
                  <td>
                    <Link className="power-ranking-name" href={f.href("/clubs/", { id: r.teamId })} prefetch={false}>
                      <Media name={r.name} url={r.imageUrl} className="player-avatar" />
                      <strong>{r.name}</strong>
                    </Link>
                  </td>
                  <td>{r.country || "—"}</td>
                  <td>{r.score == null ? "—" : <Score value={r.score} digits={0} title="Score du club sur 100" />}</td>
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
    </>
  );
}

export default function PowerRankingPage() {
  const f = useFootball(),
    seasons = f.manifest?.seasons || [];
  const [tab, setTab] = useUrlState("tab", "players", ["players", "clubs"]);
  const [role, setRole] = useUrlState("role", "", RANKING_ROLES.map(([id]) => id));
  const roleLabel = RANKING_ROLES.find(([id]) => id === role)?.[1] || "Tous les postes";
  // The bar on the title's line (§ 87): the season, and the position for the players.
  const bar = (seasons.length > 1 || tab === "players") && (
    <div className="home-settings power-bar">
      {seasons.length > 1 && (
        <SeasonSelect bare label="Saison" value={f.season} seasons={seasons.map((s) => s.id)} onChange={f.changeSeason} />
      )}
      {tab === "players" && (
        <SettingsPicker pane="role" icon="players" label="Poste" text={roleLabel} value={role} bare>
          {(close) => (
            <div className="home-settings-seasons" role="group" aria-label="Poste">
              {RANKING_ROLES.map(([id, label]) => (
                <button
                  key={id || "all"}
                  type="button"
                  className="home-settings-season"
                  aria-pressed={id === role}
                  onClick={() => {
                    setRole(id);
                    close();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </SettingsPicker>
      )}
    </div>
  );
  return (
    <Layout path="/power-ranking/" title="Power Ranking" className="power-ranking-page" actions={bar} loader={<RankingSkeleton kind="power" />}>
      <div className="power-tabs">
        <Segments label="Classement" value={tab} items={TABS} onChange={setTab} />
      </div>
      {tab === "players" ? <PlayersTab season={f.season} role={role} /> : <ClubsTab season={f.season} />}
    </Layout>
  );
}
