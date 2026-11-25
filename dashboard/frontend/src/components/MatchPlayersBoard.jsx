"use client";
/* The « Joueurs » tab: the match's best grade and three markers (the most dangerous, the most
 * present, the most solid), then every player who came on in one table, sorted by grade,
 * sortable by any column, filtered by team; every player opens his performance of the match. */
import React, { useMemo, useState } from "react";
import { Empty, Media, Segments, Skeleton } from "./UI.jsx";
import { Hint } from "./Hint.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import useMatchPlayerStats from "../hooks/useMatchPlayerStats.js";
import { useMatchGrades } from "../services/match-grades.js";
import { boardRows, leaders, sortRows, BOARD_COLUMNS } from "../services/match-tabs.js";
import { explain } from "../services/glossary.js";
import { number } from "../services/format.js";
import { GRADE_HIGH } from "../services/grades.js";
import s from "./MatchTabs.module.css";
import o from "./MatchPlayerOpen.module.css";

const tone = (grade) => (grade == null ? "" : grade >= GRADE_HIGH ? s.gradeHigh : grade < 45 ? s.gradeLow : "");

function Leader({ title, value, row, detail, team, onOpen }) {
  if (!row) return null;
  return (
    <button type="button" className={`card ${s.panel} ${s.leader} ${o.open} ${o.cardButton}`} onClick={() => onOpen(row)}>
      <span className={s.label}>{title}</span>
      <strong className={s.big}>{value}</strong>
      <span className={s.leaderWho}>
        <Media name={row.name} url={row.imageUrl} className={`player-avatar ${s.subAvatar}`} />
        <span>
          <b>{row.name}</b>
          <small>
            {team} · {detail}
          </small>
        </span>
      </span>
    </button>
  );
}

function Cell({ row, column, best }) {
  const value = row[column.key];
  const text =
    value == null ? (
      <small className={s.muted}>Non renseigné</small>
    ) : column.key === "grade" ? (
      <span className={`${s.grade} ${tone(value)}`}>{number(value, 0)}</span>
    ) : (
      <>
        {number(value, column.digits || 0)}
        {column.total && row[column.total] != null && <small className={s.muted}> / {number(row[column.total])}</small>}
        {column.extra && row[column.extra] != null && <small className={s.muted}> ({number(row[column.extra])})</small>}
      </>
    );
  return <td className={best && value != null && value === best && column.key !== "minutes" ? s.best : undefined}>{text}</td>;
}

