"""Produce a complete dictionary, current-to-target inventory and Graphviz inputs."""
import collections
import csv
import hashlib
import html
import json
from pathlib import Path
import re

OUT = Path(__file__).resolve().parents[1]
ROOT = OUT.parents[2]
model = json.loads((OUT / "target-schema.proposed.json").read_text())
tables = {t["qualified_name"]: t for s in model["schemas"] for t in s["tables"]}
baseline = json.loads((OUT / "inputs/Orion_schema_bdd.original.json").read_text())
baseline_names = {t["qualified_name"] for s in baseline["schemas"] for t in s["tables"]}
dbs = json.loads((OUT / "evidence/databases.json").read_text())["databases"]

COMMON = {
    "id": "Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.",
    "name": "Nom de l’entité dans le contexte défini par cette table.", "display_name": "Nom d’affichage observé ou sélectionné pour cette identité.",
    "code": "Code stable du référentiel, avec sa définition explicite.", "label": "Libellé d’affichage du code ou de l’édition.",
    "definition": "Définition sémantique du code et de ses conditions d’utilisation.", "description": "Description documentée de l’objet.",
    "slug": "Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases.",
    "source_id": "Espace d’identifiants du fournisseur ; une copie de données ne devient pas une nouvelle source.",
    "source_record_id": "Observation d’origine identifiée dans les métadonnées de provenance ; ses faits restent dans SQL après purge.",
    "canonical_policy_version": "Version de la règle qui choisit une observation entre plusieurs sources.",
    "data_revision": "Révision du grain ou de la famille, incrémentée seulement lorsque son contenu change.",
    "quality_flags": "Codes de qualité et booléens enregistrés ; aucun fait sportif ou document complet.",
    "updated_at": "Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.",
    "created_at": "Création de cette ligne dans le système.", "computed_at": "Instant de calcul effectif du résultat dérivé.",
    "observed_at": "Instant auquel l’information a été observée ; ne prouve pas une date de validité métier.",
    "retrieved_at": "Récupération effective de la donnée source.", "published_at": "Publication déclarée ou activation, selon le grain de cette table.",
    "source_updated_at": "Dernière mise à jour déclarée par la source, distincte de sa récupération.",
    "source_published_at": "Publication déclarée par la source ; reste inconnue en l’absence de preuve.",
    "status": "État explicite de l’objet, limité aux valeurs du CHECK de cette table.",
    "scope": "Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent.",
    "scope_key": "Identifiant stable d’un périmètre de calcul et de sa population.",
    "season_key": "Saison métier de l’édition : par exemple 2026 ou 2026/2027 ; jamais déduite du seul répertoire.",
    "external_id": "Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.",
    "period_code": "Période définie dans football.periods ; full_match ne s’additionne pas aux mi-temps.",
    "match_date": "Date civile connue du match ; une heure inconnue ne crée pas un instant minuit fictif.",
    "kickoff_at": "Instant UTC du coup d’envoi, uniquement lorsque l’heure est connue.",
    "kickoff_precision": "Précision réellement fournie : unknown, date, minute ou second.",
    "source_timezone": "Fuseau de la date/heure source si connu, utilisé pour la conversion explicite.",
    "publication_state": "draft, published ou quarantined ; les invariants renforcés s’appliquent à la publication.",
    "round_label": "Tour ou journée tel qu’observé ; ne présume pas un ordre numérique.",
    "round_number": "Numéro de journée/tour lorsqu’il est explicitement connu.",
    "leg_number": "Manche d’une confrontation aller/retour.", "tie_key": "Clé qui regroupe les manches d’une confrontation.",
    "side": "Place home ou away du participant dans ce match.", "participant_label": "Libellé de participant encore non résolu, par exemple vainqueur d’une demi-finale.",
    "score_scope": "Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance.",
    "score_basis": "Score effectivement joué, attribué administrativement ou de base inconnue.",
    "goals": "Buts observés dans le grain et la période de cette table ; zéro est une observation.",
    "assists": "Passes décisives attribuées par le fournisseur dans cette période.",
    "shots": "Nombre de tirs observés selon la définition source.",
    "shots_on_target": "Tirs cadrés observés selon la définition source.",
    "shots_off_target": "Tirs non cadrés observés.", "shots_blocked": "Tirs bloqués observés.",
    "xg": "Buts attendus de la source ; probabilité pour un tir, total pour une participation/période.",
    "non_penalty_xg": "Buts attendus hors penalties selon la définition source.",
    "xa": "Passes décisives attendues ; une valeur indisponible reste indisponible.",
    "xgot": "Buts attendus sur tirs cadrés selon le modèle fournisseur.",
    "minutes_played": "Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation.",
    "provider_rating": "Note du fournisseur ; distincte d’un score Orion.",
    "goals_prevented": "Buts évités selon le modèle gardien du fournisseur ; valeur signée.",
    "played": "Participation prouvée dans match_players ; dans un classement, nombre de matchs joués.",
    "participation_evidence": "Preuve explicite qui justifie played ; une ligne de performance ne suffit pas.",
    "squad_status": "Titulaire, remplaçant, remplaçant inutilisé, observation ou état inconnu.",
    "is_starter": "Statut titulaire observé ; ne pas le déduire de statistiques manquantes.",
    "shirt_number": "Numéro natif conservé en texte ; la forme et le type d’origine sont traçables par field_states.",
    "is_captain": "Capitanat explicitement indiqué dans la composition.",
    "confirmed": "Confirmation explicite de la composition ; une prédiction ne vaut pas confirmation.",
    "formation": "Formation observée, conservée comme libellé.",
    "lineup_type": "Nature confirmed, predicted, observed ou unknown de la composition.",
    "event_seq": "Ordre dans une version du flux ; ne constitue pas une identité stable entre corrections.",
    "source_ordinal": "Position native dans la collection source, conservée pour la compatibilité.",
    "event_type": "Type d’événement observé ; mapping versionné si normalisé.",
    "minute": "Minute source dans la période indiquée ; précision conservée.",
    "minute_added": "Temps additionnel distinct de la minute principale.", "second": "Seconde dans la minute, de 0 à 59.",
    "is_penalty": "Penalty explicitement signalé dans l’observation.",
    "is_own_goal": "But contre son camp explicitement signalé.",
    "source_event_id": "Identifiant natif d’événement s’il existe ; sinon ordre dans la famille versionnée.",
    "external_shot_id": "Identifiant de tir limité à son match et sa source.",
    "coordinate_frame": "Repère spatial déclaré par la source, propre à cette famille.",
    "x_m": "Coordonnée longitudinale du tir, en mètres seulement si conversion vérifiée ; le repère est explicite.",
    "y_m": "Coordonnée transversale du tir dans le repère déclaré.",
    "raw_pitch_x": "Coordonnée native de placement du joueur ; pas une distance en mètres supposée.",
    "raw_pitch_y": "Seconde coordonnée native de placement du joueur.",
    "goal_crossed_y": "Coordonnée du franchissement de la ligne de but dans le repère du fournisseur.",
    "goal_crossed_z": "Hauteur du franchissement de la ligne de but dans le repère du fournisseur.",
    "body_part": "Partie du corps si fournie ; ne pas l’inférer d’un code de tir non défini.",
    "outcome": "Résultat du tir selon un mapping documenté.",
    "situation": "Contexte du tir : jeu ouvert, phase arrêtée, etc., selon les codes source.",
    "is_goal": "Indicateur de but observé ou dérivé sous règle versionnée.",
    "is_on_target": "Indicateur natif de tir cadré.", "is_inside_box": "Tir dans la surface selon la source.",
    "grid_columns": "Nombre de colonnes de la grille spatiale.", "grid_rows": "Nombre de lignes de la grille spatiale.",
    "cell_length_m": "Longueur en mètres d’une cellule.", "cell_width_m": "Largeur en mètres d’une cellule.",
    "map_kind": "Nature de la carte spatiale.", "actions": "Nombre d’actions couvertes, si renseigné.",
    "from_seconds": "Début connu de la fenêtre du réseau, en secondes de match.",
    "until_seconds": "Fin de la fenêtre ; first_substitution ne décrit pas tout le match.",
    "window_kind": "Contrat de la fenêtre temporelle du réseau.",
    "passes": "Passes observées pour le nœud, l’arête ou le périmètre de cette table.",
    "passes_received": "Passes reçues par ce nœud du réseau.",
    "avg_x": "Position longitudinale moyenne dans le repère du réseau.", "avg_y": "Position transversale moyenne dans ce repère.",
    "degree": "Degré du nœud selon le contrat réseau.", "strength": "Force pondérée du nœud selon le contrat fournisseur.",
    "betweenness": "Centralité d’intermédiarité fournie.", "clustering": "Coefficient de clustering fourni.",
    "centralization": "Centralisation collective fournie pour cette fenêtre.",
    "rank": "Rang publié ; les ex aequo ne sont pas interdits sans règle de la source.",
    "previous_rank": "Rang de l’édition précédente selon la source.",
    "points": "Points publiés ; peuvent inclure bonus et sanctions selon le classement.",
    "coefficient": "Coefficient de fédération publié par l’autorité.",
    "earned_points": "Points acquis indiqués séparément par la source.",
    "component_period": "Période annuelle de contribution au coefficient, distincte de la date de récupération.",
    "component_rank": "Rang publié de cette composante lorsqu’il existe.",
    "edition_key": "Clé native de l’édition du classement ou de la distinction.",
    "period_label": "Période de référence déclarée ; ne prouve pas la disponibilité historique.",
    "effective_on": "Date d’effet connue du classement, distincte de publication/récupération.",
    "effective_at": "Instant d’effet connu de ce tableau de classement.",
    "official_edition": "Édition officielle si explicitement attestée par la source.",
    "subject_kind": "Type d’entité classée ou agrégée ; les fédérations restent distinctes des équipes.",
    "methodology_version": "Version de la méthode de l’autorité de classement.",
    "authority": "Organisme qui publie ce classement, par exemple FIFA ou UEFA.",
    "scope_definition": "Définition technique bornée du périmètre et des règles d’éligibilité du modèle futur.",
    "score": "Résultat du modèle versionné ; l’échelle appartient à la définition du modèle.",
    "role_code": "Rôle retenu pour l’évaluation, selon une définition versionnée.",
    "temporal_policy": "Politique de disponibilité de l’information : observée, publiée avant cutoff ou rétrospective.",
    "knowledge_cutoff_at": "Dernier instant auquel les informations sont admissibles pour ce calcul.",
    "window_start": "Première date inclusive de la fenêtre d’évaluation.", "window_end": "Dernière date inclusive de cette fenêtre.",
    "search_text": "Texte préparé pour la recherche, issu des identités/alias retenus.",
    "search_vector": "Vecteur plein texte PostgreSQL généré de search_text avec dictionnaire simple.",
}
METRICS = {
    "passes_completed": "Passes réussies observées.", "passes_attempted": "Passes tentées observées, dénominateur des taux.",
    "passes_final_third": "Passes dans le dernier tiers selon le contrat source.", "chances_created": "Occasions créées attribuées par la source.",
    "big_chances_created": "Grosses occasions créées selon la définition source.",
    "defensive_actions": "Actions défensives selon le contrat de la mesure.", "interceptions": "Interceptions observées.",
    "tackles": "Tacles selon la définition source.", "recoveries": "Ballons récupérés.", "clearances": "Dégagements observés.",
    "blocks": "Actions bloquées selon la définition source.", "duels_won": "Duels gagnés observés.", "duels_lost": "Duels perdus observés.",
    "aerial_duels_won": "Duels aériens gagnés.", "aerial_duels_attempted": "Duels aériens disputés, dénominateur connu.",
    "aerials": "Duels aériens selon le contrat avancé.", "aerials_won": "Duels aériens gagnés du contrat avancé.",
    "touches": "Ballons touchés selon le fournisseur.", "touches_box": "Ballons touchés dans la surface.",
    "dribbles_completed": "Dribbles réussis.", "dribbles_attempted": "Dribbles tentés.", "saves": "Arrêts du gardien observés.",
    "corners": "Corners observés.", "offsides": "Hors-jeu observés.", "fouls": "Fautes observées.",
    "yellow_cards": "Avertissements attribués dans cette période.", "red_cards": "Expulsions attribuées dans cette période.",
    "crosses_completed": "Centres réussis.", "crosses_attempted": "Centres tentés.",
    "progressive_passes": "Passes progressives selon la définition du fournisseur.", "passes_into_box": "Passes dans la surface.",
    "key_passes": "Passes clés selon le fournisseur.", "through_balls": "Passes en profondeur.", "crosses": "Centres du contrat avancé.",
    "switches": "Renversements de jeu du contrat avancé.", "carries": "Conduites de balle observées.",
    "progressive_carries": "Conduites progressives.", "carries_into_final_third": "Conduites dans le dernier tiers.",
    "carries_into_box": "Conduites dans la surface.", "take_ons": "Tentatives de duel offensif.", "take_ons_won": "Duels offensifs réussis.",
    "miscontrols": "Mauvais contrôles observés.", "dispossessed": "Pertes sur dépossession.",
    "sca": "Actions menant à un tir selon la méthode du fournisseur.", "gca": "Actions menant à un but selon cette méthode.",
    "second_assists": "Avant-dernières passes décisives attribuées.", "xag": "Expected assisted goals selon le modèle fournisseur.",
    "xg_chain": "Contribution xG de chaîne de possession selon ce modèle.", "xg_buildup": "Contribution xG de construction selon ce modèle.",
    "xt_total": "Expected threat fournisseur, valeur signée ; modèle identifié séparément.",
    "vaep_total": "Valeur VAEP totale fournisseur, signée.", "vaep_offensive": "Composante offensive VAEP, signée.", "vaep_defensive": "Composante défensive VAEP, signée.",
    "pv_total": "Valeur totale de possession du modèle fournisseur.", "pv_offensive": "Composante offensive de possession.", "pv_defensive": "Composante défensive de possession.",
    "ppda": "Passes adverses par action défensive selon le contrat source ; dénominateur conservé lorsqu’il existe.",
    "field_tilt": "Part territoriale normalisée sous contrat, échelle 0–100.", "possession_pct": "Possession en pourcentage 0–100, selon la définition de cette table.",
    "opponent_passes": "Passes adverses entrant dans le périmètre de la mesure.", "high_turnovers": "Récupérations hautes selon le fournisseur.",
    "counterpress_regains_5s": "Récupérations dans les cinq secondes du contre-pressing.",
    "final_third_entries": "Entrées dans le dernier tiers.", "box_entries": "Entrées dans la surface.",
    "buildup_attacks": "Attaques construites selon la définition source.", "direct_attacks": "Attaques directes selon cette définition.",
    "challenges": "Duels/interventions du contrat avancé.", "avg_action_x": "Position longitudinale moyenne des actions, repère déclaré.",
    "avg_defensive_action_x": "Position longitudinale moyenne des actions défensives.",
    "ball_recovery_time_seconds": "Temps de récupération en secondes selon le contrat source.",
    "passes_per_sequence": "Passes par séquence selon le contrat source.", "sequence_time_seconds": "Durée de séquence en secondes.",
    "direct_speed": "Vitesse de progression directe ; unité de la définition fournisseur.",
    "progressive_pass_distance": "Distance des passes progressives, unité fournisseur à valider.",
    "carry_distance": "Distance de conduite, unité fournisseur à valider.", "progressive_carry_distance": "Distance des conduites progressives selon ce contrat.",
}


