"use client";
/* Full ranking behind one indicator, shared by club and player profiles:
 * every member of the referential, best first, the profile highlighted. */
import React, { createContext, useContext, useEffect, useRef } from "react";
import Link from "next/link";
import { Modal } from "./UI.jsx";
import { PercentileBar } from "./PlayerScoutCharts.jsx";
import s from "./RankingDialog.module.css";

const RankingContext = createContext(null);

/** `open(target)` when a profile can show rankings, else null. */
export const useRankingOpener = () => useContext(RankingContext);
export const RankingProvider = RankingContext.Provider;

/** Button around an indicator label; plain text when rankings are off. */
export function RankingTrigger({ target, children, className = "" }) {
  const open = useRankingOpener();
  if (!open) return children;
  return (
    <button
      type="button"
      className={`${s.trigger} ${className}`}
      onClick={() => open(target)}
      title="Voir le classement complet"
    >
      {children}
      <span className={s.triggerIcon} aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

/**
 * rows: [{ id, rank, name, imageUrl, meta, value, centile, href }], already
 * sorted. `note` explains the order (lower is better, style indicator…).
 */
export function RankingDialog({ title, subtitle, note, rows, selfId, onClose }) {
  const list = useRef();
  useEffect(() => {
    const row = list.current?.querySelector("[data-self='true']");
    row?.scrollIntoView({ block: "center" });
  }, [rows, selfId]);
  const self = rows.find((row) => row.id === selfId);
  return (
    <Modal
      title={title}
      onClose={onClose}
      className={s.modal}
      header={
        <div className={s.head}>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
          {self && (
            <p className={s.selfLine}>
              <strong>{self.rank ? `${self.rank}e` : "—"}</strong> sur{" "}
              {rows.length} · {self.value}
              {self.centile != null && ` · centile ${self.centile}`}
            </p>
          )}
        </div>
      }
    >
      {note && <p className={s.note}>{note}</p>}
      <ol className={s.list} ref={list}>
        {rows.map((row) => {
          const name = row.href ? (
            <Link href={row.href} onClick={onClose}>
              {row.name}
            </Link>
          ) : (
            row.name
          );
          return (
            <li key={row.id} data-self={row.id === selfId}>
              <span className={s.rank}>{row.rank ?? "—"}</span>
              {row.imageUrl ? (
                <img className={s.logo} src={row.imageUrl} alt="" />
              ) : (
                <span className={s.logo} />
              )}
              <span className={s.name}>
                {name}
                {row.meta && <small>{row.meta}</small>}
              </span>
              <span className={s.value}>{row.value}</span>
              <span className={s.bar}>
                {row.centile != null && <PercentileBar value={row.centile} />}
              </span>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
