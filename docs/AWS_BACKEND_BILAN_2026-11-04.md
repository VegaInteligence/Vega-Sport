# Backend AWS : bilan chiffré du 4 novembre 2026

La lecture SQL et les optimisations ci-dessous sont implémentées, poussées sur `codex/aws-backend-20261104` et testées. L’API AWS est déployée. La migration complète et la bascule de production restent ouvertes : seules deux partitions sont publiées, le volume RDS actuel ne suffit pas au périmètre complet estimé, et Vercel refuse les nouveaux déploiements après sa limite quotidienne.

## Lecture relationnelle et cache

Comparaison appariée sur le même match et les mêmes tirs, avec versions des sources inchangées : 64 requêtes HTTP, toutes réussies, mêmes valeurs JSON et mêmes tableaux ordonnés.

| Mesure médiane | Avant | Après | Évolution |
|---|---:|---:|---:|
| Fiche complète, processus froid | 3 132 ms | 1 460 ms | −53,4 % |
| Tirs, processus froid | 1 879 ms | 1 050 ms | −44,1 % |
| Requêtes SQL, fiche froide | 28 | 2 | −92,9 % |
| Requêtes SQL, tirs froids | 4 | 2 | −50 % |
| Fiche complète, processus chaud | 98,9 ms | 107,4 ms | +8,5 ms |
| Tirs, processus chaud | 96,3 ms | 100,2 ms | +3,9 ms |

Les anciennes lectures S3 et le parsing des archives partagées disparaissent de ces requêtes. En contrepartie, le résultat SQL de la fiche froide passe de 4 170 à 349 585 octets. SQL + S3 mesurés passent de 246 904 à 349 585 octets sur cette fiche froide : **pas de réduction démontrée du transfert total ni de sa facture**. Ces temps incluent la connexion Mac→Ohio et le démarrage du pool ; ils ne constituent pas une comparaison de latence navigateur en production. [Protocole, échantillons et limites](verification/aws-live-performance-20261104/RESULTS.md).

Sur l’API réellement déployée, une fiche a donné 1 404 ms en MISS puis 65 ms en HIT ; GET conditionnel et HEAD ont renvoyé zéro octet. C’est un contrôle ponctuel du CDN et des validateurs, sans estimation de p95. L’origine Lambda non signée répond 403. [Requêtes publiques](verification/aws-release-20261104/public-data-smoke.json).

## Publication SQL et stockage des statistiques

La migration 009 stocke les mesures dans des colonnes numériques nommées, partage leurs définitions et conserve les cas rares dans des relations typées. Aucun document métier JSON ou binaire n’est ajouté au modèle de lecture.

| Périmètre identique | Avant | Après | Évolution |
|---|---:|---:|---:|
| Deux familles de métriques, allocation RDS | 90,24 Mo | 8,48 Mo | −90,6 % |
| Base RDS entière, avant/après installation | 11,332 Go | 11,250 Go | −81,48 Mo |
| COPY des feuilles de match, lot de 64 matchs | 64 | 4 | −93,8 % |
| Publication locale de 16 matchs | 1,025 s | 1,154 s | +12,6 % |
| Calcul local des 378 empreintes de réponses | 3,62 s | 4,54 s | +25,4 % |

Les 411 416 lignes originales sont identiques dans les deux sens de comparaison SQL, avec les champs absents, nulls, ordres, types et valeurs rares préservés. Les 378 empreintes de ressources concordent. Annulation transactionnelle, lecteurs concurrents, deux écrivains directs et droits de lecture ont été vérifiés. L’installation réelle 009 a réussi ; les tables sources de la migration de ton ami sont intactes. Le gain concerne surtout le stockage. Les lectures et écritures locales ci-dessus ont un coût supplémentaire mesuré. [Preuves et commandes](verification/aws-compact-metrics-20261104/RESULTS.md), [inventaire RDS après installation](verification/aws-release-20261104/inventory-compact-009.json).

## Pages de saisons et chargement du site

Le format HTTP compact optionnel enlève les valeurs répétées, puis le client reconstruit les objets attendus. Le contrat par défaut reste disponible. La base continue de stocker et sélectionner des tables typées.

| Deux partitions publiées, mêmes 189 matchs et 8 304 apparitions | Avant | Après | Évolution |
|---|---:|---:|---:|
| Requêtes pour un parcours complet | 64 | 7 | −89,1 % |
| Octets HTTP décodés, tentatives comprises | 20,48 Mo | 3,74 Mo | −81,8 % |
| Gzip calculé de la même façon par réponse | 1,98 Mo | 0,74 Mo | −62,4 % |
| Tentatives de partitions, trois parcours navigateur | 99 | 11 | −88,9 % |
| Réponses 413 sur ces trois parcours | 9 | 0 | supprimées sur cet échantillon |

