import { cupSnapshotPath } from "../../../shared/cup-worker.js";
import { dataUrl } from "../data-url.js";

/** Read the last worker publication; only fall back to the live route if absent. */
export async function cupWorkerSnapshot(kind, competition, season, fallbackUrl = null) {
  const response = await fetch(dataUrl(cupSnapshotPath(kind, competition, season)));
  if (response.ok) {
    const value = await response.json();
    if (!Array.isArray(kind === "standings" ? value.tables : value.matches)) throw new Error("Données de coupe invalides.");
    return value;
  }
  if (response.status !== 404 || !fallbackUrl) {
    const error = new Error("Données de coupe indisponibles (HTTP " + response.status + ")");
    error.status = response.status;
    throw error;
  }
  const fallback = await fetch(fallbackUrl);
  if (!fallback.ok) throw new Error("Données de coupe indisponibles (HTTP " + fallback.status + ")");
  return fallback.json();
}
