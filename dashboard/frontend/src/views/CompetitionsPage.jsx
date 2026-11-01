"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  Card,
  Media,
  Pager,
  AsyncState,
  Segments,
  Empty,
} from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import { normalizeText, seasonLabel, number } from "../services/format.js";
import { useResource, json, download } from "../services/resources.js";
import { csvString } from "../model.js";
import { dataUrl } from "../data-url.js";
import CompetitionScope from "../components/CompetitionScope.jsx";
import { EUROPE_FOCUS_IDS } from "../../../shared/competition-scope.js";
export function SupplementalPanel({
  data: value,
  id = "",
  kind = "results",
  onId = () => {},
  onKind = () => {},
}) {
  const selected = value.competitions.find((c) => c.folder === id),
    rows = selected?.[kind] || [];
  return (
    <Card title="Autres ligues et coupes">
      <p>
        Saison2026/2027 ou année2026 · Source :{" "}
        <Link href="https://github.com/oladeeayo/open-matchday">
          open-matchday
        </Link>{" "}
        · usage non commercial avec attribution · certains matchs recoupent
        PitchAPI.
      </p>
      <label>
        Compétition
        <select value={id} onChange={(e) => onId(e.target.value)}>
          <option value="">Choisir</option>
          {value.competitions.map((c) => (
            <option key={c.folder} value={c.folder}>
              {c.name || c.folder}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <Segments
            value={kind}
            onChange={onKind}
            label="Données complémentaires"
            items={[
              ["results", "Résultats"],
              ["fixtures", "Calendrier"],
              ["goals", "Buts"],
            ]}
          />
          <button
            className="button button-secondary"
            onClick={() => {
              const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
              download(
                `open-matchday-${id}-${kind}.csv`,
                csvString(
                  keys,
                  rows.map((r) => keys.map((k) => r[k])),
                ),
                "text/csv;charset=utf-8",
              );
            }}
          >
            Exporter CSV
          </button>
          <div className="table-scroll">
            {rows.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    {Object.keys(rows[0]).map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {Object.keys(rows[0]).map((k) => (
                        <td key={k}>
                          {r[k] === null ||
                          r[k] === undefined ||
                          r[k] === "" ? (
                            <span className="missing-value">—</span>
                          ) : (
                            String(r[k])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>Aucune donnée.</Empty>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
function Supplemental() {
  const [id, setId] = useState(""),
    [kind, setKind] = useState("results");
  const result = useResource("supplemental", async () => {
    const index = await json(dataUrl("raw/supplemental-index.json"));
    return {
      meta: index.meta,
      competitions: await Promise.all(
        index.competitions.map(async (c) => {
          const { tables, ...value } = c;
          for (const [name, ref] of Object.entries(tables)) {
            const r = await fetch(dataUrl(ref.path));
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            value[name] = await new Response(
              r.body.pipeThrough(new DecompressionStream("gzip")),
            ).json();
          }
          return value;
        }),
      ),
    };
  });
  return (
    <AsyncState resource={result}>
      {(value) => (
        <SupplementalPanel
          data={value}
          id={id}
          kind={kind}
          onId={setId}
          onKind={setKind}
        />
      )}
    </AsyncState>
  );
}
function Fixtures({ competition, day }) {
  const f = useFootball(),
    [season, setSeason] = useState(
      competition?.seasons?.find((s) => seasonLabel(s) === f.season) ||
        competition?.seasons?.at(-1) ||
        f.season,
    ),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1);
  const resource = useResource(
    `fixtures:${f.client.id}:${competition?.id}:${season}:${day}:${f.configured}`,
    async () => {
      const scoped = Object.assign(Object.create(f.client), {
        browseMode: day ? "day" : "catalog",
        day,
        competitionId: competition?.id,
        season,
      });
      await f.client.loadFixtures.call(scoped);
      const key = day ? `date:${day}` : `${competition.id}:${season}`;
      return scoped.fixtures.get(key);
    },
    f.statusKnown,
  );
  return (
    <Card title={competition?.name || "Calendrier par date"}>
      {!day && (
        <label>
          Saison de compétition
          <select
            aria-label="Saison de compétition"
            value={season}
            onChange={(e) => {
              setSeason(e.target.value);
              const next = seasonLabel(e.target.value);
              if (f.manifest.seasons.some((s) => s.id === next))
                f.changeSeason(next);
              setPage(1);
            }}
          >
            {competition.seasons?.map((s) => (
              <option key={s} value={s}>
                {seasonLabel(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      <Segments
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        label="Statut des rencontres"
        items={[
          ["all", "Tous"],
          ["finished", "Terminés"],
          ["not_started", "À venir"],
        ]}
      />
      <AsyncState resource={resource}>
        {(value) => {
          const rows = value.matches.filter(
              (m) =>
                (status === "all" || m.status === status) &&
                (f.focus !== "europe" ||
                  EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId)),
            ),
            pages = Math.max(1, Math.ceil(rows.length / 30)),
            current = Math.min(page, pages);
          return (
            <>
              {value.error && (
                <p role="status">
                  {value.error} · données collectées affichées.
                </p>
              )}
              {rows.slice((current - 1) * 30, current * 30).map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
              {!rows.length && <Empty>Aucune rencontre collectée.</Empty>}
              <Pager page={current} total={pages} onChange={setPage} />
            </>
          );
        }}
      </AsyncState>
    </Card>
  );
}
export default function CompetitionsPage() {
  const f = useFootball(),
    params = useSearchParams(),
    id = params.get("id"),
    [query, setQuery] = useState(""),
    [country, setCountry] = useState("all"),
    [page, setPage] = useState(1),
    [supplemental, setSupplemental] = useState(false),
    [day, setDay] = useState("");
  const catalog = f.catalog.map((c) => ({
      ...c,
      seasons: [
        ...new Set([
          ...(c.seasons || []),
          ...f.manifest.seasons.flatMap((s) =>
            s.chunks
              .filter((chunk) => chunk.leagueId === c.id)
              .flatMap((chunk) => chunk.meta.seasons || []),
          ),
        ]),
      ]
        .sort()
        .reverse(),
    })),
    selected = catalog.find((c) => c.id === id),
    rows = catalog.filter(
      (c) =>
        (country === "all" || c.country === country) &&
        normalizeText(`${c.name} ${c.country}`).includes(normalizeText(query)),
    ),
    pages = Math.max(1, Math.ceil(rows.length / 24)),
    current = Math.min(page, pages);
  return (
    <Layout path="/competitions/" title="Compétitions">
      {id ? (
        <>
          <Link href={f.href("/competitions/")} className="inline-link">
            ← Toutes les compétitions
          </Link>
          {selected ? (
            <Fixtures competition={selected} />
          ) : (
            <Empty>Compétition inconnue.</Empty>
          )}
        </>
      ) : (
        <>
          <div className="clubs-toolbar">
            <CompetitionScope />
            <input
              type="search"
              placeholder="Rechercher une compétition…"
              aria-label="Rechercher une compétition"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Filtrer par pays"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Tous les pays</option>
              {[...new Set(catalog.map((c) => c.country).filter(Boolean))]
                .sort()
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
            <button
              className="button button-secondary"
              disabled={f.focus === "europe"}
              onClick={() => setSupplemental((v) => !v)}
            >
              Autres ligues et coupes
            </button>
            <label>
              Calendrier par date
              <input
                type="date"
                aria-label="Calendrier par date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          </div>
          {day && <Fixtures key={day} day={day} />}{" "}
          {supplemental && f.focus !== "europe" ? (
            <Supplemental />
          ) : (
            <>
              <div className="competition-grid directory-grid">
                {rows.slice((current - 1) * 24, current * 24).map((c) => (
                  <Link
                    key={c.id}
                    className="competition-card"
                    href={f.href("/competitions/", { id: c.id })}
                  >
                    <div className="competition-card-header">
                      <Media name={c.name} url={c.imageUrl} />
                      <div>
                        <h2>{c.name}</h2>
                        <p>{c.country}</p>
                      </div>
                    </div>
                    <div className="directory-card-footer">
                      <span>{c.seasons?.length || 0} saisons</span>
                      <Icon name="arrow" />
                    </div>
                  </Link>
                ))}
              </div>
              <Pager page={current} total={pages} onChange={setPage} />
            </>
          )}
        </>
      )}
    </Layout>
  );
}
