/**
 * The account side of the preferences sync (VI-38): the client of the site's /api/account route, and the adapter
 * that setPreferencesSync({ load, save, report }) takes (user-preferences.js). Doc: docs/COMPTES_SITE.md, section 5;
 * tests: tests/account-sync.test.mjs.
 *
 * load()  the account's contract; at the first sign-in of this account on this browser, merged with the browser's
 *         (account-merge.js) and written back before it is returned; a marker per account id then says « merged »,
 *         and later loads return the account's contract as it is.
 * save()  PUT with If-Match; on 409 the three-way merge against the last contract loaded or saved, written with the
 *         new revision and returned (the seam re-applies it). One request at a time.
 * Errors carry the API's code and message only: never a token, an address or an account id.
 */
import { mergeFirstSignIn, mergeThreeWay } from "./account-merge.js";
import { validateContract } from "./user-preferences.js";

export const MERGED_KEY = "vega.account.merged.v1";
const ROUNDS = 3;

/** A refusal or failure of /api/account: `status` (0 when unreachable), `code`, `message`, `retry`, `revision`. */
export class AccountApiError extends Error {
  constructor(status, body) {
    const error = body && typeof body === "object" && body.error && typeof body.error === "object" ? body.error : {};
    super(typeof error.message === "string" && error.message ? error.message : "Le serveur des comptes ne répond pas.");
    this.name = "AccountApiError";
    this.status = status;
    this.code = typeof error.code === "string" ? error.code : "ACCOUNT_UNREACHABLE";
    this.retry = error.retry === true || status === 0;
    this.revision = Number.isSafeInteger(body?.revision) ? body.revision : null;
  }
}

/** The client of /api/account (same origin; the server adds the Neon session). */
export function createAccountApi({ fetch: fetchImpl = (...args) => globalThis.fetch(...args), base = "/api/account" } = {}) {
  async function call(method, path, { body, ifMatch } = {}) {
    const headers = { accept: "application/json" };
    if (method !== "GET") headers["content-type"] = "application/json";
    if (ifMatch !== undefined && ifMatch !== null) headers["if-match"] = String(ifMatch);
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      throw new AccountApiError(0, null);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new AccountApiError(response.status || 0, null);
    }
    if (!response.ok) throw new AccountApiError(response.status, data);
    return data;
  }
  return {
    session: () => call("POST", "/session"),
    getPreferences: () => call("GET", "/preferences"),
    putPreferences: (contract, revision) => call("PUT", "/preferences", { body: contract, ifMatch: revision }),
    exportData: () => call("GET", "/export"),
    erase: () => call("DELETE", ""),
  };
}

