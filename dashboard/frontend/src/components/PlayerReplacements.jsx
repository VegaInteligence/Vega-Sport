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
import { BookmarkButton } from "./ResearchUI.jsx";
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

function Comparison({ reference, candidate, season }) {
  const f = useFootball();
  const axes =
    reference.axes && candidate.axes
      ? AXES.filter(
          ([key]) => reference.axes[key] != null && candidate.axes[key] != null,
        )
      : [];
  return (
    <section
      className={s.comparison}
      data-replacement-comparison={candidate.id}
      aria-label="Comparaison"
    >
      <h3 className={s.comparisonTitle}>
        <span>{reference.name}</span>
        <span aria-hidden="true">→</span>
        <span>{candidate.name}</span>
      </h3>
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
      {axes.length > 0 && (
        <div className={s.axes}>
          <p className={s.legend}>
            <span className={s.legendRef}>{reference.name}</span>
            <span className={s.legendCand}>{candidate.name}</span>
          </p>
          {axes.map(([key, label]) => (
            <div key={key} className={s.axis}>
              <span>{label}</span>
              <span
                className={s.bars}
                aria-label={`${label} : ${reference.axes[key]} contre ${candidate.axes[key]}`}
              >
                <i
                  className={s.barRef}
                  style={{ "--w": `${reference.axes[key]}%` }}
                />
                <i
                  className={s.barCand}
                  style={{ "--w": `${candidate.axes[key]}%` }}
                />
              </span>
              <Delta
                value={candidate.axes[key] - reference.axes[key]}
                better="higher"
              />
            </div>
          ))}
        </div>
      )}
      <div className={s.actions}>
        <Link
          className="button"
          href={f.href("/joueurs/", { id: candidate.id, q: "" })}
        >
          Voir la fiche
        </Link>
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
    [sort, setSort] = useState("similarity"),
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
              <span>Ressemblance</span>
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
                  >
                    <span className={s.who}>
                      <Media
                        name={row.name}
                        url={row.image_url}
                        className="crest"
                      />
                      <span>
                        <strong>{row.name}</strong>
                        <small>{subtitle(row)}</small>
                      </span>
                    </span>
                    <span className={s.similarity}>
                      <span>{row.similarity} %</span>
                      <i style={{ "--w": `${row.similarity}%` }} />
                    </span>
                    <span className={s.ageCol}>
                      {row.age == null ? "—" : `${row.age} ans`}
                    </span>
                    <span className={s.value}>{money(row.value_eur)}</span>
                    <span>
                      {row.grade == null ? "—" : <Grade value={row.grade} />}
                    </span>
                  </button>
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
