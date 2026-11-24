/**
 * The six images of a report (1080 × 1350, for a thread on X): JSX for next/og (Satori:
 * flexbox only, every block with more than one child in display: flex). `report` comes
 * from report-data.js; `images` maps an image URL to a data URL fetched beforehand (an
 * image that could not be read is drawn as initials).
 */
import React from "react";
import { badgeOverflow, placeBadges } from "../services/curve-badges.js";
import { REPORT_TITLES } from "../services/reports.js";
import { BRAND_IVORY, WORDMARK } from "../brand-mark.js";

export const WIDTH = 1080, HEIGHT = 1350;
const BG = "#06080C", PANEL = "#0F141C", LINE = "#1F2835", INK = "#F4F7FB", MUTED = "#8C97A8", SOFT = "#C9D3E0";
const ACCENT = "#3C96E7", WARM = "#F08A4B", WIN = "#3FB97A", DRAW = "#8C97A8", LOSS = "#E5555A";
// The wordmark « Vega. » at the top of every card, in the logo's ivory (src/brand-mark.js).
const MARK_HEIGHT = 58;

export const TITLES = REPORT_TITLES;

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fr = (value, digits = 0) =>
  value == null || Number.isNaN(value) ? "—" : Number(value).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const day = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const money = (eur) => (eur == null ? "—" : eur >= 1e6 ? `${fr(eur / 1e6, eur % 1e6 && eur < 1e7 ? 1 : 0)} M€` : `${fr(eur / 1e3, 0)} k€`);
/** A probability in percent as shown: never 0 or 100 when it is not exactly so. */
const chance = (x) => (x == null ? "—" : x > 0 && x < 0.5 ? "< 1 %" : x >= 99.5 && x < 100 ? "> 99 %" : `${fr(x, 0)} %`);
const gradeColor = (g) => (g == null ? MUTED : g >= 70 ? ACCENT : g < 30 ? WARM : SOFT);
const resultColor = (r) => (r === "V" ? WIN : r === "D" ? LOSS : DRAW);
const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Img({ src, images, size, round = true, name }) {
  const data = src && images?.[src];
  if (data)
    return <img src={data} width={size} height={size} style={{ width: size, height: size, borderRadius: round ? size / 2 : 12, objectFit: "cover", background: PANEL }} />;
  return (
    <div style={{ display: "flex", width: size, height: size, borderRadius: round ? size / 2 : 12, background: PANEL, border: `2px solid ${LINE}`,
      alignItems: "center", justifyContent: "center", color: MUTED, fontSize: Math.round(size / 3), fontWeight: 700 }}>
      {initials(name)}
    </div>
  );
}

function Pill({ value, size = 34 }) {
  return (
    <div style={{ display: "flex", padding: `${Math.round(size / 4)}px ${Math.round(size / 2)}px`, borderRadius: 999, border: `2px solid ${gradeColor(value)}`,
      color: gradeColor(value), fontSize: size, fontWeight: 700 }}>
      {value == null ? "—" : fr(value, 0)}
    </div>
  );
}

