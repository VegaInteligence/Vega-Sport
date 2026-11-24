"use client";
// /compte, direction B « Diptyque » (VI-38 mock-up): /connexion's composition. On the left the night panel holds who is
// signed in, still while the right side changes; on the right one narrow column under the site's tabs: the
// favourites as a wall of crests and portraits, the settings, the security. On a phone the panel is a band on top.
import { useState } from "react";
import Link from "next/link";
import { Media } from "./UI.jsx";
import {
  CompetitionsChoice,
  CountryChoice,
  DeleteAction,
  ExportAction,
  PAGES,
  PasswordAction,
  SECTIONS,
  SignOutButton,
  SyncNote,
  ThemeChoice,
  UnsavedNotice,
  useSectionHash,
} from "./AccountParts.jsx";

function Tile({ name, imageUrl, kind, href }) {
  const body = (
    <>
      <Media name={name} url={imageUrl} kind={kind} size={48} />
      <span>{name}</span>
    </>
  );
  return <li>{href ? <Link href={href} prefetch={false}>{body}</Link> : <span>{body}</span>}</li>;
}

export default function AccountDiptych({ page }) {
  const { f, groups, competitions } = page;
  const [tab, setTab] = useState(SECTIONS[0][0]);
  // The header's menu: « Paramètres » opens its tab, « Mon compte » the first.
  useSectionHash(page.ready, (id) => {
    setTab(id || SECTIONS[0][0]);
    window.scrollTo({ top: 0 });
  });
  const choose = (id) => {
    setTab(id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
  };
  const onKey = (event) => {
    const at = SECTIONS.findIndex(([id]) => id === tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SECTIONS[(at + step + SECTIONS.length) % SECTIONS.length][0];
    choose(next);
    document.getElementById(`diptyque-tab-${next}`)?.focus();
  };
  return (
    <div className="account account-diptyque">
      <aside className="diptyque-panel">
        <div className="account-hero diptyque-who">
          <h1 className="diptyque-title">
            Mon compte
            <span className="brand-dot" aria-hidden="true" />
          </h1>
          <p className="diptyque-address">{page.email}</p>
          <p className="diptyque-plan">{page.plan}</p>
          <SyncNote page={page} className="diptyque-sync" />
          <UnsavedNotice page={page} />
          <SignOutButton page={page} className="diptyque-signout" />
        </div>
      </aside>

      <div className="diptyque-content">
        <div className="research-tabs diptyque-tabs" role="tablist" aria-label="Mon compte" onKeyDown={onKey}>
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              id={`diptyque-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => choose(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <section id="favoris" role="tabpanel" aria-labelledby="diptyque-tab-favoris" hidden={tab !== "favoris"} className="diptyque-panel-body">
          {groups.map((group) => (
            <div className="diptyque-group" key={group.kind}>
              <h2>{group.label}</h2>
              <ul className="account-favourites diptyque-wall">
                {group.entries.map((entry) => (
                  <Tile
                    key={`${entry.kind}:${entry.id}`}
                    name={entry.name}
                    imageUrl={entry.imageUrl}
                    kind={entry.kind === "players" ? "player" : "club"}
                    href={f.href(PAGES[entry.kind], { id: entry.id })}
                  />
                ))}
              </ul>
              {group.more > 0 && (
                <button className="account-link diptyque-more" type="button" onClick={() => page.showAll(group.kind)}>
                  Afficher les {group.more} autres
                </button>
              )}
            </div>
          ))}
          {!groups.length && (
            <div className="diptyque-group">
              <h2>Aucun favori</h2>
              <p className="diptyque-browse">
                <Link className="account-link" href={f.href("/clubs/")}>
                  Clubs
                </Link>
                <Link className="account-link" href={f.href("/joueurs/")}>
                  Joueurs
                </Link>
                <Link className="account-link" href={f.href("/nations/")}>
                  Nations
                </Link>
              </p>
            </div>
          )}
          <div className="diptyque-group">
            <h2>
              Compétitions
              <CompetitionsChoice page={page} />
            </h2>
            {competitions.length ? (
              <ul className="diptyque-wall">
                {competitions.map((competition) => (
                  <Tile key={competition.id} name={competition.name} imageUrl={competition.imageUrl} kind="club" />
                ))}
              </ul>
            ) : (
              <p className="diptyque-quiet">Toutes les compétitions</p>
            )}
          </div>
        </section>

        <section id="parametres" role="tabpanel" aria-labelledby="diptyque-tab-parametres" hidden={tab !== "parametres"} className="diptyque-panel-body">
          <dl className="diptyque-rows">
            <div>
              <dt>Thème</dt>
              <dd>
                <ThemeChoice page={page} />
              </dd>
            </div>
            <div>
              <dt>Langue</dt>
              <dd className="diptyque-quiet">Français</dd>
            </div>
            <div>
              <dt>Pays</dt>
              <dd>
                <CountryChoice page={page} />
              </dd>
            </div>
          </dl>
        </section>

        <section id="securite" role="tabpanel" aria-labelledby="diptyque-tab-securite" hidden={tab !== "securite"} className="diptyque-panel-body">
          <div className="diptyque-actions">
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
    </div>
  );
}
