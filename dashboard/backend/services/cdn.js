// Only content-addressed, already-public files may be delivered from CloudFront.
export function immutableFile(path) {
  return (
    !path.split("/").some((part) => part.startsWith(".")) &&
    /^(?:raw|computed|sources)\/[A-Za-z0-9_./-]+(?:-|\/)[a-f0-9]{24,64}\.(?:json(?:\.gz)?|webp|png|jpe?g)$/.test(
      path,
    )
  );
}

export function cloudFrontObjectUrl(path, configuredBase) {
  if (!immutableFile(path)) throw new Error("File is not content-addressed");
  const base = new URL(configuredBase);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid CloudFront URL");
  return new URL("data/" + path, base).href;
}
