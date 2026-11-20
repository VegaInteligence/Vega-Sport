"use client";
import React, { useState } from "react";
import BackLink from "../components/BackLink.jsx";
import { useSearchParams } from "next/navigation";
import Layout from "../components/Layout.jsx";
import { Card, Grade, Segments, Skeleton } from "../components/UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { useResource } from "../services/resources.js";
import {
  reportImageUrl,
  reportSlug,
  reportThread,
  REPORT_TITLES,
} from "../services/reports.js";

/** The report of a player, a club or a match (/rapport/?id=…): six images for a thread on X,
 * and the technical version, every figure in full, to print. */
export default function ReportPage() {
  const params = useSearchParams();
  const f = useFootball();
  const id = params.get("id") || "",
    season = params.get("season") || "";
  const [view, setView] = useState("thread");
  const resource = useResource(
    `report:${id}:${season}`,
    () =>
      fetch(
        `/api/rapport?${new URLSearchParams({ id, ...(season ? { season } : {}) })}`,
      ).then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(
              new Error(
                r.status === 404
                  ? "Ce rapport n’existe pas."
                  : "Le rapport est momentanément indisponible.",
              ),
            ),
      ),
    Boolean(id),
  );
  const report = resource.value;
  const back =
    report &&
    (report.kind === "player"
      ? f.href("/joueurs/", { id })
      : report.kind === "club"
        ? f.href("/clubs/", { id })
        : f.href("/matchs/", { id }));
  return (
    <Layout
      path="/rapport/"
      title={report ? `Rapport · ${report.title}` : "Rapport"}
    >
      {!id ? (
        <p className="notice">
          Ouvrez un rapport depuis la fiche d’un joueur, d’un club ou d’un
          match.
        </p>
      ) : resource.loading ? (
        <Skeleton
          data-page-loading=""
          label="Chargement du rapport…"
          lines={6}
        />
      ) : resource.error || !report ? (
        <p role="alert" className="notice notice-warning">
          {resource.error || "Rapport indisponible."}
        </p>
      ) : (
        <>
          <div className="report-head">
            <BackLink
              className="inline-link"
              href={back}
              label="Retour à la fiche"
            />
            <Segments
              label="Version du rapport"
              value={view}
              onChange={setView}
              items={[
                ["thread", "Pour X · 6 images"],
                ["technical", "Version technique"],
              ]}
            />
          </div>
          {view === "thread" ? (
            <Thread report={report} season={season} />
          ) : (
            <Technical report={report} />
          )}
        </>
      )}
    </Layout>
  );
}

