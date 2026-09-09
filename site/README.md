# Tokengotchi landing page

Independent, dependency-free static site. The Electron build and root dependencies are unchanged.

From this directory:

- `npm run dev`: preview at http://127.0.0.1:4173 (requires Python 3).
- `npm run build`: copy the public files into `site/dist/` (requires Node.js).

For Cloudflare, use `site` as the build root, `npm run build` as the build command, and `dist` as the static assets directory. No server runtime is needed. Domain: `tokengotchi.app`. Deployment has not been configured yet.

## Public downloads

Until public installers exist, the page honestly shows a coming-soon state. Edit `downloads.json` with verified public HTTPS URLs; never put a GitHub token or private release URL in it. Each OS accepts multiple labeled installers:

```json
{
  "macos": [{ "label": "macOS · Universal", "url": "https://YOUR_PUBLIC_HOST/Tokengotchi-universal.dmg" }],
  "windows": [],
  "linux": []
}
```

Use versioned URLs. This manifest can be updated by the release pipeline later. Homebrew is intentionally not advertised until the tap exists. Mobile visitors see all OS options without being classified as a desktop OS.

## Artwork

The PNGs in `assets/` are copies of the existing generated artwork in `docs/sprites/`. After changing the app's sprites, regenerate them using the app's workflow and refresh these copies. Fonts use Google Fonts with system fallbacks.
