const mediaOrigin = "https://d2clu0phovomb8.cloudfront.net";
export function safeResolvedMedia(value) {
  try {
    const url = new URL(value);
    return url.origin === mediaOrigin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/data\/(?:raw|computed|sources)\/[A-Za-z0-9_./-]+(?:-|\/)[a-f0-9]{24,64}\.(?:webp|png|jpe?g)$/.test(
        url.pathname,
      ) &&
      !url.pathname.split("/").some((part) => part.startsWith("."))
      ? url.href
      : "";
  } catch {
    return "";
  }
}
