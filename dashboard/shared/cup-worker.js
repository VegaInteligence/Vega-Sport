export const CUP_WORKER_ROOT = "raw/cup-worker";
const KINDS = new Set(["open-cups", "openligadb", "nations-results", "native", "standings"]);
export function cupSnapshotPath(kind, competition, season) {
  if (!KINDS.has(kind) || !/^[A-Za-z0-9_-]+$/.test(competition || "") || !/^\d{4}(?:\/\d{4})?$/.test(season || ""))
    throw new Error("Invalid cup snapshot identity");
  return `${CUP_WORKER_ROOT}/${kind}/${competition}/${season.replace("/", "-")}.json`;
}