function Frame({ report, n, children, subtitle }) {
  const title = TITLES[report.kind][n - 1];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: WIDTH, height: HEIGHT, background: BG, color: INK, fontFamily: "Inter", padding: "60px 72px 48px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg width={Math.round((MARK_HEIGHT * WORDMARK.width) / WORDMARK.height)} height={MARK_HEIGHT} viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}>
            <path d={WORDMARK.letters} fill={BRAND_IVORY} />
            <circle cx={WORDMARK.point.cx} cy={WORDMARK.point.cy} r={WORDMARK.point.r} fill={BRAND_IVORY} />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{report.title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 44 }}>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
        {subtitle ? <div style={{ display: "flex", fontSize: 28, color: MUTED, marginTop: 14 }}>{subtitle}</div> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 40 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 22, fontSize: 22, color: MUTED }}>
        <div style={{ display: "flex" }}>vegasport.vercel.app</div>
        <div style={{ display: "flex" }}>{`${n}/6 · données au ${day(report.generatedAt)}`}</div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, color = INK, width = 296 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width, padding: "26px 28px", background: PANEL, borderRadius: 24, marginBottom: 22 }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{label}</div>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color, marginTop: 6 }}>{value}</div>
      {sub ? <div style={{ display: "flex", fontSize: 22, color: MUTED, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function Tiles({ items, width }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between" }}>
      {items.map((item) => <Tile key={item.label} width={width} {...item} />)}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", fontSize: 34, color: MUTED, textAlign: "center" }}>{text}</div>;
}

function HBar({ label, value, text, color = ACCENT, max = 100 }) {
  const share = Math.max(0, Math.min(1, (value ?? 0) / max));
  return (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: 30 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30 }}>
        <div style={{ display: "flex" }}>{label}</div>
        <div style={{ display: "flex", fontWeight: 700, color }}>{text}</div>
      </div>
      <div style={{ display: "flex", height: 22, borderRadius: 11, background: PANEL, marginTop: 12 }}>
        <div style={{ display: "flex", width: `${Math.round(share * 100)}%`, height: 22, borderRadius: 11, background: color }} />
      </div>
    </div>
  );
}

/** One line of a match: date, opponent, score, and what the line is about. */
function MatchRow({ left, middle, right, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "18px 0", borderBottom: `2px solid ${LINE}` }}>
      <div style={{ display: "flex", width: 170, flexShrink: 0, fontSize: 24, color: MUTED }}>{left}</div>
      <div style={{ display: "flex", flexGrow: 1, fontSize: 30 }}>{middle}</div>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: color || INK }}>{right}</div>
    </div>
  );
}

// Player -----------------------------------------------------------------------

