export const HOME_STATE_COOKIE = "vega.home.v1";
export const DEFAULT_HOME_STATE = Object.freeze({
  preferences: Object.freeze({
    focus: "europe",
    defaultSeason: "",
    favoriteLeagueIds: Object.freeze([]),
    onboardingComplete: false,
  }),
  season: "",
  personalTeams: Object.freeze([]),
  personalPlayers: Object.freeze([]),
});

// Return clientOnly when a valid, bounded representation cannot preserve intent.
export function normalizeHomeState(input) {
  const fallback = {
    preferences: {
      focus: "europe",
      defaultSeason: "",
      favoriteLeagueIds: [],
      onboardingComplete: false,
    },
    season: "",
    personalTeams: [],
    personalPlayers: [],
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fallback;
  const p =
    input.preferences && typeof input.preferences === "object"
      ? input.preferences
      : {};
  const season = (value) =>
    typeof value === "string" && /^\d{4}(?:\/\d{4})?$/.test(value) ? value : "";
  const collect = (value, pattern, max, truncate = false) => {
    if (!Array.isArray(value)) return [];
    if (value.some((id) => typeof id !== "string" || !pattern.test(id)))
      return null;
    const ids = [...new Set(value)].sort();
    return ids.length > max && !truncate ? null : ids.slice(0, max);
  };
  const favoriteLeagueIds = collect(
    p.favoriteLeagueIds,
    /^l_[A-Za-z0-9]{6}$/,
    200,
  );
  const personalTeams = collect(
    input.personalTeams,
    /^t_[A-Za-z0-9]{6}$/,
    100,
    true,
  );
  const personalPlayers = collect(
    input.personalPlayers,
    /^p_[A-Za-z0-9]{6}$/,
    100,
    true,
  );
  if (
    !favoriteLeagueIds ||
    !personalTeams ||
    !personalPlayers ||
    (p.defaultSeason && !season(p.defaultSeason)) ||
    (input.season && !season(input.season))
  )
    return { clientOnly: true };
  return {
    preferences: {
      focus: p.focus === "all" ? "all" : "europe",
      defaultSeason: season(p.defaultSeason),
      favoriteLeagueIds,
      onboardingComplete: p.onboardingComplete === true,
    },
    season: season(input.season),
    personalTeams,
    personalPlayers,
  };
}
export function encodeHomeState(value) {
  const state = normalizeHomeState(value);
  const result = encodeURIComponent(
    JSON.stringify(
      state.clientOnly ? { v: 1, clientOnly: true } : { v: 1, state },
    ),
  );
  return result.length <= 3500
    ? result
    : encodeURIComponent(JSON.stringify({ v: 1, clientOnly: true }));
}
export function decodeHomeState(value) {
  try {
    const data = JSON.parse(decodeURIComponent(value));
    if (!data || data.v !== 1) return null;
    if (data.clientOnly === true) return { clientOnly: true };
    if (
      !data.state ||
      typeof data.state !== "object" ||
      Array.isArray(data.state)
    )
      return null;
    return normalizeHomeState(data.state);
  } catch {
    return null;
  }
}
export function mirrorHomeState(state) {
  if (typeof document === "undefined") return;
  document.cookie = `${HOME_STATE_COOKIE}=${encodeHomeState(state)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

function readStoredHomeState(normalize) {
  try {
    const prefsRaw = localStorage.getItem("orion.preferences.v1");
    const preferences = prefsRaw ? JSON.parse(prefsRaw) : {};
    const pageRaw = sessionStorage.getItem("statarena:page-seasons:v1");
    const pages = pageRaw ? JSON.parse(pageRaw) : {};
    const researchRaw = localStorage.getItem("statarena.research.v1");
    const research = researchRaw ? JSON.parse(researchRaw) : null;
    const lists =
      research?.version === 1 && Array.isArray(research.lists)
        ? research.lists.slice(0, 50)
        : [];
    const seen = new Set(),
      entries = [];
    for (const list of lists) {
      if (
        typeof list?.id !== "string" ||
        !/^[\w-]{1,80}$/.test(list.id) ||
        seen.has(list.id)
      )
        continue;
      seen.add(list.id);
      for (const entry of (Array.isArray(list.entries)
        ? list.entries
        : []
      ).slice(0, 5000)) {
        if (
          (entry?.kind === "clubs" &&
            /^t_[A-Za-z0-9]+$/.test(entry.id || "")) ||
          (entry?.kind === "players" && /^p_[A-Za-z0-9]+$/.test(entry.id || ""))
        )
          entries.push(entry);
      }
    }
    return normalize({
      preferences,
      season: pages && typeof pages === "object" ? pages["/"] : "",
      personalTeams: entries.filter((x) => x.kind === "clubs").map((x) => x.id),
      personalPlayers: entries
        .filter((x) => x.kind === "players")
        .map((x) => x.id),
    });
  } catch {
    return { clientOnly: true };
  }
}
export function readBrowserHomeState() {
  if (typeof window === "undefined") return { clientOnly: true };
  return readStoredHomeState(normalizeHomeState);
}
export function browserHomeBootstrapMatches(
  bootstrapState,
  manifest,
  search = typeof window === "undefined" ? "" : window.location.search,
) {
  const actual = readBrowserHomeState(),
    expected = normalizeHomeState(bootstrapState);
  if (actual.clientOnly || expected.clientOnly || !manifest) return false;
  const explicit = new URLSearchParams(search).get("season");
  const selected = explicit || actual.season || manifest.defaultSeason || "";
  return (
    JSON.stringify({ ...actual, season: selected }) ===
    JSON.stringify({
      ...expected,
      season: bootstrapState?.season || manifest.defaultSeason || "",
    })
  );
}
function guardHomeBootstrap(normalize, read) {
  try {
    const cookies = document.cookie.split(";").map((v) => v.trim());
    const encoded = cookies
      .find((v) => v.startsWith("vega.home.v1="))
      ?.slice("vega.home.v1=".length);
    let cookie = null;
    if (encoded) {
      const value = JSON.parse(decodeURIComponent(encoded));
      if (value?.v === 1)
        cookie =
          value.clientOnly === true
            ? { clientOnly: true }
            : value.state
              ? normalize(value.state)
              : null;
    }
    if (cookie?.clientOnly) {
      document.documentElement.dataset.homeBootstrapMismatch = "true";
      return;
    }
    const current = read(normalize);
    const expected = cookie || normalize({});
    if (new URLSearchParams(location.search).has("season")) {
      current.season = "";
      expected.season = "";
    }
    if (
      current.clientOnly ||
      JSON.stringify(current) !== JSON.stringify(expected)
    )
      document.documentElement.dataset.homeBootstrapMismatch = "true";
  } catch {
    document.documentElement.dataset.homeBootstrapMismatch = "true";
  }
}
export const homeBootstrapGuardScript = `(${guardHomeBootstrap.toString()})(${normalizeHomeState.toString()}, ${readStoredHomeState.toString()});`;
