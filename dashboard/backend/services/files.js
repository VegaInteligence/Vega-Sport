import path from "node:path";
import { realpath, stat } from "node:fs/promises";
export const response = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
export function contained(root, file) {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
export async function publicFile(root, relative, head = false) {
  if (
    relative.split("/").some((x) => x.startsWith(".")) ||
    !contained(root, path.resolve(root, relative))
  )
    return response("Forbidden", 403);
  try {
    const [base, file] = await Promise.all([
      realpath(root),
      realpath(path.resolve(root, relative)),
    ]);
    if (
      !contained(base, file) ||
      path
        .relative(base, file)
        .split(path.sep)
        .some((x) => x.startsWith("."))
    )
      return response("Forbidden", 403);
    if (!(await stat(file)).isFile()) return response("Not found", 404);
    const body = Bun.file(file);
    return response(head ? null : body, 200, {
      "Content-Type": relative.endsWith(".gz") ? "application/gzip" : body.type,
      "Content-Length": String(body.size),
      "Cache-Control": "no-cache",
    });
  } catch (error) {
    return response(
      error.code === "ENOENT" || error.code === "ENOTDIR"
        ? "Not found"
        : "Unable to read asset",
      error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500,
    );
  }
}