function playerCard(r, n, images) {
  const p = r.player, s = r.seasonStats, power = r.power;
  if (n === 1)
    return (
      <Frame report={r} n={n} subtitle={[p.team?.name, p.team?.league].filter(Boolean).join(" · ")}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Img src={p.imageUrl} images={images} size={280} name={p.name} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 48 }}>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>{p.name}</div>
            <div style={{ display: "flex", fontSize: 30, color: SOFT, marginTop: 10 }}>
              {[p.position, p.age != null ? `${p.age} ans` : null, p.country].filter(Boolean).join(" · ")}
            </div>
            {p.contractUntil ? <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 8 }}>{`Sous contrat jusqu'en ${p.contractUntil.slice(0, 4)}`}</div> : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56, padding: "36px 40px", background: PANEL, borderRadius: 28 }}>
          <div style={{ display: "flex", fontSize: 28, color: MUTED }}>Score Vega de la saison</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 6 }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700, color: ACCENT, lineHeight: 1 }}>{power?.score != null ? fr(power.score, 0) : "—"}</div>
            <div style={{ display: "flex", fontSize: 40, color: MUTED, marginLeft: 12, marginBottom: 18 }}>/100</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, marginTop: 14 }}>
            {power ? `${power.rank}${power.rank === 1 ? "er" : "e"} au classement Vega · ${power.roleRank}${power.roleRank === 1 ? "er" : "e"} à son poste${power.provisional ? " (provisoire)" : ""}` : "Pas encore classé"}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36 }}>
          {[["Matchs", fr(s.matches)], ["Minutes", fr(s.minutes)], ["Buts", fr(s.totals.goals)], ["Passes déc.", fr(s.totals.assists)]].map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 220 }}>
              <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>{value}</div>
              <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{label}</div>
            </div>
          ))}
        </div>
      </Frame>
    );
  if (n === 2)
    return (
      <Frame report={r} n={n} subtitle={`${r.season} · toutes compétitions · ${fr(s.minutes)} minutes`}>
        <Tiles width={452} items={[
          { label: "Buts", value: fr(s.totals.goals), sub: `${fr(s.per90.goals, 2)} par 90 min` },
          { label: "Passes décisives", value: fr(s.totals.assists), sub: `${fr(s.per90.assists, 2)} par 90 min` },
          { label: "xG", value: fr(s.totals.xg, 1), sub: `${fr(s.per90.xg, 2)} par 90 min` },
          { label: "xA", value: fr(s.totals.xa, 1), sub: `${fr(s.per90.xa, 2)} par 90 min` },
          { label: "Tirs (cadrés)", value: `${fr(s.totals.shots)} (${fr(s.totals.shotsOnTarget)})`, sub: `${fr(s.per90.shots, 1)} par 90 min` },
          { label: "Note Vega de saison", value: s.grade == null ? "—" : fr(s.grade, 0), sub: `sur 100 · ${s.graded} matchs notés`, color: gradeColor(s.grade) },
        ]} />
      </Frame>
    );
  if (n === 3)
    return (
      <Frame report={r} n={n} subtitle={power ? `Centile parmi les ${fr(power.roleCount)} joueurs classés à son poste` : ""}>
        {power?.blocks?.length ? power.blocks.map((b) => (
          <HBar key={b.key} label={b.label} value={b.percentile} text={b.percentile == null ? "—" : `${fr(b.percentile, 0)}e centile`}
            color={b.percentile >= 80 ? ACCENT : b.percentile < 30 ? WARM : SOFT} />
        )) : <Empty text="Profil indisponible pour cette saison." />}
      </Frame>
    );
  if (n === 4) {
    const rows = r.last;
    return (
      <Frame report={r} n={n} subtitle="Note Vega sur 100 de ses dix derniers matchs (50 = un match ordinaire à son poste)">
        {rows.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((a) => (
              <div key={a.matchId} style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
                <div style={{ display: "flex", width: 330, flexShrink: 0, fontSize: 26, overflow: "hidden", whiteSpace: "nowrap" }}>{`${a.home ? "" : "@ "}${a.opponent || "?"}`}</div>
                <div style={{ display: "flex", width: 90, flexShrink: 0, fontSize: 24, color: resultColor(a.result) }}>{a.score || ""}</div>
                <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, height: 34, background: PANEL, borderRadius: 10, marginRight: 16 }}>
                  <div style={{ display: "flex", width: `${Math.max(2, Math.round(a.grade ?? 0))}%`, height: 34, borderRadius: 10, background: gradeColor(a.grade) }} />
                </div>
                <div style={{ display: "flex", width: 80, flexShrink: 0, justifyContent: "flex-end", fontSize: 30, fontWeight: 700, color: gradeColor(a.grade) }}>{a.grade == null ? "—" : fr(a.grade, 0)}</div>
              </div>
            ))}
          </div>
        ) : <Empty text="Aucun match noté cette saison." />}
      </Frame>
    );
  }
  if (n === 5) {
    const history = r.values.history;
    if (history.length < 2)
      return <Frame report={r} n={n}><Empty text="Aucune estimation disponible." /></Frame>;
    // The clubs he joined float above the curve at the date of each transfer, as on the player
    // page: a badge of 52 px on a stem; the panel grows by what a stack of badges needs.
    const clubs = r.values.clubs || [], radius = 26, side = clubs.length ? radius + 6 : 10;
    const w = 936, plot = 560, times = history.map((v) => Date.parse(v.date)), max = Math.max(...history.map((v) => v.valueEur));
    const t0 = Math.min(...times), last = Math.max(...times), t1 = Math.max(last, ...clubs.map((c) => Date.parse(c.at)));
    const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 2 * side) + side, rise = (v) => (v / max) * (plot - 60);
    const loose = placeBadges(history.map((v, i) => ({ x: x(times[i]), y: plot - 20 - rise(v.valueEur) })), clubs.map((c) => ({ x: x(Date.parse(c.at)) })),
      { radius, gap: 12, margin: 4, spacing: 6 });
    const lift = Math.min(150, Math.ceil(badgeOverflow(loose, radius, 10))), h = plot + lift;
    const y = (v) => h - 20 - rise(v);
    const spots = loose.map((spot) => ({ x: spot.x, y: Math.max(radius + 4, spot.y + lift), footY: spot.footY + lift }));
    const path = history.map((v, i) => `${i ? "L" : "M"} ${x(times[i]).toFixed(1)} ${y(v.valueEur).toFixed(1)}`).join(" ");
    return (
      <Frame report={r} n={n} subtitle={`${history.length} estimations depuis ${history[0].date.slice(0, 4)}`}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 110, fontWeight: 700, color: ACCENT }}>{money(r.values.current?.valueEur)}</div>
          <div style={{ display: "flex", fontSize: 28, color: MUTED, marginLeft: 20, marginBottom: 22 }}>{`au ${day(r.values.current?.date)}`}</div>
        </div>
        <div style={{ display: "flex", position: "relative", width: w, height: h, marginTop: 30, background: PANEL, borderRadius: 24 }}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
            <path d={`${path} L ${x(last).toFixed(1)} ${h - 20} L ${x(t0).toFixed(1)} ${h - 20} Z`} fill="rgba(60,150,231,0.18)" />
            <path d={path} stroke={ACCENT} strokeWidth="6" fill="none" />
            {t1 > last ? <path d={`M ${x(last).toFixed(1)} ${y(history.at(-1).valueEur).toFixed(1)} L ${x(t1).toFixed(1)} ${y(history.at(-1).valueEur).toFixed(1)}`} stroke={ACCENT} strokeWidth="6" strokeDasharray="4 14" fill="none" /> : null}
            {spots.map((spot, i) => <path key={`s${i}`} d={`M ${spot.x.toFixed(1)} ${spot.footY.toFixed(1)} L ${spot.x.toFixed(1)} ${(spot.y + radius).toFixed(1)}`} stroke={ACCENT} strokeWidth="2" fill="none" />)}
            {spots.map((spot, i) => <circle key={`f${i}`} cx={spot.x} cy={spot.footY} r="8" fill={PANEL} stroke={ACCENT} strokeWidth="4" />)}
          </svg>
          {spots.map((spot, i) => {
            const data = clubs[i].imageUrl && images?.[clubs[i].imageUrl];
            return (
              <div key={`b${i}`} style={{ display: "flex", position: "absolute", left: spot.x - radius, top: spot.y - radius, width: 2 * radius, height: 2 * radius, borderRadius: radius,
                background: BG, border: `2px solid ${ACCENT}`, alignItems: "center", justifyContent: "center", color: SOFT, fontSize: 18, fontWeight: 700 }}>
                {data ? <img src={data} width={34} height={34} style={{ width: 34, height: 34, objectFit: "contain" }} /> : initials(clubs[i].name)}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: MUTED, marginTop: 14 }}>
          <div style={{ display: "flex" }}>{history[0].date.slice(0, 4)}</div>
          <div style={{ display: "flex" }}>{`maximum ${money(max)}`}</div>
          <div style={{ display: "flex" }}>{history.at(-1).date.slice(0, 4)}</div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame report={r} n={n} subtitle="Ses trois meilleures notes Vega de la saison">
      {r.best.length ? r.best.map((a, i) => (
        <div key={a.matchId} style={{ display: "flex", alignItems: "center", padding: "30px 34px", background: PANEL, borderRadius: 26, marginBottom: 26 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: MUTED, width: 70 }}>{String(i + 1)}</div>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{`${a.home ? "contre" : "à"} ${a.opponent || "?"} · ${a.score || ""}`}</div>
            <div style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 6 }}>{`${day(a.date)} · ${a.league || ""}`}</div>
            <div style={{ display: "flex", fontSize: 26, color: SOFT, marginTop: 10 }}>
              {`${a.goals} but${a.goals > 1 ? "s" : ""} · ${a.assists} passe${a.assists > 1 ? "s" : ""} déc. · ${fr(a.xg, 2)} xG · ${a.shots} tirs · ${a.minutes} min`}
            </div>
          </div>
          <Pill value={a.grade} size={44} />
        </div>
      )) : <Empty text="Aucun match noté cette saison." />}
    </Frame>
  );
}

