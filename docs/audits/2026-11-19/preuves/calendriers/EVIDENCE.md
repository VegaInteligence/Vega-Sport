# Lot « calendriers » — instruction en lecture seule (E04a, E04b, E04c, E04d, E04e, E04j)

- Code lu : worktree `/home/romai/Agents/worktrees/vega-audit-reprise-20261119`, `main` = `2088d36e60` (aucune modification).
- Branche lue sans écrire : `claude/week-internationals` (`61121c8fb5`, base de fusion `840414438c`), worktree `/home/romai/Agents/worktrees/vega-week-internationals-20261119`.
- Production : GET anonymes sur `https://dngp6kh9jx2bl.cloudfront.net`, le 19 nov. 2026 entre 13 h 19 et 14 h 05 UTC, au plus une par seconde. Horodatage et empreinte de chaque réponse dans `MANIFEST-api.txt` ; réponses brutes dans `api/`.
- Sources externes téléchargées (données non fiables, jamais exécutées) : `telechargements/`, inventaire et SHA-256 dans `MANIFEST-telechargements.txt`.
  - Open Matchday (`oladeeayo/open-matchday`) : `build_summary.json` et fichiers du commit `bb689ea53d` (19 nov. 06 h 46 UTC) ; 117 versions de fichiers (8 dossiers) prises dans l'historique Git (`telechargements/om/hist/`, via l'API GitHub `commits?path=` puis `raw.githubusercontent.com/<sha>/…`).
  - International Results (`martj42/international_results`, CC0) : `results.csv` (SHA-256 `57ef26c3…`, dernière ligne 2026-11-17, commit `86536ee39e` du 18 nov. 15 h 00 UTC), `shootouts.csv`, `goalscorers.csv`.
  - OpenFootball : arbres Git de `football.json@e6744429` (épinglé), `footballcsv/europe-champions-league@66393c8d` (épinglé), `champions-league`, `england`, `deutschland`, `espana`, `italy`, `austria`, `europe` (master) ; fichiers `clq/elq/confq` 2024-25 et 2025-26, `conf.txt`, coupes nationales 2021-22 à 2025-26, `es.1`/`fr.1` 2023-24 à 2025-26 à la révision épinglée.
  - Aucun accès à ESPN, à football-data.co.uk, à une API d'organisateur, à AWS, à Linear.
- Capsules d'audit réutilisées (extraites, non modifiées) : `prior/ang575/` (`angleterre-575.zip`), `prior/q2489/` (`qualifications-2489.zip`).

## Rejeu

```bash
export PATH=/home/romai/Agents/scratch/passation-audit-20261119/venv/bin:$PATH
E=/home/romai/Agents/scratch/passation-audit-20261119/evidence/calendriers
python -I $E/scripts/e04a_angleterre.py $E          # 575 officiels contre API et fichier source du jour
python -I $E/scripts/e04a_historique_git.py $E      # les 236 absents dans l'historique Git d'Open Matchday
python -I $E/scripts/e04c_openfootball_quali.py $E  # 2 489 qualifications UEFA contre openfootball/champions-league
python -I $E/scripts/e04d_international_results.py $E
python -I $E/scripts/e04d_europe_701.py $E
python -I $E/scripts/e04d_branch_scope.py $E        # rejeu du filtre parseInternationalResults de la branche
python -I $E/scripts/show.py $E/api/<réponse /api/fixtures>.json
```
Les scripts ne lisent que `api/`, `telechargements/` et `prior/`. Les réponses HTTP se rejouent avec les URL de `MANIFEST-api.txt` (même ordre de grandeur ; une nouvelle lecture peut différer si la source a bougé).

Limite de méthode : `/api/fixtures` ne sert que les éditions natives (`api.fixtures` exclut `cup_key` et `archive_key`, `backend/sql/144_edition_artwork_reads.sql:41`). Les recherches d'absence par cette route valent pour les éditions natives ; chaque recherche a un témoin positif (fichiers `ctrl-*.json`). Les éditions Open Matchday sont lues par `/api/cup-table`, les tournois par `/api/cups/edition` et `/api/nations/<id>`.

## E04a — ligues domestiques

### Trois ligues anglaises (gardées)

