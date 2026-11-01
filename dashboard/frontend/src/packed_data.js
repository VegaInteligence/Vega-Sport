/** Lossless decoding of generated serving tables. Raw JSON stays authoritative. */
export function decodeTables(payload) {
  if (payload.format !== "orion-packed-tables-v1")
    throw new Error("Format des données indisponible");
  return Object.fromEntries(
    Object.entries(payload.tables).map(([name, table]) => {
      const { keys, dictionaries = {}, missing = {} } = table;
      return [
        name,
        table.rows.map((values, i) => {
          const absent = missing[i];
          const row = {};
          for (let j = 0; j < keys.length; j++) {
            if (absent?.includes(j)) continue;
            const value = values[j];
            row[keys[j]] =
              value !== null && dictionaries[j]
                ? dictionaries[j][value]
                : value;
          }
          return row;
        }),
      ];
    }),
  );
}
