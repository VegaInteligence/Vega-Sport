import Link from "next/link";
import StatarenaLogo from "./StatarenaLogo.jsx";

const repository = "https://github.com/VegaInteligence/Vega-Sport";
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
    ],
  },
  {
    title: "Méthode",
    links: [
      ["Données & méthode", "/methode/"],
      [
        "Modèle mathématique",
        `${repository}/blob/main/docs/METHODE_CLASSEMENT_BALLON_D_OR.md`,
      ],
    ],
  },
  {
    title: "Projet",
    links: [
      ["GitHub", repository],
      ["Documentation", `${repository}/tree/main/docs`],
      ["Signaler un problème", `${repository}/issues`],
    ],
  },
];

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
      </div>
    </footer>
  );
}
