export const WORLD_CUP_ID = "l_1XLtP0";
const WORLD_CUP_HISTORY_ID = "open-cup:world-cup-history";

// Both catalogues carried the same 2026 edition mark as a family logo.
const misattributedWorldCupLogo = "https://img.thesports.com/football/competition/da617cd58cd9cffaae0daec865457fb5.png";

function worldCupFamily(id) {
  return id === WORLD_CUP_ID || id === WORLD_CUP_HISTORY_ID || id === "l_v0000064";
}

export function familyArtworkUrl(id, imageUrl) {
  return worldCupFamily(id) && imageUrl === misattributedWorldCupLogo ? undefined : imageUrl;
}

export function editionArtworkUrl(id, imageUrl, artwork) {
  if (artwork?.role === "edition_emblem" && artwork.imageUrl) return artwork.imageUrl;
  // A logo attributed to either World Cup family needs edition-specific evidence
  // before it can fill a season's slot. Other competitions keep their own logo.
  return worldCupFamily(id) ? undefined : imageUrl;
}
