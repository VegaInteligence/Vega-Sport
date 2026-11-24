# Identité Vega

Le logo est « Vega. » : le mot en EB Garamond, suivi d’un point rond. Il a été choisi le 24 novembre 2026 pour aller avec le film de présentation, à la place de l’étoile à traînée.

## Le logo

- **Le mot** : « Vega », lettres EB Garamond (licence SIL OFL 1.1), graisse 560.
- **Le point** : un cercle. Son diamètre D vaut 0,26 fois la hauteur du V ; il est placé à 0,37 D de la dernière lettre et dépasse légèrement la ligne de base, comme les lettres rondes.
- **Les produits** : le second mot en italique, le point à la fin : « Vega *Sport*. », « Vega *Prediction*. », « Vega *Status*. ». Dans un texte, on écrit Vega Sport, sans le point.
- **La marque « V. »** : là où la place manque (icônes, en-tête étroit). À 32 px et en dessous, un dessin épaissi.
- **Deux couleurs, rien d’autre** : nuit `#07080B` et ivoire `#F4F1EA`. Pas de dégradé, pas de halo, pas d’étoile, pas de bleu dans le logo.
- **Autour** : une marge de D sur chaque côté ; 64 px de large au minimum pour le mot, la marque en dessous.

## Les fichiers

| Où | Quoi |
| --- | --- |
| [`public/branding/vega/`](../../dashboard/frontend/public/branding/vega/) | `logo-dark.svg` et `logo-light.svg` (« Vega Sport. », ivoire et nuit), `symbol-*.svg` (« V. »), `icon-*.svg` et `favicon.svg` (la marque sur son carré), `share-1200x630.jpg` (l’image de partage) |
| [`public/`](../../dashboard/frontend/public/) | `favicon.ico`, `apple-touch-icon.png`, `android-chrome-*.png`, `og-image.png` : les adresses que les navigateurs demandent d’eux-mêmes |
| [`src/brand-mark.js`](../../dashboard/frontend/src/brand-mark.js) | les tracés du mot et de la marque, pour ce que le serveur dessine et pour l’écran de chargement |
| [`vega/`](vega/) | le jeu complet : « Vega. » seul, les trois produits, « Vega Intelligence. », la marque et les icônes, en ivoire et en nuit |

Les couleurs du logo sont aussi des jetons : `--vega-night` et `--vega-ivory` ([`brand-tokens.css`](../../dashboard/frontend/src/brand-tokens.css)).

## Sur le site

- **En-tête** : le mot « Vega Sport. » à partir de 1024 px de large, la marque « V. » en dessous, pour laisser aux menus la place qu’ils avaient ([`SiteHeader.jsx`](../../dashboard/frontend/src/components/SiteHeader.jsx), `.brand-logo` et `.brand-mark` dans `styles.css`).
- **Pied de page** : le mot.
- **Thèmes** : ivoire sur le thème sombre, nuit sur le thème clair ([`StatarenaLogo.jsx`](../../dashboard/frontend/src/components/StatarenaLogo.jsx)).
- **Icône de l’onglet** : elle suit le thème du site (`icon-dark.svg` ou `icon-light.svg`), et la page n’en nomme qu’une : le script de thème de [`app/layout.jsx`](../../dashboard/frontend/app/layout.jsx) écrit lui-même ce lien, qui ne figure donc pas dans `metadata.icons`. Sans scripts, la page nomme `favicon.svg`, qui suit les couleurs du système. `faviconVersion`, dans le même fichier, augmente à chaque nouveau dessin.
- **Icônes d’application** : `/api/vega-image?kind=icon&size=180|192|512`, dessinées par le serveur.
- **Image de partage** : le mot sur une image du film de présentation (plan Mixkit 42355, Stock Video Free License). L’ancienne adresse `/api/vega-image?kind=og` y renvoie.
- **Écran de chargement** : « V. », dont le point rebondit ([`PageLoader.jsx`](../../dashboard/frontend/src/components/PageLoader.jsx)).
- **Images de rapport** : « Vega. » en haut à gauche de chaque carte ([`report-cards.jsx`](../../dashboard/frontend/src/server/report-cards.jsx)).

Contrôle de bout en bout : `node tests/e2e/brand.e2e.mjs <adresse du site> <dossier de preuves>`.

## L’interface

Le logo ne change ni les couleurs ni la police de l’interface : elles vivent dans [`theme.css`](../../dashboard/frontend/src/theme.css), et le texte reste en Inter (auto-hébergée dans [`public/fonts`](../../dashboard/frontend/public/fonts/), licence OFL). Le bleu y est réservé à la sélection et aux signaux.

## Archives

Les kits STATARENA (le premier, puis le vert) restent pour mémoire : fichiers dans `public/branding/` et [`public/branding/green`](../../dashboard/frontend/public/branding/green/), guide et références dans ce dossier (`guidelines`, `previews`, `source`, `tokens`, `web`, `manifest.json`).
