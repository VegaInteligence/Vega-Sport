import Link from "next/link";
import StatarenaLogo from "./StatarenaLogo.jsx";
import ConsentSettingsLink from "./ConsentSettingsLink.jsx";

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
  {
    // The legal pages (src/views/LegalPage.jsx), static and public: one address each, never the
    // season or focus the football pages carry in their links.
    title: "Informations",
    plain: true,
    links: [
      ["Confidentialité", "/confidentialite/"],
      ["Conditions d’utilisation", "/conditions-utilisation/"],
      ["Conditions générales de vente", "/conditions-generales-de-vente/"],
    ],
    // Reopens the consent banner (Consent.jsx): a button, styled as the links above it (consent.css).
    after: <ConsentSettingsLink />,
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
              aria-label="Vega Sport, vue d’ensemble"
            >
              <StatarenaLogo
                className="site-footer-logo"
                width={105}
                height={56}
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
                  const target =
                    external || group.plain ? destination : href(destination);
                  return (
                    <li key={destination}>
                      <Link
                        href={target}
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
                {group.after && <li>{group.after}</li>}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
