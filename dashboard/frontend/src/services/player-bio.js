// Only fields explicitly named as such in an internal player payload are used.
// A country code or national team is not evidence of citizenship.
export function playerBio(profile) {
  if (!profile || typeof profile !== "object") return [];
  const fields = [
    ["Nom complet", profile.full_name],
    [
      "Taille",
      typeof profile.height_cm === "number" && profile.height_cm > 0
        ? `${profile.height_cm} cm`
        : null,
    ],
    ["Nationalité", profile.nationality],
    ["Pied fort", profile.preferred_foot],
    ["Poste", profile.position_label],
  ];
  return fields
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([label, value]) => ({ label, value: value.trim() }));
}

const FEET = { left: "Gauche", right: "Droit", both: "Les deux" };
const text = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const positive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
const isoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value) || "");
  return match ? { year: +match[1], month: +match[2], day: +match[3] } : null;
};
const frenchDate = ({ year, month, day }) =>
  `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;

export function ageOn(birth, today = new Date()) {
  let age = today.getUTCFullYear() - birth.year;
  const month = today.getUTCMonth() + 1;
  if (
    month < birth.month ||
    (month === birth.month && today.getUTCDate() < birth.day)
  )
    age--;
  return age;
}

export function marketValueLabel(euros) {
  if (!positive(euros)) return null;
  if (euros >= 1e6) {
    const millions = euros / 1e6;
    return `${millions.toLocaleString("fr-FR", { maximumFractionDigits: millions < 10 ? 1 : 0 })} M€`;
  }
  return `${Math.round(euros / 1e3).toLocaleString("fr-FR")} k€`;
}

/**
 * Identity and market facts published with the player record (Transfermarkt
 * fields such as birth date, contract and market value). Absent fields are
 * omitted: the profile never estimates a value the source did not publish.
 */
export function playerFacts(record, today = new Date()) {
  if (!record || typeof record !== "object") return { facts: [], value: null };
  const birth = isoDate(record.birth_date || record.date_of_birth);
  const contract = isoDate(record.contract_until || record.contract_expires);
  const height = positive(record.height_cm);
  const foot =
    FEET[record.preferred_foot] ||
    FEET[record.dominant_foot] ||
    text(record.preferred_foot);
  const facts = [
    text(record.full_name) && {
      label: "Nom complet",
      value: text(record.full_name),
    },
    birth && {
      label: "Âge",
      value: `${ageOn(birth, today)} ans`,
      note: frenchDate(birth),
    },
    height && {
      label: "Taille",
      value: `${(height / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} m`,
    },
    foot && { label: "Pied fort", value: foot },
    text(record.nationality) && {
      label: "Nationalité",
      value: text(record.nationality),
    },
    contract && {
      label: "Fin de contrat",
      value: `${String(contract.month).padStart(2, "0")}/${contract.year}`,
      note: frenchDate(contract),
    },
    text(record.position_label) && {
      label: "Poste",
      value: text(record.position_label),
    },
    text(record.agent) && { label: "Agent", value: text(record.agent) },
  ].filter(Boolean);
  const amount = marketValueLabel(
    record.market_value_eur ?? record.market_value,
  );
  const updated = isoDate(record.market_value_updated_at);
  return {
    facts,
    value: amount
      ? {
          amount,
          source: text(record.market_value_source) || "Transfermarkt",
          updated: updated ? frenchDate(updated) : null,
        }
      : null,
  };
}
