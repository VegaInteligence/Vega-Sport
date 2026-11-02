/** Lossless decoding of generated serving tables. Raw JSON stays authoritative. */

// Rows are rebuilt with a function generated once per table, so every row is
// created as one object literal of the same shape. That is an order of
// magnitude faster than adding 40+ dynamic keys one by one on each of the
// ~170k performances of a season. A fallback keeps decoding working where
// code generation is not allowed.
function generated(params, body, fallback) {
  try {
    return new Function(...params, body);
  } catch {
    return fallback;
  }
}
export function rowFactory(keys, dictionaries = {}) {
  const fields = keys.map((key, j) => {
    const value = `v[${j}]`;
    return `${JSON.stringify(key)}: ${
      dictionaries[j]
        ? `${value} !== null ? d[${j}][${value}] : ${value}`
        : value
    }`;
  });
  return generated(["v", "d"], `return {${fields.join(",")}};`, (v, d) => {
    const row = {};
    for (let j = 0; j < keys.length; j++)
      row[keys[j]] = v[j] !== null && d[j] ? d[j][v[j]] : v[j];
    return row;
  });
}
/** Copies `keys` from a row and appends `extra` fields read from a second object. */
export function rowCopier(keys, extra = []) {
  const fields = [
    ...keys.map((key) => `${JSON.stringify(key)}: r[${JSON.stringify(key)}]`),
    ...extra.map((key) => `${JSON.stringify(key)}: x[${JSON.stringify(key)}]`),
  ];
  return generated(["r", "x"], `return {${fields.join(",")}};`, (r, x) => {
    const row = {};
    for (const key of keys) row[key] = r[key];
    for (const key of extra) row[key] = x[key];
    return row;
  });
}
export function decodeTables(payload) {
  if (payload.format !== "orion-packed-tables-v1")
    throw new Error("Format des données indisponible");
  return Object.fromEntries(
    Object.entries(payload.tables).map(([name, table]) => {
      const { keys, dictionaries = {}, missing = {} } = table,
        make = rowFactory(keys, dictionaries),
        rows = table.rows,
        out = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const absent = missing[i];
        if (!absent?.length) {
          out[i] = make(rows[i], dictionaries);
          continue;
        }
        const row = {};
        for (let j = 0; j < keys.length; j++) {
          if (absent.includes(j)) continue;
          const value = rows[i][j];
          row[keys[j]] =
            value !== null && dictionaries[j] ? dictionaries[j][value] : value;
        }
        out[i] = row;
      }
      return [name, out];
    }),
  );
}