function Thread({ report, season }) {
  const [copied, setCopied] = useState(false);
  const text = reportThread(report);
  const urls = [1, 2, 3, 4, 5, 6].map((n) =>
    reportImageUrl(report.id, n, season),
  );
  const all = () =>
    urls.forEach((url, i) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportSlug(report)}-${i + 1}.png`;
      setTimeout(() => a.click(), i * 400);
    });
  return (
    <>
      <Card title="Le fil">
        <p className="card-note">
          Six images de 1080 × 1350, dans l’ordre du fil. Le texte ci-dessous
          les accompagne.
        </p>
        <textarea className="report-text" readOnly value={text} rows={4} />
        <div className="report-actions">
          <button
            className="button button-secondary"
            onClick={() =>
              navigator.clipboard?.writeText(text).then(() => setCopied(true))
            }
          >
            {copied ? "Texte copié" : "Copier le texte"}
          </button>
          <button className="button button-secondary" onClick={all}>
            Tout télécharger
          </button>
        </div>
      </Card>
      <div className="report-images">
        {urls.map((url, i) => (
          <figure key={url} className="report-image">
            <img
              src={url}
              alt={`${REPORT_TITLES[report.kind][i]}, image ${i + 1} sur 6`}
              loading={i < 2 ? "eager" : "lazy"}
              width={1080}
              height={1350}
            />
            <figcaption>
              <span>{`${i + 1}. ${REPORT_TITLES[report.kind][i]}`}</span>
              <a
                className="inline-link"
                href={url}
                download={`${reportSlug(report)}-${i + 1}.png`}
              >
                Télécharger
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

const FOOT = { right: "droit", left: "gauche", both: "les deux" };
const fmt = (value, digits = 0) =>
  value == null ? "—" : number(value, digits);
const pct = (value) => (value == null ? "—" : `${number(value, 1)} %`);

function Table({ caption, head, rows }) {
  return (
    <div className="table-scroll">
      <table className="data-table report-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Technical({ report }) {
  return (
    <div className="report-technical">
      <div className="report-actions report-print-hide">
        <button
          className="button button-secondary"
          onClick={() => window.print()}
        >
          Imprimer ou enregistrer en PDF
        </button>
      </div>
      {report.kind === "player" ? (
        <PlayerTechnical r={report} />
      ) : report.kind === "club" ? (
        <ClubTechnical r={report} />
      ) : (
        <MatchTechnical r={report} />
      )}
      <p className="card-note">
        {`Rapport établi le ${new Date(report.generatedAt).toLocaleDateString("fr-FR")}. Notes et scores : méthode décrite dans « Données & méthode ».`}
      </p>
    </div>
  );
}

function PlayerTechnical({ r }) {
  const p = r.player,
    s = r.seasonStats,
    t = s.totals,
    per = s.per90;
  const stat = (label, key, digits = 0) => [
    label,
    fmt(t[key], digits),
    fmt(per[key], 2),
  ];
  return (
    <>
      <Card title="Identité">
        <Table
          caption="Identité"
          head={["", ""]}
          rows={[
            ["Club", p.team ? `${p.team.name} (${p.team.league || ""})` : "—"],
            ["Poste", p.position || "—"],
            ["Âge", p.age == null ? "—" : `${p.age} ans (${p.birthDate})`],
            ["Taille", p.heightCm ? `${p.heightCm} cm` : "—"],
            ["Pied fort", FOOT[p.foot] || "—"],
            ["Contrat", p.contractUntil || "—"],
            [
              "Score Vega",
              r.power?.score == null
                ? "—"
                : `${fmt(r.power.score)} / 100 · ${r.power.rank}e · ${r.power.roleRank}e à son poste sur ${fmt(r.power.roleCount)}${r.power.provisional ? " (provisoire)" : ""}`,
            ],
            [
              "Note Vega de saison",
              s.grade == null
                ? "—"
                : `${fmt(s.grade)} / 100 sur ${s.graded} matchs notés`,
            ],
          ]}
        />
      </Card>
      <Card title={`Saison ${r.season} · toutes compétitions`}>
        <Table
          caption="Statistiques de la saison"
          head={["Statistique", "Total", "Par 90 min"]}
          rows={[
            [
              "Matchs (titularisations ≥ 60 min)",
              `${s.matches} (${s.starts})`,
              "",
            ],
            ["Minutes", fmt(s.minutes), ""],
            stat("Buts", "goals"),
            stat("Passes décisives", "assists"),
            stat("xG", "xg", 2),
            stat("xA", "xa", 2),
            stat("Tirs", "shots"),
            stat("Tirs cadrés", "shotsOnTarget"),
            stat("Occasions créées", "chancesCreated"),
            stat("Grosses occasions créées", "bigChancesCreated"),
            stat("Passes réussies", "passesAccurate"),
            stat("Passes dans le dernier tiers", "passesFinalThird"),
            stat("Touches dans la surface", "touchesBox"),
            stat("Dribbles réussis", "dribbles"),
            stat("Duels gagnés", "duelsWon"),
            stat("Duels perdus", "duelsLost"),
            stat("Tacles", "tackles"),
            stat("Interceptions", "interceptions"),
            stat("Récupérations", "recoveries"),
          ]}
        />
      </Card>
      {r.power?.blocks?.length ? (
        <Card title="Profil par phase de jeu">
          <Table
            caption="Profil"
            head={["Phase", "Centile au poste", "Contribution"]}
            rows={r.power.blocks.map((b) => [
              b.label,
              fmt(b.percentile, 1),
              fmt(b.contribution, 2),
            ])}
          />
        </Card>
      ) : null}
      <Card title="Tous ses matchs">
        <Table
          caption="Matchs"
          head={[
            "Date",
            "Compétition",
            "Adversaire",
            "Score",
            "Min",
            "Note",
            "B",
            "PD",
            "xG",
            "xA",
            "Tirs",
            "Cadrés",
            "Occ.",
            "Passes",
            "Duels",
          ]}
          rows={r.appearances
            .slice()
            .reverse()
            .map((a) => [
              a.date || "—",
              a.league || "—",
              `${a.home ? "" : "@ "}${a.opponent || "?"}`,
              a.score || "—",
              a.minutes,
              a.grade == null ? "—" : <Grade value={a.grade} />,
              a.goals,
              a.assists,
              fmt(a.xg, 2),
              fmt(a.xa, 2),
              a.shots,
              a.shotsOnTarget,
              a.chancesCreated,
              fmt(a.passesAccurate),
              fmt(a.duelsWon),
            ])}
        />
      </Card>
      {r.values.history.length ? (
        <Card title="Valeur marchande">
          <Table
            caption="Valeurs"
            head={["Date", "Valeur"]}
            rows={r.values.history
              .slice()
              .reverse()
              .map((v) => [v.date, `${number(v.valueEur / 1e6, 1)} M€`])}
          />
        </Card>
      ) : null}
    </>
  );
}

function ClubTechnical({ r }) {
  const rec = r.record,
    o = r.outlook;
  return (
    <>
      <Card title="Le club">
        <Table
          caption="Le club"
          head={["", ""]}
          rows={[
            ["Championnat", r.club.league || "—"],
            [
              "Score Vega",
              r.power
                ? `${fmt(r.power.score)} / 100 · ${r.power.rank}e sur ${r.power.of} · Elo ${fmt(r.power.elo)} (${r.power.eloChange >= 0 ? "+" : ""}${fmt(r.power.eloChange)})`
                : "Hors des 200 premiers",
            ],
            [
              "Bilan",
              `${rec.matches} matchs · ${rec.wins} V, ${rec.draws} N, ${rec.losses} D · ${rec.points} pts`,
            ],
            ["Buts", `${rec.goalsFor} marqués, ${rec.goalsAgainst} encaissés`],
            [
              "xG",
              `${fmt(rec.xgFor, 1)} pour, ${fmt(rec.xgAgainst, 1)} contre`,
            ],
          ]}
        />
      </Card>
      <Card title="Tous ses matchs">
        <Table
          caption="Matchs"
          head={[
            "Date",
            "Compétition",
            "Adversaire",
            "Score",
            "Résultat",
            "xG pour",
            "xG contre",
          ]}
          rows={r.matches
            .slice()
            .reverse()
            .map((m) => [
              m.date,
              m.league || "—",
              `${m.home ? "" : "@ "}${m.opponent.name || "?"}`,
              `${m.scored}-${m.conceded}`,
              m.result || "—",
              fmt(m.xgFor, 2),
              fmt(m.xgAgainst, 2),
            ])}
        />
      </Card>
      <Card title="Les joueurs">
        <Table
          caption="Joueurs"
          head={[
            "Joueur",
            "Matchs",
            "Minutes",
            "Note de saison",
            "Buts",
            "PD",
            "xG",
            "xA",
          ]}
          rows={r.players.map((p) => [
            p.name || "—",
            p.matches,
            fmt(p.minutes),
            p.grade == null ? "—" : <Grade value={p.grade} />,
            p.goals,
            p.assists,
            fmt(p.xg, 2),
            fmt(p.xa, 2),
          ])}
        />
      </Card>
      {o ? (
        <Card title="Projection de fin de saison">
          <p className="card-note">{`Après ${o.played} matchs : ${o.points} points, ${o.position}e. Points projetés : ${fmt(o.projectedPoints, 1)}.`}</p>
          <Table
            caption="Chances par place"
            head={["Place", "Chance"]}
            rows={o.places.map((x, i) => [`${i + 1}e`, pct(x)])}
          />
        </Card>
      ) : null}
      {r.upcoming.length ? (
        <Card title="Prochains matchs">
          <Table
            caption="À venir"
            head={[
              "Date",
              "Compétition",
              "Adversaire",
              "Victoire",
              "Nul",
              "Défaite",
            ]}
            rows={r.upcoming.map((m) => [
              m.date,
              m.league || "—",
              `${m.home ? "" : "@ "}${m.opponent || "?"}`,
              m.win == null ? "—" : `${m.win} %`,
              m.draw == null ? "—" : `${m.draw} %`,
              m.loss == null ? "—" : `${m.loss} %`,
            ])}
          />
        </Card>
      ) : null}
    </>
  );
}

function MatchTechnical({ r }) {
  const m = r.match;
  const minutes = r.timeline.filter((p) => p.minute % 15 === 0);
  return (
    <>
      <Card title="Le match">
        <Table
          caption="Le match"
          head={["", ""]}
          rows={[
            [
              "Compétition",
              [m.league, m.round ? `journée ${m.round}` : null]
                .filter(Boolean)
                .join(" · ") || "—",
            ],
            ["Date", m.date || "—"],
            [
              "Score",
              m.home.score == null
                ? "À jouer"
                : `${m.home.name} ${m.home.score} – ${m.away.score} ${m.away.name}`,
            ],
            ["Stade", m.stadium || "—"],
            ["Arbitre", m.referee || "—"],
            [
              "Pronostic au coup d’envoi",
              r.before
                ? `${r.before.home} % · nul ${r.before.draw} % · ${r.before.away} %`
                : "—",
            ],
          ]}
        />
      </Card>
      <Card title="Statistiques">
        <Table
          caption="Statistiques"
          head={[m.home.name, "", m.away.name]}
          rows={r.stats.map((s) => [s.homeText, s.label, s.awayText])}
        />
      </Card>
      <Card title="Les notes de tous les joueurs">
        <Table
          caption="Notes"
          head={["Joueur", "Équipe", "Poste", "Min", "Buts", "PD", "Note"]}
          rows={r.grades.map((p) => [
            p.name,
            p.team,
            p.position || "—",
            p.minutes,
            p.goals,
            p.assists,
            p.grade == null ? "—" : <Grade value={p.grade} />,
          ])}
        />
      </Card>
      {minutes.length ? (
        <Card title="Probabilité de victoire, de quart d’heure en quart d’heure">
          <Table
            caption="Probabilités"
            head={["Minute", m.home.name, "Nul", m.away.name]}
            rows={minutes.map((p) => [
              `${p.minute}e`,
              pct(p.home * 100),
              pct(p.draw * 100),
              pct(p.away * 100),
            ])}
          />
        </Card>
      ) : null}
    </>
  );
}