Les deux saisons reconstruites sont identiques aux références. Les tests isolés préservent aussi les positions numériques et textuelles, les champs absents, nulls et les noms de mesures réservés. La CI Linux du commit `d5df4c5a9a` est verte, dont le parcours PostgreSQL→HTTP→décodeur.

Le build Next de production exact passe **22/22 contrôles Chromium contre l’API AWS réelle** : score 1–1, 23 tirs, interceptions 10–8, joueur à 10 matchs et 804 minutes, vues bureau et mobile. L’ancienne mesure navigateur vient d’une prévisualisation Vercel, la nouvelle d’un serveur local de production : la baisse des requêtes est observable, une amélioration de latence hébergée reste à mesurer. [Transport](verification/aws-wire-pages/RESULTS.md), [navigateur, captures et commande](verification/aws-compact-preview-20261104/RESULTS.md), [CI](https://github.com/OrionQuantPlatform/STATARENA/actions/runs/41774754578).

## Fiche match : charger les saisons au clic

Une fiche terminée peut afficher son résumé sans télécharger les saisons. Sur le rejeu local de réponses AWS conservées pour Reims–Sochaux, les lectures initiales passent de **7 à 0** et le contenu structuré de **3,74 Mo à 10,7 Ko, soit −99,7 %**. Le clic joueur charge ensuite le cohort nécessaire à sa performance et aux comparaisons. Les sélections existantes survivent à un changement de compétition ; les erreurs proposent une reprise et le chargement peut être fermé.

Le parent a vérifié le code final avec le build Next de production contre l’API AWS réelle : **26/26 contrôles**, plus **6/6** sur une comparaison conservée entre Serie A et Ligue 2. Sept scénarios complémentaires sur les réponses conservées passent aussi, dont l’erreur 503, l’annulation et les cas de saison/compétition différentes. Le résumé bureau/mobile demande zéro partition ; les vues de contexte d’un match à venir conservent leurs lectures ciblées. Ces mesures portent sur les requêtes et les valeurs ; la latence hébergée attend toujours le déploiement Vercel. [Résultats, scripts et captures](verification/aws-deferred-match-20261104/RESULTS.md).

## Dimensionnement Lambda

Un essai réel et réversible sur la page dense a conservé toutes les réponses, leurs tailles et leur empreinte. Pour cinq appels chauds par configuration, passer de 512 à 1 024 Mio a donné une médiane HTTP de 3 924→2 717 ms, mais une consommation facturée de 1,843→2,238 Go-secondes par requête, **+21,4 %**. Des tests navigateur partageaient RDS pendant cet essai. **512 Mio a été rétabli** ; ce petit essai ne justifie pas une hausse permanente pour tout le trafic. [Résultats et rapports Lambda associés par identifiant](verification/aws-lambda-memory-20261104/RESULTS.md).

## Reste à terminer

- **Couverture** : 2 partitions, 189 matchs enrichis, 1 880 projections de support et 37 867 références d’images ont été publiés. Il reste 484 partitions et environ 36 700 travaux au total. L’audit API partiel garde ses neuf échecs liés à cette publication incomplète ; la migration n’est pas déclarée terminée.
- **Capacité** : après compaction, le périmètre complet est estimé autour de 27,8 Go avant réserve, en conservant les sources existantes. Le disque RDS est de 20 Gio, avec une admission SQL à 16 Go. Le backfill massif reste suspendu. L’extension proposée à 64 Gio ajoute 5,06 USD HT/mois au tarif régional vérifié et attend ton accord explicite, car le volume alloué ne peut ensuite pas être réduit sur cette instance. [Calcul et demande exacte](verification/aws-capacity-20261104/storage-change-plan.json).
- **Vercel** : la dernière prévisualisation hébergée vérifiée est au commit `6335ac6e5f`. Deux tentatives concordantes, connecteur puis CLI, refusent le commit suivant avec HTTP 402, `api-deployments-free-per-day`, plus de 100 déploiements. Aucun changement de forfait ou de protection. Le dernier front est testé localement en mode production, mais son déploiement hébergé reste à vérifier.
- **Bascule finale** : reprendre la publication dans la capacité autorisée, terminer la couverture des sources et tous les parcours métier, déployer le front, puis retirer les dépendances Neon obsolètes. Main et la production n’ont pas été basculés sur ce jeu partiel.

Chaque dossier de preuve contient ses entrées, commandes de relance et résultats observés. Les gains rapportés ne sont pas extrapolés à l’ensemble des utilisateurs ni transformés en économies mensuelles non mesurées.

Commit suggéré : `docs: record AWS migration progress and measured performance gains`.