def describe(table, name, value):
    if value.get("description"):
        return value["description"]
    if table.get("history_of"):
        parent = tables[table["history_of"]]
        return "Valeur historique immuable. " + describe(parent, name, parent["columns"][name])
    refs = [f for f in table["foreign_keys"] if name in f["columns"]]
    if refs:
        return "Référence SQL vers " + "; ".join(f["references"]["table"] + "(" + ", ".join(f["references"]["columns"]) + ")" for f in refs) + "."
    if name in COMMON:
        return COMMON[name]
    if name in METRICS:
        return METRICS[name]
    if name.endswith("_at"):
        return "Instant UTC « " + name + " » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée."
    if name.endswith("_count") or name.endswith("_counted"):
        return "Nombre de « " + name.removesuffix("_count").replace("_", " ") + " » du périmètre de cette ligne ; absence distincte de zéro."
    meanings = {
        "alias": "Nom alternatif ou historique d’une équipe, conservé avec langue, source et validité.",
        "attempt_no": "Numéro strictement positif de tentative dans ce run et pour cette ressource.",
        "attribution_url": "Lien de crédit/licence à présenter pour le média.", "author": "Auteur ou crédit du média tel que sourcé.",
        "home_goals": "Score domicile du scope explicite de ce résumé.", "away_goals": "Score extérieur du même scope.",
        "home_label": "Libellé domicile figé dans la publication, y compris participant encore inconnu.", "away_label": "Libellé extérieur figé dans la publication.",
        "home_shootout_goals": "Tirs au but réussis par l’équipe domicile, séparés du score joué.", "away_shootout_goals": "Tirs au but réussis par l’équipe extérieure.",
        "base_url": "Adresse publique de base du fournisseur ; aucune clé ou secret inclus.",
        "byte_length": "Nombre d’octets vérifiés de l’ancien artefact ; métadonnée sans conservation de son contenu.",
        "content_sha256": "Empreinte SHA-256 hexadécimale du contenu effectivement vérifié ; aucune capacité de reconstruction par ce hash seul.",
        "content_type": "Type MIME du média ou de l’ancien artefact.", "encoding": "Encodage/compression source identifié.",
        "contract_version": "Version du contrat de ce corpus, figée pour les observations qui l’utilisent.",
        "coverage_state": "Disponibilité réelle de la famille, indépendante du statut HTTP : disponible, vide, indisponible, invalide, etc.",
        "dataset_key": "Clé stable du corpus de cette source.", "endpoint": "Endpoint de collecte ; jamais appelé par une requête utilisateur.",
        "entered_on": "Date d’engagement de l’équipe dans l’édition si réellement connue.", "exited_on": "Date de sortie de l’édition si réellement connue.",
        "entity_kind": "Type d’identité concerné par le rapprochement en attente.", "error_code": "Code d’erreur technique/fournisseur conservé exactement.",
        "external_key": "Clé native de cet enregistrement lorsqu’elle existe.",
        "external_profile_version_id": "Ancien identifiant public de version de profil, distinct de l’identité joueur.",
        "family": "Famille de poste : gardien, défenseur, milieu ou attaquant.",
        "feature_code": "Famille fonctionnelle de couverture, par exemple lineups, shots ou heatmaps.",
        "group_label": "Libellé historique du groupe si aucune identité de groupe n’est encore résolue.",
        "http_status": "Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP.",
        "is_aggregate": "Indique qu’une période recouvre d’autres périodes ; empêche leur addition naïve.",
        "is_stale": "Indique une donnée périmée selon sa politique de fraîcheur.",
        "language_code": "Langue de cet alias lorsqu’elle est connue.",
        "legacy_asset_url": "Ancienne URL publique à continuer de résoudre vers le média.",
        "legacy_object_path": "Ancien chemin, conservé comme provenance uniquement après purge.",
        "license_code": "Licence ou conditions d’utilisation identifiées pour le corpus/média.",
        "locator_kind": "Nature du localisateur : pointeur JSON, ligne JSONL, ordinal, membre d’archive ou document entier.",
        "mode": "Nature du run : daily, backfill, rebuild ou repair.",
        "ordinal": "Position d’un enregistrement dans son ancien conteneur, utilisée comme provenance.",
        "pitch_length_m": "Longueur du terrain en mètres lorsqu’elle est explicitement connue.", "pitch_width_m": "Largeur du terrain en mètres lorsqu’elle est connue.",
        "position_mapping_version": "Version précise de la traduction du code natif de poste.",
        "provider_model_version": "Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue.",
        "reason": "Motif documenté de l’anomalie ou du rapprochement.", "record_kind": "Type sémantique de l’observation source.",
        "request_fingerprint": "Empreinte stable de la requête canonique, incluant la source, sans secret.",
        "resolution": "Traitement réellement effectué pour résoudre ou accepter une anomalie.", "resolution_notes": "Justification humaine ou automatisée de la décision de rapprochement.",
        "response_state": "Résultat réel de la collecte : donnée disponible, réponse vide, indisponibilité, échec ou invalidité.",
        "role": "Fonction effectivement observée de l’entraîneur durant cet épisode.",
        "rule_code": "Règle de contrôle identifiée et versionnée qui a détecté le problème.",
        "sample_index": "Index du point dans l’ordre natif de la série de momentum.",
        "series_code": "Série de momentum concernée, conservée distinctement des autres séries.",
        "severity": "Gravité info, warning, error ou blocking de l’anomalie.",
        "snapshot_key": "Clé unique de l’instantané SQL ; sa composition devient immuable après scellement.",
        "source_label": "Libellé natif de la ligne de classement, conservé pour le contexte.",
        "source_priority_version": "Version de la politique de priorité/déduplication entre sources utilisée par cet instantané.",
        "source_url": "Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité.",
        "storage_bucket": "Bucket du média conservé ou ancienne localisation de source supprimée.",
        "storage_key": "Clé du média conservé ou ancienne localisation de source ; aucun contenu incorporé.",
        "storage_version": "Version exacte du stockage si réellement disponible ; une clé mutable n’est pas une version.",
        "iso2": "Code ISO à deux lettres uniquement lorsqu’il existe.", "iso3": "Code ISO à trois lettres uniquement lorsqu’il existe.",
        "federation_code": "Code de la fédération sportive, distinct d’un ISO.", "confederation_code": "Code de la confédération sportive.",
        "birth_date": "Date de naissance connue de la personne.", "height_cm": "Taille connue en centimètres.",
        "dominant_foot": "Pied dominant connu : left, right, both ou unknown.",
        "gender": "Catégorie sportive déclarée : men, women, mixed ou unknown.", "age_category": "Catégorie d’âge déclarée ; ne pas la déduire sans preuve.",
        "team_type": "Club, sélection nationale, équipe représentative ou type inconnu.", "competition_type": "Nature league, cup, tournament, supercup, friendly, other ou unknown.",
        "short_name": "Nom court observé.", "founded_year": "Année de fondation lorsqu’elle est sourcée.",
        "latitude": "Latitude géographique du stade, entre −90 et 90.", "longitude": "Longitude géographique du stade, entre −180 et 180.",
        "capacity": "Capacité du stade observée à capacity_as_of.", "capacity_as_of": "Date de validité connue de la capacité.",
        "opened_year": "Année d’ouverture connue ; une date imprécise ne devient pas une année inventée.", "city": "Ville du stade, si connue.",
        "start_date": "Première date métier connue de l’édition.", "end_date": "Dernière date métier connue de l’édition.",
        "valid_from": "Début de validité connu, sans remplacer une observation par une date de signature.", "valid_to": "Fin de validité connue ; NULL conserve une borne inconnue.",
        "observed_from": "Première observation de l’appartenance.", "observed_to": "Dernière observation de l’appartenance.",
        "date_precision": "Précision réelle des dates : day, month, year ou unknown.", "evidence_kind": "Nature de preuve : contrat, effectif, match, profil ou revue manuelle.",
        "membership_type": "Appartenance club, prêt, sélection, observation ou autre ; simultanéité club/sélection permise.",
        "stage_type": "Type de phase défini par les valeurs autorisées.", "stage_key": "Clé de phase unique dans son édition.", "group_key": "Clé de groupe unique dans sa phase.",
        "sequence_no": "Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire.",
        "outcome": "Résultat/distinction natif du grain de cette table.", "honour_type": "Titre collectif ou distinction individuelle.",
        "season_label": "Libellé historique conservé lorsqu’aucune édition canonique n’est résolue.",
        "points_adjustment": "Bonus ou sanction publiés ; valeur signée.", "goals_for": "Buts marqués dans ce périmètre.", "goals_against": "Buts encaissés dans ce périmètre.",
        "wins": "Victoires observées/calculées dans le périmètre de cette table.", "draws": "Matchs nuls dans ce périmètre.", "losses": "Défaites dans ce périmètre.",
        "appearances": "Participations prouvées, sans compter automatiquement tous les joueurs listés.", "starts": "Titularisations prouvées.",
        "matches_played": "Rencontres jouées éligibles dans cette édition.", "points_calculated": "Points issus des résultats ; ne remplace pas un classement officiel incluant sanctions.",
        "provider_rating_weighted": "Moyenne de la note fournisseur pondérée selon le contrat et sa couverture.",
        "xg_for": "xG produits connus dans le périmètre de l’équipe.", "xg_against": "xG concédés connus dans ce périmètre.",
        "manifest_sha256": "Empreinte du manifeste SQL scellé ; ne contient pas les fichiers supprimés.",
        "first_seen_at": "Première observation enregistrée de cet identifiant externe.", "neutral_venue": "Terrain neutre si explicitement connu.",
        "methodology_version": "Version identifiée de la méthode de classement.", "revision": "Révision explicite de cette édition.",
        "value": "Valeur fournie dans le grain et l’unité définis par la table.", "minimum": "Borne inférieure documentée de cette métrique.", "maximum": "Borne supérieure documentée de cette métrique.",
        "aggregation": "Règle sum, weighted_mean, ratio_of_sums, last ou none de cette métrique.", "unit": "Unité déclarée et versionnée de la métrique.",
        "allows_negative": "Autorisation explicite de valeurs signées pour cette métrique.",
        "raw_position_code": "Code natif du poste ; résolution uniquement avec une version de mapping validée.", "mapping_version": "Version de la traduction des valeurs fournisseur.",
        "raw_key": "Clé technique native de la métrique.", "family_code": "Famille de données dont le contrat définit cette clé.",
        "definition_notes": "Limites et définition particulières de la correspondance.",
        "version": "Version immuable du contrat, de la feature ou du modèle.", "code_commit": "Révision du code effectivement employée.",
        "product_key": "Produit ou publication de scores concerné.", "transform_version": "Version de la transformation de données.",
        "metrics_contract_version": "Version des définitions et règles d’agrégation appliquées.",
        "appearances_eligible": "Participations retenues selon les critères explicites du modèle.", "minutes_eligible": "Minutes admissibles selon les critères explicites du modèle.",
    }
    if name in meanings:
        return meanings[name]
    if value["type"] == "jsonb":
        return value.get("jsonb_exception", "Paramètre technique sous contrat explicite, sans contenu métier source.")
    return "Champ « " + name + " » du grain « " + table["grain"] + " » ; valeurs et contraintes reproduites ci-dessous, sémantique fournisseur à confirmer avant publication si non définie."


