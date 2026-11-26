/**
 * The signed-in state of the whole site (VI-38), with no React provider: one module store that any component reads
 * through useAccount(). Fetched in the browser after hydration, never on the server (docs/COMPTES_SITE.md, W5).
 *
 *   status  "off" (accounts off) | "unknown" (not read yet) | "signed-out" | "signed-in"
 *   user    { id, email, name } while signed in; kept in memory only, never in a URL, a log or storage
 *   level   the account's level (POST /account/session), null until known
 *   sync    { state, reason? }: unavailable | idle | syncing | synced | failed | stopped
 *
 * The preferences adapter (account-sync.js) is set once the person is signed in, sync is on and AccountSync.jsx
 * gives the browser's contract (both stores loaded); it is removed when the session ends.
 */
import { accountsOn, accountSyncOn } from "./account-switch.js";
import { authClient } from "./auth-client.js";
import { clearHint, setHint } from "./account-hint.js";
import { failedReturnHref, hasVerifier, readsSession } from "./account-return.js";
import { createAccountAdapter, createAccountApi, forgetMerged } from "./account-sync.js";
import { clearPreferences, setPreferencesSync } from "./user-preferences.js";

const initial = () => ({
  status: accountsOn() ? "unknown" : "off",
  user: null,
  level: null,
  sync: { state: accountSyncOn() ? "idle" : "unavailable" },
});
let state = initial();
const SERVER_STATE = initial();
const listeners = new Set();
let reading = null, readLocal = null, current = null;
// While « Se déconnecter » or a deletion runs, the session still reads « signed in »: no new adapter may attach then,
// or its first load writes the account back into the stores just emptied (FAILURE_MODES § 78).
let leaving = false;

function set(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
  attach();
}
export const getAccountState = () => state;
export const getServerAccountState = () => SERVER_STATE;
export function subscribeAccount(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function detach() {
  if (!current) return;
  current = null;
  setPreferencesSync(null);
}

function attach() {
  if (leaving || !accountSyncOn() || state.status !== "signed-in" || !readLocal) return;
  const accountId = state.user.id;
  if (current?.accountId === accountId) return;
  detach();
  const api = createAccountApi();
  const adapter = createAccountAdapter({
    api,
    accountId,
    readLocal: () => (readLocal ? readLocal() : null),
    onStatus: (sync) => current?.adapter === adapter && set({ sync }),
    onSessionLost: () => refreshSession({ force: true }),
  });
  current = { accountId, adapter, api };
  setPreferencesSync(adapter);
  api.session().then(
    (answer) => current?.adapter === adapter && Number.isInteger(answer?.level) && set({ level: answer.level }),
    () => {},
  );
}

/** AccountSync.jsx: the browser's contract, once both stores are loaded. Returns the undo. */
export function provideLocalPreferences(read) {
  readLocal = read;
  attach();
  return () => {
    if (readLocal === read) readLocal = null;
  };
}

function signedOut() {
  detach();
  set({ status: "signed-out", user: null, level: null, sync: { state: accountSyncOn() ? "idle" : "unavailable" } });
}

/**
 * Reads the session (once, unless forced). Never throws. Without the hint that this browser may hold a session
 * (account-hint.js, W6) an unforced read asks nothing: the state is « signed out » at once.
 */
export function refreshSession({ force = false } = {}) {
  if (!accountsOn()) return Promise.resolve(state);
  if (reading && !force) return reading;
  // Section 9, G5 and G6: a return from Google carries a verifier, which this read exchanges for the session.
  const here = currentPage();
  const returning = hasVerifier(here.search);
  if (!readsSession({ storage: storage(), force, search: here.search })) {
    if (state.status === "unknown") signedOut();
    return Promise.resolve(state);
  }
  reading = (async () => {
    try {
      const client = await authClient();
      const { data, error } = await client.getSession(force ? { fetchOptions: { headers: { "X-Force-Fetch": "1" } } } : undefined);
      const user = data?.user;
      if (!(user && typeof user.id === "string") && returning) return failedReturn(here, error);
      if (user && typeof user.id === "string") {
        const same = state.user?.id === user.id;
        setHint(storage());
        set({
          status: "signed-in",
          user: { id: user.id, email: typeof user.email === "string" ? user.email : "", name: typeof user.name === "string" ? user.name : "" },
          ...(same ? {} : { level: null }),
        });
      } else {
        clearHint(storage());
        signedOut();
      }
    } catch (thrown) {
      // A refused verifier comes back as a thrown HTTP error (@neon/auth's createHttpResponseError).
      if (returning) return failedReturn(here, thrown);
      // Neon out of reach: shown signed out, nothing removed from the stores.
      if (state.status === "unknown") signedOut();
    }
    return state;
  })();
  return reading;
}

/** The page's path and query, or an empty page outside a browser. */
function currentPage() {
  try {
    const { pathname, search } = globalThis.window?.location ?? {};
    return { pathname: typeof pathname === "string" ? pathname : "/", search: typeof search === "string" ? search : "" };
  } catch {
    return { pathname: "/", search: "" };
  }
}

/** G5: the return opened no session: /connexion says so (the address replaced, not pushed). Never throws. */
function failedReturn(here, failure) {
  if (state.status === "unknown") signedOut();
  try {
    globalThis.window?.location.replace(failedReturnHref(here, failure));
  } catch {}
  return state;
}

/** After a sign-in or a sign-up on /connexion, and when /connexion opens (it always reads, W6). */
export const sessionChanged = () => refreshSession({ force: true });

/** Just before leaving for Google: the page that comes back reads the session. */
export const expectSession = () => setHint(storage());

/**
 * « Se déconnecter » (docs/COMPTES_SITE.md, O1 to O3): the last save first; when it fails, { ok: false,
 * unsaved: true } and nothing else happens, unless `force`. Then the sync is removed, the stores emptied (when they
 * were the account's) and Neon's session ended.
 */
export async function signOut({ force = false } = {}) {
  const accountId = state.user?.id;
  if (current && !force) {
    const contract = readLocal?.();
    if (contract) {
      const { ok } = await current.adapter.flush(contract);
      if (!ok) return { ok: false, unsaved: true };
    }
  }
  const synced = accountSyncOn();
  leaving = true;
  try {
    detach();
    if (synced && accountId && clearPreferences()) forgetMerged(storage(), accountId);
    try {
      const client = await authClient();
      await client.signOut();
    } catch {}
    clearHint(storage());
    signedOut();
  } finally {
    leaving = false;
  }
  return { ok: true };
}

/** « Exporter mes données »: the export's JSON, or a thrown AccountApiError. */
export const exportAccount = () => (current?.api ?? createAccountApi()).exportData();

/** « Supprimer mon compte »: { ok } or { ok: false, error } (an AccountApiError). Success signs out. */
export async function eraseAccount() {
  const accountId = state.user?.id;
  try {
    await (current?.api ?? createAccountApi()).erase();
  } catch (error) {
    return { ok: false, error };
  }
  leaving = true;
  try {
    detach();
    if (accountId && clearPreferences()) forgetMerged(storage(), accountId);
    try {
      const client = await authClient();
      await client.signOut();
    } catch {}
    clearHint(storage());
    signedOut();
  } finally {
    leaving = false;
  }
  return { ok: true };
}
