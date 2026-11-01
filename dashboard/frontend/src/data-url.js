/** Avoid mixing cached data redirects from different deployed revisions. */
export const dataUrl = (path) => {
  const revision = process.env.NEXT_PUBLIC_DATA_REVISION;
  return `/data/${path}${revision ? `?v=${revision}` : ""}`;
};
