import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { build, renderChecksum, renderDownloadResult, renderNoscript } from './build.mjs';
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
  releaseNotesUrl,
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
});

test('required lines stay in both languages and avoid a paid tier', () => {
  assert.equal(copy.en.heroTitleHtml.includes('Your tokens.'), true);
  assert.match(copy.en.heroTitleHtml, /A little <em>life\.<\/em>/);
  assert.equal(copy.en.heroSub, 'A pixel pet that lives on your desktop and feeds on your AI usage. You build things. It grows up.');
  assert.equal(copy.en.freeLine, 'Free, MIT-licensed');
  assert.equal(copy.en.ui.heroCta, 'Download');
  assert.equal(copy.en.ui.ctaFor, 'Download for {os}');
  assert.equal(copy.en.ui.ctaMobile, 'Get it on your computer');
  assert.equal(copy.en.feedTitleHtml, 'You do your thing.<br>It does its little thing.');
  assert.match(copy.en.feed3Body, /Output tokens count more than cached ones/);
  assert.match(copy.en.livesBody, /Disappear for more than about 3½ days and it dies/);
  assert.equal(copy.en.privTitle, 'Your work stays yours.');
  assert.equal(copy.en.privBody, 'Usage is read on your device. Logs and pet data stay there. The app only checks GitHub for new releases, and you can turn that off.');
  assert.match(copy.en.trustHtml, /Stays on your machine\./);
  assert.match(copy.en.trustHtml, /optional GitHub release check/);
  assert.equal(copy.en.navHow, 'How it works');
  assert.equal(copy.en.navEvolution, 'Evolution');
  assert.equal(copy.en.navDownload, 'Download');
  assert.equal(copy.en.footerTag, 'Built with tokens. Raised with love.');
  assert.equal(copy.en.ui.comingSoon, 'Public downloads for {os} are coming soon.');

  assert.match(copy.pt.heroTitleHtml, /Seus tokens\./);
  assert.match(copy.pt.heroTitleHtml, /<em>pequenina\.<\/em>/);
  assert.equal(copy.pt.heroSub, 'Um bichinho pixelado que mora na sua tela e se alimenta do que você gasta com IA. Você cria. Ele cresce.');
  assert.equal(copy.pt.freeLine, 'Grátis, licença MIT');
  assert.equal(copy.pt.ui.heroCta, 'Baixar');
  assert.equal(copy.pt.ui.ctaFor, 'Baixar para {os}');
  assert.equal(copy.pt.ui.ctaMobile, 'Baixe no computador');
  assert.equal(copy.pt.feedTitleHtml, 'Você faz a sua parte.<br>Ele faz a dele.');
  assert.match(copy.pt.livesBody, /Se sumir por mais de uns 3 dias e meio, ele morre/);
  assert.equal(copy.pt.privTitle, 'Seu trabalho fica com você.');
  assert.equal(copy.pt.privBody, 'A leitura é na sua máquina. Logs e dados do bichinho não saem daí. A única rede é checar releases no GitHub, e dá para desligar.');
  assert.match(copy.pt.trustHtml, /Fica na sua máquina\./);
  assert.equal(copy.pt.navHow, 'Como funciona');
  assert.equal(copy.pt.navEvolution, 'Evolução');
  assert.equal(copy.pt.navDownload, 'Baixar');
  assert.equal(copy.pt.footerTag, 'Feito com tokens. Criado com carinho.');
  assert.equal(copy.pt.ui.comingSoon, 'Os downloads públicos para {os} chegam em breve.');
  assert.match(copy.pt.evoIntro, /19 níveis/);
  assert.match(copy.pt.evoIntro, /9 formas/);

  const blob = JSON.stringify(copy).toLowerCase();
  assert.doesNotMatch(blob, /premium|pricing/);
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
  assert.match(en, /Oct 8, 2026/);
  assert.match(pt, /8 out\. 2026/);
  assert.match(en, /Tokengotchi-0\.5\.2-arm64\.dmg/);
  assert.match(en, /Tokengotchi-0\.5\.2-x64\.dmg/);
  assert.doesNotMatch(en, /fonts\.googleapis\.com/);
  assert.doesNotMatch(pt, /fonts\.googleapis\.com/);
  const css = await readFile(new URL('./dist/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  assert.match(css, /image-rendering:\s*crisp-edges;\s*image-rendering:\s*pixelated/);
  assert.doesNotMatch(css, /data-locale=.pt.[\s\S]*font-size/);

  await assert.rejects(access(new URL('./dist/en/downloads.json', import.meta.url)));
  await assert.rejects(access(new URL('./dist/pt/assets/estagio-ovo.png', import.meta.url)));
  await access(new URL('./dist/assets/og.png', import.meta.url));
  await access(new URL('./dist/assets/PixelifySans-subset.woff2', import.meta.url));
  await access(new URL('./dist/assets/OFL-PixelifySans.txt', import.meta.url));
  await access(new URL('./dist/downloads-logic.mjs', import.meta.url));
  await access(new URL('./dist/inline-code.mjs', import.meta.url));
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
  assert.equal(manifest.macos.find((entry) => entry.arch === 'arm64').size, 106564099);
  assert.equal(manifest.macos.find((entry) => entry.arch === 'x64').size, 111547831);
  assert.equal(manifest.windows.find((entry) => entry.arch === 'x64').size, 133998834);
  assert.equal(manifest.windows.find((entry) => entry.arch === 'arm64').size, 130523848);
  assert.equal(manifest.linux.find((entry) => entry.arch === 'x64').size, 91131184);
  assert.equal(manifest.linux.find((entry) => entry.arch === 'arm64').size, 84665716);

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
  assert.equal(releaseNotesUrl(manifest), `https://github.com/vitorjpr/tokengotchi/releases/tag/${tag}`);
  assert.equal(formatSize(106564099, 'en'), '106.6 MB');
  assert.equal(formatSize(106564099, 'pt'), '106,6 MB');
  assert.equal(formatSize(111547831, 'en'), '111.5 MB');
  assert.equal(formatReleaseDate('2026-10-08', 'en'), 'Oct 8, 2026');
  assert.equal(formatReleaseDate('2026-10-08', 'pt'), '8 out. 2026');
  assert.equal(formatReleaseDate(manifest.released, 'en'), 'Oct 8, 2026');

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
    'Apple Silicon · 106.6 MB · Free, MIT-licensed',
  );
  const unknown = heroAction({ detectedOs: 'macos', cpuArch: null, manifest, ui: copy.en.ui, locale: 'en' });
  assert.equal(unknown.kind, 'choose');
  assert.equal(unknown.href, '#download');
  assert.equal(unknown.text, 'Download for macOS');
  assert.equal(
    heroMetaLine({ detectedOs: 'macos', cpuArch: null, manifest, ui: copy.en.ui, locale: 'en' }),
    'Free, MIT-licensed',
  );
  const both = downloadView(manifest, 'macos', { detectedOs: 'macos', cpuArch: 'x64', locale: 'en', ui: copy.en.ui });
  assert.deepEqual(both.files.map((file) => file.arch), ['x64', 'arm64']);
  assert.equal(both.files.filter((file) => file.badge).length, 1);
});

test('Safari on an Intel Mac does not get an Apple Silicon download', async () => {
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
    'v0.5.2 · Free, MIT-licensed',
  );

  const view = downloadView(manifest, 'macos', {
    detectedOs: 'macos',
    cpuArch: arch,
    locale: 'en',
    ui: copy.en.ui,
  });
  assert.equal(view.files.length, 2);
  assert.equal(view.files.filter((file) => file.badge).length, 0);
  assert.ok(view.files.some((file) => file.name.endsWith('-arm64.dmg')));
  assert.ok(view.files.some((file) => file.name.endsWith('-x64.dmg')));

  assert.equal(archFromSignals({ userAgent: safari, renderer: 'Apple GPU', architecture: 'arm' }), 'arm64');
  assert.equal(archFromSignals({ userAgent: safari, renderer: 'Apple GPU', architecture: 'x86' }), 'x64');
  assert.equal(archFromSignals({ userAgent: safari, renderer: 'ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)' }), 'arm64');
  assert.equal(archFromSignals({ renderer: 'Apple GPU' }), null);
  assert.equal(archFromSignals({ userAgent: safari, renderer: 'Intel(R) Iris(TM) Plus Graphics OpenGL Engine' }), 'x64');
});
