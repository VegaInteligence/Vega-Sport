# Contrôle inverse des intermédiaires joueurs

Le SELECT classe chaque ligne de `agg.player_power_matches` selon les conditions du lecteur source et compte les paires match/joueur sur plusieurs années de récompense. Le chemin de jointure utilise la saison de la rencontre, car une statistique de juillet peut appartenir à l’année de récompense précédente. La requête s’exécute en lecture seule. Un reçu RDS horodaté est nécessaire pour connaître les effectifs réels.

## Conditions et résultats attendus du contrôle local

La base PostgreSQL en mémoire démarre vide. Le premier contrôle attend zéro pour les huit compteurs et une valeur nulle pour chaque témoin. Le second utilise des données inventées réservées à cette base.

| Rencontre | Entrées | Classe attendue |
| --- | --- | --- |
| 11 | Novembre 2021, joueur 10 avec 90 minutes, intermédiaires 2021 et 2022 | Une ligne admise et une année incorrecte, paire multi-annuelle |
| 12 | Juillet 2022, joueur 20 avec 7 minutes dans la saison source 2022, intermédiaire 2021 | Ligne admise |
| 13 | Rencontre sans statistique du joueur | Source manquante |
| 14 | Match annulé avec statistique | Source inéligible |
| 15 | Match de coupe complémentaire avec statistique | Source inéligible |
| 16 | Intermédiaire sans rencontre | Source manquante |

Le total attendu est de sept lignes, six paires, deux sources admises, deux manquantes, deux inéligibles et une année incorrecte. Une paire couvre deux années et apporte une ligne excédentaire. Les deux décompositions doivent donner sept. Les témoins sont déterministes.

## Rejeu

Depuis ce dossier, fournir le point d’entrée de PGlite 0.5.8 ou installer cette version dans un répertoire temporaire. Le programme ne contacte aucun service. La commande utilisée sur la machine d’audit est conservée ci-dessous. Les nombres obtenus et la version du moteur sont dans `local-verification.json`.

```sh
node verify.mjs '/Users/lemonnierhugo/Desktop/Me/Codex Folder/Codex/2026-08-31/question-mpg-chatgpt-conversation-6a94cf59-5050/outputs/draft-xi/node_modules/@electric-sql/pglite/dist/index.js'
```
