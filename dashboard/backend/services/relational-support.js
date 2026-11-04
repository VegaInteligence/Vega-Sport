import { canonical, query } from "./postgres.js";
import definitions from "./support-model.json" with { type: "json" };

const { families, models } = definitions;
const plans = new Map();

function compile(name) {
  const root = families[name];
  const relations = [];
  function visit(key, depth) {
    relations.push({ key, depth, model: models[key] });
    for (const child of Object.values(models[key].children))
      visit(child, depth + 1);
  }
  visit(root, 0);
  // Each nested selection uses the projection_id prefix of its primary key. A single
  // statement sees one committed generation, including when a worker replaces children.
  const selections = relations.map(({ key, model, depth }) => {
    const order = Array.from(
      { length: depth },
      (_, i) => "r.ordinal_" + (i + 1),
    );
    const from =
      " FROM statarena_app." + model.table + " r WHERE r.projection_id=p.id";
    const select = depth
      ? "SELECT json_agg(r ORDER BY " + order.join(",") + ")" + from
      : "SELECT row_to_json(r)" + from;
    return "(" + select + ") AS " + key;
  });
  return {
    relations,
    root,
    sql:
      "SELECT p.digest, " +
      selections.join(",") +
      " FROM statarena_app.support_projection p WHERE p.name=$1 AND p.params=$2",
  };
}

function assign(obj, path, value) {
  const names = path.split(".");
  for (const name of names.slice(0, -1)) obj = obj[name] ??= {};
  obj[names.at(-1)] = value;
}

function unpack(key, record, groups, indexes) {
  const { fields, children, scalar } = models[key];
  if (scalar) return record[fields[scalar][0]];
  const out = {},
    absent = new Set(record.missing),
    nulls = new Set(record.null_groups);
  for (const [path, [column]] of Object.entries(fields)) {
    let prefix = "",
      blocked = false;
    for (const part of path.split(".")) {
      prefix += (prefix ? "." : "") + part;
      if (absent.has(prefix) || nulls.has(prefix)) {
        blocked = true;
        break;
      }
      if (prefix !== path) {
        // An explicitly present empty nested source object must remain an object.
        const parts = prefix.split(".");
        let obj = out;
        for (const name of parts) obj = obj[name] ??= {};
      }
    }
    if (!blocked) assign(out, path, record[column]);
  }
  for (const [path, child] of Object.entries(children)) {
    if (absent.has(path) || nulls.has(path)) continue;
    const rows = groups.get(child)?.get(indexes.join("/")) || [];
    assign(
      out,
      path,
      rows.map((r) =>
        unpack(child, r, groups, [
          ...indexes,
          r["ordinal_" + (indexes.length + 1)],
        ]),
      ),
    );
  }
  for (const path of nulls) assign(out, path, null);
  if (key === "cup_fixture") {
    for (const synthetic of ["scorePeriods", "scoreVector"]) {
      if (!Object.hasOwn(out, synthetic)) continue;
      out.score = out[synthetic];
      delete out[synthetic];
    }
  }
  return out;
}

export async function getSupporting(
  name,
  params = {},
  { head = false, withMeta = false } = {},
) {
  if (!Object.hasOwn(families, name)) return null;
  const values = [name, canonical(params)];
  if (head) {
    const rows = await query(
      name === "player-honours"
        ? "SELECT p.digest,h.available AS ready FROM statarena_app.support_projection p JOIN statarena_app.support_honours h ON h.projection_id=p.id WHERE p.name=$1 AND p.params=$2"
        : "SELECT digest FROM statarena_app.support_projection WHERE name=$1 AND params=$2",
      values,
    );
    return rows.length
      ? {
          etag: `W/"support-v1-${rows[0].digest}"`,
          ready: rows[0].ready !== false,
        }
      : null;
  }
  if (!plans.has(name)) plans.set(name, compile(name));
  const { sql, relations, root } = plans.get(name);
  const [data] = await query(sql, values);
  if (!data) return null;
  if (!data[root])
    throw new Error("Published projection has no normalized root");
  const groups = new Map();
  for (const { key, depth } of relations) {
    if (!depth) continue;
    const byParent = new Map();
    for (const row of data[key] || []) {
      const parent = Array.from(
        { length: depth - 1 },
        (_, i) => row["ordinal_" + (i + 1)],
      ).join("/");
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(row);
    }
    groups.set(key, byParent);
  }
  const body = unpack(root, data[root], groups, []);
  return withMeta
    ? { value: body, etag: `W/"support-v1-${data.digest}"`, status: 200 }
    : body;
}
