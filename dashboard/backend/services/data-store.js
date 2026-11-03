import { gunzipSync } from "node:zlib";
import { objectMeta, objectBody, cache } from "./neon.js";
const parsed = cache(64 * 1024 * 1024);
export async function dataJson(path) {
  const meta = await objectMeta(path);
  if (!meta) {
    const e = new Error("Neon data not found");
    e.code = "ENOENT";
    throw e;
  }
  return parsed(
    meta.sha256,
    async () => {
      const body = await objectBody(meta);
      return JSON.parse(
        path.endsWith(".gz")
          ? gunzipSync(body, { maxOutputLength: 128 * 1024 * 1024 }).toString(
              "utf8",
            )
          : body.toString("utf8"),
      );
    },
    15 * 60 * 1000,
  );
}