for table in tables.values():
    for name, value in table["columns"].items():
        value["description"] = describe(table, name, value)

def domain(t):
    name = t["qualified_name"]
    n = t["name"]
    if t.get("history_of"):
        return "historique"
    if t["phase"] == "models":
        return "13-modeles-reserves"
    if name.startswith("analytics."):
        return "12-lectures-publication"
    if name.startswith("ingest."):
        if n in ("sources", "source_datasets", "source_documents", "source_records", "document_lineage", "resource_fetches", "media_assets"):
            return "01-sources-medias"
        if n in ("relation_contracts", "row_versions", "dataset_snapshots", "dataset_snapshot_documents", "dataset_snapshot_rows", "field_contracts", "field_states", "record_row_links"):
            return "02-historique-instantanes"
        if n in ("import_runs", "collection_jobs", "asset_jobs", "dirty_editions", "match_coverage", "schema_migrations"):
            return "03-ingestion-reprise"
        return "04-qualite-identites-nettoyage"
    if n in ("countries", "associations", "competitions", "competition_seasons", "competition_stages", "competition_groups", "competition_teams", "venues"):
        return "05-competitions-referentiels"
    if n in ("players", "player_profile_versions", "teams", "team_profile_versions", "association_profile_versions", "positions", "position_mappings", "player_team_memberships", "team_aliases") or n.endswith("_source_ids"):
        return "06-identites-profils"
    if n in ("matches", "match_teams", "match_scores", "match_lineups", "match_players", "match_events", "match_h2h_entries", "match_observation_details"):
        return "07-matchs-participations"
    if n in ("periods", "metric_definitions", "source_metric_mappings", "player_match_stats", "team_match_stats", "player_match_advanced", "team_match_advanced", "player_match_metric_values", "team_match_metric_values"):
        return "08-statistiques-periodes"
    if n in ("shots", "match_momentum", "pass_networks", "pass_network_nodes", "pass_network_edges", "match_heatmaps", "match_heatmap_cells"):
        return "09-tirs-spatial"
    if "ranking" in n or "standing" in n:
        return "10-classements"
    return "11-entraineurs-palmares"


