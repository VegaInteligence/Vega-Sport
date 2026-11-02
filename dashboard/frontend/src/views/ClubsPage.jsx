"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useDeferredValue, useState, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Media } from "../components/UI.jsx";
import { ProfileDialog } from "../components/PlayerDetails.jsx";
import ClubRanking from "../components/ClubRanking.jsx";
import { ClubFacts, ClubRoster } from "../components/ClubProfile.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import { normalizeText, number } from "../services/format.js";
export default function ClubsPage() {
  const f = useFootball(),
    [query, setQuery] = useState(""),
    [profile, setProfile] = useState(false);
  const id = useSearchParams().get("id");
  const clubs = useMemo(() => {
    const map = new Map();
    for (const m of f.data.matches)
      for (const side of ["home", "away"]) {
        const t = m[side];
        if (!map.has(t.id)) map.set(t.id, { ...t, league: m.league, count: 0 });
        const club = map.get(t.id);
        if (
          !club.country &&
          /^[A-Z]{3}$/.test(m.country || "") &&
          !["INT", "EUR"].includes(m.country)
        )
          club.country = m.country;
        club.count++;
      }
    return [...map.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((club) => ({ ...club, search: normalizeText(club.name) }));
  }, [f.data]);
  // The whole directory is listed; the search filters it without blocking
  // the keystroke.
  const search = normalizeText(useDeferredValue(query)),
    selected = clubs.find((c) => c.id === id),
    visible = useMemo(
      () => clubs.filter((c) => c.search.includes(search)),
      [clubs, search],
    ),
    // The first screens paint at once; the rest of the list follows in a
    // background render.
    complete = useDeferredValue(true, false),
    shown = complete ? visible : visible.slice(0, 120);
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
          <ClubFacts
            club={selected}
            matches={f.data.matches.filter(
              (m) => m.home.id === id || m.away.id === id,
            )}
          />
          <ClubRanking clubId={id} />
          <ClubRoster
            clubId={id}
            appearances={f.data.appearances}
            href={f.href}
            season={f.season}
          />
          <Card title="Matchs du club">
            {f.data.matches
              .filter((m) => m.home.id === id || m.away.id === id)
              .map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
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
              onChange={(e) => setQuery(e.target.value)}
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
            {shown.map((c) => (
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
        </>
      )}
    </Layout>
  );
}