| Mesure | Attendu (18 nov.) | Obtenu (19 nov.) |
|---|---:|---:|
| Résultats officiels terminés (capsule) | 575 | 575 |
| Exacts en production (`/api/cup-table`) | 338 | **338** |
| Absents en production | 236 | **236** (201 jamais vus + 35 retirés) |
| Score divergent (8625 Ashton–Warrington Town) | 1 | **1** (API et source : 1–2 ; officiel 0–1) |
| Lignes de résultats servies | 339 | 339 (116/112/111) = fichier source du jour |
| Les 236 dans le fichier source du jour | — | **0** |
| Les 236 dans au moins une version publiée de l'historique Git (47 versions depuis le 6 oct.) | — | **236, toutes au score officiel exact** |

Fichiers : `e04a-angleterre-aujourdhui.json`, `e04a-angleterre-575-aujourdhui.csv`, `e04a-angleterre-historique-git.json`, `e04a-angleterre-236-historique-git.csv`.

Mécanisme (lecture du code) : l'export Open Matchday est une fenêtre glissante (première date 05/09, 08/09, 12/09 aujourd'hui) ; `read_files` refuse tout fichier qui n'a pas exactement les lignes déclarées ; `snapshot.guard` refuse depuis `1b28961a88` toute photo qui perd un résultat stocké ; `open_matchday_history.rolling_prefix` (depuis `65c31737ec`) conserve un résultat déjà stocké qui sort par la gauche, seulement pour les trois dossiers attestés. Aucune de ces gardes ne crée un match absent : `retained()` saute une clé attestée sans lien (« The manifest never creates one »). Les 35 retirés ont un outil de restauration (`backend/vega/open_matchday_restore.py`, passage explicite) non exécuté en production : ils sont toujours absents. Ni `drop_copy` (dossiers `COVERED` seulement), ni une fenêtre de saison (toutes les dates sont dans 2026/27) n'expliquent les absences.

### Autres témoins

| Témoin | Périmètre (`scope.py`) | Aujourd'hui | Source capable |
|---|---|---|---|
| Kazakhstan, 133 | **retiré** (`REMOVED_FOLDERS["KAZ_1_premier-league"]`) | absent du catalogue `/api/cup-index` | sans objet |
| Pologne I Liga, 20 | gardé (`POL_2_division-1`) | API 106 = source 106, journées 1–2 et 2 matchs de la 3 absents | historique Git d'Open Matchday : **20** résultats publiés puis sortis (19 versions) |
| Pologne II Liga, 36 | gardé (`POL_3_division-2`) | API 105 = source 105, journées 1–4 absentes | historique Git : **37** lignes sorties (36 + probablement une clé déplacée, non vérifié) |
| Cymru Premier, 22 | gardé (`WAL_1_cymru-premier`) | API 105 = source 105 | historique Git : **22** |
| Cymru North, 2 | **retiré** (`WAL_2_cymru-north`) | — | sans objet |
| Bochum–Hertha 0–1, 07/08 | gardé (2. Bundesliga native `l_3hvsne`) | absent (`bochum-hertha.json` ; témoin `hertha-aug.json`) | **présent** dans le fichier Open Matchday du jour `GER_2_2-bundesliga` ; non lu car dossier `COVERED` tenu par PitchAPI |
| Obolon–Kryvbas 1–0, 10/10 | gardé (`UKR_1_premier-league`) | toujours servi « résultat » 1–0 (`ukr-results.json`) ; la source le liste toujours en résultat | aucune source lue ne le corrige ; `snapshot.RETRACTIONS` ne joue que si la source le retire |
| Six barrages L1/L2 2024–2026 | gardé (Ligue 1 native) | absents (`fr-barrage-*.json`, témoin `ctrl-metz-20240519.json`) | aucune : absents d'OpenFootball `fr.1` (épinglé), Open Matchday ne publie que 2026/27 |
| Majorque–Gérone 1–0, 03/03/2024 | gardé (Liga native) | absent (`mallorca-girona*.json`, témoin `ctrl-girona-202403.json`) | **présent** dans `football.json@e6744429/2023-24/es.1.json` (révision épinglée), hors de la plage lue (`build_openfootball_history.py` : 2010–2020) |
| Francs Borains–Liège U21 | gardé (`BEL_U21_pro-league`) | **ne se reproduit plus** : API et source au 30/11 | — |

Tous les dossiers Open Matchday servis ont aujourd'hui exactement les comptes de la source (`e04ab-open-matchday-api-vs-source.txt`) ; aucun fichier n'a perdu de ligne entre la version du 18 nov. et celle du 19 nov. (contrôle dans `telechargements/om/hist/`).

