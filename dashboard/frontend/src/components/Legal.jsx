// The pieces the legal texts are written with (src/content/legal-*.jsx): a field the owner fills in, a link to
// another section, a table, the brand's asterisk, and the French typography applied to all of it.
// Server components: no state, no browser API.
import React, { cloneElement, isValidElement } from "react";
import BrandAsterisk from "./BrandAsterisk.jsx";
import {
  legalFieldKinds,
  legalFieldLabels,
  legalIdentity,
  legalOptionalFields,
} from "../content/legal-identity.js";

const NBSP = " ",
  NARROW = " ";

/**
 * French typography for text typed with ordinary keys: ’ for ', a no-break space before « : » and inside
 * « », a narrow one before « ; ! ? ». The texts stay easy to edit; the page shows them right.
 */
export function frenchText(text) {
  return text
    .replace(/'/g, "’")
    .replace(/ :/g, `${NBSP}:`)
    .replace(/ ([;!?])/g, `${NARROW}$1`)
    .replace(/« /g, `«${NBSP}`)
    .replace(/ »/g, `${NBSP}»`);
}

/** Applies frenchText to every string of a JSX tree, LegalTable's cells and caption included. */
export function typeset(node) {
  if (typeof node === "string") return frenchText(node);
  if (Array.isArray(node)) return node.map(typeset);
  if (!isValidElement(node)) return node;
  const props = {};
  if (node.type === LegalTable) {
    props.rows = node.props.rows.map((row) => row.map(typeset));
    props.columns = node.props.columns.map(typeset);
    if (node.props.caption) props.caption = typeset(node.props.caption);
  }
  const { children } = node.props;
  if (children === undefined)
    return Object.keys(props).length ? cloneElement(node, props) : node;
  // Children go back as arguments, as JSX wrote them: a static list, no keys needed.
  return Array.isArray(children)
    ? cloneElement(node, props, ...children.map(typeset))
    : cloneElement(node, props, typeset(children));
}

/**
 * A fact from src/content/legal-identity.js: its value once filled, else « [À compléter : <label>] », marked so
 * it shows (legal.css) and so the E2E finds it (`data-legal-field`). `before` is the separator that goes with
 * it (« , »): an optional field the owner chose not to publish (false) leaves out both.
 */
export function LegalField({ name, before = "" }) {
  if (!(name in legalFieldLabels))
    throw new Error(
      `LegalField: unknown field « ${name} » (legal-identity.js)`,
    );
  const value = legalIdentity[name];
  if (value === false) {
    if (!legalOptionalFields.has(name))
      throw new Error(
        `LegalField: « ${name} » cannot be left out (legal-identity.js)`,
      );
    return null;
  }
  if (value != null && value !== "") {
    const shown =
      legalFieldKinds[name] === "email" ? (
        <a href={`mailto:${value}`}>{value}</a>
      ) : (
        value
      );
    return (
      <>
        {before}
        {shown}
      </>
    );
  }
  return (
    <>
      {before}
      <span className="legal-field" data-legal-field={name}>
        [À compléter{NBSP}: {legalFieldLabels[name]}]
      </span>
    </>
  );
}

/**
 * The « section N » links of a page: `legalRefs(() => page.sections)` gives a component, <Ref to="cookies" />,
 * that writes « section 8 » from the section's place, so moving a section never leaves a wrong number.
 */
export function legalRefs(sections) {
  return function Ref({ to }) {
    const index = sections().findIndex((section) => section.id === to);
    if (index < 0) throw new Error(`Ref: no section « ${to} »`);
    return (
      <a href={`#${to}`} data-legal-ref={to}>
        section{NBSP}
        {index + 1}
      </a>
    );
  };
}

/**
 * A table: `columns` are the heads, `rows` arrays of cells (text or JSX), the first cell of a row naming it.
 * `nowrap`: the indexes of short columns kept on one line on a wide screen (« Stockage local », « 6 mois »).
 * On a phone each row becomes a card, every cell under its column's name (legal.css).
 */
export function LegalTable({ caption, columns, rows, nowrap = [] }) {
  const cellClass = (i) => (nowrap.includes(i) ? "legal-nowrap" : undefined);
  return (
    <div className="legal-table-wrap">
      <table className="legal-table" data-columns={columns.length}>
        {/* Every table follows its section's heading: the caption names it for assistive technology only. */}
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={i} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={i}
                    scope="row"
                    data-label={columns[i]}
                    className={cellClass(i)}
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={i} data-label={columns[i]} className={cellClass(i)}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The logo's asterisk after a title, as after « Vega »: its top at the capitals' height (BrandAsterisk.jsx). */
export function LegalAsterisk() {
  return <BrandAsterisk className="legal-asterisk" />;
}
