# Next.js / React integration

1. Copy all files in `logos/svg/` to your project’s `public/branding/` directory.
2. Copy `icons/favicon.ico`, `icons/favicon.svg`, `icons/apple-touch-icon.png`, `icons/android-chrome-192.png` and `icons/android-chrome-512.png` to `public/`.
3. Copy `web/site.webmanifest` to `public/site.webmanifest`.
4. Copy `social/open-graph-1200x630.png` to `public/og-image.png`.
5. Import `tokens/statarena.css` in your app's global CSS.
6. Copy `web/STATARENA-Logo.tsx` to your React components folder and use:

```tsx
<StatarenaLogo layout="horizontal" appearance="color" style={{ width: 260, height: 'auto' }} />
<StatarenaLogo layout="symbol" appearance="inverse" style={{ width: 64, height: 'auto' }} />
```

Next.js `app/layout.tsx` metadata (adapt site URLs when known):

```ts
export const metadata = {
  title: 'STATARENA',
  applicationName: 'STATARENA',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
  openGraph: { images: ['/og-image.png'] },
};
```

No domain or marketing copy has been invented.
