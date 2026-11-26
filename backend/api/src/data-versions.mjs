/**
 * Validators read before the answer is built (docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md, GH137A).
 *
 * A route of the manifest declares the api relations its statements name (`reads`). Its own checks of the request come
 * first: the build runs once with a reader that refuses every statement, and what it refuses before its first statement
 * is the answer, with no statement run (a 400 needs no base). Then one statement reads the version of the relations
 * (api.data_version, migration 181: the base's head, its day when the answer reads current_date, and each source
 * table's committed changes and partition tree). The tag is W/"<family>-v2-<check>-<content>": `content` the SHA-256 the
 * route's former tag already hashed, `check` 16 hexadecimal characters of the SHA-256 of the resource (the release, the
 * runtime, the media base, the family, the path, the sorted parameters), the version, the freshness and the content.
 * A held tag whose check is right for the current version is the tag the answer would carry: a 304 at once. Otherwise
 * the answer is built, every statement checked against the declaration; a 413 over its size limit whatever is held;
 * else a 304 only when the request holds its tag (http.mjs's send: weak comparison, or '*'), a 200 otherwise. A version
 * that cannot be read (NULL, or a base before 181) gives the former tag, W/"<family>-v1-<content>".
 */
import { createHash, randomUUID } from "node:crypto";
import { entityTags, send, tooLarge } from "./http.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
// What builds an answer: the read API's release (VEGA_RELEASE, api.yaml), else a value drawn once per process (a local
// run), and the runtime. Two copies of one release give the same checks; another release, other checks.
export const REPRESENTATION = sha(JSON.stringify(["data-versions-v1", process.env.VEGA_RELEASE || randomUUID(), process.version]));
const NAMES = /\bapi\.([a-z_][a-z0-9_]*)/g;
/** The api relations a statement names. */
export const relationsOf = (sql) => [...new Set([...String(sql).matchAll(NAMES)].map((m) => `api.${m[1]}`))];
// What a statement reads of the clock, as ops.track_data_changes reads it in views and functions (181).
const DAY = /\b(current_date|age\s*\()/i;
const TIME = /(\bnow\s*\(|\bcurrent_timestamp\b|\blocaltimestamp\b|\blocaltime\b|\bcurrent_time\b|\bclock_timestamp\b|\bstatement_timestamp\b|\btransaction_timestamp\b|\btimeofday\b|'(now|today|tomorrow|yesterday)')/i;
export const clockOf = (sql) => (TIME.test(sql) ? "time" : DAY.test(sql) ? "day" : null);

export const VERSION_SQL = "SELECT api.data_version($1::text[], $2::text) AS version";
// A base without api.data_version (a schema before 181): no check, the former tags.
const MISSING = new Set(["42883", "42P01", "3F000"]);
export const versionsMissing = (error) => MISSING.has(error?.code);

const sorted = (params) => [...params].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
/** The key of a resource: what builds it and what is asked (the parameters sorted: their order says nothing). */
export const resourceKey = (parts) => sha(JSON.stringify([REPRESENTATION, ...parts]));
/** The key of a request's resource, as every route of the manifest makes it. */
export const keyOf = (mediaBase, family, path, params) => resourceKey([mediaBase, family, path, sorted(params)]);
/** The SHA-256 of a JSON text: a tag's content. */
export const contentOf = (json) => sha(json);
/** An answer's check: its resource, the version read before it, its freshness, its content. */
export const checkOf = (key, version, ttl, content) => sha(`${key}:${version}:${ttl}:${content}`).slice(0, 16);

/** The checked tags of `family` a request holds (If-None-Match), and whether it sent '*'. */
export function heldOf(header, family) {
  const held = entityTags(header);
  const checked = new RegExp(`^"${family}-v2-([a-f0-9]{16})-([a-f0-9]{64})"$`);
  const out = { any: Boolean(held?.any), checks: [] };
  for (const tag of held?.tags || []) {
    const v2 = checked.exec(tag);
    if (v2) out.checks.push({ etag: `W/${tag}`, check: v2[1], content: v2[2] });
  }
  return out;
}

// What the validation run's reader answers every statement with.
const REFUSAL = Object.freeze(Object.assign(new Error("validation run: no statement"), { code: "VEGA_VALIDATION_RUN" }));
/**
 * The route's own checks, before any statement (GH137A-y): the build with a reader that refuses every statement. An
 * error thrown before its first statement is the request's answer (a 400, a 404 its parameters alone decide), as it
 * was before the versions; once the build has asked for a statement, whatever it then does is ignored.
 */
export async function checkedFirst(build) {
  let asked = false;
  const refuse = () => {
    asked = true;
    const refused = Promise.reject(REFUSAL);
    refused.catch(() => {}); // a build that drops it, throwing first, leaves no unhandled rejection
    return refused;
  };
  try {
    await build(refuse);
  } catch (error) {
    if (!asked) throw error;
  }
}

/**
 * The validator of the manifest's routes. `strict`: an undeclared relation or clock read throws (the tests); otherwise a
 * line and the former tag. `observe(event)`: told each served route's declaration (the tests).
 * Gives serve(req, params, spec, build): `spec` { family, reads, ttl (a number, or the list of the values `build` may give),
 * clock?, data? (the body is { data }), maxBytes?, former? (the former tag of a content) }; `build(read)` gives the value
 * (with a list of ttl: { value, ttl }).
 */
export function createDataVersions(read, { strict = false, warn = (line) => console.error(line), observe = null, mediaBase = null } = {}) {
  async function versionOf(spec) {
    try {
      const [row] = await read(VERSION_SQL, [spec.reads, spec.clock ?? null]);
      return row?.version ?? null;
    } catch (error) {
      if (versionsMissing(error)) return null;
      throw error;
    }
  }
  /** What a statement reads that its route does not declare. */
  function undeclared(spec, sql) {
    const out = relationsOf(sql).filter((r) => !spec.reads.includes(r));
    const clock = clockOf(sql);
    if (clock && clock !== spec.clock) out.push(`clock:${clock}`);
    return out;
  }
  function serve(req, params, spec, build) {
    const url = new URL(req.url);
    observe?.({ path: url.pathname, family: spec.family, reads: spec.reads });
    return answer(req, url, params, spec, build);
  }
  async function answer(req, url, params, spec, build) {
    await checkedFirst(build);
    const ttls = [].concat(spec.ttl);
    const former = spec.former ?? ((content) => `W/"${spec.family}-v1-${content}"`);
    const key = keyOf(mediaBase, spec.family, url.pathname, params);
    const held = heldOf(req.headers.get("if-none-match"), spec.family);
    const version = await versionOf(spec);
    // A held tag checked for this version, this resource and its content is the tag the 200 would carry (GH137A-v).
    if (version !== null && !held.any)
      for (const tag of held.checks)
        for (const ttl of ttls) if (checkOf(key, version, ttl, tag.content) === tag.check) return send(req, null, 200, { etag: tag.etag, ttl });
    const unknown = new Set();
    const guarded = (sql, ...rest) => {
      for (const name of undeclared(spec, sql)) unknown.add(name);
      return read(sql, ...rest);
    };
    const built = await build(guarded);
    if (unknown.size) {
      const line = `undeclared read ${url.pathname}: ${[...unknown].join(",")}`;
      if (strict) throw new Error(line);
      warn(line);
    }
    const [value, ttl] = ttls.length > 1 ? [built.value, built.ttl] : [built, ttls[0]];
    const json = JSON.stringify(value);
    const body = spec.data ? `{"data":${json}}` : json;
    // A positive tag only for an answer that is one: within its size limit, GET and HEAD alike.
    if (spec.maxBytes && Buffer.byteLength(body) > spec.maxBytes) return tooLarge(req);
    const content = sha(json);
    const etag = version !== null && !unknown.size ? `W/"${spec.family}-v2-${checkOf(key, version, ttl, content)}-${content}"` : former(content);
    // send: a 304 only when the request holds this very tag, or '*'.
    return send(req, null, 200, { etag, ttl, serialized: body });
  }
  return Object.assign(serve, { undeclared, strict, warn, mediaBase });
}