function markers(storage) {
  try {
    const list = JSON.parse(storage?.getItem(MERGED_KEY) || "[]");
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function writeMarkers(storage, list) {
  try {
    if (list.length) storage?.setItem(MERGED_KEY, JSON.stringify(list.slice(-20)));
    else storage?.removeItem(MERGED_KEY);
  } catch {}
}
/** Whether this browser already merged its data into that account. */
export const hasMerged = (storage, accountId) => markers(storage).includes(accountId);
export function markMerged(storage, accountId) {
  const list = markers(storage).filter((id) => id !== accountId);
  writeMarkers(storage, [...list, accountId]);
}
/** At sign-out, once the stores are emptied: the next sign-in merges what is added meanwhile. */
export function forgetMerged(storage, accountId) {
  writeMarkers(storage, markers(storage).filter((id) => id !== accountId));
}

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
const readable = (value) => {
  try {
    validateContract(value);
    return true;
  } catch {
    return false;
  }
};
const reasonOf = (error) =>
  error instanceof AccountApiError
    ? error.message
    : "Le serveur des comptes ne répond pas.";
// A refusal that another try of the same document cannot fix: reported, the sync stopped for it.
const FINAL = new Set(["ACCOUNT_ERASED", "CONTRACT_INVALID", "CONTRACT_VERSION", "CONTRACT_LIMIT", "BODY_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"]);

/**
 * `api`: createAccountApi(); `readLocal()`: the browser's contract (toContract of the stores), null while they are
 * not loaded; `onStatus({ state, reason? })`: syncing | synced | failed | stopped; `onSessionLost()`: a 401.
 */
export function createAccountAdapter({
  api,
  accountId,
  readLocal,
  storage = browserStorage(),
  onStatus = () => {},
  onSessionLost = () => {},
}) {
  let base = null, revision = null, loaded = false, queue = Promise.resolve();
  const status = (state, reason) => {
    try {
      onStatus(reason === undefined ? { state } : { state, reason });
    } catch {}
  };
  // One request sequence at a time, in order.
  const serial = (work) => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };
  const failed = (error) => {
    if (error instanceof AccountApiError && error.status === 401) {
      try {
        onSessionLost();
      } catch {}
    }
    if (error instanceof AccountApiError && FINAL.has(error.code)) report(error);
    else status("failed", reasonOf(error));
    throw error;
  };
  function report(error) {
    status("stopped", error?.message || "La synchronisation s'est arrêtée.");
  }
  const put = async (contract, ifMatch) => {
    const answer = await api.putPreferences(contract, ifMatch ?? undefined);
    base = contract;
    revision = Number.isSafeInteger(answer?.revision) ? answer.revision : null;
  };
  const stale = (error) => error instanceof AccountApiError && error.status === 409 && error.code === "STALE";

  async function loadOnce() {
    const local = readLocal();
    if (!local) throw new Error("Préférences du navigateur pas encore chargées.");
    for (let round = 0; ; round++) {
      const held = await api.getPreferences();
      const remote = held?.contract ?? null;
      revision = Number.isSafeInteger(held?.revision) ? held.revision : null;
      if (remote === null) {
        const mine = validateContract(local);
        await put(mine);
        markMerged(storage, accountId);
        return mine;
      }
      if (!readable(remote)) return remote; // another version: the seam stops and reports, nothing written
      const theirs = validateContract(remote);
      if (hasMerged(storage, accountId)) {
        base = theirs;
        return theirs;
      }
      const { contract: merged, error } = mergeFirstSignIn(theirs, local);
      if (error) report(error);
      if (JSON.stringify(merged) === JSON.stringify(theirs)) {
        base = theirs;
        markMerged(storage, accountId);
        return theirs;
      }
      try {
        await put(merged, revision);
      } catch (failure) {
        if (stale(failure) && round < ROUNDS) continue;
        throw failure;
      }
      markMerged(storage, accountId);
      return merged;
    }
  }

  async function saveOnce(contract) {
    if (!loaded) throw new Error("Synchronisation pas encore chargée.");
    let sending = contract;
    for (let round = 0; ; round++) {
      try {
        await put(sending, revision);
        return sending === contract ? undefined : sending;
      } catch (failure) {
        if (!stale(failure) || round >= ROUNDS) throw failure;
      }
      const held = await api.getPreferences();
      revision = Number.isSafeInteger(held?.revision) ? held.revision : null;
      if (held?.contract == null) continue; // emptied there: written as it is
      if (!readable(held.contract)) throw new Error(`Version de préférences non reconnue : ${held.contract?.v}.`);
      sending = mergeThreeWay(base, contract, held.contract);
    }
  }

  const adapter = {
    load: () =>
      serial(async () => {
        status("syncing");
        try {
          const out = await loadOnce();
          loaded = true;
          if (readable(out)) status("synced");
          return out;
        } catch (error) {
          return failed(error);
        }
      }),
    save: (contract) =>
      serial(async () => {
        status("syncing");
        try {
          const out = await saveOnce(contract);
          status("synced");
          return out;
        } catch (error) {
          return failed(error);
        }
      }),
    report,
    /** The sign-out's last save: { ok, error }, never a throw. */
    async flush(contract) {
      try {
        await adapter.save(contract);
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
  return adapter;
}
