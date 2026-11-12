export function shotOutcome(s) {
  if (s.isOwnGoal) return "Contre son camp";
  if (s.isGoal) return "But";
  if (s.isBlocked || ["BlockedShot", "Blocked"].includes(s.type))
    return "Bloqué";
  if (s.type === "Post") return "Poteau";
  if (s.isOnTarget === true || s.type === "AttemptSaved")
    return "Cadré sans but";
  if (["Miss", "MissedShots", "MissedShot"].includes(s.type))
    return "Non cadré";
  return "Résultat inconnu";
}
export function shotPosition(s) {
  const frame = s.coordinateFrame ?? s.coordinate_frame;
  if (frame && frame !== "acting_ltr") return null;
  const length = Number(s.pitchLengthM ?? s.pitch_length_m ?? 105);
  const width = Number(s.pitchWidthM ?? s.pitch_width_m ?? 68);
  if (
    !(length > 0 && width > 0) ||
    !Number.isFinite(s.x) ||
    !Number.isFinite(s.y) ||
    s.x < 0 ||
    s.x > length ||
    s.y < 0 ||
    s.y > width
  )
    return null;
  const verified = frame === "acting_ltr";
  return {
    x: s.x / length,
    y: s.y / width,
    distance: verified ? Math.hypot(length - s.x, width / 2 - s.y) : null,
    approximate:
      (s.pitchLengthM == null && s.pitch_length_m == null) ||
      (s.pitchWidthM == null && s.pitch_width_m == null),
    verified,
  };
}

/**
 * What the strikes added to the chances: the sum of xGOT minus xG over the shots whose
 * two values are known. A shot off target or blocked is worth 0 after the strike; a shot
 * on target without an xGOT is left out, as is an own goal. Null without any such shot.
 */
export function strikeQuality(shots) {
  let value = 0,
    counted = 0,
    onTarget = 0;
  for (const shot of shots || []) {
    if (!shot || shot.isOwnGoal || !Number.isFinite(shot.xg)) continue;
    const framed = shot.isGoal === true || shot.isOnTarget === true;
    if (framed && !Number.isFinite(shot.xgot)) continue;
    const after = framed ? shot.xgot : Number.isFinite(shot.xgot) ? shot.xgot : 0;
    value += after - shot.xg;
    counted++;
    if (framed) onTarget++;
  }
  return counted ? { value, shots: counted, onTarget } : null;
}
