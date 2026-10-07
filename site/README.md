# Tokengotchi landing page

Independent, dependency-free static site. The Electron build and root dependencies are unchanged.

From this directory:

- `npm test`: check locale negotiation, download selection, and the built pages.
- `npm run build`: write the public files into `site/dist/` (requires Node.js).
- `npm run dev`: build, then preview at http://127.0.0.1:4173.

For Cloudflare, use `site` as the build root, `npm run build` as the build command, and `dist` as the static assets directory. Domain: `tokengotchi.app`.

## Locales

The landing is one page in two static trees:

- `dist/en/index.html` → `https://tokengotchi.app/en/`
- `dist/pt/index.html` → `https://tokengotchi.app/pt/`

`styles.css`, `app.js`, `assets/`, and `downloads.json` are shared from the site root. There is no pricing, blog, or account page.

`/` redirects to `/pt/` when the preferred language is `pt*` (for example `pt-BR`), and to `/en/` otherwise. A `tokengotchi_locale` cookie (`en` or `pt`, one year, `Path=/`, `SameSite=Lax`) wins over `Accept-Language`. The header language switcher swaps `/en/` and `/pt/` and keeps the current hash, such as `#download`. Each locale page sets the cookie, so opening a language directly becomes the next preference.

That root redirect is the only server step. `site/functions/index.js` is a Cloudflare Pages Function. Pages reads it from the `site` project root; it is not copied into `dist`. It exists because a static file cannot see `Accept-Language`. The response is `302`, `Vary: Accept-Language, Cookie`, and `Cache-Control: private, no-store`.

`dist/index.html` is the fallback when that function is not running (local file hosts, or a Pages project that only uploads `dist`). It uses the cookie, then `navigator.language`, and links to both languages if JavaScript is off. `dist/_redirects` adds trailing slashes for `/en` and `/pt`.

SEO on each locale page: `html lang`, a canonical URL, `hreflang` for `en`, `pt`, and `x-default` (`/en/`), and translated title, description, and Open Graph tags.

## Public downloads

`downloads.json` is the only download manifest. The page reads it at `/downloads.json` and renders an `https:` URL only. Empty arrays, a failed fetch, or a URL that is not public HTTPS show a coming-soon line in the active language. Hash values are not printed. When every asset URL shares one GitHub release, the page links to that release's `SHA256SUMS` file (`<release base>/SHA256SUMS`). If the base cannot be derived, the link is omitted. Do not add placeholder hashes.

The example below is the shape only. `<tag>` and `<version>` are placeholders. Copy real HTTPS URLs from the published release into `downloads.json`; that file is the source of truth.

```json
{
  "macos": [
    { "label": "macOS · Apple Silicon", "url": "https://github.com/vitorjpr/tokengotchi/releases/download/<tag>/Tokengotchi-<version>-arm64.dmg", "arch": "arm64" },
    { "label": "macOS · Intel", "url": "https://github.com/vitorjpr/tokengotchi/releases/download/<tag>/Tokengotchi-<version>-x64.dmg", "arch": "x64" }
  ],
  "windows": [
    { "label": "Windows · x64 (zip)", "url": "https://github.com/vitorjpr/tokengotchi/releases/download/<tag>/Tokengotchi-<version>-win.zip", "arch": "x64" },
    { "label": "Windows · arm64 (zip)", "url": "https://github.com/vitorjpr/tokengotchi/releases/download/<tag>/Tokengotchi-<version>-arm64-win.zip", "arch": "arm64" }
  ],
  "linux": [
    { "label": "Debian (x64)", "url": "https://github.com/vitorjpr/tokengotchi/releases/download/<tag>/tokengotchi_<version>_amd64.deb", "arch": "x64" },
    { "label": "Debian (arm64)", "url": "https://github.com/vitorjpr/tokengotchi/releases/download/<tag>/tokengotchi_<version>_arm64.deb", "arch": "arm64" }
  ]
}
```

`macos`, `windows`, and `linux` are arrays. They may be empty. Each entry needs `label` and `url`. `arch` is optional:

| `arch` | Shown to |
| --- | --- |
| omitted, `universal`, or `any` | Anyone on that OS, unless a matching per-arch file exists |
| `x64` (also `amd64`, `x86_64`, `intel`) | 64-bit Intel/AMD |
| `arm64` (also `aarch64`, `arm`, `apple`, `apple-silicon`) | ARM, including Apple Silicon |

On the visitor's own desktop OS, a matching `arch` replaces the universal file. If the CPU is unknown, or they are on a phone or iPad (those stay unclassified and the tabs simply default to macOS), a universal file is shown when one exists; otherwise every labeled arch is shown so they can choose. Opening another OS's tab lists every arch for that OS, since that machine may not be the one they are using.

Labels stay language-neutral. The page supplies the verb: `Download {label}` / `Baixar {label}`.

`downloads.json` is the source of truth for the live files and version. It points at the latest published GitHub release. Do not invent URLs for an unpublished release, and do not copy a version number out of this README. Files are per-arch: list each HTTPS URL with `arch` and drop any universal entry. The page lists macOS Apple Silicon and Intel `.dmg` files (ad-hoc signed, not notarized), Windows `.zip` (x64 and arm64), and Linux `.deb` (amd64 and arm64). Add a Windows Setup `.exe` or a Linux AppImage only when a published release actually carries them. Homebrew stays off the page until a tap exists.

## Artwork

The PNGs in `assets/` are copies of the existing generated artwork in `docs/sprites/`. After changing the app's sprites, regenerate them using the app's workflow and refresh these copies. Fonts use Google Fonts with system fallbacks.
