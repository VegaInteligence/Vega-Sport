import Link from "next/link";
import Icon from "./Icon.jsx";
import StatarenaLogo from "./StatarenaLogo.jsx";

const repository = "https://github.com/OrionQuantPlatform/STATARENA";
const groups = [
  {
    title: "Explorer",
    links: [
      ["Vue d’ensemble", "/"],
      ["Compétitions", "/competitions/"],
      ["Clubs", "/clubs/"],
      ["Matchs", "/matchs/"],
    ],
  },
  {
    title: "Joueurs",
    links: [
      ["Performances", "/joueurs/"],
      ["Classement joueurs", "/classement-joueurs/"],
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
      ["Base JSON", `${repository}/blob/main/docs/JSON_DATABASE.md`],
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

export default function SiteFooter({ href, path }) {
  return (
    <footer className="site-footer" aria-label="Pied de page">
      <div className="site-footer-inner">
        <div className="site-footer-main">
          <div className="site-footer-identity">
            <Link
              className="site-footer-home"
              href={href("/")}
              aria-label="STATARENA, vue d’ensemble"
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
        <div className="site-footer-bottom">
          <div className="site-footer-copyright">
            <a
              className="site-footer-github"
              href={repository}
              target="_blank"
              rel="noreferrer"
              aria-label="STATARENA sur GitHub"
            >
              GitHub <Icon name="external" />
            </a>
            <span>© {new Date().getFullYear()} STATARENA</span>
          </div>
          <a
            href={`${repository}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            Licence MIT
          </a>
        </div>
      </div>
    </footer>
  );
}
