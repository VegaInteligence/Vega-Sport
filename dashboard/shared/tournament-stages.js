export const UNKNOWN_STAGE_LABEL = "Phase non renseignée";

/** Read only round labels that identify a stage in the competition sources. */
export function stageKind(round) {
  const name = String(round ?? "").trim().toLowerCase()
    .replace(/^finals,\s*|,\s*replays?$/g, "");
  if (/^(?:(?:match for )?third[ -]place(?: match| play[ -]?off)?|3rd place|bronze|match pour la troisi[eè]me place)$/.test(name)) return "third";
  if (/^(?:the )?finale?s?$/.test(name)) return "final";
  if (name === "final round") return "final-pool";
  if (/^(?:semi[ -]?finals?|1\/2|demi(?:[ -]?finales?)?)$/.test(name)) return "semi";
  if (/^(?:quarter[ -]?finals?|1\/4|quarts?(?: de finale)?)$/.test(name)) return "quarter";
  if (/^(?:round of 16|1\/8|huiti[eè]mes?(?: de finale)?)$/.test(name)) return "r16";
  if (/^(?:round of 32|1\/16|seizi[eè]mes?(?: de finale)?)$/.test(name)) return "r32";
  if (/^(?:\d+|(?:matchday|journ[eé]e) \d+|(?:group|groupe|gruppe) [a-z0-9]+(?: play[ -]?off)?|(?:first|preliminary|1st) round|phase de groupes)$/.test(name)) return "group";
  return "unknown";
}
