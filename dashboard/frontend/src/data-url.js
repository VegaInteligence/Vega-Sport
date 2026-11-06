const configuredOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;
function publicOrigin(value) {
  if (!value) return "";
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const trusted =
    /^d[a-z0-9]+\.cloudfront\.net$/.test(url.hostname) &&
    url.protocol === "https:" &&
    !url.port;
  if (
    (!trusted && !(local && ["http:", "https:"].includes(url.protocol))) ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Origine API invalide.");
  return url.origin;
}
const origin = publicOrigin(configuredOrigin);
export function apiUrl(path) {
  if (origin && path.startsWith(origin + "/api/"))
    path = path.slice(origin.length);
  if (
    !path.startsWith("/api/") ||
    path.includes("#") ||
    /[\\\u0000-\u001f]/.test(path) ||
    decodeURIComponent(path.split("?")[0])
      .split("/")
      .some((part) => part === "." || part === "..")
  )
    throw new Error("Route API invalide.");
  return origin + path;
}

/** Historical interchange paths. The AWS web API retires raw object delivery. */
export function dataUrl(path) {
  if (
    typeof path !== "string" ||
    !/^(raw|computed)\/[A-Za-z0-9_./-]+$/.test(path) ||
    path.split("/").some((part) => part.startsWith("."))
  )
    throw new Error("Route de données invalide.");
  return "/data/" + path;
}