groups = collections.defaultdict(list)
history = []
for name, t in tables.items():
    if domain(t) == "historique":
        history.append(name)
    else:
        groups[domain(t)].append(name)
for i in range(0, len(history), 6):
    groups[f"{14+i//6:02d}-historiques-{i//6+1:02d}"] = history[i:i+6]
titles = {
    "01-sources-medias": "Sources et médias", "02-historique-instantanes": "Historique et instantanés SQL", "03-ingestion-reprise": "Ingestion et reprise",
    "04-qualite-identites-nettoyage": "Qualité, alias et nettoyage", "05-competitions-referentiels": "Compétitions et référentiels", "06-identites-profils": "Identités et profils",
    "07-matchs-participations": "Matchs et participations", "08-statistiques-periodes": "Statistiques et périodes", "09-tirs-spatial": "Tirs et analyses spatiales",
    "10-classements": "Classements", "11-entraineurs-palmares": "Entraîneurs et palmarès", "12-lectures-publication": "Lectures et publication", "13-modeles-reserves": "Modèles : réserve hors nouvelles formules",
}
for key in groups:
    titles.setdefault(key, "Historiques SQL typés " + key.rsplit("-", 1)[-1])

mapping = []
def target_for(schema, name):
    if schema == "neon_auth":
        return ["authentification existante — contrôle d’usage préalable"], "conserver provisoirement", "Aucune suppression déduite du nom du schéma ou de statistiques estimées."
    if schema == "statarena":
        known = {
            "objects": ["ingest.source_documents", "ingest.media_assets"], "file_documents": ["ingest.source_records", "ingest.record_row_links", "football.* selon famille"],
            "current_file_documents": ["football.* et historiques typés"], "file_document_sources": ["ingest.document_reconciliations"],
            "file_payloads": ["ingest.source_documents", "ingest.cleanup_items"], "file_payload_chunks": ["ingest.cleanup_items"],
            "fixtures": ["football.matches", "football.match_teams", "football.match_scores", "football.match_source_ids"],
            "resources": ["ingest.resource_fetches", "ingest.match_coverage"], "shards": ["ingest.source_documents", "ingest.source_records"],
            "observations": ["ingest.source_records", "ingest.record_row_links"], "projections": ["football.standing_snapshots", "football.ranking_snapshots", "football.venues", "football.coaches", "football.player_honours"],
            "jobs": ["ingest.collection_jobs"], "asset_jobs": ["ingest.asset_jobs"], "assets": ["ingest.media_assets"],
            "dirty_partitions": ["ingest.dirty_editions"], "ingest_failures": ["ingest.resource_fetches", "ingest.quality_issues"],
            "state": ["ingest.import_runs", "analytics.publication_versions"], "archive_audits": ["ingest.document_reconciliations"],
        }
        if name.startswith("neon_"):
            return ["ingest.record_row_links", "ingest.document_reconciliations", "football.* selon contenu"], "réconcilier puis retirer", "Tables de delta du transfert : ne pas consommer/supprimer en concurrence avec son propriétaire."
        return known.get(name, ["REVUE EXPLICITE REQUISE"]), "fusionner/remplacer puis retirer", "Corps source supprimés seulement après correspondance exhaustive ; métadonnées utiles conservées sans payload."
    core = {
        "players": ["football.players", "football.player_profile_versions", "football.player_source_ids"], "teams": ["football.teams", "football.team_profile_versions", "football.team_source_ids"],
        "matches": ["football.matches", "football.match_teams", "football.match_scores"], "fixtures": ["football.matches", "football.match_teams", "football.match_scores"],
        "competitions": ["football.competitions", "football.competition_source_ids"], "competition_seasons": ["football.competition_seasons"], "competition_catalog_seasons": ["football.competition_seasons"],
        "team_seasons": ["football.competition_teams"], "appearances": ["football.match_players", "football.player_match_stats"], "appearance_shirt_numbers": ["football.match_players", "ingest.field_states"],
        "appearance_metrics": ["football.player_match_metric_values"], "shots": ["football.shots"], "team_statistics": ["football.team_match_stats", "football.team_match_metric_values"],
        "assets": ["ingest.media_assets"], "metric_definitions": ["football.metric_definitions", "football.source_metric_mappings"],
    }
    if name in core:
        return core[name], "normaliser puis remplacer", "Préserver types natifs, état des champs, identité et compatibilité publique ; jamais compter toutes les performances comme apparitions."
    if name.startswith("compact_"):
        return ["football.player_match_stats", "football.player_match_metric_values", "ingest.field_states"], "décompacter en faits puis retirer", "Conserver toutes les métriques, périodes et exceptions ; réutiliser seulement le format compact de transport utile au frontend."
    if name in ("match_families", "match_coverage", "match_warnings", "match_details", "match_detail_versions"):
        return ["ingest.match_coverage", "ingest.source_records", "ingest.row_versions", "ingest.quality_issues"], "remplacer", "Statut de collecte, disponibilité, fraîcheur et validité restent indépendants."
    if name.startswith(("partition_", "partitions", "publications", "publication_jobs", "worker_", "workflow_")):
        return ["ingest.import_runs", "ingest.dirty_editions", "ingest.document_reconciliations", "analytics.aggregation_builds", "analytics.publication_versions"], "réutiliser les mécanismes puis remplacer", "Conserver baux, idempotence, capacité, checkpoints et preuves ; supprimer les marqueurs running périmés par une transition contrôlée."
    if name.startswith("cat_") or name == "catalog_editions":
        if "profile" in name:
            return ["football.players", "football.player_profile_versions", "football.teams", "football.team_profile_versions", "football.competitions", "football.competition_seasons"], "normaliser", "ID stable distinct du profil ; pays/poste natifs et accès source conservés sous contrat."
        if "ranking" in name:
            return ["football.ranking_systems", "football.ranking_snapshots", "football.team_ranking_entries", "football.association_ranking_entries", "football.team_ranking_components", "football.association_ranking_components"], "normaliser", "Toutes les dates, contributions et variantes restent dans SQL ; aucun remplacement par la dernière édition seule."
        if "club_links" in name:
            return ["football.team_source_ids", "football.team_aliases", "ingest.identity_candidates"], "réconcilier", "Rapprochements ambigus explicites ; aucune fusion par similitude de nom."
        return ["football.matches", "football.match_teams", "football.match_scores", "football.match_events", "football.match_observation_details", "ingest.source_datasets", "ingest.quality_issues"], "normaliser", "Éditions civiles et historiques, résultats, buts, notes, différences de score et provenance : chaque champ utile doit avoir une destination typée avant purge."
    if name.startswith("support_"):
        if "standing" in name: targets = ["football.standing_snapshots", "football.standing_rows"]
        elif "coach" in name: targets = ["football.coaches", "football.coach_source_ids", "ingest.media_assets"]
        elif "stadium" in name: targets = ["football.venues", "football.venue_source_ids", "ingest.media_assets"]
        elif "honour" in name: targets = ["football.honour_definitions", "football.player_honours", "football.team_honours"]
        elif "club" in name: targets = ["football.teams", "football.team_source_ids", "football.team_aliases", "ingest.media_assets"]
        else: targets = ["football.matches", "football.match_scores", "football.match_observation_details", "ingest.source_records"]
        return targets, "normaliser puis remplacer", "Conserver dates observées, libellés non résolus, médias/licences, ordre et sources complémentaires."
    if "heatmap" in name: targets = ["football.match_heatmaps", "football.match_heatmap_cells"]
    elif "network" in name or name == "pass_edges" or name == "pass_nodes": targets = ["football.pass_networks", "football.pass_network_nodes", "football.pass_network_edges"]
    elif "momentum" in name: targets = ["football.match_momentum"]
    elif "h2h" in name: targets = ["football.match_h2h_entries", "football.matches"]
    elif "shot" in name: targets = ["football.shots", "football.player_profile_versions"]
    elif "lineup" in name: targets = ["football.match_lineups", "football.match_players", "football.coaches"]
    elif "event" in name: targets = ["football.match_events"]
    elif "advanced_player" in name: targets = ["football.player_match_advanced", "football.player_match_metric_values"]
    elif "advanced_team" in name: targets = ["football.team_match_advanced", "football.team_match_metric_values"]
    elif "team_stat" in name: targets = ["football.team_match_stats", "football.team_match_metric_values"]
    elif "player" in name or name.startswith("half_"): targets = ["football.match_players", "football.player_match_stats", "football.player_match_metric_values"]
    elif "match_summar" in name: targets = ["football.matches", "football.match_teams", "football.match_scores", "analytics.match_summary"]
    elif name == "match_appearance_members": targets = ["football.match_players", "ingest.field_states"]
    else: return ["REVUE EXPLICITE REQUISE"], "non résolu", "La purge reste interdite tant que cette structure n’est pas cartographiée."
    return targets, "fusionner en faits métier", "Métadonnées resource_id/record_no/parent_no/position → provenance et ordinal ; missing/null_groups → field_states ; valeurs → colonnes et relations typées."


