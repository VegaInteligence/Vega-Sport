import { isNumber } from "./format.js";

/** No played match with known minutes means the accumulated zero is unknown. */
export function observedMinutes(profile) {
  return profile?.matches > 0 && isNumber(profile.minutes)
    ? profile.minutes
    : null;
}

/** Adjust the scale to the observed values while retaining missing points. */
export function trendExtent(points, bounds = []) {
  const values = points.map((point) => point.value).filter(isNumber);
  if (!values.length) return null;
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  const spread = maximum - minimum;
  const padding = spread
    ? spread * 0.15
    : Math.max(Math.abs(maximum) * 0.05, 0.5);
  let low = minimum - padding,
    high = maximum + padding;
  if (minimum >= 0) low = Math.max(0, low);
  if (isNumber(bounds[0]) && minimum >= bounds[0])
    low = Math.max(bounds[0], low);
  if (isNumber(bounds[1]) && maximum <= bounds[1])
    high = Math.min(bounds[1], high);
  if (high <= low) high = low + 1;
  return { low, high };
}
