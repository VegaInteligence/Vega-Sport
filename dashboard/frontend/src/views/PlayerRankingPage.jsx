"use client";
import React from "react";
import Link from "next/link";
import Layout from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import BallonDorIcon from "../components/BallonDorIcon.jsx";
import { Media } from "../components/UI.jsx";
import { Term } from "../components/Hint.jsx";
import SeasonSelect from "../components/SeasonSelect.jsx";
import RankingSkeleton from "../components/RankingSkeleton.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useFavourites from "../hooks/useFavourites.js";
import { number } from "../services/format.js";
import { useBallonDorRanking, useBreakouts } from "../services/ballon-dor.js";

// « La une » (§ 87, piste B): the leader first on a wide card, the second and the third stacked beside it.
const PODIUM = [
  { rank: 1, medal: "gold" },
  { rank: 2, medal: "silver" },
  { rank: 3, medal: "bronze" },
];
const STEPS = [
  [
    "Chaque match",
    "La performance du joueur est comparée à ce qu’on attend d’un joueur au même poste, dans ce match. Un match compte davantage selon son enjeu : Ligue des champions, phases finales, Coupe du monde.",
  ],
  [
    "Par blocs",
    "Finition, création, progression, défense et conservation, pondérées selon le poste.",
  ],
  [
    "Sur la saison",
    "Du 1ᵉʳ août au 31 juillet : contribution cumulée et niveau par 90 minutes, plus le niveau du club, mesuré sur une échelle commune aux championnats.",
  ],
  [
    "Entre les postes",
    "Chaque joueur est situé par rapport à la moyenne de son poste ; les 30 meilleurs des clubs de première division sont réunis.",
  ],
];
// Varied placeholder widths, so empty rows read as names rather than bars.
const WIDTHS = [62, 48, 71, 55, 66, 44, 58, 69, 51, 63, 46, 60, 53, 67];
const width = (rank, offset = 0) =>
  `${WIDTHS[(rank * 3 + offset) % WIDTHS.length]}%`;

function Bar({ w }) {
  return <span className="rank-bar" style={{ width: w }} aria-hidden="true" />;
}
function Avatar({ entry, className }) {
  return entry ? (
    <Media
      name={entry.name}
      url={entry.imageUrl}
      className={`player-avatar ${className}`}
    />
  ) : (
    <span className={`${className} rank-avatar-empty`} aria-hidden="true">
      <Icon name="players" />
    </span>
  );
}

// The ranking's players and clubs open their own pages, on the ranking's season.
function useEntryLinks(entry) {
  const f = useFootball();
  return {
    player: entry?.playerId && f.href("/joueurs/", { id: entry.playerId }),
    club: entry?.teamId && f.href("/clubs/", { id: entry.teamId }),
  };
}
function Cell({ href, className, children, ...props }) {
  return href ? (
    <Link className={className} href={href} prefetch={false}>
      {children}
    </Link>
  ) : (
    <span className={className} {...props}>
      {children}
    </span>
  );
}

function PodiumPlace({ rank, medal, entry, second }) {
  const links = useEntryLinks(entry),
    // Effect 6: a favourite player keeps the standings' highlight of saved clubs.
    followed = useFavourites().players.has(entry?.playerId);
  return (
    <li
      className={`card podium-place podium-${medal}`}
      data-followed={followed || undefined}
      value={rank}
      aria-label={
        entry
          ? `Rang ${rank} : ${entry.name}, ${entry.team}`
          : `Rang ${rank}, à révéler`
      }
    >
      <span className="podium-rank" aria-hidden="true">
        {rank}
      </span>
      {links.player ? (
        <Link
          className="podium-photo"
          href={links.player}
          prefetch={false}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Avatar entry={entry} className="podium-avatar" />
        </Link>
      ) : (
        <Avatar entry={entry} className="podium-avatar" />
      )}
      <div className="podium-identity">
        {rank === 1 && <span className="podium-kicker">En tête de la course</span>}
        {entry ? (
          <>
            <strong>
              <Cell href={links.player}>{entry.name}</Cell>
            </strong>
            <span>
              <Cell href={links.club}>{entry.team}</Cell> · {entry.position}
            </span>
          </>
        ) : (
          <>
            <strong>À révéler</strong>
            <span>Club · poste</span>
          </>
        )}
      </div>
      <div className="podium-score">
        <span>
          <Term hint="Score Vega sur 100 de cette saison seule, sans la saison précédente : c’est lui qui départage la course au Ballon d’Or.">Score de la saison</Term>
        </span>
        <b>{entry ? number(entry.score, 1) : "—"}</b>
      </div>
      {rank === 1 && entry && second && entry.score != null && second.score != null && (
        <p className="podium-lead">
          <b>+{number(entry.score - second.score, 1)}</b> d’avance sur {second.name}
        </p>
      )}
    </li>
  );
}