for database, data in dbs.items():
    for relation in data["relations"]:
        targets, action, reason = target_for(relation["schema"], relation["name"])
        mapping.append(dict(database=database, current=relation["schema"] + "." + relation["name"], kind=relation["kind"], targets=targets, action=action, reason=reason))

# Render complete table diagrams: every local column, all outgoing FK, external key stubs.
diagram_dir = OUT / "diagrams"
diagram_dir.mkdir(exist_ok=True)
def q(s): return json.dumps(str(s), ensure_ascii=False)
def esc(s): return html.escape(str(s), quote=True)
def dot_label(table, stub=False, referenced=None):
    pk = set(table["primary_key"]["columns"])
    fks = {c for f in table["foreign_keys"] for c in f["columns"]}
    header = "#f2f4f7" if stub else "#e4edf9" if table["qualified_name"].startswith("ingest.") else "#e6f1e9" if table["qualified_name"].startswith("football.") else "#f6eddc"
    lines = [f'<TABLE BORDER="1" COLOR="#c0c6cf" CELLBORDER="0" CELLSPACING="0" CELLPADDING="6"><TR><TD COLSPAN="3" BGCOLOR="{header}" ALIGN="LEFT"><B>{esc(table["qualified_name"])}</B>{" — référence" if stub else ""}</TD></TR>']
    for name, value in table["columns"].items():
        if stub and name not in referenced:
            continue
        badges = "/".join(x for x, yes in (("PK", name in pk), ("FK", name in fks)) if yes)
        lines.append(f'<TR><TD PORT="{esc(name)}" ALIGN="LEFT">{esc(name)}</TD><TD ALIGN="LEFT">{esc(value["type"])}{"" if value["nullable"] else " !"}</TD><TD ALIGN="LEFT">{badges}</TD></TR>')
    return "<" + "".join(lines) + "</TABLE>>"