// Club -------------------------------------------------------------------------

function clubCard(r, n, images) {
  const c = r.club, rec = r.record;
  if (n === 1)
    return (
      <Frame report={r} n={n} subtitle={[c.league, r.season].filter(Boolean).join(" · ")}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Img src={c.imageUrl} images={images} size={240} round={false} name={c.name} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 48 }}>
            <div style={{ display: "flex", fontSize: 60, fontWeight: 700 }}>{c.name}</div>
            <div style={{ display: "flex", fontSize: 30, color: SOFT, marginTop: 10 }}>
              {r.outlook ? `${r.outlook.position}${r.outlook.position === 1 ? "er" : "e"} de ${c.league || "son championnat"} · ${r.outlook.points} pts` : c.league || ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56, padding: "36px 40px", background: PANEL, borderRadius: 28 }}>
          <div style={{ display: "flex", fontSize: 28, color: MUTED }}>Score Vega du club</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 6 }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 700, color: ACCENT, lineHeight: 1 }}>{r.power?.score != null ? fr(r.power.score, 0) : "—"}</div>
            <div style={{ display: "flex", fontSize: 40, color: MUTED, marginLeft: 12, marginBottom: 18 }}>/100</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, marginTop: 14 }}>
            {r.power ? `${r.power.rank}${r.power.rank === 1 ? "er" : "e"} au Power Ranking · Elo ${fr(r.power.elo)} (${r.power.eloChange >= 0 ? "+" : ""}${fr(r.power.eloChange)} cette saison)` : "Hors des 200 premiers clubs"}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36 }}>
          {[["Matchs", fr(rec.matches)], ["V-N-D", `${rec.wins}-${rec.draws}-${rec.losses}`], ["Buts", `${rec.goalsFor}-${rec.goalsAgainst}`], ["xG", `${fr(rec.xgFor, 0)}-${fr(rec.xgAgainst, 0)}`]].map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 220 }}>
              <div style={{ display: "flex", fontSize: 50, fontWeight: 700 }}>{value}</div>
              <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{label}</div>
            </div>
          ))}
        </div>
      </Frame>
    );
  if (n === 2)
    return (
      <Frame report={r} n={n} subtitle="Les dix derniers matchs, toutes compétitions">
        <div style={{ display: "flex", marginBottom: 26 }}>
          {r.form.map((m) => (
            <div key={m.id} style={{ display: "flex", width: 76, height: 76, marginRight: 14, borderRadius: 16, background: resultColor(m.result), alignItems: "center",
              justifyContent: "center", fontSize: 36, fontWeight: 700, color: BG }}>{m.result || "?"}</div>
          ))}
        </div>
        {r.form.slice().reverse().slice(0, 8).map((m) => (
          <MatchRow key={m.id} left={day(m.date)} middle={`${m.home ? "" : "@ "}${m.opponent.name || "?"}`} right={`${m.scored}-${m.conceded}`} color={resultColor(m.result)} />
        ))}
      </Frame>
    );
  if (n === 3) {
    const rows = r.form;
    const max = Math.max(1, ...rows.map((m) => Math.max(m.xgFor ?? 0, m.xgAgainst ?? 0)));
    return (
      <Frame report={r} n={n} subtitle={`Saison : ${fr(rec.xgFor, 1)} xG pour, ${fr(rec.xgAgainst, 1)} contre · ${rec.goalsFor} buts marqués, ${rec.goalsAgainst} encaissés`}>
        {rows.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
            <div style={{ display: "flex", width: 300, flexShrink: 0, fontSize: 24, overflow: "hidden", whiteSpace: "nowrap" }}>{`${m.home ? "" : "@ "}${m.opponent.name || "?"}`}</div>
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
              <div style={{ display: "flex", height: 18, width: `${Math.round(((m.xgFor ?? 0) / max) * 100)}%`, background: ACCENT, borderRadius: 9 }} />
              <div style={{ display: "flex", height: 18, width: `${Math.round(((m.xgAgainst ?? 0) / max) * 100)}%`, background: WARM, borderRadius: 9, marginTop: 6 }} />
            </div>
            <div style={{ display: "flex", width: 150, flexShrink: 0, justifyContent: "flex-end", fontSize: 26, fontWeight: 700 }}>{`${fr(m.xgFor, 1)} – ${fr(m.xgAgainst, 1)}`}</div>
          </div>
        ))}
        <div style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 10 }}>
          <div style={{ display: "flex", width: 22, height: 22, background: ACCENT, borderRadius: 6, marginRight: 10 }} />
          <div style={{ display: "flex", marginRight: 30 }}>xG pour</div>
          <div style={{ display: "flex", width: 22, height: 22, background: WARM, borderRadius: 6, marginRight: 10 }} />
          <div style={{ display: "flex" }}>xG contre</div>
        </div>
      </Frame>
    );
  }
  if (n === 4)
    return (
      <Frame report={r} n={n} subtitle="Note Vega de saison avec le club (titulaires réguliers)">
        {r.top.length ? r.top.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", padding: "20px 0", borderBottom: `2px solid ${LINE}` }}>
            <div style={{ display: "flex", width: 56, fontSize: 36, fontWeight: 700, color: MUTED }}>{String(i + 1)}</div>
            <Img src={p.imageUrl} images={images} size={96} name={p.name} />
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginLeft: 26 }}>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{p.name}</div>
              <div style={{ display: "flex", fontSize: 24, color: MUTED, marginTop: 4 }}>{`${p.matches} matchs · ${fr(p.minutes)} min · ${p.goals} but${p.goals > 1 ? "s" : ""} · ${p.assists} passe${p.assists > 1 ? "s" : ""} déc.`}</div>
            </div>
            <Pill value={p.grade} />
          </div>
        )) : <Empty text="Pas encore assez de matchs notés." />}
      </Frame>
    );
  if (n === 5) {
    const o = r.outlook;
    if (!o) return <Frame report={r} n={n}><Empty text="Pas de projection pour ce championnat." /></Frame>;
    return (
      <Frame report={r} n={n} subtitle={`${c.league} · 1 000 fins de saison simulées après ${o.played} journées`}>
        <Tiles width={452} items={[
          { label: "Points projetés", value: fr(o.projectedPoints, 0), sub: `${o.points} pts aujourd'hui, ${o.position}${o.position === 1 ? "er" : "e"}` },
          { label: "Champion", value: chance(o.title), color: ACCENT },
          { label: "Dans les 4 premiers", value: chance(o.top4) },
          { label: "Relégation", value: chance(o.relegation), color: o.relegation >= 20 ? WARM : INK, sub: "les trois dernières places" },
        ]} />
      </Frame>
    );
  }
  return (
    <Frame report={r} n={n} subtitle="Pronostics Vega des prochains matchs">
      {r.upcoming.length ? r.upcoming.map((m) => (
        <div key={m.id} style={{ display: "flex", flexDirection: "column", padding: "28px 32px", background: PANEL, borderRadius: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Img src={m.opponentImageUrl} images={images} size={72} round={false} name={m.opponent} />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 22 }}>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{`${m.home ? "contre" : "à"} ${m.opponent || "?"}`}</div>
              <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{`${day(m.date)} · ${m.league || ""}`}</div>
            </div>
          </div>
          {m.win != null ? (
            <div style={{ display: "flex", marginTop: 22, height: 54, borderRadius: 12 }}>
              {[["Victoire", m.win, WIN], ["Nul", m.draw, DRAW], ["Défaite", m.loss, LOSS]].map(([label, value, color]) => (
                <div key={label} style={{ display: "flex", width: `${Math.max(value, 8)}%`, background: color, alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: BG }}>
                  {`${value} %`}
                </div>
              ))}
            </div>
          ) : <div style={{ display: "flex", marginTop: 16, fontSize: 24, color: MUTED }}>Pronostic pas encore publié</div>}
        </div>
      )) : <Empty text="Aucun match programmé." />}
    </Frame>
  );
}

