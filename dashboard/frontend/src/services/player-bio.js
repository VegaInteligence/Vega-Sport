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
