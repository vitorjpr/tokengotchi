import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { build, renderChecksum, renderDownloadResult, renderFileCardsHtml, renderMetaHtml, renderNoscript } from './build.mjs';
import { copy } from './copy.mjs';
import { inlineCodeSegments } from './inline-code.mjs';
import {
  aptInstallCommands,
  aptInstallPlans,
  archFromSignals,
  checksumUrl,
  detectDesktopOs,
  downloadView,
  formatReleaseDate,
  formatSize,
  heroAction,
  heroMetaLine,
  linuxDetail,
  listDownloads,
  preferredArchWhenUnknown,
  releaseTag,
  selectDownloads,
  validateManifest,
} from './downloads-logic.mjs';
import { onRequest } from './functions/index.js';
import { createLanguageSwitchHash } from './language-switch.mjs';
import { chooseLocale } from './negotiate.mjs';

const empty = { macos: [], windows: [], linux: [] };

/** Title, meta tags, JSON-LD, and rendered copy. Skips styles, scripts, and font-licence files. */
function visiblePageText(html) {
  const chunks = [];
  for (const match of html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)) chunks.push(match[1]);
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) chunks.push(match[0]);
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    chunks.push(match[1]);
  }
  for (const match of html.matchAll(/<script\b[^>]*id=["']ui-copy["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    chunks.push(match[1]);
  }
  const markup = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const match of markup.matchAll(/\b(?:alt|aria-label|title)="([^"]*)"/gi)) chunks.push(match[1]);
  chunks.push(markup.replace(/<[^>]+>/g, ' '));
  return chunks.join('\n');
}

