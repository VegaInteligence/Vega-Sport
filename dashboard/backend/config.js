import path from "node:path";
import { fileURLToPath } from "node:url";
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = path.resolve(appRoot, "..");
export const databaseRoot = path.join(repositoryRoot, "data");
export function argument(name) {
  const args = process.argv.slice(2);
  const value = args.find((x) => x.startsWith(name + "="));
  return value
    ? value.slice(name.length + 1)
    : args.includes(name)
      ? args[args.indexOf(name) + 1]
      : undefined;
}
export const port = Number(argument("--port") || process.env.PORT || 8765);
export const hostname =
  argument("--host") === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
