"use client";
// /compte « Lettre » (VI-38, docs/COMPTES_SITE.md section 10): one narrow column read from top to bottom, like a
// letter. The one title in the logo's letters, who is signed in on one line, then the favourites in the same letters
// (the person's own content), the settings and the security in the site's text. No tab, no frame, no icon.
import Link from "next/link";
import { Media } from "./UI.jsx";
import { moreLabel } from "../services/account-page.js";
import {
  CompetitionsChoice,
  CountryChoice,
  DeleteAction,
  ExportAction,
  PAGES,
  PasswordAction,
  SignOutButton,
  SyncNote,
  ThemeChoice,
  UnsavedNotice,
  useSectionHash,
} from "./AccountParts.jsx";

function Favourite({ entry, href }) {
  return (
    <li>
      <Link href={href} prefetch={false}>
        <Media name={entry.name} url={entry.imageUrl} kind={entry.kind === "players" ? "player" : "club"} size={28} />
        <span>{entry.name}</span>
      </Link>
    </li>
  );
}

export default function AccountLetter({ page }) {
  const { f, groups, competitions } = page;
  // The header's menu: « Paramètres » is #parametres, « Mon compte » the top.
  useSectionHash(page.ready, (id) => {
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  });
  const empty = !groups.length;
  return (
    <div className="account account-lettre">
      <header className="account-hero lettre-head">
        <h1 className="lettre-title">
          Mon compte
          <span className="brand-dot" aria-hidden="true" />
        </h1>
        <p className="lettre-who">
          <span className="lettre-address">{page.email}</span>
          <span className="lettre-plan">{page.plan}</span>
          <SignOutButton page={page} className="lettre-signout" />
        </p>
        <SyncNote page={page} />
        <UnsavedNotice page={page} />
      </header>

      <section id="favoris" className="lettre-section" aria-labelledby="lettre-favoris">
        <h2 id="lettre-favoris">Favoris</h2>
        {groups.map((group) => (
          <div className="lettre-group" key={group.kind}>
            <h3>{group.label}</h3>
            <ul className="account-favourites lettre-names">
              {group.entries.map((entry) => (
                <Favourite key={`${entry.kind}:${entry.id}`} entry={entry} href={f.href(PAGES[entry.kind], { id: entry.id })} />
              ))}
            </ul>
            {group.more > 0 && (
              <button className="account-link lettre-more" type="button" onClick={() => page.showAll(group.kind)}>
                {moreLabel(group.more)}
              </button>
            )}
          </div>
        ))}
        {empty && (
          <p className="lettre-empty">
            Aucun favori.{" "}
            <Link className="account-link" href={f.href("/clubs/")}>
              Clubs
            </Link>{" "}
            ·{" "}
            <Link className="account-link" href={f.href("/joueurs/")}>
              Joueurs
            </Link>{" "}
            ·{" "}
            <Link className="account-link" href={f.href("/nations/")}>
              Nations
            </Link>
          </p>
        )}
        <div className="lettre-group">
          <h3>
            Compétitions
            <CompetitionsChoice page={page} />
          </h3>
          {competitions.length ? (
            <ul className="lettre-names">
              {competitions.map((competition) => (
                <li key={competition.id}>
                  <span>
                    <Media name={competition.name} url={competition.imageUrl} kind="club" size={28} />
                    <span>{competition.name}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lettre-quiet">Toutes les compétitions</p>
          )}
        </div>
      </section>

      <section id="parametres" className="lettre-section" aria-labelledby="lettre-parametres">
        <h2 id="lettre-parametres">Paramètres</h2>
        <dl className="lettre-rows">
          <div>
            <dt>Thème</dt>
            <dd>
              <ThemeChoice page={page} />
            </dd>
          </div>
          <div>
            <dt>Langue</dt>
            <dd className="lettre-quiet">Français</dd>
          </div>
          <div>
            <dt>Pays</dt>
            <dd>
              <CountryChoice page={page} />
            </dd>
          </div>
        </dl>
      </section>

      <section id="securite" className="lettre-section" aria-labelledby="lettre-securite">
        <h2 id="lettre-securite">Sécurité</h2>
        <div className="lettre-actions">
          {page.password && <PasswordAction />}
          {page.sync && (
            <div className="account-data">
              <ExportAction />
              <DeleteAction page={page} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