export default function MatchPlayersBoard({ match }) {
  const f = useFootball();
  const players = useMatchPlayerStats(match);
  const events = useMatchSection(match, "events");
  const grades = useMatchGrades(match.id);
  const [team, setTeam] = useState("all");
  const [sort, setSort] = useState({ key: "grade", direction: "desc" });
  const rows = useMemo(() => boardRows(players.data, events.data?.events, grades), [players.data, events.data, grades]);
  if (players.loading && !players.data) return <Skeleton label="Chargement des joueurs…" lines={5} />;
  if (!rows.length) return <Empty>Aucune performance collectée pour ce match.</Empty>;
  const teamName = (id) => (id === match.home.id ? match.home.name : id === match.away.id ? match.away.name : "");
  const shown = sortRows(rows.filter((r) => team === "all" || r.teamId === team), sort);
  const best = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.key, Math.max(...rows.map((r) => r[c.key] ?? -Infinity))]));
  const top = leaders(rows);
  const motm = top.grade;
  const open = (row) => row.id && f.setPlayer(`${match.id}:${row.id}`);
  return (
    <div className={s.stack}>
      <div className={s.leaders}>
        {motm && (
          <button type="button" className={`card ${s.panel} ${s.motm} ${o.open} ${o.cardButton}`} onClick={() => open(motm)}>
            <Media name={motm.name} url={motm.imageUrl} className={`player-avatar ${s.motmAvatar}`} />
            <span>
              <span className={`${s.label} ${s.good}`}>Meilleure note du match</span>
              <b className={s.motmName}>{motm.name}</b>
              <small className={s.muted}>
                {teamName(motm.teamId)} · {number(motm.minutes)} min
              </small>
              <span className={s.motmLine}>
                <strong className={`${s.big} ${s.good}`}>{number(motm.grade, 0)}</strong>
                <small className={s.muted}>
                  {[
                    motm.goals > 0 && `${motm.goals} but${motm.goals > 1 ? "s" : ""}`,
                    motm.assists > 0 && `${motm.assists} passe${motm.assists > 1 ? "s" : ""} décisive${motm.assists > 1 ? "s" : ""}`,
                    motm.chancesCreated > 0 && `${motm.chancesCreated} occasions créées`,
                    motm.duelsWon > 0 && `${motm.duelsWon} duels gagnés`,
                  ].filter(Boolean).join(" · ")}
                </small>
              </span>
            </span>
          </button>
        )}
        <Leader title="Le plus dangereux" row={top.threat} value={top.threat && `${number(top.threat.threat, 2)} xG + xA`}
          detail={top.threat && `${number(top.threat.goals ?? 0)} but${(top.threat.goals ?? 0) > 1 ? "s" : ""} · ${number(top.threat.shots ?? 0)} tir${(top.threat.shots ?? 0) > 1 ? "s" : ""}`} team={top.threat && teamName(top.threat.teamId)} onOpen={open} />
        <Leader title="Le plus présent" row={top.passes} value={top.passes && `${number(top.passes.passes)} passes`}
          detail={top.passes?.passesTotal ? `${number((100 * top.passes.passes) / top.passes.passesTotal, 0)} % de réussite` : ""} team={top.passes && teamName(top.passes.teamId)} onOpen={open} />
        <Leader title="Le plus solide" row={top.duels} value={top.duels && `${number(top.duels.duelsWon)} duels gagnés`}
          detail={top.duels && `${number(top.duels.recovered)} tacles et interceptions`} team={top.duels && teamName(top.duels.teamId)} onOpen={open} />
      </div>
      <section className={`card ${s.panel}`}>
        <div className={s.toolbar}>
          <Segments
            label="Équipe"
            value={team}
            onChange={setTeam}
            items={[["all", "Les deux équipes"], [match.home.id, match.home.name], [match.away.id, match.away.name]]}
          />
        </div>
        <div className="table-scroll">
          <table className={`data-table ${s.board}`}>
            <thead>
              <tr>
                <th scope="col">Joueur</th>
                {BOARD_COLUMNS.map((c) => (
                  <th scope="col" key={c.key} aria-sort={sort.key === c.key ? (sort.direction === "desc" ? "descending" : "ascending") : undefined}>
                    <button
                      type="button"
                      className={`${s.sortButton} ${sort.key === c.key ? s.sorted : ""}`}
                      onClick={() => setSort((current) => ({ key: c.key, direction: current.key === c.key && current.direction === "desc" ? "asc" : "desc" }))}
                    >
                      {c.label}
                      {sort.key === c.key ? (sort.direction === "desc" ? " ↓" : " ↑") : ""}
                    </button>
                    <Hint text={explain(c.label) || c.hint} label={c.label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id || row.name} className={s.clickable} onClick={() => open(row)}>
                  <th scope="row">
                    <span className={s.playerCell}>
                      <i className={s.teamBar} style={{ background: row.teamId === match.home.id ? "var(--home)" : "var(--away)" }} />
                      <Media name={row.name} url={row.imageUrl} className={`player-avatar ${s.subAvatar}`} />
                      <span>
                        {row.id ? (
                          <button
                            type="button"
                            className={`${o.open} ${o.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              open(row);
                            }}
                          >
                            {row.name}
                          </button>
                        ) : (
                          row.name
                        )}
                        <small className={s.muted}>
                          {row.keeper ? "Gardien" : teamName(row.teamId)}
                          {row.on && <span className={s.on}> ▲ {row.on}′</span>}
                          {row.off && <span className={s.off}> ▼ {row.off}′</span>}
                        </small>
                      </span>
                    </span>
                  </th>
                  {BOARD_COLUMNS.map((c) => (
                    <Cell key={c.key} row={row} column={c} best={best[c.key]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
