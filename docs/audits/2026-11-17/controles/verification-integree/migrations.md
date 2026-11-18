# Ordre réservé des migrations pour la branche d’audit

Inventaire des sept worktrees le 18 novembre. Le premier passage d'Opus T4 a déjà créé et appliqué 141_archive_removal_guards sur sa copie privée. La piste visuels n'a aucun fichier 142 appliqué ou créé. Préserver la migration enregistrée et rendre l'ordre compatible avec le démarrage neuf et la mise à niveau.

- 141, T4, gardes de suppression des archives déjà présentes.
- 141 crée aussi le pointeur core.competition_seasons.emblem_asset_id. 142, T4, qualifie sa provenance et les associations des éditions.
- 143, T4, alias d’identités d'archives si ce schéma est nécessaire.
- 144, T7, projection du visuel d'édition. Le test d'intégration applique 141, 142 et 144 dans l'ordre numérique.
- 145, T4, conservation bornée de la preuve des périodes de Coupe d'Allemagne.
- 146, T4, protection des vrais logos familiaux sur les seules associations attestées.
- 147, T2, qualification de la lecture du classement J1 déjà attribué au mauvais millésime, préservation des observations.
- 148, T4, prévention de la réapparition des deux scores écossais dont la correction est attestée.
- 149, T4, validation de la rencontre retenue par chaque alias d’archive et refus des contradictions avec la trace du retrait. Le rejeu confirme cinq refus, les contrôles positifs et la lecture publique des anciennes clés.

Ces numéros remplacent les réservations provisoires 141/142/143 des briefs précédents. Les autres migrations originales 134–140 conservent leur ordre et propriétaire. Aucune de ces réservations ne change une migration de production.
