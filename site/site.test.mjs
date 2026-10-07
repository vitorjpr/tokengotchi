import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { build, renderDownloadResult, renderNoscript } from './build.mjs';
import { copy } from './copy.mjs';
import {
  archFromSignals,
  checksumUrl,
  detectDesktopOs,
  selectDownloads,
  validateManifest,
} from './downloads-logic.mjs';
import { onRequest } from './functions/index.js';
import { chooseLocale } from './negotiate.mjs';

const empty = { macos: [], windows: [], linux: [] };

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
});

test('required lines stay in both languages and avoid a paid tier', () => {
  assert.equal(copy.en.heroTitleHtml.includes('Your tokens.'), true);
  assert.match(copy.en.heroTitleHtml, /A little <span>life\.<\/span>/);
  assert.equal(copy.en.intro, 'Meet the desktop pet that feeds on your AI usage. You build things. It grows up.');
  assert.equal(copy.en.micro, 'Free to use. Yours to look after.');
  assert.equal(copy.en.ui.heroCta, 'Get Tokengotchi');
  assert.equal(copy.en.ui.heroCtaFor, 'Get Tokengotchi for {os}');
  assert.equal(copy.en.how1Title, 'Just keep building.');
  assert.equal(copy.en.how2Title, 'A little more alive.');
  assert.equal(copy.en.how3Title, 'Room for real life.');
  assert.equal(copy.en.privacyTitle, 'Your work stays yours.');
  assert.match(copy.en.privacyBodyHtml, /The app only checks GitHub for new releases — and you can turn that off\./);
  assert.equal(copy.en.navHow, 'How it works');
  assert.equal(copy.en.navEvolution, 'Evolution');
  assert.equal(copy.en.navDownload, 'Get the app');
  assert.equal(copy.en.footerTag, 'Built with tokens. Raised with love.');
  assert.equal(copy.en.ui.comingSoon, 'Public downloads for {os} are coming soon.');

  assert.match(copy.pt.heroTitleHtml, /Seus tokens\./);
  assert.match(copy.pt.heroTitleHtml, /pequenina\./);
  assert.equal(copy.pt.intro, 'O bichinho de estimação que mora na tela e se alimenta do que você gasta com IA. Você cria. Ele cresce.');
  assert.equal(copy.pt.micro, 'Grátis. Seu para cuidar.');
  assert.equal(copy.pt.ui.heroCta, 'Baixar o Tokengotchi');
  assert.equal(copy.pt.ui.heroCtaFor, 'Baixar o Tokengotchi para {os}');
  assert.equal(copy.pt.how1Title, 'Continue criando.');
  assert.equal(copy.pt.how2Title, 'Um pouco mais vivo.');
  assert.equal(copy.pt.how3Title, 'Espaço para a vida real.');
  assert.equal(copy.pt.privacyTitle, 'Seu trabalho fica com você.');
  assert.match(copy.pt.privacyBodyHtml, /A única rede é checar releases no GitHub — e dá para desligar\./);
  assert.equal(copy.pt.navHow, 'Como funciona');
  assert.equal(copy.pt.navEvolution, 'Evolução');
  assert.equal(copy.pt.navDownload, 'Baixar o app');
  assert.equal(copy.pt.footerTag, 'Feito com tokens. Criado com carinho.');
  assert.equal(copy.pt.ui.comingSoon, 'Os downloads públicos para {os} chegam em breve.');
  assert.match(copy.pt.evoIntroHtml, /19 níveis/);
  assert.match(copy.pt.evoIntroHtml, /9 formas/);

  const blob = JSON.stringify(copy).toLowerCase();
  assert.doesNotMatch(blob, /premium|pricing/);
  assert.equal(copy.en.detailMac, copy.en.ui.detail.macos);
  assert.equal(copy.pt.detailMac, copy.pt.ui.detail.macos);
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
  assert.match(copy.en.ui.detail.linux, /sudo apt install \.\/tokengotchi_\*\.deb/);
  assert.match(copy.en.ui.detail.linux_x64, /For 64-bit Linux\. A \.deb package/);
  assert.match(copy.en.ui.detail.linux_arm64, /For ARM Linux\. A \.deb package/);
  assert.match(copy.en.ui.detail.macos, /ad-hoc signed and not notarized/);
  assert.match(copy.en.ui.detail.macos, /right-click \(or Control-click\)/);
  assert.match(copy.en.ui.detail.macos, /Open Anyway/);
  assert.match(copy.en.ui.detail.macos_arm64, /For Apple Silicon\. The app is ad-hoc signed/);
  assert.match(copy.en.ui.detail.macos_x64, /For Intel Macs\. The app is ad-hoc signed/);
  assert.match(copy.pt.ui.detail.windows, /É um arquivo \.zip\. Extraia e execute Tokengotchi\.exe/);
  assert.match(copy.pt.ui.detail.windows, /Mais informações/);
  assert.match(copy.pt.ui.detail.windows, /Executar assim mesmo/);
  assert.match(copy.pt.ui.detail.linux, /Pacote \.deb para amd64 e arm64 \(Debian\/Ubuntu\)/);
  assert.match(copy.pt.ui.detail.linux, /sudo apt install \.\/tokengotchi_\*\.deb/);
  assert.match(copy.pt.ui.detail.macos, /assinado ad-hoc e não é notarizado/);
  assert.match(copy.pt.ui.detail.macos, /Abrir Mesmo Assim/);
  assert.equal(copy.en.ui.checksum, 'Verify downloads (SHA256SUMS)');
  assert.equal(copy.pt.ui.checksum, 'Conferir os downloads (SHA256SUMS)');
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
    assert.match(html, /src="\/assets\/estagio-ovo\.png"/);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
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
  assert.match(en, /ad-hoc signed and not notarized/);
  assert.match(pt, /assinado ad-hoc e não é notarizado/);

  await assert.rejects(access(new URL('./dist/en/downloads.json', import.meta.url)));
  await assert.rejects(access(new URL('./dist/pt/assets/estagio-ovo.png', import.meta.url)));
  await access(new URL('./dist/assets/estagio-dragao-ancestral.png', import.meta.url));
  await access(new URL('./dist/downloads-logic.mjs', import.meta.url));
});