// Match ------------------------------------------------------------------------

function matchCard(r, n, images) {
  const m = r.match;
  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 34 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Img src={m.home.imageUrl} images={images} size={64} round={false} name={m.home.name} />
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, marginLeft: 16 }}>{m.home.name}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, marginRight: 16 }}>{m.away.name}</div>
        <Img src={m.away.imageUrl} images={images} size={64} round={false} name={m.away.name} />
      </div>
    </div>
  );
  if (n === 1)
    return (
      <Frame report={r} n={n} subtitle={[m.league, m.round ? `journée ${m.round}` : null, day(m.date)].filter(Boolean).join(" · ")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 30 }}>
          {[m.home, m.away].map((side, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 330 }}>
              <Img src={side.imageUrl} images={images} size={220} round={false} name={side.name} />
              <div style={{ display: "flex", fontSize: 38, fontWeight: 700, marginTop: 24, textAlign: "center" }}>{side.name}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "center", fontSize: 190, fontWeight: 700, marginTop: 30 }}>
          {m.home.score == null ? "–" : `${m.home.score} – ${m.away.score}`}
        </div>
        <div style={{ display: "flex", justifyContent: "center", fontSize: 32, color: MUTED, marginTop: 10 }}>
          {r.xg ? `xG ${fr(r.xg.home, 2)} – ${fr(r.xg.away, 2)}` : ""}
        </div>
        <div style={{ display: "flex", justifyContent: "center", fontSize: 26, color: MUTED, marginTop: 30 }}>{[m.stadium, m.referee ? `arbitre ${m.referee}` : null].filter(Boolean).join(" · ")}</div>
      </Frame>
    );
  if (n === 2)
    return (
      <Frame report={r} n={n}>
        {header}
        {r.stats.length ? r.stats.slice(0, 9).map((s) => {
          const total = (s.home ?? 0) + (s.away ?? 0) || 1;
          const text = (v) => (s.format === "decimal" ? fr(v, 2) : s.format === "percent" ? `${fr(v)} %` : fr(v));
          return (
            <div key={s.key} style={{ display: "flex", flexDirection: "column", marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30 }}>
                <div style={{ display: "flex", fontWeight: 700 }}>{text(s.home)}</div>
                <div style={{ display: "flex", color: MUTED }}>{s.label}</div>
                <div style={{ display: "flex", fontWeight: 700 }}>{text(s.away)}</div>
              </div>
              <div style={{ display: "flex", height: 16, marginTop: 8, borderRadius: 8, background: PANEL }}>
                <div style={{ display: "flex", width: `${Math.round(((s.home ?? 0) / total) * 100)}%`, background: ACCENT, borderRadius: 8 }} />
                <div style={{ display: "flex", flexGrow: 1 }} />
                <div style={{ display: "flex", width: `${Math.round(((s.away ?? 0) / total) * 100)}%`, background: WARM, borderRadius: 8 }} />
              </div>
            </div>
          );
        }) : <Empty text="Statistiques indisponibles." />}
      </Frame>
    );
  if (n === 3) {
    const pts = r.timeline;
    if (pts.length < 2) return <Frame report={r} n={n}><Empty text="Courbe indisponible pour ce match." /></Frame>;
    const w = 936, h = 640, last = Math.max(...pts.map((p) => p.minute), 90);
    const x = (minute) => (minute / last) * w;
    const band = (from, to) => {
      const top = pts.map((p) => `${x(p.minute).toFixed(1)} ${(h * to(p)).toFixed(1)}`);
      const bottom = pts.slice().reverse().map((p) => `${x(p.minute).toFixed(1)} ${(h * from(p)).toFixed(1)}`);
      return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
    };
    return (
      <Frame report={r} n={n} subtitle="Chances de victoire de chaque équipe minute par minute, modèle en direct de Vega">
        {header}
        <div style={{ display: "flex", background: PANEL, borderRadius: 20 }}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
            <path d={band(() => 0, (p) => p.home)} fill={ACCENT} />
            <path d={band((p) => p.home, (p) => p.home + p.draw)} fill="#2A3342" />
            <path d={band((p) => p.home + p.draw, () => 1)} fill={WARM} />
            {r.events.filter((e) => e.kind === "goal").map((e, i) => (
              <path key={i} d={`M ${x(Math.min(e.minute, last)).toFixed(1)} 0 L ${x(Math.min(e.minute, last)).toFixed(1)} ${h}`} stroke={INK} strokeWidth="3" strokeDasharray="10 8" />
            ))}
          </svg>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: MUTED, marginTop: 14 }}>
          <div style={{ display: "flex" }}>{`Coup d'envoi : ${r.before?.home ?? "—"} % · nul ${r.before?.draw ?? "—"} % · ${r.before?.away ?? "—"} %`}</div>
          <div style={{ display: "flex" }}>pointillés : les buts</div>
        </div>
      </Frame>
    );
  }
  if (n === 4)
    return (
      <Frame report={r} n={n} subtitle="Note Vega sur 100 : le match de chacun face à ce qu'on attend de son poste">
        {[["home", m.home], ["away", m.away]].map(([side, team]) => (
          <div key={side} style={{ display: "flex", flexDirection: "column", marginBottom: 30 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <Img src={team.imageUrl} images={images} size={52} round={false} name={team.name} />
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700, marginLeft: 14 }}>{team.name}</div>
            </div>
            {r.best[side].map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", padding: "14px 0", borderBottom: `2px solid ${LINE}` }}>
                <Img src={p.imageUrl} images={images} size={72} name={p.name} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginLeft: 20 }}>
                  <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ display: "flex", fontSize: 22, color: MUTED }}>{`${p.position || ""} · ${p.minutes} min${p.goals ? ` · ${p.goals} but${p.goals > 1 ? "s" : ""}` : ""}${p.assists ? ` · ${p.assists} passe${p.assists > 1 ? "s" : ""} déc.` : ""}`}</div>
                </div>
                <Pill value={p.grade} size={30} />
              </div>
            ))}
          </div>
        ))}
      </Frame>
    );
  if (n === 5) {
    const b = r.before;
    if (!b) return <Frame report={r} n={n}><Empty text="Pas de pronostic pour ce match." /></Frame>;
    const result = m.home.score == null ? null : m.home.score > m.away.score ? "home" : m.home.score < m.away.score ? "away" : "draw";
    return (
      <Frame report={r} n={n} subtitle="Ce que donnait le modèle de Vega au coup d'envoi">
        {header}
        {[["home", `Victoire ${m.home.name}`, ACCENT], ["draw", "Match nul", SOFT], ["away", `Victoire ${m.away.name}`, WARM]].map(([key, label, color]) => (
          <HBar key={key} label={`${label}${result === key ? " (résultat)" : ""}`} value={b[key]} text={`${b[key]} %`} color={color} />
        ))}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 20, padding: "28px 32px", background: PANEL, borderRadius: 24 }}>
          <div style={{ display: "flex", fontSize: 28, color: MUTED }}>Résultat</div>
          <div style={{ display: "flex", fontSize: 48, fontWeight: 700, marginTop: 6 }}>{m.home.score == null ? "À jouer" : `${m.home.score} – ${m.away.score}`}</div>
          {r.xg ? <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 6 }}>{`xG ${fr(r.xg.home, 2)} – ${fr(r.xg.away, 2)}`}</div> : null}
        </div>
      </Frame>
    );
  }
  const p = r.playerOfMatch;
  if (!p) return <Frame report={r} n={n}><Empty text="Pas de notes pour ce match." /></Frame>;
  return (
    <Frame report={r} n={n} subtitle="La meilleure note Vega du match">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 20 }}>
        <Img src={p.imageUrl} images={images} size={320} name={p.name} />
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, marginTop: 34 }}>{p.name}</div>
        <div style={{ display: "flex", fontSize: 30, color: SOFT, marginTop: 10 }}>{`${p.team} · ${p.position || ""}`}</div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 40 }}>
          <div style={{ display: "flex", fontSize: 160, fontWeight: 700, color: gradeColor(p.grade), lineHeight: 1 }}>{fr(p.grade, 0)}</div>
          <div style={{ display: "flex", fontSize: 40, color: MUTED, marginLeft: 12, marginBottom: 20 }}>/100</div>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: SOFT, marginTop: 24 }}>
          {`${p.minutes} min · ${p.goals} but${p.goals > 1 ? "s" : ""} · ${p.assists} passe${p.assists > 1 ? "s" : ""} décisive${p.assists > 1 ? "s" : ""}`}
        </div>
      </div>
    </Frame>
  );
}

export function card(report, n, images = {}) {
  if (report.kind === "player") return playerCard(report, n, images);
  if (report.kind === "club") return clubCard(report, n, images);
  return matchCard(report, n, images);
}

/** The image URLs a card draws (fetched beforehand by the route). */
export function cardImages(report, n) {
  if (report.kind === "player") return n === 1 ? [report.player.imageUrl] : n === 5 ? (report.values.clubs || []).map((c) => c.imageUrl) : [];
  if (report.kind === "club")
    return n === 1 ? [report.club.imageUrl] : n === 4 ? report.top.map((p) => p.imageUrl) : n === 6 ? report.upcoming.map((m) => m.opponentImageUrl) : [];
  const m = report.match, teams = [m.home.imageUrl, m.away.imageUrl];
  if (n === 4) return [...teams, ...report.best.home.map((p) => p.imageUrl), ...report.best.away.map((p) => p.imageUrl)];
  if (n === 6) return report.playerOfMatch ? [report.playerOfMatch.imageUrl] : [];
  return teams;
}
