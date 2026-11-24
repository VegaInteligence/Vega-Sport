/**
 * The preference document: the site's contract (dashboard/frontend/src/services/user-preferences.js),
 * stored and returned as sent. The site owns its shape and validates it on every load; a second
 * validator here would drift from the site's and refuse what the site emits. So only what storing
 * it safely needs is checked: a JSON object, version 1, 2 MiB of compact JSON at most, and no
 * text that PostgreSQL's jsonb cannot hold. Failure modes: FAILURE_MODES.md, section 5.
 *
 * The merge of a browser's preferences with the account's, at the first sign-in on a device, is
 * the site adapter's (section 6). Pure: used by the front (to refuse early) and the store (last check).
 */

export const CONTRACT_VERSION = 1;
/** Compact JSON, in UTF-8 bytes. With the front's 4 MiB body bound, every Lambda payload stays under 6 MB. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** codes: CONTRACT_INVALID, CONTRACT_VERSION, CONTRACT_LIMIT. */
export class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// In JSON.stringify's output, a NUL is written \u0000 and a lone surrogate \udXXX (a pair is
// written as its characters): both refused by jsonb (22P05). The escape counts only when the
// backslashes before it are odd in number (an even run is escaped backslashes).
const UNSTORABLE = /(?<!\\)(?:\\\\)*\\u(?:0000|d[89a-f][0-9a-f]{2})/i;

/** The compact JSON text of the document, or a ContractError. */
export function checkContract(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ContractError("CONTRACT_INVALID", "the preferences must be a JSON object");
  if (value.v !== CONTRACT_VERSION) throw new ContractError("CONTRACT_VERSION", `the preferences must be version ${CONTRACT_VERSION}`);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new ContractError("CONTRACT_LIMIT", `the preferences exceed ${MAX_DOCUMENT_BYTES} bytes`);
  if (UNSTORABLE.test(text)) throw new ContractError("CONTRACT_INVALID", "the preferences hold a NUL character or a lone surrogate");
  return text;
}
