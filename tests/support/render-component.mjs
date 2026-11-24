// Compiles one site component with its imports replaced by stubs (the repo's render-test pattern, shared by the
// preference render tests). Any import not stubbed fails loudly.
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
export const React = requireLocal("react");
export const { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core");
const preset = requireLocal("next/dist/compiled/babel/preset-react");
const commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");

/** `file` relative to dashboard/frontend/src; `stubs` by import specifier. Returns module.exports. */
export async function compile(file, stubs) {
  const filename = path.join(root, "dashboard/frontend/src", file);
  const source = await fs.readFile(filename, "utf8");
  const code = babel.transformSync(source, {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
    (name) => {
      if (name === "react") return React;
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}
export const src = (file) => import(path.join(root, "dashboard/frontend/src", file));
