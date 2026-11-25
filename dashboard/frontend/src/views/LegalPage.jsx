// The legal pages (/confidentialite, /conditions-utilisation, /conditions-generales-de-vente): a night banner with the title, « En bref », the
// Sommaire and the numbered sections. The text lives in src/content/legal-*.jsx; this view only lays it out.
// A server component: the whole page is in the server's HTML; only the Sommaire's marking runs in the browser.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AccountArt from "../components/AccountArt.jsx";
import LegalShell from "../components/LegalShell.jsx";
import LegalToc from "../components/LegalToc.jsx";
import { LegalAsterisk, frenchText, typeset } from "../components/Legal.jsx";
import {
  missingLegalFields,
  missingSaleFields,
} from "../content/legal-identity.js";

const SITE = "https://vegasport.vercel.app";
const dateLabel = (iso) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

/** The page's metadata: title, description, canonical (the bare address, the one given to Google). */
export function legalMetadata(page) {
  const title = frenchText(page.title),
    description = frenchText(page.description);
  return {
    title,
    description,
    alternates: { canonical: page.path },
    openGraph: {
      title,
      description,
      url: `${SITE}${page.path}`,
      type: "article",
    },
  };
}

export default function LegalPage({ page: source }) {
  // The text as written in src/content, set in French typography (Legal.jsx).
  const page = {
    ...source,
    title: frenchText(source.title),
    intro: typeset(source.intro),
    siblings: source.siblings.map((sibling) => ({
      ...sibling,
      title: frenchText(sibling.title),
    })),
    facts: (source.facts || []).map((fact) => ({
      ...fact,
      label: frenchText(fact.label),
      value: frenchText(fact.value),
    })),
    sections: source.sections.map((section) => ({
      ...section,
      title: frenchText(section.title),
      short: section.short && frenchText(section.short),
      body: typeset(section.body),
    })),
  };
  const numbers = new Map(
    page.sections.map((section, index) => [section.id, index + 1]),
  );
  const items = page.sections.map((section) => ({
    id: section.id,
    number: numbers.get(section.id),
    // The Sommaire takes the short form of a long title.
    title: section.short || section.title,
  }));
  // The sales terms (`saleFields`) also wait for their own facts: SIRET, VAT, mediator, prices.
  const provisional =
    missingLegalFields().length > 0 ||
    (source.saleFields && missingSaleFields().length > 0);
  return (
    <LegalShell path={page.path}>
      <article className="legal">
        <header className="legal-hero">
          <AccountArt className="legal-art" />
          <div className="legal-hero-copy">
            <h1 className="legal-title">
              {page.title}
              <LegalAsterisk />
            </h1>
            {page.intro && <p className="legal-intro">{page.intro}</p>}
            <p className="legal-meta">
              <span>
                Mise à jour le{" "}
                <time dateTime={page.updated}>{dateLabel(page.updated)}</time>
              </span>
              {page.siblings.map((sibling) => (
                <Link
                  key={sibling.path}
                  className="legal-sibling"
                  href={sibling.path}
                >
                  {sibling.title}
                  <ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" />
                </Link>
              ))}
            </p>
          </div>
        </header>

        {provisional && (
          <p className="legal-provisional" data-legal-provisional="">
            Version provisoire : les champs entre crochets restent à compléter.
          </p>
        )}

        {page.facts.length > 0 && (
          <section className="legal-facts" aria-labelledby="legal-facts-title">
            <h2 id="legal-facts-title" className="legal-facts-title">
              En bref
            </h2>
            <ul
              data-count={page.facts.length}
              style={{ "--facts": page.facts.length }}
            >
              {page.facts.map(({ icon: Glyph, label, value, section }) => (
                <li key={label}>
                  <a href={`#${section}`}>
                    <span className="legal-fact-head">
                      {Glyph && (
                        <Glyph size={18} strokeWidth={1.6} aria-hidden="true" />
                      )}
                      <span className="legal-fact-label">{label}</span>
                      <span className="legal-fact-ref">
                        {numbers.get(section)}
                      </span>
                    </span>
                    <span className="legal-fact-value">{value}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="legal-body">
          <LegalToc items={items} />
          <div className="legal-text">
            {page.sections.map((section) => (
              <section
                key={section.id}
                className="legal-section"
                aria-labelledby={section.id}
              >
                <h2 id={section.id} data-legal-section="">
                  <span className="legal-num">{numbers.get(section.id)}</span>
                  <span className="legal-heading">{section.title}</span>
                </h2>
                <div className="legal-prose">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </article>
    </LegalShell>
  );
}