function RankRow({ rank, entry, leader }) {
  const links = useEntryLinks(entry),
    followed = useFavourites().players.has(entry?.playerId);
  return (
    <li
      className="rank-row"
      data-followed={followed || undefined}
      value={rank}
      aria-label={
        entry
          ? `Rang ${rank} : ${entry.name}, ${entry.team}`
          : `Rang ${rank}, à venir`
      }
    >
      <span className="rank-number" aria-hidden="true">
        {String(rank).padStart(2, "0")}
      </span>
      <Cell
        className="rank-player"
        href={links.player}
        aria-hidden={!entry}
      >
        <Avatar entry={entry} className="rank-avatar" />
        {entry ? <strong>{entry.name}</strong> : <Bar w={width(rank)} />}
      </Cell>
      <span className="rank-position" aria-hidden={!entry}>
        {entry ? entry.position : <Bar w={width(rank, 1)} />}
      </span>
      <Cell className="rank-club" href={links.club} aria-hidden={!entry}>
        {entry ? (
          <>
            <Media name={entry.team} url={entry.teamImageUrl} />
            {entry.team}
          </>
        ) : (
          <Bar w={width(rank, 2)} />
        )}
      </Cell>
      {leader !== undefined && (
        // The row's place between the leader (full) and the 30th (a fifth); nothing read aloud, the score says it.
        <span className="rank-gap" aria-hidden="true">
          <i style={{ width: entry && leader ? `${Math.max(4, Math.min(100, 100 - (leader.score - entry.score) * leader.scale))}%` : 0 }} />
        </span>
      )}
      <span className="rank-score" aria-hidden={!entry}>
        {entry ? number(entry.score, 1) : <Bar w="70%" />}
      </span>
    </li>
  );
}

function RankColumn({ from, to, ranking }) {
  // The gauge spans the race: full at the leader's score, a fifth at the 30th's.
  const first = ranking?.find((e) => e.rank === 1)?.score,
    last = ranking?.reduce((low, e) => (e.score != null && e.score < low ? e.score : low), Infinity),
    leader = first != null && Number.isFinite(last) ? { score: first, scale: first > last ? 80 / (first - last) : 0 } : null;
  return (
    <div className="rank-column rank-column--gauged">
      <div className="rank-head">
        <span>Rang</span>
        <span>Joueur</span>
        <span>Poste</span>
        <span>Club</span>
        <span>Écart au premier</span>
        <span>
          <Term hint="Score Vega sur 100 de cette saison seule, sans la saison précédente : c’est lui qui départage la course au Ballon d’Or.">Score</Term>
        </span>
      </div>
      <ol className="rank-list" start={from} role="list">
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(
          (rank) => (
            <RankRow
              key={rank}
              rank={rank}
              entry={ranking?.find((e) => e.rank === rank)}
              leader={leader}
            />
          ),
        )}
      </ol>
    </div>
  );
}

// The breakouts take the ranking's rows; their last column is a share of the regulars.
function BreakoutColumn({ entries, from }) {
  return (
    <div className="rank-column">
      <div className="rank-head" aria-hidden="true">
        <span>Rang</span>
        <span>Joueur</span>
        <span>Poste</span>
        <span>Club</span>
        <span title="Part des titulaires de son poste que son rendement par 90 minutes dépasse">Devant</span>
      </div>
      <ol className="rank-list" start={from} role="list">
        {entries.map((entry) => (
          <RankRow key={entry.playerId} rank={entry.rank} entry={entry} />
        ))}
      </ol>
    </div>
  );
}

function Breakouts({ season }) {
  const entries = useBreakouts(season);
  if (!entries?.length) return null;
  const shown = entries.slice(0, 20),
    half = Math.ceil(shown.length / 2);
  return (
    <section className="rank-board" aria-labelledby="breakouts-title">
      <h2 id="breakouts-title">Révélations</h2>
      <p className="standings-note">
        Des joueurs de moins de 23 ans qui n’ont pas encore assez joué pour être classés, jamais titulaires une
        saison entière auparavant, et dont le rendement par 90 minutes dépasse déjà celui de la plupart des
        titulaires de leur poste. « Devant » : la part de ces titulaires qu’ils dépassent (en %). Seuls les
        joueurs dont la date de naissance est connue y figurent.
      </p>
      <div className="rank-columns">
        <BreakoutColumn entries={shown.slice(0, half)} from={1} />
        {shown.length > half && <BreakoutColumn entries={shown.slice(half)} from={half + 1} />}
      </div>
    </section>
  );
}

export default function PlayerRankingPage() {
  const f = useFootball(),
    seasons = f.manifest?.seasons || [],
    ranking = useBallonDorRanking(f.season);
  return (
    <Layout
      path="/classement-joueurs/"
      title="Classement Ballon d’Or"
      titleIcon={<BallonDorIcon />}
      className="ranking-page"
      loader={<RankingSkeleton kind="ballon" />}
      actions={
        seasons.length > 1 && (
          <SeasonSelect
            label="Saison du classement"
            className="award-season"
            value={f.season}
            seasons={seasons.map((s) => s.id)}
            onChange={f.changeSeason}
          />
        )
      }
    >
      <ol className="podium" role="list" aria-label="Podium">
        {PODIUM.map((place) => (
          <PodiumPlace
            key={place.rank}
            {...place}
            entry={ranking?.find((e) => e.rank === place.rank)}
            second={place.rank === 1 ? ranking?.find((e) => e.rank === 2) : undefined}
          />
        ))}
      </ol>

      <section className="rank-board" aria-label="Rangs 4 à 30">
        <h2>Rangs 4 à 30</h2>
        <div className="rank-columns">
          <RankColumn from={4} to={17} ranking={ranking} />
          <RankColumn from={18} to={30} ranking={ranking} />
        </div>
      </section>

      <Breakouts season={f.season} />

      <section className="award-method" aria-labelledby="award-method-title">
        <h2 id="award-method-title">Comment le classement est construit</h2>
        <ol role="list">
          {STEPS.map(([title, text], index) => (
            <li key={title}>
              <span className="award-step" aria-hidden="true">
                {index + 1}
              </span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </Layout>
  );
}