graph_data = []
for key, names in sorted(groups.items()):
    names = sorted(names)
    externals = collections.defaultdict(set)
    outgoing = []
    for name in names:
        for f in tables[name]["foreign_keys"]:
            outgoing.append((name, f))
            if f["references"]["table"] not in names:
                externals[f["references"]["table"]].update(f["references"]["columns"])
    dot = ['digraph schema {', 'graph [rankdir=LR,bgcolor="white",pad="0.3",nodesep="0.35",ranksep="1.2",splines=polyline];', 'node [shape=plain,fontname="Helvetica",fontsize=12];', 'edge [color="#929caa",arrowsize=0.6,fontname="Helvetica",fontsize=9];']
    for name in names:
        dot.append(q(name) + " [label=" + dot_label(tables[name]) + ',URL=' + q("../index.html#table=" + name) + ',target="_top"];')
    for name, columns in externals.items():
        dot.append(q(name) + " [label=" + dot_label(tables[name], True, columns) + ',URL=' + q("../index.html#table=" + name) + ',target="_top"];')
    for name, f in outgoing:
        dot.append(q(name) + ":" + q(f["columns"][0]) + " -> " + q(f["references"]["table"]) + ":" + q(f["references"]["columns"][0]) + " [tooltip=" + q(", ".join(f["columns"]) + " → " + f["references"]["table"] + "(" + ", ".join(f["references"]["columns"]) + ")") + "];")
    dot.append("}")
    (diagram_dir / (key + ".dot")).write_text("\n".join(dot) + "\n")
    graph_data.append(dict(id=key, title=titles[key], tables=names, columns=sum(len(tables[n]["columns"]) for n in names), outgoing_fks=len(outgoing), file="diagrams/" + key + ".svg"))

