/** Public immutable data bypasses a serverless redirect on every file request. */
export const dataUrl = (path) => {
  const revision = process.env.NEXT_PUBLIC_DATA_REVISION;
  if (/^[a-f0-9]{40}$/i.test(revision || "")) {
    const relative =
      path === "dashboard-manifest.json"
        ? "computed/dashboard/index.json"
        : path === "football-manifest.json"
          ? "raw/index.json"
          : path;
    return `https://raw.githubusercontent.com/OrionQuantPlatform/Football_Ranking/${revision}/data/${relative}`;
  }
  return `/data/${path}`;
};
