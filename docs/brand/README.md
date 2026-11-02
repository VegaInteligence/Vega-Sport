# Identité STATARENA

Le kit vert fournit désormais l’emblème, le mot-symbole, les icônes et les visuels de partage. La palette de production conserve ses accents `#1D6FD6` et `#3B8EFF` et ses neutres ; les couleurs et la police Sora du kit vert ne sont pas appliquées à l’interface. Les tokens de l’interface vivent dans [`theme.css`](../../dashboard/frontend/src/theme.css), seule source des couleurs, tailles de texte et rayons :

- Thème sombre : neutres froids `#0E0F12` (fond), `#15171B` (surfaces), texte `#E4E7EC`.
- Thème clair : fond off-white du kit `#F6F8FB`, surfaces blanches, texte navy `#0D2134`, bordures `#E2E7EE`.
- Le bleu analytics est réservé à la sélection et aux signaux clés (onglet actif, note élevée, filtre actif).
- Typographie : Inter variable (graisse + taille optique) auto-hébergée dans [`public/fonts`](../../dashboard/frontend/public/fonts/), licence OFL. Chiffres tabulaires partout ; le monospace est réservé aux données JSON brutes.
- Échelle : 11 / 12 / 13 / 15 / 20 / 28 px ; rayons 6 / 8 / 12 / 14 px.

- Les logos, icônes et visuels sociaux actifs du kit vert sont conservés dans [`public/branding/green`](../../dashboard/frontend/public/branding/green/). Les fichiers du premier kit restent dans `public/branding` pour les références historiques.
- Le guide et les références du premier kit restent ici comme archives. Le manifeste du dossier `public/branding/green` identifie les nouveaux fichiers fournis.
- Le composant [`StatarenaLogo`](../../dashboard/frontend/src/components/StatarenaLogo.jsx) utilise les SVG originaux. Le changement de logo ne modifie aucun token ni aucune police de l’interface.
- Le favicon, les icônes mobiles, le manifeste et l’aperçu Open Graph utilisent les fichiers du kit. Le README emploie sa bannière GitHub.
- Les variantes de logo et l’avatar sont disponibles pour les futurs supports. L’identité de l’organisation GitHub, qui héberge d’autres projets, reste indépendante.

L’inventaire de fidélité figure dans [`asset-inventory.json`](../../dashboard/outputs/statarena-brand/asset-inventory.json).
