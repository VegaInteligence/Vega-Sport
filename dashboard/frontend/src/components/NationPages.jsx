"use client";
/* The nation pages (VI-18, approved mock-up of 16 Nov 2026): the national teams ranked by their
 * Vega Elo, and one nation's page built like a club's: its identity rail, then its season, its
 * Elo, its matches, the players of its latest tournament and its runs in the major tournaments.
 * Everything comes from /api/nations: a fact the base lacks (a coach, a score of an old final)
 * is left out, never filled in. */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Empty, Media, Segments, Skeleton } from "./UI.jsx";
import { ResearchTabs } from "./ResearchUI.jsx";
import { PhoneFoldToggle, usePhoneFold } from "./PhoneFold.jsx";
import { Card, dateShort, fmtNum, Kpis } from "./ClubScoutUI.jsx";
import { LineChart, TipBody } from "./PlayerScoutCharts.jsx";
import FillChart from "./FillChart.jsx";
import NationalFlag from "./NationalFlag.jsx";
import { Term } from "./Hint.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { normalizeText, number } from "../services/format.js";
import {
  competitionLabel,
  lastTournament,
  nationName,
  roundLabel,
  sideOf,
  useNation,
  useNations,
} from "../services/nations.js";
import rail from "./ClubScoutTabs.module.css";
import s from "./Nations.module.css";

/** An axis date: « 9 juil. », or « juil. 24 » when the points span several years. */
const axisDate = (value, years) =>
  years
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })
    : dateShort(value);
