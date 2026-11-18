/**
 * Where badges float above a line chart's line, in the drawing's own units.
 *
 * `points` is the line as drawn ({x, y}, by x, y growing downwards); `badges` the marks to
 * place ({x}, by x). Each badge sits above the highest point of the line under its own width
 * (so it clears a slope), and above any earlier badge it would cover; it may rise above the
 * drawing's top edge (`badgeOverflow` says by how much). Returns, in the badges' order, the
 * centre ({x, y}) and the line's height at x (`footY`, the last point's height past the
 * line's end).
 */
export function placeBadges(points, badges, { radius, gap = 7, margin = 2, spacing = 4 } = {}) {
  if (!points.length) return [];
  const lineY = (x) => {
    if (x <= points[0].x) return points[0].y;
    const last = points.at(-1);
    if (x >= last.x) return last.y;
    const after = points.findIndex((point) => point.x >= x);
    const a = points[after - 1], b = points[after];
    return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  };
  const placed = [];
  for (const badge of badges) {
    const from = badge.x - radius - margin, to = badge.x + radius + margin;
    // A line of straight segments is highest at an end of the span or at one of its own points.
    const highest = Math.min(lineY(from), lineY(to), ...points.filter((point) => point.x > from && point.x < to).map((point) => point.y));
    let y = highest - gap - radius;
    const reach = 2 * radius + spacing;
    for (let moved = true; moved; ) {
      moved = false;
      for (const other of placed)
        if (Math.abs(other.x - badge.x) < reach && Math.abs(other.y - y) < reach) {
          y = other.y - reach;
          moved = true;
        }
    }
    placed.push({ x: badge.x, y, footY: lineY(badge.x) });
  }
  return placed;
}

/** How far the highest badge rises above the drawing's top edge, `pad` kept clear: what the
 * chart adds above its plot so that no badge is cut or pushed back onto another. */
export const badgeOverflow = (placed, radius, pad = 0) => Math.max(0, ...placed.map((badge) => pad + radius - badge.y));