test('locale negotiation prefers the cookie, then pt*, then English', () => {
  assert.equal(chooseLocale({ cookieHeader: 'tokengotchi_locale=pt', acceptLanguage: 'en-US' }), 'pt');
  assert.equal(chooseLocale({ cookieHeader: 'theme=dark; tokengotchi_locale=en', acceptLanguage: 'pt-BR' }), 'en');
  assert.equal(chooseLocale({ cookieHeader: 'tokengotchi_locale=fr', acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8' }), 'pt');
  assert.equal(chooseLocale({ acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8' }), 'pt');
  assert.equal(chooseLocale({ acceptLanguage: 'en-US,en;q=0.9,pt;q=0.8' }), 'en');
  assert.equal(chooseLocale({ acceptLanguage: 'pt;q=0.4,en;q=0.9' }), 'en');
  assert.equal(chooseLocale({ acceptLanguage: 'fr-FR,fr;q=0.9' }), 'en');
  assert.equal(chooseLocale({ acceptLanguage: '' }), 'en');
  assert.equal(chooseLocale({ acceptLanguage: '*' }), 'en');
});

test('root redirect follows Accept-Language and keeps the query string', async () => {
  const response = await onRequest({
    request: new Request('https://tokengotchi.app/?from=home', {
      headers: { 'Accept-Language': 'pt-BR,en;q=0.8' },
    }),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://tokengotchi.app/pt/?from=home');
  assert.match(response.headers.get('Vary'), /Accept-Language/);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('language switch drops a leftover hash at the top and keeps the section in view', () => {
  const view = { targetTop: 24, targetBottom: 900, viewportHeight: 800, scrollY: 2400 };
  const below = { targetTop: 2800, targetBottom: 4200, viewportHeight: 800, scrollY: 0 };
  const traveling = { targetTop: 900, targetBottom: 2200, viewportHeight: 800, scrollY: 1200 };

  const fresh = createLanguageSwitchHash();
  assert.equal(fresh({ hash: '', ...below }), '');
  assert.equal(fresh({ hash: '#download', ...below }), '');
  assert.equal(fresh({ hash: '#how', ...view, scrollY: 1800 }), '#how');

  const stale = createLanguageSwitchHash();
  assert.equal(stale({ hash: '#download', ...view }), '#download');
  assert.equal(stale({ hash: '#download', ...below }), '');

  const toward = createLanguageSwitchHash();
  assert.equal(toward({ hash: '#download', ...traveling }), '#download');
  assert.equal(toward({ hash: '#download', ...view }), '#download');
  assert.equal(toward({
    hash: '#download',
    targetTop: -1800,
    targetBottom: -200,
    viewportHeight: 800,
    scrollY: 4200,
  }), '');
  assert.equal(toward({ hash: '#evolution', targetTop: 40, targetBottom: 600, viewportHeight: 800, scrollY: 900 }), '#evolution');

  const follow = createLanguageSwitchHash();
  assert.equal(follow({ hash: '#download', ...below }), '');
  assert.equal(follow({ hash: '#download', ...traveling }), '#download');
  assert.equal(follow({ hash: '#download', ...view }), '#download');

  const resurrect = createLanguageSwitchHash();
  assert.equal(resurrect({ hash: '#download', ...view }), '#download');
  assert.equal(resurrect({ hash: '#download', ...below }), '');
  const atHow = { hash: '#download', targetTop: 1400, targetBottom: 2600, viewportHeight: 800, scrollY: 1600 };
  assert.equal(resurrect(atHow), '');
  assert.equal(resurrect(atHow), '');

  const missing = createLanguageSwitchHash();
  assert.equal(missing({ hash: '#nope', found: false }), '');
  assert.equal(missing({ hash: '#%E0%A4%A', found: false }), '');
  assert.equal(missing({ hash: '#custom' }), '');
  assert.equal(missing({ hash: '#' }), '');
  assert.equal(missing({ hash: 'download', ...view }), '');
  assert.equal(missing({ hash: '#how', ...view, scrollY: 1800 }), '#how');
});

test('desktop OS detection leaves phones and iPads unclassified', () => {
  assert.equal(detectDesktopOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'macos');
  assert.equal(detectDesktopOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectDesktopOs('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.equal(detectDesktopOs('Mozilla/5.0 (Linux; Android 14)'), null);
  assert.equal(detectDesktopOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), null);
  assert.equal(detectDesktopOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', {
    platform: 'MacIntel',
    maxTouchPoints: 5,
  }), null);
  assert.equal(detectDesktopOs('Mozilla/5.0 (X11; CrOS x86_64)'), null);
});

test('architecture signals prefer client hints over a Mac UA that still says Intel', () => {
  assert.equal(archFromSignals({ architecture: 'arm', userAgent: 'Intel Mac OS X' }), 'arm64');
  assert.equal(archFromSignals({ architecture: 'x86' }), 'x64');
  assert.equal(archFromSignals({ userAgent: 'Windows NT 10.0; Win64; x64' }), 'x64');
  assert.equal(archFromSignals({ userAgent: 'Linux; Android 14; aarch64' }), 'arm64');
  assert.equal(archFromSignals({
    userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
    renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)',
  }), 'arm64');
  assert.equal(archFromSignals({
    userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
    renderer: 'Intel Iris OpenGL Engine',
  }), 'x64');
  assert.equal(archFromSignals({ userAgent: 'Macintosh; Intel Mac OS X 10_15_7' }), null);
  assert.equal(archFromSignals({
    userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
    renderer: 'Apple GPU',
  }), null);
});

test('download selection stays compatible with empty arrays and https-only arch files', () => {
  assert.deepEqual(selectDownloads([], 'arm64'), []);
  assert.deepEqual(selectDownloads(undefined, null), []);
  assert.deepEqual(validateManifest(empty), []);
  assert.ok(validateManifest({
    macos: [{ label: 'Nope', url: 'http://example.com/a.dmg' }],
    windows: [],
    linux: [],
  }).some((error) => error.includes('https')));

  const linux = [
    { label: 'AppImage (x64)', url: 'https://example.com/app.AppImage', arch: 'x64' },
    { label: 'Debian (x64)', url: 'https://example.com/app_amd64.deb', arch: 'amd64' },
    { label: 'AppImage (arm64)', url: 'https://example.com/app-arm64.AppImage', arch: 'arm64' },
    { label: 'Secret', url: 'https://user:pass@example.com/nope', arch: 'arm64' },
    { label: 'Local', url: 'http://127.0.0.1/nope', arch: 'arm64' },
  ];
  assert.deepEqual(selectDownloads(linux, 'arm64').map((entry) => entry.label), ['AppImage (arm64)']);
  assert.deepEqual(selectDownloads(linux, 'x64').map((entry) => entry.label), ['AppImage (x64)', 'Debian (x64)']);
  assert.equal(selectDownloads(linux, null).length, 3);

  const mac = [
    { label: 'macOS · Universal', url: 'https://example.com/universal.dmg' },
    { label: 'macOS · Apple Silicon', url: 'https://example.com/arm.dmg', arch: 'apple-silicon' },
    { label: 'macOS · Intel', url: 'https://example.com/intel.dmg', arch: 'intel' },
  ];
  assert.deepEqual(selectDownloads(mac, 'arm64').map((entry) => entry.label), ['macOS · Apple Silicon']);
  assert.deepEqual(selectDownloads(mac, null).map((entry) => entry.label), ['macOS · Universal']);
  assert.deepEqual(selectDownloads([
    { label: 'macOS · Apple Silicon', url: 'https://example.com/arm.dmg', arch: 'arm64' },
    { label: 'macOS · Intel', url: 'https://example.com/intel.dmg', arch: 'x64' },
  ], 'ia64').map((entry) => entry.label), ['macOS · Apple Silicon', 'macOS · Intel']);

  const release = (name) => `https://github.com/acme/tokengotchi/releases/download/v9.9.9/${name}`;
  assert.equal(checksumUrl(empty), null);
  assert.equal(checksumUrl({
    macos: [{ label: 'A', url: release('a.dmg'), arch: 'arm64' }],
    windows: [{ label: 'B', url: 'https://example.com/b.zip', arch: 'x64' }],
    linux: [],
  }), null);
  assert.equal(checksumUrl({
    macos: [{ label: 'A', url: release('a.dmg') }],
    windows: [{ label: 'B', url: 'https://github.com/other/tokengotchi/releases/download/v9.9.9/b.zip' }],
    linux: [],
  }), null);
  assert.equal(checksumUrl({
    macos: [{ label: 'A', url: 'https://github.com/acme/tokengotchi/releases/download/v1/a.dmg' }],
    windows: [{ label: 'B', url: 'https://github.com/acme/tokengotchi/releases/download/v2/b.zip' }],
    linux: [],
  }), null);
  assert.equal(checksumUrl({
    macos: [{ label: 'A', url: release('Tokengotchi-arm64.dmg') }],
    windows: [{ label: 'B', url: release('Tokengotchi-win.zip') }],
    linux: [{ label: 'C', url: release('tokengotchi_amd64.deb') }],
  }), 'https://github.com/acme/tokengotchi/releases/download/v9.9.9/SHA256SUMS');
  assert.equal(checksumUrl({
    macos: [{
      label: 'A',
      url: release('a.dmg'),
      secondary: { url: release('a-mac.zip') },
    }],
    windows: [],
    linux: [],
  }), 'https://github.com/acme/tokengotchi/releases/download/v9.9.9/SHA256SUMS');
  assert.equal(checksumUrl({
    macos: [{
      label: 'A',
      url: release('a.dmg'),
      secondary: { url: 'https://github.com/acme/tokengotchi/releases/download/v0.0.1/a.zip' },
    }],
    windows: [],
    linux: [],
  }), null);
  assert.ok(validateManifest({
    macos: [{ label: 'A', url: 'https://example.com/a.dmg', secondary: { url: 'http://example.com/a.zip' } }],
    windows: [],
    linux: [],
  }).some((error) => error.includes('secondary')));
});

test('required lines stay in both languages and avoid a paid tier', () => {
  assert.equal(copy.en.heroTitleHtml.includes('Your tokens.'), true);
  assert.match(copy.en.heroTitleHtml, /A little <em>life\.<\/em>/);
  assert.equal(copy.en.heroSub, 'A pixel pet that lives on your desktop and feeds on your AI usage. You build things. It grows up.');
  assert.equal(copy.en.freeLine, 'Free');
  assert.equal(copy.en.ui.heroCta, 'Download');
  assert.equal(copy.en.ui.ctaFor, 'Download for {os}');
  assert.equal(copy.en.ui.ctaMobile, 'Get it on your computer');
  assert.equal(copy.en.feedTitleHtml, 'You do your thing.<br>It does its little thing.');
  assert.match(copy.en.feed3Body, /Output tokens count more than cached ones/);
  assert.match(copy.en.livesBody, /Disappear for more than about 3½ days and it dies/);
  assert.equal(copy.en.privTitle, 'Your work stays yours.');
  assert.equal(copy.en.privBody, 'Tokengotchi makes one kind of network request: a daily check for a new version at downloads.tokengotchi.app (served by Cloudflare). It sends only your app version, and Cloudflare sees your IP. Nothing about your pet or your usage is sent. Turn it off with <code>"updates": { "enabled": false }</code> in <code>sources.json</code>. The app also listens on 127.0.0.1 only, password-protected and never reachable from the network, so local hooks can feed your pet. Set <code>ingest.enabled</code> to false to turn that off.');
  assert.equal(copy.en.trustHtml, '<strong>Stays on your machine.</strong> Nothing about your pet or your usage is sent. The only network call is a daily version check at downloads.tokengotchi.app, and you can turn it off.');
  assert.equal(copy.en.privNetBody, 'A daily check for a new version at downloads.tokengotchi.app. It sends only your app version, and Cloudflare sees your IP. Turn it off with <code>"updates": { "enabled": false }</code> in <code>sources.json</code>.');
  assert.match(copy.en.privStaysBody, /127\.0\.0\.1 only, password-protected/);
  assert.match(copy.en.privStaysBody, /<code>ingest\.enabled<\/code>/);
  assert.equal(copy.en.privReadsBodyHtml, 'Tokengotchi reads nothing until you turn a source on in the menu: Claude Code, Codex CLI, Grok CLI or Cursor. It reads token counts from local logs, never their text. Cursor doesn\'t log tokens, so Tokengotchi estimates them from how often Cursor\'s files change, without opening them.');
  assert.equal(copy.en.navHow, 'How it works');
  assert.equal(copy.en.navEvolution, 'Evolution');
  assert.equal(copy.en.navDownload, 'Download');
  assert.equal(copy.en.footerTag, 'Built with tokens. Raised with love.');
  assert.equal(copy.en.ui.comingSoon, 'Public downloads for {os} are coming soon.');

  assert.match(copy.pt.heroTitleHtml, /Seus tokens\./);
  assert.match(copy.pt.heroTitleHtml, /<em>pequenina\.<\/em>/);
  assert.equal(copy.pt.heroSub, 'Um bichinho pixelado que mora na sua tela e se alimenta do que você gasta com IA. Você cria. Ele cresce.');
  assert.equal(copy.pt.freeLine, 'Grátis');
  assert.equal(copy.pt.ui.heroCta, 'Baixar');
  assert.equal(copy.pt.ui.ctaFor, 'Baixar para {os}');
  assert.equal(copy.pt.ui.ctaMobile, 'Baixe no computador');
  assert.equal(copy.pt.feedTitleHtml, 'Você faz a sua parte.<br>Ele faz a dele.');
  assert.match(copy.pt.livesBody, /Se sumir por mais de uns 3 dias e meio, ele morre/);
  assert.equal(copy.pt.privTitle, 'Seu trabalho fica com você.');
  assert.equal(copy.pt.privBody, 'O Tokengotchi faz um único tipo de chamada de rede: uma checagem diária de versão nova em downloads.tokengotchi.app (servido pela Cloudflare). Ele envia só a versão do app, e a Cloudflare vê o seu IP. Nada do bichinho nem do seu uso é enviado. Desligue com <code>"updates": { "enabled": false }</code> no <code>sources.json</code>. O app também escuta só em 127.0.0.1, protegido por senha e nunca alcançável pela rede, para que hooks locais possam alimentar o bichinho. Para desligar, deixe <code>ingest.enabled</code> como false.');
  assert.equal(copy.pt.trustHtml, '<strong>Fica na sua máquina.</strong> Nada do bichinho nem do seu uso é enviado. A única chamada de rede é uma checagem diária de versão em downloads.tokengotchi.app, e dá para desligar.');
  assert.equal(copy.pt.privNetBody, 'Uma checagem diária de versão nova em downloads.tokengotchi.app. Ele envia só a versão do app, e a Cloudflare vê o seu IP. Desligue com <code>"updates": { "enabled": false }</code> no <code>sources.json</code>.');
  assert.match(copy.pt.privStaysBody, /127\.0\.0\.1/);
  assert.match(copy.pt.privStaysBody, /<code>ingest\.enabled<\/code>/);
  assert.match(copy.pt.privReadsBodyHtml, /Claude Code, Codex CLI, Grok CLI ou Cursor/);
  assert.match(copy.pt.privReadsBodyHtml, /sem abri-los/);
  assert.equal(copy.pt.navHow, 'Como funciona');
  assert.equal(copy.pt.navEvolution, 'Evolução');
  assert.equal(copy.pt.navDownload, 'Baixar');
  assert.equal(copy.pt.footerTag, 'Feito com tokens. Criado com carinho.');
  assert.equal(copy.pt.ui.comingSoon, 'Os downloads públicos para {os} chegam em breve.');
  assert.match(copy.pt.evoIntro, /19 níveis/);
  assert.match(copy.pt.evoIntro, /9 formas/);

  const blob = JSON.stringify(copy).toLowerCase();
  assert.doesNotMatch(blob, /premium|pricing/);
  assert.doesNotMatch(blob, /github/);
  assert.deepEqual(Object.keys(copy.en).sort(), Object.keys(copy.pt).sort());
  assert.deepEqual(Object.keys(copy.en.ui).sort(), Object.keys(copy.pt.ui).sort());
  assert.deepEqual(Object.keys(copy.en.ui.detail).sort(), Object.keys(copy.pt.ui.detail).sort());
  assert.doesNotMatch(blob, /appimage/);
  assert.doesNotMatch(blob, /installer|instalador/);
  assert.match(copy.en.ui.detail.windows, /A \.zip\. Extract it and run Tokengotchi\.exe/);
  assert.match(copy.en.ui.detail.windows, /More info/);
  assert.match(copy.en.ui.detail.windows, /Run anyway/);
  assert.match(copy.en.ui.detail.windows_x64, /For 64-bit Windows\. A \.zip/);
  assert.match(copy.en.ui.detail.windows_arm64, /For Windows on ARM\. A \.zip/);
  assert.match(copy.en.ui.detail.linux, /A \.deb package for amd64 and arm64 \(Debian\/Ubuntu\)/);
  assert.match(copy.en.ui.detail.linux_x64, /For 64-bit Linux\. A \.deb package/);
  assert.match(copy.en.ui.detail.linux_arm64, /For ARM Linux\. A \.deb package/);
  assert.match(copy.en.ui.detail.macos, /ad-hoc signed and not notarized/);
  assert.match(copy.en.ui.detail.macos, /right-click \(or Control-click\)/);
  assert.match(copy.en.ui.detail.macos, /Open Anyway/);
  assert.match(copy.en.ui.detail.macos, /On macOS 14 \(Sonoma\) or earlier, right-click \(or Control-click\)/);
  assert.match(copy.en.ui.detail.macos, /first try to open the app, choose "Done"/);
  assert.match(copy.en.ui.detail.macos_arm64, /For Apple Silicon\. The app is ad-hoc signed/);
  assert.match(copy.en.ui.detail.macos_x64, /For Intel Macs\. The app is ad-hoc signed/);
  assert.match(copy.en.ui.detail.windows, /SmartScreen may warn/);
  assert.match(copy.pt.ui.detail.windows, /É um arquivo \.zip\. Extraia e execute Tokengotchi\.exe/);
  assert.match(copy.pt.ui.detail.windows, /Mais informações/);
  assert.match(copy.pt.ui.detail.windows, /Executar assim mesmo/);
  assert.match(copy.pt.ui.detail.windows, /pode avisar/);
  assert.match(copy.pt.ui.detail.linux, /Pacote \.deb para amd64 e arm64 \(Debian\/Ubuntu\)/);
  assert.match(copy.pt.ui.detail.macos, /assinado ad-hoc e não é notarizado/);
  assert.match(copy.pt.ui.detail.macos, /No macOS 14 \(Sonoma\) ou anterior, clique com o botão direito \(ou segure Control e clique\)/);
  assert.match(copy.pt.ui.detail.macos, /Abrir Mesmo Assim/);
  assert.match(copy.pt.ui.detail.macos, /primeiro tente abrir o app, escolha "Concluído"/);
  assert.equal(copy.en.ui.zipAlt, 'Or download the .zip');
  assert.equal(copy.pt.ui.zipAlt, 'Ou baixe o .zip');
  assert.equal(copy.en.ui.checksum, 'Verify downloads (SHA256SUMS)');
  assert.equal(copy.pt.ui.checksum, 'Conferir os downloads (SHA256SUMS)');
  assert.equal(copy.en.ui.checksumNote, 'SHA256SUMS is published in the same release, so it detects corrupted downloads, not a compromised release.');
  assert.equal(copy.pt.ui.checksumNote, 'O SHA256SUMS é publicado no mesmo release, então detecta downloads corrompidos, não um release comprometido.');
  assert.doesNotMatch(blob, /tokengotchi_\*/);
  assert.doesNotMatch(blob, /\*\.deb/);
  assert.match(renderNoscript('pt', empty), /Os downloads públicos chegam em breve/);
  assert.doesNotMatch(renderNoscript('en', empty), /https?:/);
  assert.match(renderDownloadResult('en', empty), /Public downloads for macOS are coming soon/);
});

test('build writes locale trees, shared assets, and per-locale SEO', async () => {
  await build();
  const en = await readFile(new URL('./dist/en/index.html', import.meta.url), 'utf8');
  const pt = await readFile(new URL('./dist/pt/index.html', import.meta.url), 'utf8');
  const root = await readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('./dist/downloads.json', import.meta.url), 'utf8'));

  assert.match(en, /<html lang="en"/);
  assert.match(pt, /<html lang="pt-BR"/);
  assert.match(en, /rel="canonical" href="https:\/\/tokengotchi\.app\/en\/"/);
  assert.match(pt, /rel="canonical" href="https:\/\/tokengotchi\.app\/pt\/"/);
  for (const html of [en, pt]) {
    assert.match(html, /hreflang="en" href="https:\/\/tokengotchi\.app\/en\/"/);
    assert.match(html, /hreflang="pt" href="https:\/\/tokengotchi\.app\/pt\/"/);
    assert.match(html, /hreflang="x-default" href="https:\/\/tokengotchi\.app\/en\/"/);
    assert.match(html, /href="\/styles\.css"/);
    assert.match(html, /src="\/app\.js"/);
    assert.match(html, /src="\/assets\/evolucao\.png"/);
    assert.match(html, /src="\/assets\/estagio-adulto\.png"/);
    assert.match(html, /src="\/assets\/humor-feliz\.png"/);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.match(html, /aria-label="EN, English"/);
    assert.match(html, /aria-label="PT, Português"/);
  }
  assert.match(en, /Your tokens\./);
  assert.match(pt, /Seus tokens\./);
  assert.match(root, /tokengotchi_locale/);
  assert.match(root, /noindex/);

  const assets = ['macos', 'windows', 'linux'].flatMap((os) => manifest[os]);
  assert.deepEqual(manifest.macos.map((entry) => entry.arch).sort(), ['arm64', 'x64']);
  assert.ok(manifest.macos.every((entry) => entry.url.endsWith('.dmg')));
  assert.deepEqual(manifest.windows.map((entry) => entry.arch).sort(), ['arm64', 'x64']);
  assert.ok(manifest.windows.every((entry) => entry.url.endsWith('.zip')));
  assert.deepEqual(manifest.linux.map((entry) => entry.arch).sort(), ['arm64', 'x64']);
  assert.ok(manifest.linux.every((entry) => entry.url.endsWith('.deb')));
  assert.equal(assets.filter((entry) => entry.url.endsWith('.AppImage') || entry.url.endsWith('.exe')).length, 0);
  assert.equal(manifest.linux.filter((entry) => entry.url.includes('amd64') && entry.url.endsWith('.deb')).length, 1);
  assert.equal(manifest.linux.filter((entry) => entry.arch === 'arm64' && entry.url.endsWith('.deb')).length, 1);

  const sums = checksumUrl(manifest);
  assert.ok(sums && sums.endsWith('/SHA256SUMS'));
  assert.equal(new Set(assets.map((entry) => entry.url.slice(0, entry.url.lastIndexOf('/')))).size, 1);
  for (const html of [en, pt]) {
    for (const entry of assets) assert.ok(html.includes(entry.url));
    assert.ok(html.includes(sums));
    assert.doesNotMatch(html, /AppImage/);
    assert.doesNotMatch(html, /universal\.dmg/i);
    assert.doesNotMatch(html, /installer|instalador/i);
  }
  assert.match(en, /Download macOS · Apple Silicon/);
  assert.match(en, /Download macOS · Intel/);
  assert.match(pt, /Baixar macOS · Apple Silicon/);
  assert.match(pt, /Baixar macOS · Intel/);
  assert.match(en, /Verify downloads \(SHA256SUMS\)/);
  assert.match(pt, /Conferir os downloads \(SHA256SUMS\)/);
  assert.match(en, /SHA256SUMS is published in the same release/);
  assert.match(pt, /O SHA256SUMS é publicado no mesmo release/);
  assert.match(en, /class="checksum-note"/);
  assert.match(pt, /class="checksum-note"/);
  assert.doesNotMatch(en, /#verify/);
  assert.doesNotMatch(pt, /#verify/);
  assert.match(en, /ad-hoc signed and not notarized/);
  assert.match(en, /On macOS 14 \(Sonoma\) or earlier/);
  assert.match(en, /first try to open the app/);
  assert.match(pt, /assinado ad-hoc e não é notarizado/);
  assert.match(pt, /No macOS 14 \(Sonoma\) ou anterior/);
  assert.match(pt, /segure Control e clique/);
  assert.match(pt, /pode avisar/);
  assert.doesNotMatch(en, /tokengotchi_\*\.deb/);
  assert.doesNotMatch(pt, /tokengotchi_\*\.deb/);
  assert.doesNotMatch(en, /<version>|&lt;version&gt;|\\u003cversion/);
  assert.doesNotMatch(pt, /<version>|&lt;version&gt;|\\u003cversion/);
  assert.match(en, /106\.6 MB/);
  assert.match(pt, /106,6 MB/);
  assert.match(en, /class="help help-windows" data-help="windows">/);
  assert.match(en, /class="help help-linux" data-help="linux">/);
  assert.match(en, /<noscript><style>\.os-tabs\{display:none\}\.help-os\{display:block\}<\/style><\/noscript>/);
  assert.match(en, /More info/);
  assert.match(en, /sudo apt install \.\//);
  assert.match(en, /Oct 12, 2026/);
  assert.match(pt, /12 out\. 2026/);
  assert.match(en, /Tokengotchi-0\.5\.3-arm64\.dmg/);
  assert.match(en, /Tokengotchi-0\.5\.3-x64\.dmg/);
  assert.match(en, /Tokengotchi-0\.5\.3-arm64-mac\.zip/);
  assert.match(en, /Tokengotchi-0\.5\.3-x64-mac\.zip/);
  assert.match(pt, /Tokengotchi-0\.5\.3-arm64-mac\.zip/);
  assert.match(pt, /Tokengotchi-0\.5\.3-x64-mac\.zip/);
  assert.match(en, /Tokengotchi-0\.5\.3-win\.zip/);
  assert.match(en, /Tokengotchi-0\.5\.3-arm64-win\.zip/);
  assert.match(en, /tokengotchi_0\.5\.3_amd64\.deb/);
  assert.match(en, /tokengotchi_0\.5\.3_arm64\.deb/);
  assert.match(en, /Or download the \.zip/);
  assert.match(pt, /Ou baixe o \.zip/);
  assert.match(en, /106\.4 MB/);
  assert.match(pt, /106,4 MB/);
  assert.match(en, /111\.4 MB/);
  assert.match(pt, /111,4 MB/);
  assert.match(en, /sudo apt install \.\/tokengotchi_0\.5\.3_amd64\.deb/);
  assert.match(en, /sudo apt install \.\/tokengotchi_0\.5\.3_arm64\.deb/);
  assert.doesNotMatch(en, /v0\.5\.2/);
  assert.doesNotMatch(pt, /v0\.5\.2/);
  assert.doesNotMatch(en, /\.rpm|AppImage|Setup/i);
  assert.doesNotMatch(pt, /\.rpm|AppImage|Setup/i);
  assert.doesNotMatch(en, /fonts\.googleapis\.com/);
  assert.doesNotMatch(pt, /fonts\.googleapis\.com/);
  const css = await readFile(new URL('./dist/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  assert.match(css, /image-rendering:\s*crisp-edges;\s*image-rendering:\s*pixelated/);
  assert.doesNotMatch(css, /data-locale=.pt.[\s\S]*font-size/);
  assert.match(en, /Not sure\? Apple menu &gt; About This Mac/);
  assert.match(pt, /Não tem certeza\? Menu Apple &gt; Sobre este Mac/);
  for (const html of [en, pt]) {
    assert.doesNotMatch(html, /\?token=/);
    for (const url of htmlDownloadUrls(html)) assertPublicReleaseAsset(url);
  }
  for (const url of manifestDownloadUrls(manifest)) assertPublicReleaseAsset(url);

  await assert.rejects(access(new URL('./dist/en/downloads.json', import.meta.url)));
  await assert.rejects(access(new URL('./dist/pt/assets/estagio-ovo.png', import.meta.url)));
  await access(new URL('./dist/assets/og.png', import.meta.url));
  await access(new URL('./dist/assets/PixelifySans-subset.woff2', import.meta.url));
  await access(new URL('./dist/assets/OFL-PixelifySans.txt', import.meta.url));
  await access(new URL('./dist/downloads-logic.mjs', import.meta.url));
  await access(new URL('./dist/inline-code.mjs', import.meta.url));
  await access(new URL('./dist/language-switch.mjs', import.meta.url));

  const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(appSource, /createLanguageSwitchHash/);
  assert.doesNotMatch(appSource, /url\.hash = location\.hash/);
  for (const html of [en, pt]) {
    assert.doesNotMatch(visiblePageText(html), /\bmit\b|licen/i);
    assert.match(html, /© <span id="year">/);
    assert.doesNotMatch(html, /View on GitHub|Ver no GitHub/);
    assert.doesNotMatch(html, /Open source|Código aberto|open source|código aberto/);
    assert.doesNotMatch(html, /Read every line on GitHub|Leia cada linha no GitHub/);
    assert.doesNotMatch(html, /GitHub/);
    assert.match(html, /<code>"updates": \{ "enabled": false \}<\/code>/);
    assert.match(html, /<code>ingest\.enabled<\/code>/);
    assert.match(html, /downloads\.tokengotchi\.app/);
    assert.doesNotMatch(html, /<dt>Source<\/dt>|<dt>Código<\/dt>/);
    assert.doesNotMatch(html, /href="https:\/\/github\.com\/vitorjpr\/tokengotchi"/);
    assert.doesNotMatch(html, /releases\/tag\//);
    assert.doesNotMatch(html, /M8 0a8 8 0 0 0-2\.53 15\.59/);
    assert.match(html, /href="\/en\/" hreflang="en"/);
    assert.match(html, /href="\/pt\/" hreflang="pt"/);
    assert.doesNotMatch(html, /href="\/(?:en|pt)\/#/);
    assert.match(html, /releases\/download\/v0\.5\.3\/SHA256SUMS/);
  }
});

test('apt commands use the deb basename and fall back without a placeholder', () => {
  const release = (name) => `https://github.com/vitorjpr/tokengotchi/releases/download/v0.5.1/${name}`;
  const manifest = {
    linux: [
      { label: 'Debian (x64)', url: release('tokengotchi_0.5.1_amd64.deb'), arch: 'x64' },
      { label: 'Debian (arm64)', url: release('tokengotchi_0.5.1_arm64.deb'), arch: 'arm64' },
    ],
  };
  assert.deepEqual(aptInstallCommands(manifest.linux), [
    'sudo apt install ./tokengotchi_0.5.1_amd64.deb',
    'sudo apt install ./tokengotchi_0.5.1_arm64.deb',
  ]);
  assert.deepEqual(aptInstallCommands([{ url: release('tokengotchi_<version>_amd64.deb') }]), []);
  assert.deepEqual(aptInstallCommands([{ url: release('not safe.deb') }]), []);
  assert.deepEqual(aptInstallCommands([{
    label: 'Debian (x64)',
    url: release('tokengotchi_0.5.1_arm64.deb'),
    arch: 'x64',
  }]), []);
  assert.deepEqual(aptInstallPlans([{
    label: 'Debian (arm64)',
    url: release('tokengotchi_0.5.1_amd64.deb'),
    arch: 'arm64',
  }]), []);
  const rejected = [
    release('tokengotchi_0.5.1_amd64.deb%3Brm'),
    release('tokengotchi_0.5.1_amd64.deb;rm'),
    release('a$(rm).deb'),
    release('a`rm`.deb'),
    release('tokengotchi_0.5.1_amd64.deb%0A'),
    release('tokengotchi_0.5.1_amd\n64.deb'),
    release('tokengotchi_0.5.1_amd64.deb\n'),
    release('my file.deb'),
    release('a|b.deb'),
    release('a&b.deb'),
    release('a\'b.deb'),
    release('a"b.deb'),
    release('tokengotchi_0.5.1_amd64.deb%20x'),
    'https://example.com/tokengotchi_0.5.1_amd64.deb',
    'http://github.com/vitorjpr/tokengotchi/releases/download/v0.5.1/tokengotchi_0.5.1_amd64.deb',
    'https://github.com/acme/tokengotchi/releases/download/v0.5.1/tokengotchi_0.5.1_amd64.deb',
    'https://github.com/vitorjpr/other/releases/download/v0.5.1/tokengotchi_0.5.1_amd64.deb',
    'https://github.com/vitorjpr/tokengotchi/archive/v0.5.1/tokengotchi_0.5.1_amd64.deb',
  ];
  for (const url of rejected) {
    assert.deepEqual(aptInstallCommands([{ url }]), [], url);
    assert.equal(
      linuxDetail(copy.en.ui, [{ label: 'Debian (x64)', url, arch: 'x64' }]),
      copy.en.ui.detail.linux_x64,
      url,
    );
  }

  for (const locale of ['en', 'pt']) {
    const page = copy[locale].ui;
    const both = linuxDetail(page, manifest.linux);
    const codes = inlineCodeSegments(both).filter((part) => part.code).map((part) => part.value);
    assert.deepEqual(codes, [
      'sudo apt install ./tokengotchi_0.5.1_amd64.deb',
      'sudo apt install ./tokengotchi_0.5.1_arm64.deb',
    ]);
    assert.doesNotMatch(both, /[<>]/);
    const x64 = linuxDetail(page, [manifest.linux[0]]);
    assert.deepEqual(inlineCodeSegments(x64).filter((part) => part.code).map((part) => part.value), [
      'sudo apt install ./tokengotchi_0.5.1_amd64.deb',
    ]);
    assert.match(x64, locale === 'en' ? /For 64-bit Linux/ : /Para Linux de 64 bits/);
    const arm = linuxDetail(page, [manifest.linux[1]]);
    assert.deepEqual(inlineCodeSegments(arm).filter((part) => part.code).map((part) => part.value), [
      'sudo apt install ./tokengotchi_0.5.1_arm64.deb',
    ]);

    for (const missing of [undefined, null, [], {}]) {
      const fallback = linuxDetail(page, missing);
      assert.equal(fallback, page.detail.linux);
      assert.doesNotMatch(fallback, /[<>]/);
      assert.doesNotMatch(fallback, /<version>|&lt;version&gt;|\bversion\b/i);
      const fallbackCodes = inlineCodeSegments(fallback).filter((part) => part.code).map((part) => part.value);
      assert.deepEqual(fallbackCodes, ['sudo apt install ./']);
    }
    assert.equal(linuxDetail(page, [{ label: 'Nope', url: release('tokengotchi_<version>_amd64.deb'), arch: 'x64' }]), page.detail.linux_x64);
    assert.doesNotMatch(JSON.stringify(page), /<version>|&lt;version&gt;/);
  }
  assert.doesNotMatch(JSON.stringify(copy), /<version>|&lt;version&gt;/);

  const sample = renderChecksum('en', {
    macos: [{ label: 'A', url: 'https://github.com/acme/tokengotchi/releases/download/v9.9.9/a.dmg' }],
    windows: [{ label: 'B', url: 'https://github.com/acme/tokengotchi/releases/download/v9.9.9/b.zip' }],
    linux: [{ label: 'C', url: 'https://github.com/acme/tokengotchi/releases/download/v9.9.9/c.deb' }],
  });
  assert.match(sample, /<p class="download-verify"><a href="https:\/\/github.com\/acme\/tokengotchi\/releases\/download\/v9\.9\.9\/SHA256SUMS">/);
  assert.match(sample, /<p class="checksum-note">SHA256SUMS is published in the same release/);
  assert.doesNotMatch(sample, /href="[^"]+#/);
  assert.equal(renderChecksum('en', empty), '');
});

test('every architecture stays listed, and size and date render only when present', async () => {
  const manifest = JSON.parse(await readFile(new URL('./downloads.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateManifest(manifest), []);
  const commands = aptInstallCommands(manifest.linux);
  assert.equal(commands.length, manifest.linux.length);
  manifest.linux.forEach((entry, index) => {
    assert.equal(commands[index], `sudo apt install ./${entry.url.split('/').pop()}`);
  });
  const sentence = linuxDetail(copy.en.ui, manifest.linux);
  for (const command of commands) assert.ok(sentence.includes(command), command);
  assert.doesNotMatch(sentence, /<version>/);

  // Bytes from the GitHub release API for the tag named in these URLs.
  const armMac = manifest.macos.find((entry) => entry.arch === 'arm64');
  const intelMac = manifest.macos.find((entry) => entry.arch === 'x64');
  assert.equal(armMac.size, 106567851);
  assert.equal(armMac.secondary.size, 106382685);
  assert.equal(intelMac.size, 111548180);
  assert.equal(intelMac.secondary.size, 111400623);
  assert.equal(manifest.windows.find((entry) => entry.arch === 'x64').size, 134000219);
  assert.equal(manifest.windows.find((entry) => entry.arch === 'arm64').size, 130525238);
  assert.equal(manifest.linux.find((entry) => entry.arch === 'x64').size, 91131772);
  assert.equal(manifest.linux.find((entry) => entry.arch === 'arm64').size, 84666528);
  assert.ok(manifest.macos.every((entry) => entry.url.endsWith('.dmg')));
  assert.ok(manifest.macos.every((entry) => entry.secondary.url.endsWith('-mac.zip')));
  assert.equal(manifest.windows.some((entry) => entry.url.endsWith('.exe')), false);
  assert.equal(manifest.linux.some((entry) => /\.(AppImage|rpm)$/.test(entry.url)), false);

  for (const os of ['macos', 'windows', 'linux']) {
    const all = listDownloads(manifest[os]);
    assert.deepEqual(all.map((entry) => entry.arch).sort(), ['arm64', 'x64']);
    assert.equal(selectDownloads(manifest[os], 'arm64').length, 1);
    const view = downloadView(manifest, os, {
      detectedOs: os,
      cpuArch: 'arm64',
      locale: 'en',
      ui: copy.en.ui,
    });
    assert.equal(view.files.length, 2);
    assert.equal(view.files[0].arch, 'arm64');
    assert.equal(view.files.filter((file) => file.badge).length, 1);
    assert.ok(view.files.every((file) => file.sizeText));
  }

  const tag = manifest.macos[0].url.split('/').at(-2);
  assert.equal(releaseTag(manifest), tag);
  assert.equal(formatSize(106564099, 'en'), '106.6 MB');
  assert.equal(formatSize(106564099, 'pt'), '106,6 MB');
  assert.equal(formatSize(111547831, 'en'), '111.5 MB');
  assert.equal(formatReleaseDate('2026-10-08', 'en'), 'Oct 8, 2026');
  assert.equal(formatReleaseDate('2026-10-08', 'pt'), '8 out. 2026');
  assert.equal(formatReleaseDate(manifest.released, 'en'), 'Oct 12, 2026');
  assert.equal(formatReleaseDate(manifest.released, 'pt'), '12 out. 2026');
  assert.equal(formatSize(106567851, 'en'), '106.6 MB');
  assert.equal(formatSize(106382685, 'en'), '106.4 MB');
  assert.equal(formatSize(106382685, 'pt'), '106,4 MB');
  assert.equal(formatSize(111400623, 'en'), '111.4 MB');
  assert.equal(formatSize(134000219, 'en'), '134.0 MB');
  assert.equal(formatSize(130525238, 'en'), '130.5 MB');
  assert.equal(formatSize(91131772, 'en'), '91.1 MB');
  assert.equal(formatSize(84666528, 'pt'), '84,7 MB');

  const macFiles = downloadView(manifest, 'macos', { locale: 'en', ui: copy.en.ui });
  const armFile = macFiles.files.find((file) => file.arch === 'arm64');
  assert.equal(armFile.name, 'Tokengotchi-0.5.3-arm64.dmg');
  assert.equal(armFile.sizeText, '106.6 MB');
  assert.equal(armFile.secondary.name, 'Tokengotchi-0.5.3-arm64-mac.zip');
  assert.equal(armFile.secondary.sizeText, '106.4 MB');
  assert.equal(armFile.secondary.text, copy.en.ui.zipAlt);
  const ptMac = downloadView(manifest, 'macos', { locale: 'pt', ui: copy.pt.ui });
  const intelFile = ptMac.files.find((file) => file.arch === 'x64');
  assert.equal(intelFile.secondary.sizeText, '111,4 MB');
  assert.equal(intelFile.secondary.text, copy.pt.ui.zipAlt);
  const macHero = heroAction({
    detectedOs: 'macos',
    cpuArch: 'arm64',
    manifest,
    ui: copy.en.ui,
    locale: 'en',
  });
  assert.equal(macHero.kind, 'file');
  assert.equal(macHero.href, armMac.url);
  assert.match(macHero.href, /Tokengotchi-0\.5\.3-arm64\.dmg$/);
  assert.equal(macHero.sizeText, '106.6 MB');

  const bare = {
    macos: [{ label: 'macOS · Apple Silicon', url: 'https://example.com/a.dmg', arch: 'arm64' }],
    windows: [{ label: 'Windows · x64 (zip)', url: 'https://example.com/b.zip', arch: 'x64' }],
    linux: [],
  };
  assert.deepEqual(validateManifest(bare), []);
  const bareView = downloadView(bare, 'macos', { locale: 'en', ui: copy.en.ui });
  assert.equal(bareView.files[0].sizeText, null);
  assert.equal(bareView.released, null);
  assert.equal(bareView.tag, null);
  assert.equal(formatSize(undefined, 'en'), null);
  assert.equal(formatReleaseDate(undefined, 'en'), null);
  assert.ok(validateManifest({ ...bare, released: '2026-13-01' }).some((error) => error.includes('released')));
  assert.ok(validateManifest({
    macos: [{ label: 'A', url: 'https://example.com/a.dmg', size: 1.5 }],
    windows: [],
    linux: [],
  }).some((error) => error.includes('size')));
  assert.equal(listDownloads(bare.macos).length, 1);
  assert.equal(listDownloads(bare.windows).length, 1);
});

test('phones get a computer path and desktops link the detected file', () => {
  const manifest = {
    macos: [
      { label: 'macOS · Apple Silicon', url: 'https://example.com/arm.dmg', arch: 'arm64', size: 106564099 },
      { label: 'macOS · Intel', url: 'https://example.com/intel.dmg', arch: 'x64', size: 111547831 },
    ],
    windows: [],
    linux: [],
  };
  const phone = heroAction({ detectedOs: null, cpuArch: 'arm64', manifest, ui: copy.en.ui, locale: 'en' });
  assert.equal(phone.kind, 'mobile');
  assert.equal(phone.href, '#download');
  assert.equal(phone.text, copy.en.ui.ctaMobile);
  const ptPhone = heroAction({ detectedOs: null, manifest, ui: copy.pt.ui, locale: 'pt' });
  assert.equal(ptPhone.text, copy.pt.ui.ctaMobile);
  assert.equal(ptPhone.href, '#download');

  const mac = heroAction({ detectedOs: 'macos', cpuArch: 'x64', manifest, ui: copy.en.ui, locale: 'en' });
  assert.equal(mac.kind, 'file');
  assert.equal(mac.href, 'https://example.com/intel.dmg');
  assert.equal(mac.text, 'Download for macOS');
  assert.equal(mac.sizeText, '111.5 MB');
  assert.equal(
    heroMetaLine({ detectedOs: 'macos', cpuArch: 'arm64', manifest, ui: copy.en.ui, locale: 'en' }),
    'Apple Silicon · 106.6 MB · Free',
  );
  const unknown = heroAction({ detectedOs: 'macos', cpuArch: null, manifest, ui: copy.en.ui, locale: 'en' });
  assert.equal(unknown.kind, 'choose');
  assert.equal(unknown.href, '#download');
  assert.equal(unknown.text, 'Download for macOS');
  assert.equal(
    heroMetaLine({ detectedOs: 'macos', cpuArch: null, manifest, ui: copy.en.ui, locale: 'en' }),
    'Free',
  );
  const both = downloadView(manifest, 'macos', { detectedOs: 'macos', cpuArch: 'x64', locale: 'en', ui: copy.en.ui });
  assert.deepEqual(both.files.map((file) => file.arch), ['x64', 'arm64']);
  assert.equal(both.files.filter((file) => file.badge).length, 1);
});

test('Safari with no arch signal recommends Apple Silicon in the chooser', async () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
  const arch = archFromSignals({ userAgent: safari, renderer: 'Apple GPU' });
  assert.equal(arch, null);

  const manifest = JSON.parse(await readFile(new URL('./downloads.json', import.meta.url), 'utf8'));
  const action = heroAction({
    detectedOs: 'macos',
    cpuArch: arch,
    manifest,
    ui: copy.en.ui,
    locale: 'en',
  });
  assert.equal(action.kind, 'choose');
  assert.equal(action.href, '#download');
  assert.doesNotMatch(action.href, /arm64|\.dmg/);
  assert.equal(
    heroMetaLine({ detectedOs: 'macos', cpuArch: arch, manifest, ui: copy.en.ui, locale: 'en' }),
    'v0.5.3 · Free',
  );

  const view = downloadView(manifest, 'macos', {
    detectedOs: 'macos',
    cpuArch: arch,
    locale: 'en',
    ui: copy.en.ui,
  });
  assert.equal(view.files.length, 2);
  assert.deepEqual(view.files.map((file) => file.arch), ['arm64', 'x64']);
  assert.equal(view.files[0].recommended, true);
  assert.equal(view.files[1].recommended, false);
  assert.equal(view.files[1].archLabel, 'Intel');
  assert.equal(view.files.filter((file) => file.badge).length, 0);
  assert.equal(view.hint, 'Not sure? Apple menu > About This Mac');
  assert.ok(view.files.some((file) => file.name.endsWith('-arm64.dmg')));
  assert.ok(view.files.some((file) => file.name.endsWith('-x64.dmg')));

  assert.equal(archFromSignals({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; ARM64) AppleWebKit/537.36',
  }), 'arm64');
  assert.equal(archFromSignals({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    architecture: 'arm',
  }), 'arm64');
  assert.equal(archFromSignals({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  }), 'x64');
  assert.equal(archFromSignals({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), null);

  const windowsArm = heroAction({
    detectedOs: 'windows',
    cpuArch: 'arm64',
    manifest,
    ui: copy.en.ui,
    locale: 'en',
  });
  assert.equal(windowsArm.kind, 'file');
  assert.match(windowsArm.href, /Tokengotchi-0\.5\.3-arm64-win\.zip$/);
  assert.equal(windowsArm.sizeText, '130.5 MB');
  const windowsKnown = downloadView(manifest, 'windows', {
    detectedOs: 'windows',
    cpuArch: 'arm64',
    locale: 'en',
    ui: copy.en.ui,
  });
  assert.deepEqual(windowsKnown.files.map((file) => file.arch), ['arm64', 'x64']);
  assert.equal(windowsKnown.files.filter((file) => file.badge).length, 1);
  assert.ok(windowsKnown.files.every((file) => file.url.endsWith('.zip')));
  const windowsUnknown = downloadView(manifest, 'windows', {
    detectedOs: 'windows',
    cpuArch: null,
    locale: 'en',
    ui: copy.en.ui,
  });
  assert.deepEqual(windowsUnknown.files.map((file) => file.name), [
    'Tokengotchi-0.5.3-win.zip',
    'Tokengotchi-0.5.3-arm64-win.zip',
  ]);
  assert.equal(windowsUnknown.files.filter((file) => file.badge).length, 0);
  assert.ok(windowsUnknown.files.every((file) => file.recommended === false));
  assert.equal(windowsUnknown.hint, null);
  assert.equal(heroAction({
    detectedOs: 'windows',
    cpuArch: null,
    manifest,
    ui: copy.en.ui,
    locale: 'en',
  }).kind, 'choose');

  assert.equal(archFromSignals({ userAgent: safari, renderer: 'Apple GPU', architecture: 'arm' }), 'arm64');
  assert.equal(archFromSignals({ userAgent: safari, renderer: 'Apple GPU', architecture: 'x86' }), 'x64');
  assert.equal(archFromSignals({ userAgent: safari, renderer: 'ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)' }), 'arm64');
  assert.equal(archFromSignals({ renderer: 'Apple GPU' }), null);
  assert.equal(archFromSignals({ userAgent: safari, renderer: 'Intel(R) Iris(TM) Plus Graphics OpenGL Engine' }), 'x64');
});

const PUBLIC_RELEASE_ASSET = /^https:\/\/github\.com\/vitorjpr\/tokengotchi\/releases\/download\/[^/?#]+\/[^/?#]+$/;

function manifestDownloadUrls(manifest) {
  const urls = [];
  for (const os of ['macos', 'windows', 'linux']) {
    for (const entry of manifest?.[os] || []) {
      if (typeof entry?.url === 'string') urls.push(entry.url);
      if (typeof entry?.secondary?.url === 'string') urls.push(entry.secondary.url);
    }
  }
  return urls;
}

function htmlDownloadUrls(html) {
  const urls = [];
  for (const match of String(html).matchAll(/href="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (href.includes('/releases/download/') || href.includes('?') || /\.(?:dmg|zip|deb|exe|AppImage)(?:$|\?)/i.test(href)) {
      urls.push(href);
    }
  }
  return urls;
}

function assertPublicReleaseAsset(url) {
  assert.equal(typeof url, 'string', String(url));
  assert.doesNotMatch(url, /\?/, url);
  assert.doesNotMatch(url, /#/, url);
  assert.match(url, PUBLIC_RELEASE_ASSET, url);
  const parsed = new URL(url);
  assert.equal(parsed.search, '', url);
  assert.equal(parsed.hash, '', url);
  assert.equal(parsed.username, '', url);
  assert.equal(parsed.password, '', url);
}

test('unknown Mac recommends Apple Silicon by rule, and Windows and Linux stay equal', () => {
  assert.equal(preferredArchWhenUnknown('macos'), 'arm64');
  assert.equal(preferredArchWhenUnknown('windows'), null);
  assert.equal(preferredArchWhenUnknown('linux'), null);
  assert.equal(copy.en.ui.macArchHint, 'Not sure? Apple menu > About This Mac');
  assert.equal(copy.pt.ui.macArchHint, 'Não tem certeza? Menu Apple > Sobre este Mac');

  const release = (name) => `https://github.com/vitorjpr/tokengotchi/releases/download/v0.5.3/${name}`;
  const manifest = {
    macos: [
      { label: 'macOS · Intel', url: release('intel-first.dmg'), arch: 'x64', size: 111548180 },
      { label: 'macOS · Universal', url: release('universal.dmg') },
      { label: 'macOS · Apple Silicon', url: release('arm-last.dmg'), arch: 'arm64', size: 106567851 },
    ],
    windows: [
      { label: 'Windows · arm64 (zip)', url: release('arm-first-win.zip'), arch: 'arm64' },
      { label: 'Windows · x64 (zip)', url: release('x64-second-win.zip'), arch: 'x64' },
    ],
    linux: [
      { label: 'Debian (arm64)', url: release('arm-first_arm64.deb'), arch: 'arm64' },
      { label: 'Debian (x64)', url: release('x64-second_amd64.deb'), arch: 'x64' },
    ],
  };

  for (const locale of ['en', 'pt']) {
    const view = downloadView(manifest, 'macos', {
      detectedOs: 'macos',
      cpuArch: null,
      locale,
      ui: copy[locale].ui,
    });
    assert.deepEqual(view.files.map((file) => file.arch), ['arm64', 'x64', 'universal']);
    assert.equal(view.files[0].recommended, true);
    assert.equal(view.files[0].badge, false);
    assert.equal(view.files[0].url, release('arm-last.dmg'));
    assert.equal(view.files[1].arch, 'x64');
    assert.equal(view.files[1].archLabel, 'Intel');
    assert.equal(view.files[1].recommended, false);
    assert.equal(view.files[1].badge, false);
    assert.equal(view.files[2].recommended, false);
    assert.equal(view.hint, copy[locale].ui.macArchHint);
    const hero = heroAction({
      detectedOs: 'macos',
      cpuArch: null,
      manifest,
      ui: copy[locale].ui,
      locale,
    });
    assert.equal(hero.kind, 'choose');
    assert.equal(hero.href, '#download');
    assert.equal(hero.archLabel, null);
    assert.equal(
      heroMetaLine({ detectedOs: 'macos', cpuArch: null, manifest, ui: copy[locale].ui, locale }),
      locale === 'pt' ? 'v0.5.3 · Grátis' : 'v0.5.3 · Free',
    );
  }

  const detectedIntel = downloadView(manifest, 'macos', {
    detectedOs: 'macos',
    cpuArch: 'x64',
    locale: 'en',
    ui: copy.en.ui,
  });
  assert.deepEqual(detectedIntel.files.map((file) => file.arch), ['x64', 'universal', 'arm64']);
  assert.equal(detectedIntel.files[0].badge, true);
  assert.equal(detectedIntel.files[0].recommended, true);
  assert.equal(detectedIntel.files[0].archLabel, 'Intel');
  assert.equal(detectedIntel.files.filter((file) => file.recommended).length, 1);
  assert.equal(detectedIntel.hint, null);
  const detectedHero = heroAction({
    detectedOs: 'macos',
    cpuArch: 'x64',
    manifest,
    ui: copy.en.ui,
    locale: 'en',
  });
  assert.equal(detectedHero.kind, 'file');
  assert.equal(detectedHero.href, release('intel-first.dmg'));

  const detectedArm = downloadView(manifest, 'macos', {
    detectedOs: 'macos',
    cpuArch: 'arm64',
    locale: 'pt',
    ui: copy.pt.ui,
  });
  assert.equal(detectedArm.files[0].arch, 'arm64');
  assert.equal(detectedArm.files[0].badge, true);
  assert.equal(detectedArm.files[0].recommended, true);
  assert.equal(detectedArm.files[1].archLabel, 'Intel');
  assert.equal(detectedArm.hint, null);

  for (const os of ['windows', 'linux']) {
    const view = downloadView(manifest, os, {
      detectedOs: os,
      cpuArch: null,
      locale: 'en',
      ui: copy.en.ui,
    });
    assert.deepEqual(view.files.map((file) => file.arch), ['arm64', 'x64']);
    assert.ok(view.files.every((file) => file.recommended === false));
    assert.ok(view.files.every((file) => file.badge === false));
    assert.equal(view.hint, null);
    const hero = heroAction({
      detectedOs: os,
      cpuArch: null,
      manifest,
      ui: copy.en.ui,
      locale: 'en',
    });
    assert.equal(hero.kind, 'choose');
    assert.equal(hero.href, '#download');
  }

  const windowsDetected = downloadView(manifest, 'windows', {
    detectedOs: 'windows',
    cpuArch: 'x64',
    locale: 'en',
    ui: copy.en.ui,
  });
  assert.deepEqual(windowsDetected.files.map((file) => [file.arch, file.recommended, file.badge]), [
    ['x64', true, true],
    ['arm64', false, false],
  ]);
  assert.equal(windowsDetected.hint, null);
});

test('download URLs are public GitHub release assets with no query string', async () => {
  const manifest = JSON.parse(await readFile(new URL('./downloads.json', import.meta.url), 'utf8'));
  const urls = manifestDownloadUrls(manifest);
  assert.ok(urls.length >= 8);
  assert.doesNotMatch(JSON.stringify(manifest), /\?/);
  for (const url of urls) assertPublicReleaseAsset(url);

  let html = '';
  for (const locale of ['en', 'pt']) {
    html += renderNoscript(locale, manifest);
    html += renderChecksum(locale, manifest);
    html += renderMetaHtml(locale, manifest);
    for (const os of ['macos', 'windows', 'linux']) html += renderFileCardsHtml(locale, manifest, os);
  }
  assert.doesNotMatch(html, /\?token=/);
  const found = htmlDownloadUrls(html);
  assert.ok(found.length >= urls.length);
  for (const url of found) assertPublicReleaseAsset(url);
  for (const url of urls) assert.ok(html.includes(url), url);

  await build();
  for (const locale of ['en', 'pt']) {
    const built = await readFile(new URL(`./dist/${locale}/index.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(built, /\?token=/);
    for (const url of htmlDownloadUrls(built)) assertPublicReleaseAsset(url);
    for (const url of urls) assert.ok(built.includes(url), `${locale} ${url}`);
  }
  const builtManifest = JSON.parse(await readFile(new URL('./dist/downloads.json', import.meta.url), 'utf8'));
  for (const url of manifestDownloadUrls(builtManifest)) assertPublicReleaseAsset(url);
});
