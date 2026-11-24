// The pieces the legal texts are written with (src/content/legal-*.jsx): a field the owner fills in, a table,
// the brand's asterisk. Server components: no state, no browser API.
import { WORDMARK } from "../brand-mark.js";
import {
  legalFieldKinds,
  legalFieldLabels,
  legalIdentity,
} from "../content/legal-identity.js";

/**
 * A fact from src/content/legal-identity.js: its value once filled, else « [À compléter : <label>] »,
 * marked so it shows (legal.css) and so the E2E finds it (`data-legal-field`).
 */
export function LegalField({ name }) {
  if (!(name in legalFieldLabels))
    throw new Error(
      `LegalField: unknown field « ${name} » (legal-identity.js)`,
    );
  const value = legalIdentity[name];
  if (value != null && value !== "") {
    return legalFieldKinds[name] === "email" ? (
      <a href={`mailto:${value}`}>{value}</a>
    ) : (
      <>{value}</>
    );
  }
  return (
    <span className="legal-field" data-legal-field={name}>
      [À compléter : {legalFieldLabels[name]}]
    </span>
  );
}

/**
 * A table: `columns` are the heads, `rows` arrays of cells (text or JSX), the first cell of a row naming it.
 * On a phone each row becomes a card, every cell under its column's name (legal.css).
 */
export function LegalTable({ caption, columns, rows }) {
  return (
    <div className="legal-table-wrap">
      <table className="legal-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
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
                  <th key={i} scope="row" data-label={columns[i]}>
                    {cell}
                  </th>
                ) : (
                  <td key={i} data-label={columns[i]}>
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

// The asterisk's box inside the wordmark's drawing (src/brand-mark.js).
const SIGN_BOX = "1849 -5 292 326";

/** The logo's asterisk after a title, as after « Vega »: its top at the capitals' height. */
export function LegalAsterisk() {
  return (
    <svg
      className="legal-asterisk"
      viewBox={SIGN_BOX}
      aria-hidden="true"
      focusable="false"
    >
      <path d={WORDMARK.sign} />
    </svg>
  );
}
