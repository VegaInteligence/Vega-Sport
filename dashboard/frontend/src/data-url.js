/** Versioned data assets are published with the site, not the private repository. */
export const dataUrl = (path) => {
  const revision = process.env.NEXT_PUBLIC_DATA_REVISION;
  if (/^[a-f0-9]{40}$/i.test(revision || "")) {
    const relative =
      path === "dashboard-manifest.json"
        ? "computed/dashboard/index.json"
        : path === "football-manifest.json"
          ? "raw/index.json"
          : path;
    return `/assets/${revision}/${relative}`;
  }
  return `/data/${path}`;
};