overview = '''digraph architecture {
 graph [rankdir=LR,bgcolor="white",pad="0.4",nodesep="0.5",ranksep="0.8"];
 node [shape=box,style="rounded,filled",fillcolor="#edf2f7",color="#bcc7d2",fontname="Helvetica",fontsize=14,margin="0.2,0.15"];
 edge [fontname="Helvetica",fontsize=11,color="#738397"];
 Browser [label="Navigateur\nDesktop / mobile"];
 Vercel [label="Vercel\nFrontend Next.js\naucun accès SQL navigateur",fillcolor="#e4edf9"];
 API_CDN [label="CloudFront API\nGET / HEAD / OPTIONS\ncache par route et version"];
 Lambda [label="Backend AWS Lambda\nNode 24 • pool PostgreSQL borné\nSQL métier uniquement",fillcolor="#e6f1e9"];
 RDS [label="RDS existant • statarena_prod\nPostgreSQL 18.6 • Ohio\ningest / football / analytics",fillcolor="#e6f1e9"];
 Media_CDN [label="CloudFront médias\nURLs immuables"];
 S3 [label="S3 privé\nMédias indispensables\naucune source structurée après purge",fillcolor="#f6eddc"];
 Jobs [label="GitHub Actions • données\nRéponse en mémoire → SQL typé\nbaux / checkpoints / contrôles"];
 MediaJobs [label="Collecte médias séparée\nFichiers images uniquement"];
 MediaUrls [label="URLs des médias référencés\nvisages • écussons • trophées"];
 Provider [label="PitchAPI et autres sources\ningestion uniquement"];
 Browser -> Vercel [label="HTML / JS / CSS"];
 Browser -> API_CDN [label="requêtes métier HTTPS"];
 API_CDN -> Lambda [label="MISS / revalidation\norigine signée OAC"];
 Lambda -> RDS [label="TLS • SG runtime\nSELECT autorisés"];
 Browser -> Media_CDN [label="visages / écussons / trophées"];
 Media_CDN -> S3 [label="OAC • aucun bucket public"];
 Provider -> Jobs [label="collecte planifiée / manuelle"];
 Jobs -> RDS [label="écritures contrôlées"];
 MediaUrls -> MediaJobs [label="téléchargement binaire"];
 MediaJobs -> S3 [label="images uniquement"];
 MediaJobs -> RDS [label="références / hashes / licences"];
}'''
(diagram_dir / "architecture-cible.dot").write_text(overview)
current = r'''digraph current_architecture {
 graph [rankdir=LR,bgcolor="white",pad="0.4",nodesep="0.5",ranksep="0.8"];
 node [shape=box,style="rounded,filled",fillcolor="#edf2f7",color="#bcc7d2",fontname="Helvetica",fontsize=14,margin="0.2,0.15"];
 edge [fontname="Helvetica",fontsize=11,color="#738397"];
 Browser [label="Navigateur\nDesktop / mobile"];
 Vercel [label="Vercel • frontend et API actuelle\nProduction encore sur Neon",fillcolor="#e4edf9"];
 Neon [label="Neon existant\nPostgreSQL + objets sources",fillcolor="#f6eddc"];
 API [label="CloudFront API AWS\nOrigine Lambda signée OAC"];
 Lambda [label="Lambda Node 24 • 512 Mio\nLectures SQL et projections partielles",fillcolor="#e6f1e9"];
 RDS [label="Une instance RDS PostgreSQL 18.6\nstatarena_prod : statarena + statarena_app\nstatarena : ancien import distinct",fillcolor="#e6f1e9"];
 Assets [label="CloudFront fichiers / médias\nImages et certains JSON immuables"];
 S3 [label="S3 privé • 4,89 Go\nJSON / CSV / SQLite / archives\net médias",fillcolor="#f6eddc"];
 Jobs [label="Pipeline AWS existant • en pause\nFichiers + index documentaire\nConstruction SQL partielle"];
 Pitch [label="PitchAPI et autres sources"];
 Transfer [label="Transfert initial Neon → AWS\nPropriété de l’autre Codex\nNon relancé par ce plan"];
 Browser -> Vercel [label="domaine public canonique"];
 Vercel -> Neon [label="lectures production"];
 Browser -> API [label="preview AWS historique",style=dashed];
 API -> Lambda [label="MISS / revalidation"];
 Lambda -> RDS [label="statarena_prod • TLS"];
 Browser -> Assets [label="fichiers référencés"];
 Assets -> S3 [label="OAC • chemin autorisé"];
 Pitch -> Jobs [label="collectes désactivées",style=dashed];
 Jobs -> S3 [label="ancien stockage de données",style=dashed];
 Jobs -> RDS [label="index / faits / agrégats partiels",style=dashed];
 Neon -> Transfer [label="périmètre existant",style=dashed];
 Transfer -> RDS [label="import déjà engagé",style=dashed];
 Transfer -> S3 [label="copies existantes",style=dashed];
}'''
(diagram_dir / "architecture-actuelle.dot").write_text(current)
core_names = ["football.competitions", "football.competition_seasons", "football.matches", "football.teams", "football.match_teams", "football.players", "football.match_players", "football.player_match_stats", "football.shots", "ingest.row_versions", "ingest.dataset_snapshot_rows", "analytics.aggregation_builds", "analytics.publication_versions"]
core_dot = ['digraph core {graph [rankdir=LR,bgcolor="white",pad="0.4",nodesep="0.5",ranksep="0.8"]; node [shape=box,style="rounded,filled",fillcolor="#e6f1e9",color="#bcc7d2",fontname="Helvetica",fontsize=14,margin="0.18,0.12"]; edge [color="#738397",fontname="Helvetica",fontsize=10];']
for name in core_names:
    core_dot.append(q(name) + " [label=" + q(name + "\n" + tables[name]["grain"]) + ',URL=' + q("../index.html#table=" + name) + ',target="_top"];')
