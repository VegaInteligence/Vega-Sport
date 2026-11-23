import Link from "next/link";
import StatarenaLogo from "./StatarenaLogo.jsx";

/** Pages without the football context (404, error) link to plain paths. */
const plainHref = (page) => page;
const groups = [
  {
    title: "Explorer",
    links: [
      ["Vue d’ensemble", "/"],
      ["Compétitions", "/competitions/"],
      ["Clubs", "/clubs/"],
      ["Calendrier", "/matchs/"],
    ],
  },
  {
    title: "Joueurs",
    links: [
      ["Performances", "/joueurs/"],
      ["Classement Ballon d’Or", "/classement-joueurs/"],
      ["Power Ranking", "/power-ranking/"],
    ],
  },
];

/** Credits the data and image licences require (they used to sit on « Données & méthode »). */
function Credits() {
  return (
    <div className="site-footer-credits">
      <p>
        Archives réutilisées sous licence :{" "}
        <a href="https://www.openligadb.de/">OpenLigaDB</a> (
        <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a>),{" "}
        <a href="https://github.com/schochastics/football-data">
          schochastics/football-data
        </a>{" "}
        (<a href="https://opendatacommons.org/licenses/by/1-0/">ODC-BY 1.0</a>),{" "}
        <a href="https://github.com/jalapic/engsoccerdata">engsoccerdata</a> et{" "}
        <a href="https://github.com/oladeeayo/open-matchday">open-matchday</a>{" "}
        (usage non commercial avec attribution). Titres de joueurs :{" "}
        <a href="https://www.thesportsdb.com/">TheSportsDB</a>. Fonds de carte ©{" "}
        <a href="https://www.openstreetmap.org/copyright">
          contributeurs OpenStreetMap
        </a>
        .
      </p>
      <p>
        Coupes du monde 1930–2018 (compositions, buteurs, cartons, arbitres,
        stades) :{" "}
        <a href="https://github.com/jfjelstul/worldcup">
          The Fjelstul World Cup Database
        </a>
        , © 2023 Joshua C. Fjelstul, Ph.D. (
        <a href="https://creativecommons.org/licenses/by-sa/4.0/legalcode">
          CC-BY-SA 4.0
        </a>
        ), valeurs typées et matchs rapprochés de nos archives. Drapeaux :{" "}
        <a href="https://github.com/lipis/flag-icons">flag-icons</a>, Panayiotis
        Lipiridis (<a href="/flag-icons-LICENSE.txt">licence MIT</a>).{" "}
        <a href="https://github.com/VegaInteligence/Vega-Sport/blob/main/docs/TROPHY_IMAGE_CREDITS.md">
          Crédits des images de trophées
        </a>
        .
      </p>
    </div>
  );
}

export default function SiteFooter({ href = plainHref, path }) {
  return (
    <footer className="site-footer" aria-label="Pied de page">
      <div className="site-footer-inner">
        <div className="site-footer-main">
          <div className="site-footer-identity">
            <Link
              className="site-footer-home"
              href={href("/")}
              aria-label="Vega Intelligence, vue d’ensemble"
            >
              <StatarenaLogo
                className="site-footer-logo"
                width={186}
                height={40}
              />
            </Link>
          </div>
          {groups.map((group) => (
            <nav
              className="site-footer-column"
              aria-label={group.title}
              key={group.title}
            >
              <h2>{group.title}</h2>
              <ul>
                {group.links.map(([label, destination]) => {
                  const external = destination.startsWith("https:");
                  return (
                    <li key={destination}>
                      <Link
                        href={external ? destination : href(destination)}
                        aria-current={
                          !external &&
                          path?.replace(/\/$/, "") ===
                            destination.replace(/\/$/, "")
                            ? "page"
                            : undefined
                        }
                        {...(external
                          ? { target: "_blank", rel: "noreferrer" }
                          : {})}
                      >
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>
        <Credits />
      </div>
    </footer>
  );
}
