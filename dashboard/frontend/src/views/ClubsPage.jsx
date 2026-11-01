"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Media, Pager } from "../components/UI.jsx";
import { ProfileDialog } from "../components/PlayerDetails.jsx";
import ClubRanking from "../components/ClubRanking.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import { normalizeText, number } from "../services/format.js";
export default function ClubsPage() {
  const f = useFootball(),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [profile, setProfile] = useState(false);
  const id = useSearchParams().get("id");
  const clubs = useMemo(() => {
    const map = new Map();
    for (const m of f.data.matches)
      for (const side of ["home", "away"]) {
        const t = m[side];
        if (!map.has(t.id)) map.set(t.id, { ...t, league: m.league, count: 0 });
        map.get(t.id).count++;
      }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [f.data]);
  const selected = clubs.find((c) => c.id === id),
    visible = clubs.filter((c) =>
      normalizeText(c.name).includes(normalizeText(query)),
    ),
    pages = Math.max(1, Math.ceil(visible.length / 24)),
    current = Math.min(page, pages);
  return (
    <Layout path="/clubs/" title={selected ? selected.name : "Clubs"}>
      {selected ? (
        <>
          <Link className="inline-link" href={f.href("/clubs/")}>
            ← Tous les clubs
          </Link>
          <Card
            title={selected.name}
            action={
              <button
                className="button button-secondary"
                onClick={() => setProfile(true)}
              >
                Fiche PitchAPI
              </button>
            }
          >
            <div className="club-identity">
              <Media
                name={selected.name}
                url={selected.imageUrl}
                className="crest club-logo"
              />
              <p>
                {selected.league} · {number(selected.count)} matchs
              </p>
            </div>
          </Card>
          <ClubRanking clubId={id} />
          <Card title="Matchs du club">
            {f.data.matches
              .filter((m) => m.home.id === id || m.away.id === id)
              .map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
          </Card>
          <Card title="Joueurs référencés">
            <div className="club-roster">
              {[
                ...new Map(
                  f.data.appearances
                    .filter((r) => r.teamId === id)
                    .map((r) => [r.playerId, r]),
                ).values(),
              ].map((r) => (
                <Link
                  className="roster-player"
                  key={r.playerId}
                  href={f.href("/joueurs/", { id: r.playerId })}
                >
                  <Media
                    name={r.name}
                    url={r.imageUrl}
                    className="player-avatar"
                  />
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.position || ""}</small>
                  </span>
                </Link>
              ))}
            </div>
          </Card>
          {profile && (
            <ProfileDialog
              id={id}
              kind="teams"
              onClose={() => setProfile(false)}
            />
          )}
        </>
      ) : (
        <>
          <div className="clubs-toolbar">
            <input
              placeholder="Rechercher un club…"
              type="search"
              aria-label="Rechercher un club"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <span>{visible.length} clubs</span>
            <label>
              Saison
              <select
                aria-label="Saison"
                value={f.season}
                onChange={(e) => f.changeSeason(e.target.value)}
              >
                {f.manifest.seasons.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="competition-grid directory-grid">
            {visible.slice((current - 1) * 24, current * 24).map((c) => (
              <Link
                className="competition-card"
                key={c.id}
                href={f.href("/clubs/", { id: c.id })}
              >
                <div className="competition-card-header">
                  <Media name={c.name} url={c.imageUrl} />
                  <div>
                    <h2>{c.name}</h2>
                    <p>{c.league}</p>
                  </div>
                </div>
                <div className="directory-card-footer">
                  <span>{number(c.count)} matchs</span>
                  <Icon name="arrow" />
                </div>
              </Link>
            ))}
          </div>
          <Pager page={current} total={pages} onChange={setPage} />
        </>
      )}
    </Layout>
  );
}