for a,b,label in [("football.competitions","football.competition_seasons","éditions"),("football.competition_seasons","football.matches","rencontres"),("football.matches","football.match_teams","deux places"),("football.teams","football.match_teams","équipe"),("football.match_teams","football.match_players","feuille"),("football.players","football.match_players","identité"),("football.match_players","football.player_match_stats","périodes"),("football.match_teams","football.shots","tirs"),("ingest.row_versions","ingest.dataset_snapshot_rows","versions typées"),("ingest.dataset_snapshot_rows","analytics.aggregation_builds","instantané scellé"),("analytics.aggregation_builds","analytics.publication_versions","activation")]:
    core_dot.append(q(a) + " -> " + q(b) + " [label=" + q(label) + "];")
core_dot.append("}")
(diagram_dir / "schema-overview.dot").write_text("\n".join(core_dot))

# Full standalone dictionary and a compact, self-contained browser data model.
dictionary = ["# Dictionnaire de la proposition StatArena / Orion", "", "**Proposition non déployée.** Toutes les tables, colonnes, types, clés et contraintes de la version proposée sont décrits ci-dessous. `!` signifie NOT NULL ; une PK composée porte sur l’ensemble indiqué. Les règles intertables restent à implémenter après approbation.", ""]
viewer_tables = []
fallbacks = []
for key, names in sorted(groups.items()):
    dictionary += ["## " + titles[key], ""]
    for name in sorted(names):
        t = tables[name]
        dictionary += ["### " + name, "", t["description"], "", "Grain : " + t["grain"], "", "Écriture : `" + t["write_mode"] + "` ; phase : `" + t["phase"] + "`.", "", "| Colonne | Type | NULL | Clés | Signification |", "|---|---|---|---|---|"]
        pk = set(t["primary_key"]["columns"])
        foreign = {c for f in t["foreign_keys"] for c in f["columns"]}
        columns = []
        for cname, c in t["columns"].items():
            keys = "/".join(k for k, yes in (("PK", cname in pk), ("FK", cname in foreign)) if yes)
            dictionary.append("| `" + cname + "` | `" + c["type"] + "` | " + ("oui" if c["nullable"] else "non") + " | " + keys + " | " + c["description"].replace("|", "\\|").replace("\n", " ") + " |")
            columns.append(dict(name=cname, **c, keys=keys))
            if "sémantique fournisseur à confirmer" in c["description"]:
                fallbacks.append(dict(table=name, column=cname, type=c["type"]))
        dictionary += ["", "PK : `" + ", ".join(t["primary_key"]["columns"]) + "`.", ""]
        for label, entries in (("UNIQUE", t["unique_constraints"]), ("FK", t["foreign_keys"]), ("CHECK", t["checks"]), ("INDEX", t["indexes"])):
            for e in entries:
                if label == "CHECK": text = e["sql"]
                elif label == "FK": text = ", ".join(e["columns"]) + " → " + e["references"]["table"] + "(" + ", ".join(e["references"]["columns"]) + ") ; ON DELETE " + e["on_delete"]
                elif label == "UNIQUE": text = ", ".join(e["columns"]) + (" ; NULLS NOT DISTINCT" if e.get("nulls_not_distinct") else "")
                else: text = e["method"] + " : " + json.dumps(e["keys"], ensure_ascii=False) + (" WHERE " + e["where_sql"] if e.get("where_sql") else "")
                dictionary.append("- " + label + " `" + text + "`.")
        dictionary += ["", *["- " + note for note in t.get("notes", [])], ""]
        viewer_tables.append(dict(name=name, domain=key, description=t["description"], grain=t["grain"], phase=t["phase"], write_mode=t["write_mode"], origin="historique" if t.get("history_of") else "socle JSON" if name in baseline_names else "ajout", columns=columns, primary_key=t["primary_key"], foreign_keys=t["foreign_keys"], checks=t["checks"], unique_constraints=t["unique_constraints"], indexes=t["indexes"], notes=t.get("notes", [])))
(OUT / "DICTIONNAIRE.md").write_text("\n".join(dictionary).rstrip() + "\n")
with (OUT / "current-to-target.csv").open("w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["database", "current", "kind", "targets", "action", "reason"], lineterminator="\n")
    writer.writeheader()
    writer.writerows([r | {"targets": "; ".join(r["targets"])} for r in mapping])
missing = [r for r in mapping if "REVUE EXPLICITE REQUISE" in r["targets"]]
catalog = {"planning": model["planning"], "tables": viewer_tables, "domains": graph_data, "jsonb_exceptions": model["planning"]["jsonb_exceptions"], "changes": json.loads((OUT / "changes.json").read_text()), "current_to_target": mapping, "cross_row_rules": model["required_cross_row_rules"]}
(OUT / "viewer-data.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n")
(OUT / "evidence/dictionary-review.json").write_text(json.dumps({"fallback_definitions_requiring_review": fallbacks, "unmapped_current_relations": missing}, ensure_ascii=False, indent=2) + "\n")
(OUT / "diagrams/index.json").write_text(json.dumps(graph_data, ensure_ascii=False, indent=2) + "\n")
(OUT / "target-schema.proposed.json").write_text(json.dumps(model, indent=2, ensure_ascii=False) + "\n")

# Complete structural delta, including keys, metadata and business rules.
delta=[]
def diff(a,b,path=""):
    if type(a) is not type(b):
        delta.append({"path":path,"before":a,"after":b});return
    if isinstance(a,dict):
        for key in sorted(a.keys()|b.keys()):
            p=path+"/"+key.replace("~","~0").replace("/","~1")
            if key not in a:delta.append({"path":p,"operation":"add","after":b[key]})
            elif key not in b:delta.append({"path":p,"operation":"remove","before":a[key]})
            else:diff(a[key],b[key],p)
    elif isinstance(a,list):
        for i in range(max(len(a),len(b))):
            p=path+"/"+str(i)
            if i>=len(a):delta.append({"path":p,"operation":"add","after":b[i]})
            elif i>=len(b):delta.append({"path":p,"operation":"remove","before":a[i]})
            else:diff(a[i],b[i],p)
    elif a!=b:delta.append({"path":path,"operation":"change","before":a,"after":b})
diff(baseline,model)
(OUT / "blueprint-diff.json").write_text(json.dumps(delta,indent=2,ensure_ascii=False)+"\n")
print(json.dumps({"tables": len(tables), "columns": sum(len(t["columns"]) for t in tables.values()), "domains": len(groups), "current_relations": len(mapping), "unmapped_relations": [r["current"] for r in missing], "dictionary_definitions_needing_review": len(fallbacks)}, ensure_ascii=False))
