/** The five selections whose original content tags are preserved (FAILURE_MODES_OPTIMISATIONS.md GH137R). */
import { CODE_DIGEST, versionsMissing } from "./data-versions.mjs";
import { entityTags, matchesEtag, send } from "./http.mjs";

export const RECEIPT_CODE = `${CODE_DIGEST}:${process.versions.node.split(".")[0]}`;
export const RECEIPT_SQL = "SELECT api.read_receipt($1, $2, $3) AS digest";
export const editionSelector = (competition, season = "") => `${competition}|${season}`;
export const contentTag = (family, digest) => `W/"${family}-v1-${digest}"`;

/** A conditional GET with one of this route's tags, or a metadata-only request. */
export function receiptRequest(req, family) {
  const held = entityTags(req.headers.get("if-none-match"));
  const mine = new RegExp(`^"${family}-v1-([a-f0-9]{64})"$`);
  return {
    metadataOnly: req.method === "HEAD" || Boolean(held?.any),
    digests: (held?.tags || []).map((tag) => mine.exec(tag)?.[1]).filter(Boolean),
  };
}

export async function readReceipt(req, read, route, selector, family, ttl) {
  const { metadataOnly, digests } = receiptRequest(req, family);
  if (!metadataOnly && !digests.length) return null;
  try {
    const [row] = await read(RECEIPT_SQL, [route, selector, RECEIPT_CODE]);
    if (!row?.digest) return null;
    const etag = contentTag(family, row.digest);
    if (metadataOnly || matchesEtag(req.headers.get("if-none-match"), etag))
      return send(req, null, 200, { etag, ttl });
    return null;
  } catch (error) {
    if (versionsMissing(error)) return null; // the worker/database have not yet upgraded
    throw error;
  }
}
