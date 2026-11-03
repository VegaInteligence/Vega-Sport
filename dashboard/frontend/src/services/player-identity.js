// Last verified archived portrait; the current provider profile takes precedence.
export const MESSI_PORTRAIT =
  "https://cdn.pitchapi.dev/images/players/4d33a107ca0c78cbe22a3aa4f641007615e51b69af5ca1c5b40cf9dedbe3c563.webp";

/** Keep a player's identity independent of the selected view and filters. */
export function resolvePlayerIdentity(
  id,
  profile,
  appearances = [],
  remote = null,
) {
  let observedName = "",
    observedImage = "";
  if (!profile?.imageUrl || !profile?.matches) {
    for (const row of appearances || []) {
      if (row.playerId !== id) continue;
      observedName ||= row.name || "";
      observedImage ||= row.imageUrl || "";
      if (observedName && observedImage) break;
    }
  }
  return {
    name:
      (profile?.matches && profile.name) ||
      remote?.name ||
      observedName ||
      (id === "p_1mZO3B" ? "Lionel Messi" : ""),
    imageUrl:
      profile?.imageUrl ||
      observedImage ||
      remote?.image_url ||
      remote?.imageUrl ||
      (id === "p_1mZO3B" ? MESSI_PORTRAIT : ""),
  };
}
