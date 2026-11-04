// Use the packed_data row contract and carry per-table constants once per HTTP page.
function packTable(records) {
  const fields = new Set();
  for (const record of records)
    for (const key of Object.keys(record)) fields.add(key);
  const constants = {};
  const keys = [];
  for (const key of fields) {
    const value = records[0][key];
    if (
      records.length > 1 &&
      (value === null || typeof value !== "object") &&
      records.every((row) => Object.hasOwn(row, key) && row[key] === value)
    )
      constants[key] = value;
    else keys.push(key);
  }
  const rows = records.map(() => new Array(keys.length));
  const dictionaries = {};
  const missing = {};
  for (const [j, key] of keys.entries()) {
    const unique = new Map();
    let scalar = true;
    let repeatedBytes = 0;
    for (const [i, record] of records.entries()) {
      if (!Object.hasOwn(record, key)) {
        (missing[i] ??= []).push(j);
        rows[i][j] = null;
        continue;
      }
      const value = record[key];
      rows[i][j] = value;
      if (value !== null && typeof value === "object") {
        scalar = false;
      } else if (!unique.has(value)) {
        unique.set(value, unique.size);
      } else if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      ) {
        repeatedBytes += typeof value === "string" ? value.length + 2 : 4;
      }
    }
    // Index strings, booleans and repeated nulls only when their estimated
    // savings pay for the indexes. Unique numeric geometry stays numeric.
    if (
      scalar &&
      repeatedBytes > records.length * String(unique.size).length + 8
    ) {
      dictionaries[j] = [...unique.keys()];
      for (const [i, record] of records.entries())
        if (Object.hasOwn(record, key)) rows[i][j] = unique.get(record[key]);
    }
  }
  return {
    keys,
    constants,
    rows,
    dictionaries,
    ...(Object.keys(missing).length && { missing }),
  };
}

export function packPartition({
  meta,
  metrics,
  teams,
  competitions,
  fixtures,
  matches,
  appearances,
}) {
  const shots = [],
    stats = [];
  const appearanceIndexes = new Map(appearances.map((p, i) => [p.id, i]));
  const matchRows = matches.map((match) => {
    for (const shot of match.shots) shots.push(shot);
    for (const stat of match.stats) stats.push(stat);
    return {
      ...match,
      shots: match.shots.length,
      stats: match.stats.length,
      players: match.players.map((id) => appearanceIndexes.get(id) ?? id),
    };
  });
  const tables = {
    teams,
    competitions,
    fixtures,
    matches: matchRows,
    appearances,
    shots,
    stats,
  };
  return {
    format: "orion-packed-tables-v1",
    meta,
    metrics,
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, packTable(rows)]),
    ),
  };
}
