# Rejouer les notes de l’échantillon

Le fichier [sample.json](sample.json) contient le relevé en lecture seule du 17 novembre 2026 à 21:43:21 UTC, les entrées brutes et préparées, les espérances et dispersions ajustées par indicateur pour chaque cas, les distributions de référence par poste et les notes obtenues. Les [résultats par participation](results.tsv) et le [contrôle hors ligne](offline.json) ont été produits à partir de ce fichier.

Depuis le répertoire qui contient ce README, exécuter la commande ci-dessous avec le chemin d’un dépôt Vega-Sport contenant le commit indiqué. Elle lit le module Python directement dans Git et vérifie son empreinte SHA-256. Elle ne demande ni accès AWS ni connexion à PostgreSQL.

```sh
python3 offline.py "/chemin/vers/Vega-Sport" --table /tmp/vega-score-replay.tsv
```

Résultats attendus et constatés à une tolérance relative et absolue de 10⁻¹² : 23 participations vérifiées, 21 notes sur 100, deux sans rôle sur l’ensemble de l’année. Les trois compétitions cibles contribuent chacune cinq joueurs de champ et deux gardiens. Deux témoins supplémentaires viennent de Ligue 1 et d’A-League. Les lignes d’avant-match et statistiques des participants sélectionnés avaient des dates de modification antérieures à la première collecte de 21:05 UTC. Cette première collecte donnait uniquement des agrégats. La vérification nominative et le recalcul des paramètres annuels correspondent à la photographie de 21:43 UTC.

La [sélection SQL](sample.sql) exclut les joueurs déjà notés et les lignes intermédiaires déjà publiées. La [sonde](probe.py) utilise le SQL et les fonctions de l’image `8018e0836c`, une seule transaction `REPEATABLE READ READ ONLY` et un curseur serveur sur 178 217 lignes. La transaction a été fermée après 17,71 secondes. Le calcul des références annuelles et des 23 résultats s’est poursuivi hors transaction sur le processus isolé. La sonde a conservé les paramètres de référence utiles pour contrôler ces lignes sans exporter la base. Le [reçu ECS](receipt.json) et les [temps par étape](checkpoints.txt) confirment la sortie 0 et le retrait de la définition de diagnostic éphémère.

Le [lanceur de collecte](run.py) réutilise les protections de `query_batch.py` et de `team_probe.py` du dossier de preuves parent. Un nouveau prélèvement depuis la base vivante peut retourner d’autres joueurs ou ne plus trouver de retard après un rattrapage. Pour préserver l’original, le lanceur refuse d’écraser un fichier `sample.json` existant.
