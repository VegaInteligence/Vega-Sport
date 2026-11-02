# Identité STATARENA

Kit fourni appliqué aux logos et accents : `#1D6FD6` et `#3B8EFF`. Les tokens de l’interface vivent dans [`theme.css`](../../dashboard/frontend/src/theme.css), seule source des couleurs, tailles de texte et rayons :

- Thème sombre : neutres froids `#0E0F12` (fond), `#15171B` (surfaces), texte `#E4E7EC`.
- Thème clair : fond off-white du kit `#F6F8FB`, surfaces blanches, texte navy `#0D2134`, bordures `#E2E7EE`.
- Le bleu analytics est réservé à la sélection et aux signaux clés (onglet actif, note élevée, filtre actif, filet de 2 px en haut de l’en-tête).
- Typographie : Inter variable (graisse + taille optique) auto-hébergée dans [`public/fonts`](../../dashboard/frontend/public/fonts/), licence OFL. Chiffres tabulaires partout ; le monospace est réservé aux données JSON brutes.
- Échelle : 11 / 12 / 13 / 15 / 20 / 28 px ; rayons 6 / 8 / 12 / 14 px.

- Les SVG, PNG, icônes et visuels sociaux originaux sont conservés dans [`public/branding`](../../dashboard/frontend/public/branding/).
- Le guide, les aperçus, la référence source et les fichiers d’intégration sont conservés ici.
- Le composant [`StatarenaLogo`](../../dashboard/frontend/src/components/StatarenaLogo.jsx) utilise les SVG originaux. Les tokens fournis sont importés dans le layout ; les tokens de l’interface s’y rattachent.
- Le favicon, les icônes mobiles, le manifeste et l’aperçu Open Graph utilisent les fichiers du kit. Le README emploie sa bannière GitHub.
- Les variantes de logo et l’avatar sont disponibles pour les futurs supports. L’identité de l’organisation GitHub, qui héberge d’autres projets, reste indépendante.

L’inventaire de fidélité figure dans [`asset-inventory.json`](../../dashboard/outputs/statarena-brand/asset-inventory.json).
