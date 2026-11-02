import fs from "node:fs/promises";
import path from "node:path";

/** Publish only the data already served by the app, never the private source tree. */
export async function exportPublicData(dataRoot, publicRoot, revision) {
  if (!/^[a-f0-9]{40}$/i.test(revision || ""))
    throw new Error("A commit revision is required to publish data");
  const base = path.resolve(publicRoot, "assets");
  const target = path.join(base, revision);
  if (!target.startsWith(base + path.sep))
    throw new Error("Invalid public data destination");

  await fs.mkdir(target, { recursive: true });
  await Promise.all(
    ["raw", "computed"].map(async (name) => {
      const source = path.join(dataRoot, name);
      await fs.access(source);
      await fs.cp(source, path.join(target, name), { recursive: true });
    }),
  );
  return target;
}