const ordinal = (n) => (n == null ? "—" : n === 1 ? "1er" : `${n}e`);
const signed = (v, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${number(Math.abs(v), digits)}`);
const tone = (v) => (v == null || v === 0 ? undefined : v > 0 ? s.up : s.down);

/** A national team's crest, else its flag, else its initials. */
function NationMark({ nation, className = "" }) {
  if (nation.imageUrl) return <Media name={nation.name} url={nation.imageUrl} className={`crest ${className}`} />;
  return (
    <span className={`${s.flag} ${className}`}>
      <NationalFlag name={nation.name} />
    </span>
  );
}

function Record({ wins, draws, losses }) {
  return (
    <span className={s.record}>
      <b data-r="V">{wins}</b>
      <b data-r="N">{draws}</b>
      <b data-r="D">{losses}</b>
    </span>
  );
}

/* ---------------------------------------------------------------- index */

export function NationIndex() {
  const f = useFootball();
  const nations = useNations(f.season);
  const [scope, setScope] = useState("ranked");
  const [query, setQuery] = useState("");
  const data = nations.value;
  const rows = useMemo(() => {
    const all = data?.nations || [];
    const needle = normalizeText(query.trim());
    return all
      .filter((n) => scope === "all" || n.ranking)
      .filter((n) => !needle || normalizeText(`${nationName(n.name)} ${n.name}`).includes(needle));
  }, [data, scope, query]);
  if (nations.loading && !data) return <Skeleton data-page-loading="" label="Chargement des nations…" lines={8} />;
  if (nations.error) return <p role="alert" className="notice notice-warning">Nations indisponibles. {String(nations.error.message || nations.error)}</p>;
  if (!data) return <Empty>Aucune sélection collectée.</Empty>;
  const ranked = scope === "ranked";
  return (
    <div className={s.page}>
      <div className={s.bar}>
        <input
          className={s.search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une sélection"
          aria-label="Rechercher une sélection"
        />
        <Segments
          label="Sélections affichées"
          value={scope}
          onChange={setScope}
          items={[
            ["ranked", `Classées cette saison · ${data.ranked}`],
            ["all", `Toutes les sélections · ${data.nations.length}`],
          ]}
        />
      </div>
      <section className={`card ${s.tableCard}`}>
        <div className="table-scroll">
          <table className={`data-table ${s.table}`}>
            <thead>
              <tr>
                {ranked && <th scope="col">Rang</th>}
                <th scope="col">Sélection</th>
                <th scope="col"><Term>Elo Vega</Term></th>
                {ranked ? (
                  <>
                    <th scope="col"><Term hint="Variation de l’Elo depuis le début de la saison.">Évolution</Term></th>
                    <th scope="col">Matchs</th>
                    <th scope="col">Bilan V · N · D</th>
                    <th scope="col"><Term hint="Points de résultat (1 la victoire, ½ le nul) moins ceux que l’Elo attendait avant chaque match.">Résultats − attendus</Term></th>
                  </>
                ) : (
                  <>
                    <th scope="col">Matchs</th>
                    <th scope="col">Dernier match</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const r = n.ranking;
                const diff = r && r.results != null && r.expected != null ? r.results - r.expected : null;
                return (
                  <tr key={n.id}>
                    {ranked && <td>{r.rank}</td>}
                    <th scope="row">
                      <Link className={s.who} href={f.href("/nations/", { id: n.id })}>
                        <NationMark nation={n} className={s.mark} />
                        {nationName(n.name)}
                      </Link>
                    </th>
                    <td><b>{fmtNum(ranked ? r.elo : n.elo)}</b></td>
                    {ranked ? (
                      <>
                        <td className={tone(r.eloChange)}>{signed(r.eloChange)}</td>
                        <td>{r.matches}</td>
                        <td><Record wins={r.wins} draws={r.draws} losses={r.losses} /></td>
                        <td className={tone(diff)}>{signed(diff, 2)}</td>
                      </>
                    ) : (
                      <>
                        <td>{number(n.matches)}</td>
                        <td>{n.lastMatch ? new Date(`${n.lastMatch}T12:00:00Z`).toLocaleDateString("fr-FR") : "—"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className={s.muted}>Aucune sélection ne correspond.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- page */

const TABS = [
  ["overview", "Vue d’ensemble"],
  ["matches", "Matchs"],
  ["players", "Joueurs"],
  ["history", "Historique"],
];

function MatchRow({ match, id }) {
  const f = useFootball();
  const side = sideOf(match, id);
  const score =
    match.homeScore == null ? (match.status === "finished" ? "–" : "à venir") : `${match.homeScore}–${match.awayScore}`;
  const body = (
    <>
      <span className={s.date}>{match.date ? dateShort(match.date) : "—"}</span>
      <span className={s.teams}>
        <b>
          {nationName(match.home.name)} – {nationName(match.away.name)}
        </b>
        <small>
          {[competitionLabel(match), roundLabel(match.round)].filter(Boolean).join(" · ")}
          {side.pens ? ` · t.a.b. ${match.homePenalties}–${match.awayPenalties}` : ""}
        </small>
      </span>
      <span className={s.score}>{score}</span>
      {side.result ? <b className={s.result} data-r={side.result}>{side.result}</b> : <span />}
    </>
  );
  return match.id ? (
    <Link className={s.match} href={f.href("/matchs/", { id: match.id })} prefetch={false}>
      {body}
    </Link>
  ) : (
    <div className={s.match}>{body}</div>
  );
}

function EloChart({ points, height, wide = false }) {
  if (points.length < 2) return <p className={s.muted}>Pas assez de matchs classés pour tracer l’Elo.</p>;
  const values = points.map((p) => p.elo);
  const lo = Math.floor((Math.min(...values) - 10) / 20) * 20, hi = Math.ceil((Math.max(...values) + 10) / 20) * 20;
  const step = (hi - lo) / 4;
  const years = new Set(points.map((p) => (p.date || "").slice(0, 4)).filter(Boolean)).size > 1;
  return (
    <LineChart
      width={wide ? 1000 : 640}
      height={height}
      points={points.map((p) => ({ x: p.date ? axisDate(p.date, years) : "", y: p.elo, row: p }))}
      domain={[lo, hi]}
      ticks={[0, 1, 2, 3, 4].map((i) => Math.round(lo + i * step))}
      labelEvery={Math.max(1, Math.ceil(points.length / 7))}
      format={(value) => fmtNum(value)}
      leftMargin={44}
      ariaLabel="Elo Vega après chaque match"
      tip={(point) => (
        <TipBody
          title={point.row.date ? new Date(`${point.row.date}T12:00:00Z`).toLocaleDateString("fr-FR") : "Match"}
          rows={[
            ["Elo", fmtNum(point.row.elo)],
            ["Résultat", point.row.result === 1 ? "Victoire" : point.row.result === 0 ? "Défaite" : "Nul"],
          ]}
        />
      )}
    />
  );
}

function PlayersTable({ players, limit }) {
  const f = useFootball();
  const rows = limit ? players.rows.slice(0, limit) : players.rows;
  return (
    <div className="table-scroll">
      <table className={`data-table ${s.table}`}>
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">Club</th>
            <th scope="col"><Term hint="Matchs joués au tournoi.">MJ</Term></th>
            <th scope="col">Min</th>
            <th scope="col">Buts</th>
            <th scope="col"><Term>PD</Term></th>
            <th scope="col"><Term>xG</Term></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <th scope="row">
                <Link className={s.who} href={f.href("/joueurs/", { id: p.id })} prefetch={false}>
                  <Media name={p.name} url={p.imageUrl} className={`player-avatar ${s.avatar}`} />
                  {p.name}
                </Link>
              </th>
              <td className={s.muted}>
                {p.club ? (
                  <Link href={f.href("/clubs/", { id: p.club.id })} prefetch={false}>
                    {p.club.name}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>{p.matches}</td>
              <td>{number(p.minutes)}</td>
              <td>{p.goals}</td>
              <td>{p.assists}</td>
              <td>{p.xg == null ? "—" : fmtNum(p.xg, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tournaments({ runs }) {
  return (
    <div className={s.runs}>
      {runs.map((run) => (
        <div key={`${run.tournament}:${run.year}`} className={s.run} data-tone={run.tone}>
          <small>{run.tournament === "world-cup" ? run.year : run.label}</small>
          <b>{run.stage}</b>
        </div>
      ))}
    </div>
  );
}

function TournamentPath({ run, id }) {
  return (
    <div className={s.path}>
      {run.games.map((game, i) => {
        const side = sideOf(game, id);
        return (
          <div key={i} className={s.step} data-r={side.result || undefined}>
            <small>{roundLabel(game.round) || "—"}</small>
            <b>
              {nationName(game.home.name)} – {nationName(game.away.name)}
            </b>
            <span>
              {game.homeScore == null ? "—" : `${game.homeScore}–${game.awayScore}`}
              {side.pens ? ` (t.a.b. ${game.homePenalties}–${game.awayPenalties})` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NationRail({ nation, last }) {
  const more = usePhoneFold();
  const played = nation.matches.filter((m) => m.status === "finished" && m.homeScore != null);
  const current = played[0];
  const form = played.slice(0, 6).map((m) => sideOf(m, nation.id)).reverse();
  const r = nation.ranking, rec = nation.record;
  return (
    <aside className={rail.rail} aria-label="Identité de la sélection" {...more.fold}>
      <div className={rail.identity}>
        <NationMark nation={nation} className={`${rail.bigCrest} ${s.bigMark}`} />
        <h2 className={rail.name}>{nationName(nation.name)}</h2>
        <p className={rail.sub}>Sélection nationale</p>
        {current && (
          <div className={rail.chips}>
            <span className={rail.chip}>{[competitionLabel(current), roundLabel(current.round)].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>
      <div className={`${rail.railSection} phone-fold-row`}>
        <PhoneFoldToggle {...more.toggle} label="Classement, bilan et tournois" />
      </div>
      <div className={`${rail.railSection} phone-fold-part`}>
        <div className={rail.railTitle}>
          <div className={rail.railName}><Term hint="Rang parmi les sélections classées par l’Elo Vega sur la saison.">Classement Vega</Term></div> <span>{nation.season}</span>
        </div>
        <div className={rail.position}>
          <strong>{r ? ordinal(r.rank) : "—"}</strong>
          <span>
            {r ? `sur ${nation.ranked} sélections classées` : "non classée cette saison"}
            <small>
              {`Elo ${fmtNum(r ? r.elo : nation.elo)}${r?.eloChange != null ? ` · ${signed(r.eloChange)} cette saison` : ""}`}
            </small>
          </span>
        </div>
      </div>
      <div className={`${rail.railSection} phone-fold-part`}>
        <div className={rail.railTitle}>
          <div className={rail.railName}>Bilan</div> <span>{nation.season}</span>
        </div>
        {rec.played ? (
          <dl className={s.facts}>
            <div>
              <dt><Term>Bilan</Term></dt>
              <dd>{rec.wins}-{rec.draws}-{rec.losses}</dd>
              <small>{rec.played} match{rec.played > 1 ? "s" : ""}</small>
            </div>
            <div>
              <dt><Term hint="Buts marqués et encaissés.">Buts</Term></dt>
              <dd>{rec.goalsFor}–{rec.goalsAgainst}</dd>
              <small>{signed(rec.goalsFor - rec.goalsAgainst, 0)}</small>
            </div>
          </dl>
        ) : (
          <p className={s.muted}>Aucun match joué cette saison.</p>
        )}
        {form.length > 0 && (
          <>
            <div className={rail.railTitle} style={{ marginTop: 14 }}>
              <div className={rail.railName}><Term>Forme</Term></div>
            </div>
            <span className={s.form} aria-label="Derniers résultats, du plus ancien au plus récent">
              {form.map((side, i) => (
                <b key={i} data-r={side.result || undefined}>{side.result || "?"}</b>
              ))}
            </span>
          </>
        )}
      </div>
      {last && (
        <div className={`${rail.railSection} phone-fold-part`}>
          <div className={rail.railTitle}>
            <div className={rail.railName}>{last.label}</div>
          </div>
          <div className={rail.position}>
            <strong>{last.stage}</strong>
            <span>
              {last.matches} match{last.matches > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}

function Overview({ nation, last, onTab }) {
  const r = nation.ranking, rec = nation.record;
  const recent = nation.matches.filter((m) => m.status === "finished" && m.homeScore != null).slice(0, 6);
  const elo = nation.elo.slice(-16);
  const lastGoals = last
    ? last.games.reduce(
        (sum, g) => {
          const side = sideOf(g, nation.id);
          return side.own == null ? sum : [sum[0] + side.own, sum[1] + side.other];
        },
        [0, 0],
      )
    : null;
  return (
    <div className={s.stack}>
      <Kpis
        items={[
          ["Matchs", rec.played, nation.season],
          ["Bilan", rec.played ? `${rec.wins}-${rec.draws}-${rec.losses}` : "—", "V · N · D"],
          ["Buts", rec.played ? `${rec.goalsFor}–${rec.goalsAgainst}` : "—", rec.played ? `${fmtNum(rec.goalsFor / rec.played, 2)} – ${fmtNum(rec.goalsAgainst / rec.played, 2)} / match` : null],
          ["Elo Vega", fmtNum(r ? r.elo : nation.elo), r?.eloChange != null ? `${signed(r.eloChange)} cette saison` : null],
          ["Rang Vega", r ? ordinal(r.rank) : "—", r ? `sur ${nation.ranked} sélections` : "non classée"],
          [last ? last.label : "Grand tournoi", last ? last.stage : "—", last ? `${last.matches} matchs · ${lastGoals[0]}–${lastGoals[1]}` : null],
        ]}
      />
      <div className={s.grid2}>
        <Card title="Évolution de l’Elo" text="Après chaque match classé" className={s.fill}>
          <FillChart base={240} cap={640 * 1.3}>
            {(height) => <EloChart points={elo} height={height} />}
          </FillChart>
        </Card>
        <Card title="Derniers matchs" text="Toutes compétitions">
          {recent.length ? (
            <div className={s.matches}>
              {recent.map((m, i) => (
                <MatchRow key={m.id || i} match={m} id={nation.id} />
              ))}
            </div>
          ) : (
            <p className={s.muted}>Aucun match joué collecté.</p>
          )}
        </Card>
      </div>
      {last && last.games.length > 0 && (
        <Card title={last.label} text="Le parcours, match par match">
          <TournamentPath run={last} id={nation.id} />
        </Card>
      )}
      {nation.players && (
        <Card
          title={`Les joueurs : ${nation.players.competition}`}
          text="Minutes, buts, passes décisives et xG au tournoi · club actuel"
          action={
            nation.players.rows.length > 12 && (
              <button type="button" className={s.link} onClick={() => onTab("players")}>
                Les {nation.players.rows.length} joueurs →
              </button>
            )
          }
        >
          <PlayersTable players={nation.players} limit={12} />
        </Card>
      )}
      {nation.tournaments.length > 0 && (
        <Card
          title="Grands tournois"
          text="Coupes du monde et Euros collectés"
          action={
            <button type="button" className={s.link} onClick={() => onTab("history")}>
              Historique →
            </button>
          }
        >
          <Tournaments runs={nation.tournaments} />
        </Card>
      )}
    </div>
  );
}

function Matches({ nation }) {
  const [competition, setCompetition] = useState("all");
  const labels = [...new Set(nation.matches.map(competitionLabel))];
  const rows = nation.matches.filter((m) => competition === "all" || competitionLabel(m) === competition);
  return (
    <Card title="Tous les matchs" text={`${number(nation.matches.length)} matchs collectés, du plus récent au plus ancien`}>
      {labels.length > 1 && (
        <div className={s.filters}>
          <Segments
            label="Compétition"
            value={competition}
            onChange={setCompetition}
            items={[["all", "Toutes"], ...labels.map((l) => [l, l])]}
          />
        </div>
      )}
      <div className={s.matches}>
        {rows.map((m, i) => (
          <MatchRow key={m.id || `${m.date}:${i}`} match={m} id={nation.id} />
        ))}
      </div>
    </Card>
  );
}

function History({ nation }) {
  return (
    <div className={s.stack}>
      <Card title="Grands tournois" text="Le stade atteint à chaque édition collectée ; une finale sans score connu n’en dit pas l’issue">
        {nation.tournaments.length ? <Tournaments runs={nation.tournaments} /> : <p className={s.muted}>Aucun grand tournoi collecté.</p>}
      </Card>
      <Card title="Elo Vega" text="Après chaque match classé, depuis le premier">
        <EloChart points={nation.elo} height={260} wide />
      </Card>
    </div>
  );
}

export function NationProfile({ id }) {
  const f = useFootball();
  const nation = useNation(id, f.season);
  const [tab, setTab] = useState("overview");
  const value = nation.value;
  if (nation.loading && !value) return <Skeleton data-page-loading="" label="Chargement de la sélection…" lines={6} />;
  if (nation.error) return <p role="alert" className="notice notice-warning">Sélection indisponible. {String(nation.error.message || nation.error)}</p>;
  if (!value) return <Empty>Cette sélection n’existe pas.</Empty>;
  const last = lastTournament(value);
  return (
    <>
      <Link className="inline-link competition-back" href={f.href("/nations/", { id: "" })}>
        ← Toutes les nations
      </Link>
      <div className={rail.layout}>
        <NationRail nation={value} last={last} />
        <div className={rail.main}>
          <ResearchTabs animated label="Sélection" items={TABS} value={tab} onChange={setTab} panelId="nation-panel" />
          <div id="nation-panel" role="tabpanel" aria-label={TABS.find(([key]) => key === tab)[1]} className={s.panel}>
            {tab === "overview" && <Overview nation={value} last={last} onTab={setTab} />}
            {tab === "matches" && <Matches nation={value} />}
            {tab === "players" &&
              (value.players ? (
                <Card title={`Les joueurs : ${value.players.competition}`} text="Minutes, buts, passes décisives et xG au tournoi · club actuel">
                  <PlayersTable players={value.players} />
                </Card>
              ) : (
                <Empty>Aucune statistique de joueur collectée pour cette sélection.</Empty>
              ))}
            {tab === "history" && <History nation={value} />}
          </div>
        </div>
      </div>
    </>
  );
}