## E04b — coupes domestiques (couverture)

- FA Cup 2026/27 : 142 résultats en production = source. L'historique Git publie **80** résultats de tours qualificatifs (18–20 sept.) sortis depuis, absents de la production (`e04ab-open-matchday-historique-autres.json`, `fa-cup-results.json`). Rien avant le 18 sept. dans aucune version (tours préliminaires et premiers tours qualificatifs : aucune source lue).
- FA Cup 2024/25 : archive OpenFootball, phase principale seulement (123 matchs dans `facup.txt`).
- OpenFootball, dépôts déjà lus, saisons non lues (`e04b-openfootball-coupes-matchs.txt`, « # Matches » des fichiers) : FA Cup 2021-22/22-23/23-24 = 136/144/149 ; EFL Cup 93/93/93 ; Copa del Rey 127/126/126 ; DFB-Pokal 63/63/63 ; Coppa Italia 45/45/45 ; ÖFB-Cup 63/63/63 et 56 (2025-26, partiel) ; Coupe de Suisse 2023-24 63. Aucun fichier 2025-26 pour l'Angleterre, l'Espagne, l'Italie, la France, les Pays-Bas, le Portugal. Aucune phase qualificative de la FA Cup dans OpenFootball.
- Aucune coupe nationale n'existe en édition native (journées complètes du 17/05/2025 et du 26/04/2025 : ligues seulement).

## E04c — coupes européennes

- Dépôts épinglés : `football.json@e6744429` a `uefa.cl.json` de 2011-12 à 2019-20 (lu de 2010 à 2020) ; `footballcsv/europe-champions-league@66393c8d` s'arrête en 2015-16 (`champs.csv`). Ni l'un ni l'autre ne couvre 2021/22–2026/27 : **0 des 2 489**.
- Open Matchday UEFA 2026/27 : phase de ligue seulement (premières dates 08/09, 16/09, 15/10), dossiers `COVERED` non lus : 0.
- `uefa.py` : coefficients seulement.
- `openfootball/champions-league` (même éditeur, CC0, **non lu par Vega**) : fichiers `clq/elq/confq` pour 2024-25 et 2025-26 seulement ; **854 des 854** qualifications officielles de ces deux saisons, même date (±1 j), mêmes équipes, même score final (`e04c-openfootball-qualifs.json`, détail `…-detail.csv`). Champs : date, heure locale, équipes avec code pays, tour, score final, mi-temps (792/854), prolongation (81), tirs au but (37). Pas d'identifiant de match, pas de statistiques, pas de compositions. Aucun fichier pour 2021-22 à 2023-24 (1 207 matchs) ni pour 2026-27 (428 ; dernier commit 2 juill. 2026). Les trois rencontres du Partizan (2021-22, 2022-23) figurent dans ses `conf.txt` et sont absentes de la production (`partizan-*.json`, témoin `ctrl-partizan-202110.json`).
- Identités (capsule, RDS du 18 nov.) : sur 2 489, 1 481 ont deux clubs connus de Vega, 790 un seul, 218 aucun ; sur les 854 : 518 / 268 / 68 (`e04c-identites-clubs.txt`).

## E04d — sélections

- Fraîcheur : commit du 18 nov. 15 h 00 UTC (précédent 31 oct.), 50 119 lignes, dernière date 17/11. Le constat « aucune mise à jour entre le 31 oct. et le 18 nov. » n'est plus vrai.
- Colonnes : `results.csv` = date, équipes, score final, tournoi, ville, pays, neutre (pas de mi-temps, pas de prolongation, pas d'identifiant) ; `shootouts.csv` (700 lignes) = date, équipes, **vainqueur**, premier tireur (pas le score de la séance).
- Présence (`e04d-international-results.json`, `e04d-eliminatoires-europe-701.json`) : qualifications Mondial cycle 2022 = 866 lignes, cycle 2026 = 901 (1 767, comme le relevé du 18 nov.) ; dont 364 avant 2021/22 ; éliminatoires européens 701/701 (258 + 239 + 204) ; qualifications CAN depuis 2021/22 : 401 ; Coupe d'Asie qualif. : 105 ; Ligue des nations CONCACAF : 413 ; Gold Cup qualif. : 32 ; Ligue des nations UEFA 2022/23 : 160, 2024/25 : 184 ; amicaux : 1 423 ; Euro 2024 : 51. Aucune qualification du Mondial 2030 encore.
- Éditions lues aujourd'hui : CAN 2021/2023/2025 (52 chacune), Copa 2024 (32), Coupe d'Asie 2023 (51), Gold Cup 2023/2025 (31 chacune) + Ligue des nations B–D 2026/27.
- Copa América 2024 en production (`copa-2024-edition.json`, `nation-t_*.json`) : 32 matchs ; les quatre séances (ARG–ECU 04/07, VEN–CAN 05/07, URU–BRA 06/07, CAN–URU 13/07) ont `homePenalties`/`awayPenalties` nuls ; la finale est servie 1–0 sans aucun champ de prolongation ; `round` nul partout. `shootouts.csv` donne les quatre vainqueurs, pas les scores de séance, et rien sur la prolongation de la finale.
- Branche `claude/week-internationals` (rejeu du filtre, `e04d-branche-week-internationals-portee.json`) : une édition `nations-results:internationals:2026/2027`, hors Elo (`power.ELO_MATCHES`), 389 matchs aujourd'hui (Ligue des nations CONCACAF 97, amicaux 96, qualifications CAN 96…). Elle exclut « UEFA Nations League » et « FIFA World Cup » et ne lit que 2026/27 : elle couvre **0** des 1 772 qualifications 2022/2026 et 0 des 701 éliminatoires européens.

## E04e — statistiques individuelles

- Code : seuls les matchs natifs reçoivent des lignes joueur (`store.py` familles PitchAPI ; `cups.py`, `open_matchday.py`, `archives.py` n'écrivent aucune ligne joueur) ; `PLAYER_MATCHES` exclut `cup_key` et `archive_key` (`power.py:1028`) ; `api.fixtures` aussi, donc ces matchs n'ont pas de page de match.
- API : Mondial des clubs 2021/2022/2023/2025 = 8/7/7/64 matchs servis par `/api/cups/edition`, aucun identifiant de match ; aucune fiche native Chelsea entre le 14/06 et le 14/07/2025. Copa 2024 : aucun match « collecté » (`id` absent dans `/api/nations/<id>`). Sondages joueur : Messi 2024/25 (fenêtre du 19/01/2024 au 01/06/2025) = 22 matchs, tous MLS, aucun de Copa ; Palmer 2025/26 (fenêtre jusqu'au 19/07/2026) = 32 matchs, aucun du Mondial des clubs.

## E04j — anciennes saisons

- Catalogue d'archives servi (`archives-index-results.json`) : 150 saisons de 1871/72 à 2020/21, 1 408 éditions-saisons, 440 666 matchs, 439 805 résultats, 341 non joués, 1 424 dates non vérifiées ; buts (`archives-index-goals.json`) : 62 saisons, 141 268 matchs, 422 187 événements, 120 désaccords de score. Aucune saison d'archive après 2020/21.
- Règles écrites trouvées, dispersées : `power.py:225, 282, 291, 862, 1028, 1477` (archives hors Elo et hors notes) ; `docs/calculs/08-notes-vega/01-formules-et-raisons.md:38` (archives hors Elo, décision utilisateur) ; `docs/calculs/06-accueil-et-matchs/03-pronostics-et-projections.md:196` (7 520 clubs) ; `docs/OPENFOOTBALL_HISTORY.md` ; `docs/FOOTBALL_DATA.md` (rien écrit dans `core.matches`) ; `scope.py:REMOVED_ARCHIVES`. Aucune page n'énonce une politique de disponibilité ; l'exclusion des archives et coupes des notes joueur n'est écrite que dans le code.
- Chiffres football-data (117 833 / 97 616 / 20 217) repris de `docs/FOOTBALL_DATA.md`, **non remesurés** ici.

## Non vérifié

- Les scores officiels de Pologne et du pays de Galles n'ont pas été relus chez les organisateurs : l'égalité 20/22 avec le relevé du 17 nov. est une concordance de comptes, pas un contrôle ligne à ligne.
- Le comportement en production de la garde lorsque la source retirera de nouvelles lignes dans un dossier non attesté (déduit du code, non observé).
- Le format « continental-text » d'`open-cups.mjs` sur les fichiers `clq/elq/confq` (scores avec « pen. » et « a.e.t. ») : non exécuté.
- Le contenu des 2 489 qualifications 2021-22 à 2023-24 et 2026-27 dans une source quelconque autre qu'UEFA.
