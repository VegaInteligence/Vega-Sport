/** Accent-insensitive archive matching, identical in browser and API. */
export const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
