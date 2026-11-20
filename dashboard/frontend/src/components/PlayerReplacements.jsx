"use client";
/* « Remplaçant » on /joueurs (VI-39, mock-up validated 20 Nov 2026): a reference player, the
   players whose season profile is the closest, filtered by age and value, and a comparison of
   the one selected with the reference. The reference is in the URL (`replace`). */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useId, useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { searchIdentities } from "../services/global-search-client.js";
import {
  AGE_FILTERS,
  AXES,
  money,
  REPLACEMENT_SORTS,
  sortCandidates,
  usePlayerReplacements,
  VALUE_FILTERS,
} from "../services/player-replacements.js";
import { BookmarkButton, ComparePlayerButton } from "./ResearchUI.jsx";
import { Empty, Grade, Media, Skeleton } from "./UI.jsx";
import s from "./PlayerReplacements.module.css";

export function ChipGroup({ label, value, items, onChange }) {
  return (
    <div role="group" aria-label={label} className={s.group}>
      <span className={s.groupLabel} aria-hidden="true">
        {label}
      </span>
      <div className="segmented-control">
        {items.map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const subtitle = (p) => [p.position, p.team?.name].filter(Boolean).join(" · ");

function setReference(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("replace", id);
  window.history.replaceState(null, "", url.pathname + url.search);
}

function ReferenceSearch({ season, onPick }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState([]),
    [active, setActive] = useState(0),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const listId = useId();
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchIdentities(query, season, { signal: controller.signal })
        .then((body) => {
          setResults(body.players);
          setActive(0);
          setError("");
          setOpen(true);
        })
        .catch((e) => e.name !== "AbortError" && setError(e.message));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, season]);
  const pick = (player) => {
    onPick(player.id);
    setQuery("");
    setResults([]);
    setOpen(false);
  };
  return (
    <div className={s.search}>
      <input
        role="combobox"
        aria-label="Joueur à remplacer"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results[active] ? `${listId}-${active}` : undefined
        }
        placeholder="Autre joueur…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown")
            setActive((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter" && results[active]) pick(results[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && results.length > 0 && (
        <ul role="listbox" id={listId} className={s.options}>
          {results.map((player, i) => (
            <li
              key={player.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(player);
              }}
            >
              <Media
                name={player.name}
                url={player.image_url}
                className="crest"
              />
              <span>
                <strong>{player.name}</strong>
                {player.team && <small>{player.team}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

function Delta({ value, unit = "", better }) {
  if (!Number.isFinite(value)) return null;
  const tone =
    Math.abs(value) < 0.5
      ? s.flat
      : (better === "lower" ? value < 0 : value > 0)
        ? s.good
        : s.bad;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return (
    <span className={`${s.delta} ${tone}`}>
      {sign}
      {Math.abs(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
      {unit}
    </span>
  );
}

const COMPONENTS = [
  ["profile", "Profil"],
  ["role", "Rôle dans l’équipe"],
  ["style", "Style de club"],
  ["defense", "Travail défensif"],
  ["effort", "Effort"],
  ["discipline", "Discipline"],
];
const SHARES = [
  ["touches", "Ballons touchés"],
  ["passes", "Passes"],
  ["finalThird", "Passes dernier tiers"],
  ["chances", "Occasions créées"],
  ["shots", "Tirs"],
  ["defensive", "Actions défensives"],
];
const STYLE = [
  ["possession", "Possession"],
  ["fieldTilt", "Territoire"],
  ["directness", "Jeu direct"],
  ["ppda", "Pressing"],
  ["crosses", "Centres"],
];
const fmt = (value, digits = 0, unit = "") =>
  value == null
    ? "—"
    : `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`;

/** Reference against candidate, one row per figure, bars on a common scale. */
function Pairs({ rows, refName, candName }) {
  const shown = rows.filter(([, a, b]) => a != null || b != null);
  if (!shown.length) return <p className={s.detailEmpty}>—</p>;
  return (
    <div className={s.axes}>
      <p className={s.legend}>
        <span className={s.legendRef}>{refName}</span>
        <span className={s.legendCand}>{candName}</span>
      </p>
      {shown.map(([label, a, b, text, max = 100]) => (
        <div key={label} className={s.pair}>
          <span>{label}</span>
          <span className={s.bars}>
            <i
              className={s.barRef}
              style={{ "--w": `${Math.min(100, (100 * (a ?? 0)) / max)}%` }}
            />
            <i
              className={s.barCand}
              style={{ "--w": `${Math.min(100, (100 * (b ?? 0)) / max)}%` }}
            />
          </span>
          <em>
            {text(a)} → <b>{text(b)}</b>
          </em>
        </div>
      ))}
    </div>
  );
}

function ComponentDetail({ part, reference, candidate }) {
  const r = reference.context || {},
    c = candidate.context || {};
  const names = [reference.name, candidate.name];
  if (part === "role") {
    const max =
      Math.max(
        0.05,
        ...SHARES.flatMap(([k]) => [r.shares?.[k] ?? 0, c.shares?.[k] ?? 0]),
      ) * 1.15;
    return (
      <Pairs
        refName={names[0]}
        candName={names[1]}
        rows={SHARES.map(([k, label]) => [
          label,
          r.shares?.[k],
          c.shares?.[k],
          (v) => fmt(v == null ? null : v * 100, 1, " %"),
          max,
        ])}
      />
    );
  }
  if (part === "style")
    return (
      <Pairs
        refName={r.team?.name || names[0]}
        candName={c.team?.name || names[1]}
        rows={STYLE.map(([k, label]) => [
          label,
          r.style?.[k],
          c.style?.[k],
          (v) => fmt(v),
        ])}
      />
    );
  if (part === "defense")
    return (
      <Pairs
        refName={names[0]}
        candName={names[1]}
        rows={[
          [
            "Actions / 90",
            r.defensiveP90,
            c.defensiveP90,
            (v) => fmt(v, 1),
            Math.max(1, r.defensiveP90 ?? 0, c.defensiveP90 ?? 0) * 1.15,
          ],
          ["Centile au poste", r.defensive, c.defensive, (v) => fmt(v)],
        ]}
      />
    );
  if (part === "effort")
    return (
      <Pairs
        refName={names[0]}
        candName={names[1]}
        rows={[
          [
            "Distance / 90",
            r.distanceP90,
            c.distanceP90,
            (v) => fmt(v == null ? null : v / 1000, 1, " km"),
            13000,
          ],
          [
            "Course rapide / 90",
            r.runningP90,
            c.runningP90,
            (v) => fmt(v, 0, " m"),
            Math.max(1, r.runningP90 ?? 0, c.runningP90 ?? 0) * 1.15,
          ],
          [
            "Sprints / 90",
            r.sprintsP90,
            c.sprintsP90,
            (v) => fmt(v, 1),
            Math.max(1, r.sprintsP90 ?? 0, c.sprintsP90 ?? 0) * 1.15,
          ],
          ["Centile au poste", r.effort, c.effort, (v) => fmt(v)],
        ]}
      />
    );
  if (part === "discipline")
    return (
      <Pairs
        refName={names[0]}
        candName={names[1]}
        rows={[
          [
            "Fautes / 90",
            r.foulsP90,
            c.foulsP90,
            (v) => fmt(v, 1),
            Math.max(1, r.foulsP90 ?? 0, c.foulsP90 ?? 0) * 1.15,
          ],
          [
            "Cartons / 90",
            r.cardPointsP90,
            c.cardPointsP90,
            (v) => fmt(v, 2),
            Math.max(0.1, r.cardPointsP90 ?? 0, c.cardPointsP90 ?? 0) * 1.15,
          ],
          ["Note discipline", r.discipline, c.discipline, (v) => fmt(v)],
        ]}
      />
    );
  return (
    <Pairs
      refName={names[0]}
      candName={names[1]}
      rows={AXES.map(([k, label]) => [
        label,
        reference.axes?.[k],
        candidate.axes?.[k],
        (v) => fmt(v),
      ])}
    />
  );
}

function Comparison({ reference, candidate, season, inline = false }) {
  const f = useFootball();
  const [part, setPart] = useState("role");
  const fit = candidate.fit || {
    score: candidate.similarity,
    profile: candidate.similarity,
  };
  return (
    // On a phone the comparison opens under the selected player (inline), not after the list.
    <section
      className={`${s.comparison} ${inline ? s.inline : s.side}`}
      {...(inline
        ? { "data-replacement-comparison-inline": candidate.id }
        : { "data-replacement-comparison": candidate.id })}
      aria-label="Comparaison"
    >
      <div className={s.comparisonHead}>
        <h3 className={s.comparisonTitle}>
          <span>{reference.name}</span>
          <span aria-hidden="true">→</span>
          <span>{candidate.name}</span>
        </h3>
        <strong className={s.score} aria-label={`Compatibilité ${fit.score} %`}>
          {fit.score}
          <small>%</small>
        </strong>
      </div>
      <div className={s.components} role="group" aria-label="Compatibilité">
        {COMPONENTS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={s.component}
            aria-pressed={part === key}
            onClick={() => setPart(key)}
            data-fit-component={key}
          >
            <span>{label}</span>
            <i
              className={s.componentBar}
              style={{ "--w": `${fit[key] ?? 0}%` }}
            />
            <b>{fit[key] ?? "—"}</b>
          </button>
        ))}
      </div>
      <div className={s.detail}>
        <ComponentDetail
          part={part}
          reference={reference}
          candidate={candidate}
        />
      </div>
      <dl className={s.trio}>
        <div>
          <dt>Âge</dt>
          <dd>{candidate.age == null ? "—" : `${candidate.age} ans`}</dd>
          {reference.age != null && candidate.age != null && (
            <Delta
              value={candidate.age - reference.age}
              unit=" an"
              better="lower"
            />
          )}
        </div>
        <div>
          <dt>Valeur</dt>
          <dd>{money(candidate.value_eur)}</dd>
          {reference.value_eur != null && candidate.value_eur != null && (
            <Delta
              value={(candidate.value_eur - reference.value_eur) / 1e6}
              unit=" M€"
              better="lower"
            />
          )}
        </div>
        <div>
          <dt>Note</dt>
          <dd>{candidate.grade == null ? "—" : candidate.grade}</dd>
          {reference.grade != null && candidate.grade != null && (
            <Delta value={candidate.grade - reference.grade} better="higher" />
          )}
        </div>
      </dl>
      <div className={s.actions}>
        <Link
          className="button"
          href={f.href("/joueurs/", { id: candidate.id, q: "" })}
        >
          Voir la fiche
        </Link>
        <ComparePlayerButton
          profile={{
            id: candidate.id,
            name: candidate.name,
            imageUrl: candidate.image_url,
          }}
          season={season}
        />
        <BookmarkButton
          kind="players"
          id={candidate.id}
          name={candidate.name}
          imageUrl={candidate.image_url}
          season={season}
        />
      </div>
    </section>
  );
}

export default function PlayerReplacements({ fallback }) {
  const f = useFootball(),
    params = useSearchParams();
  const referenceId =
    params.get("replace") || fallback?.playerId || fallback?.id || null;
  const [age, setAge] = useState("all"),
    [value, setValue] = useState("all"),
    [sort, setSort] = useState("fit"),
    [picked, setPicked] = useState(null);
  const read = usePlayerReplacements(referenceId, f.season, { age, value });
  const data = read.value;
  const rows = useMemo(
    () => sortCandidates(data?.similar || [], sort),
    [data, sort],
  );
  const selected = rows.find((row) => row.id === picked) || rows[0] || null;
  const choose = (id) => {
    setReference(id);
    setPicked(null);
  };
  const reference = data?.reference;
  return (
    <div className={s.root}>
      <div className={s.head}>
        {reference ? (
          <div className={s.reference}>
            <Media
              name={reference.name}
              url={reference.image_url}
              className={`crest ${s.avatar}`}
            />
            <div>
              <h2 className={s.referenceName}>{reference.name}</h2>
              <p className={s.referenceMeta}>
                {subtitle(reference) && <span>{subtitle(reference)}</span>}
                {reference.age != null && <span>{reference.age} ans</span>}
                {reference.value_eur != null && (
                  <span>{money(reference.value_eur)}</span>
                )}
                {reference.grade != null && (
                  <span>
                    Note <Grade value={reference.grade} />
                  </span>
                )}
              </p>
            </div>
          </div>
        ) : (
          <span />
        )}
        <ReferenceSearch season={f.season} onPick={choose} />
      </div>
      <div className={s.chips} data-chip-row="">
        <ChipGroup
          label="Âge"
          value={age}
          items={AGE_FILTERS}
          onChange={setAge}
        />
        <ChipGroup
          label="Valeur"
          value={value}
          items={VALUE_FILTERS}
          onChange={setValue}
        />
        <ChipGroup
          label="Trier"
          value={sort}
          items={REPLACEMENT_SORTS}
          onChange={setSort}
        />
      </div>
      {!referenceId || !read.enabled ? (
        <Empty>Choisissez un joueur à remplacer.</Empty>
      ) : read.error ? (
        <div role="alert" className="notice notice-warning">
          {String(read.error)} <button onClick={read.retry}>Réessayer</button>
        </div>
      ) : data === null ? (
        <Empty>Pas assez de minutes cette saison pour ce joueur.</Empty>
      ) : !data ? (
        <Skeleton
          data-page-loading=""
          kind="table"
          lines={8}
          label="Recherche des joueurs proches…"
        />
      ) : !rows.length ? (
        <div className={s.none}>
          <Empty>Aucun joueur proche avec ces critères.</Empty>
          {(age !== "all" || value !== "all") && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setAge("all");
                setValue("all");
              }}
            >
              Retirer les filtres
            </button>
          )}
        </div>
      ) : (
        <div className={s.body}>
          <div className={s.listCard}>
            <div className={s.listHead} aria-hidden="true">
              <span>Joueur</span>
              <span>Compatibilité</span>
              <span className={s.ageCol}>Âge</span>
              <span>Valeur</span>
              <span>Note</span>
            </div>
            <ul className={s.list}>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={s.candidate}
                    aria-pressed={row.id === selected?.id}
                    onClick={() => setPicked(row.id)}
                    data-replacement-candidate={row.id}
                    data-name={row.name}
                    data-age={row.age ?? ""}
                    data-value={row.value_eur ?? ""}
                    data-note={row.grade ?? ""}
                    data-similarity={row.similarity}
                    data-fit={row.fit?.score ?? row.similarity}
                  >
                    <span className={s.who}>
                      <Media
                        name={row.name}
                        url={row.image_url}
                        className="crest"
                      />
                      <span>
                        <strong>{row.name}</strong>
                        <small>
                          {subtitle(row)}
                          {row.levelGap != null && (
                            <span className={s.tag}>Ligue plus faible</span>
                          )}
                        </small>
                      </span>
                    </span>
                    <span className={s.similarity}>
                      <span>{row.fit?.score ?? row.similarity} %</span>
                      <i
                        style={{
                          "--w": `${row.fit?.score ?? row.similarity}%`,
                        }}
                      />
                    </span>
                    <span className={s.ageCol}>
                      {row.age == null ? "—" : `${row.age} ans`}
                    </span>
                    <span className={s.value}>{money(row.value_eur)}</span>
                    <span>
                      {row.grade == null ? "—" : <Grade value={row.grade} />}
                    </span>
                  </button>
                  {reference && row.id === selected?.id && (
                    <Comparison
                      reference={reference}
                      candidate={row}
                      season={f.season}
                      inline
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
          {reference && selected && (
            <Comparison
              reference={reference}
              candidate={selected}
              season={f.season}
            />
          )}
        </div>
      )}
    </div>
  );
}
