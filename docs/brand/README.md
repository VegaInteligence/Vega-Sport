# Identité Vega

Le logo est « Vega* » : le mot en EB Garamond, suivi d’un astérisque. Il a été choisi le 24 novembre 2026 pour aller avec le film de présentation, à la place de l’étoile à traînée (après un premier choix, le même jour, de « Vega. » avec un point).

## Le logo

- **Le mot** : « Vega », lettres EB Garamond (licence SIL OFL 1.1), graisse 560.
- **L’astérisque** : six pétales dessinés pour Vega (ce n’est pas le signe de la police), un seul tracé fermé. Son diamètre A vaut 0,48 fois la hauteur du V ; son sommet est à la hauteur du V et il se place à 0,18 A de la dernière lettre. « Astérisque » veut dire « petite étoile », et le signe renvoie à la note : la preuve.
- **Le produit** : en petit dessous, en italique, sous « Ve » et à gauche de la boucle du g : « Vega* » avec « Sport ». Dans un texte, on écrit Vega Sport, sans l’astérisque.
- **La marque « V* »** : là où la place manque (icônes, en-tête étroit). L’astérisque ne s’emploie jamais seul. À 48 px et en dessous, un dessin épaissi.
- **Deux couleurs, rien d’autre** : nuit `#07080B` et ivoire `#F4F1EA`. Pas de dégradé, pas de halo, pas de bleu dans le logo.
- **Autour** : une marge d’un demi-A sur chaque côté ; 64 px de large au minimum pour le mot, la marque en dessous.

## Les fichiers

| Où | Quoi |
| --- | --- |
| [`public/branding/vega/`](../../dashboard/frontend/public/branding/vega/) | `logo-dark.svg` et `logo-light.svg` (« Vega* » avec « Sport » dessous, ivoire et nuit), `symbol-*.svg` (« V* »), `icon-*.svg` et `favicon.svg` (la marque sur son carré), `share-1200x630.jpg` (l’image de partage) |
| [`public/`](../../dashboard/frontend/public/) | `favicon.ico`, `apple-touch-icon.png`, `android-chrome-*.png`, `og-image.png` : les adresses que les navigateurs demandent d’eux-mêmes |
| [`src/brand-mark.js`](../../dashboard/frontend/src/brand-mark.js) | les tracés du mot et de la marque, pour ce que le serveur dessine et pour l’écran de chargement |
| [`vega/`](vega/) | le jeu complet : « Vega* » seul, « Vega* » avec « Sport », la marque « V* » et les icônes, en ivoire et en nuit |

Les couleurs du logo sont aussi des jetons : `--vega-night` et `--vega-ivory` ([`brand-tokens.css`](../../dashboard/frontend/src/brand-tokens.css)).

## Sur le site

- **En-tête** : le mot avec « Sport » dessous à partir de 1120 px de large, la marque « V* » en dessous, pour laisser aux menus la place qu’ils avaient ([`SiteHeader.jsx`](../../dashboard/frontend/src/components/SiteHeader.jsx), `.brand-logo` et `.brand-mark` dans `styles.css`).
- **Pied de page** : le mot.
- **Thèmes** : ivoire sur le thème sombre, nuit sur le thème clair ([`StatarenaLogo.jsx`](../../dashboard/frontend/src/components/StatarenaLogo.jsx)).
- **Icône de l’onglet** : elle suit le thème du site ; `faviconVersion` dans [`app/layout.jsx`](../../dashboard/frontend/app/layout.jsx) augmente à chaque nouveau dessin.
- **Icônes d’application** : `/api/vega-image?kind=icon&size=180|192|512`, dessinées par le serveur.
- **Image de partage** : le mot sur une image du film de présentation (plan Mixkit 42355, Stock Video Free License). L’ancienne adresse `/api/vega-image?kind=og` y renvoie.
- **Écran de chargement** : « V* », dont l’astérisque tourne ([`PageLoader.jsx`](../../dashboard/frontend/src/components/PageLoader.jsx)).
- **Images de rapport** : « Vega* » en haut à gauche de chaque carte ([`report-cards.jsx`](../../dashboard/frontend/src/server/report-cards.jsx)).

Contrôle de bout en bout : `node tests/e2e/brand.e2e.mjs <adresse du site> <dossier de preuves>`.

## L’interface

Le logo ne change ni les couleurs ni la police de l’interface : elles vivent dans [`theme.css`](../../dashboard/frontend/src/theme.css), et le texte reste en Inter (auto-hébergée dans [`public/fonts`](../../dashboard/frontend/public/fonts/), licence OFL). Le bleu y est réservé à la sélection et aux signaux.

Une exception, les écrans du compte (`/connexion`, `/compte`, [`account.css`](../../dashboard/frontend/src/account.css)) : la voix de la marque y est reprise telle quelle.

- **Le titre de `/connexion` et le monogramme du compte** sont en EB Garamond (auto-hébergée, `public/fonts/eb-garamond-latin.woff2`, licence OFL), suivis d’un point rond (`.brand-dot`) repris du premier logo, « Vega. » : « Connexion. », « L. ».
- **L’action principale** (« Se connecter ») est ivoire sur nuit au thème sombre, nuit sur ivoire au thème clair.
- **Le dessin** ([`AccountArt.jsx`](../../dashboard/frontend/src/components/AccountArt.jsx)) : des terrains d’entraînement de nuit vus du ciel, comme le plan du film derrière l’image de partage. Tracé en SVG, nuit et ivoire dans les deux thèmes, sans requête.

## Archives

Les kits STATARENA (le premier, puis le vert) restent pour mémoire : fichiers dans `public/branding/` et [`public/branding/green`](../../dashboard/frontend/public/branding/green/), guide et références dans ce dossier (`guidelines`, `previews`, `source`, `tokens`, `web`, `manifest.json`).
