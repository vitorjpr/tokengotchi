import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { copy } from './copy.mjs';
import { aptInstallPlans, checksumUrl, downloadView, selectDownloads, validateManifest } from './downloads-logic.mjs';

const root = new URL('./', import.meta.url);
const output = new URL('./dist/', root);
const RAW = new Set([
  'heroTitleHtml',
  'wittyHtml',
  'trustHtml',
  'livesTitleHtml',
  'feedTitleHtml',
  'feed2BodyHtml',
  'feedNoteHtml',
  'evoTitleHtml',
  'privReadsBodyHtml',
  'dlTitleHtml',
  'macSeq1',
  'macSeq2',
  'macSeq3',
  'macSon',
  'winLead',
  'winWarn',
  'noscriptHtml',
  'fileCardsHtml',
  'aptHtml',
  'metaHtml',
  'uiJson',
  'enCurrent',
  'ptCurrent',
]);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function renderDownloadResult(locale, manifest) {
  const page = copy[locale];
  const entries = selectDownloads(manifest?.macos, null);
  if (!entries.length) {
    const message = page.ui.comingSoon.replaceAll('{os}', page.ui.os.macos);
    return `<p class="availability">${escapeHtml(message)}</p>`;
  }
  return entries.map((entry) => {
    const label = page.ui.download.replaceAll('{label}', entry.label);
    return `<a class="button" href="${escapeHtml(entry.url)}">${escapeHtml(label)}</a>`;
  }).join('');
}

export function renderChecksum(locale, manifest) {
  const url = checksumUrl(manifest);
  if (!url) return '';
  const { checksum, checksumNote } = copy[locale].ui;
  const link = `<p class="download-verify"><a href="${escapeHtml(url)}">${escapeHtml(checksum)}</a></p>`;
  if (!checksumNote) return link;
  return `${link}<p class="checksum-note">${escapeHtml(checksumNote)}</p>`;
}

export function renderFileCardsHtml(locale, manifest, os = 'macos') {
  const page = copy[locale];
  const view = downloadView(manifest, os, { locale, ui: page.ui });
  if (!view.files.length) {
    const message = page.ui.comingSoon.replaceAll('{os}', page.ui.os[os] || os);
    return `<p class="availability">${escapeHtml(message)}</p>`;
  }
  const cards = view.files.map((file) => {
    const badge = file.badge ? `<span class="dl-badge">${escapeHtml(page.ui.detected)}</span>` : '';
    const name = file.name ? `<code class="dl-name">${escapeHtml(file.name)}</code>` : '';
    const size = file.sizeText ? `<span class="dl-size">${escapeHtml(file.sizeText)}</span>` : '';
    const kind = file.recommended ? 'btn-primary' : 'btn-secondary';
    const rec = file.recommended ? ' is-rec' : '';
    return `<div class="dl-file${rec}"><div class="dl-file-head"><span class="dl-arch">${escapeHtml(file.archLabel)}</span>${badge}</div>${name}${size}<a class="btn ${kind}" href="${escapeHtml(file.url)}" aria-label="${escapeHtml(file.ariaLabel)}">${escapeHtml(file.buttonText)}</a></div>`;
  }).join('');
  return `<div class="dl-files">${cards}</div>`;
}

export function renderAptHtml(locale, entries) {
  const page = copy[locale];
  return aptInstallPlans(entries).map((plan) => {
    const arch = page.ui.arch?.linux?.[plan.arch] || plan.arch;
    const label = `${page.linuxCopy}: ${plan.command}`;
    return `<div class="apt-row"><span class="apt-arch">${escapeHtml(arch)}</span><code>${escapeHtml(plan.command)}</code><button type="button" class="apt-copy" aria-label="${escapeHtml(label)}">${escapeHtml(page.linuxCopy)}</button></div>`;
  }).join('');
}

export function renderMetaHtml(locale, manifest) {
  const page = copy[locale].ui;
  const view = downloadView(manifest, 'macos', { locale, ui: page });
  const bits = [];
  if (view.tag) bits.push(`<span><span class="k">${escapeHtml(page.version)}</span> ${escapeHtml(view.tag)}</span>`);
  if (view.released) bits.push(`<span><span class="k">${escapeHtml(page.released)}</span> ${escapeHtml(view.released)}</span>`);
  if (view.notesUrl) {
    bits.push(`<a href="${escapeHtml(view.notesUrl)}">${escapeHtml(page.notes)} <span aria-hidden="true">↗</span></a>`);
  }
  if (view.sumsUrl) {
    bits.push(`<a href="${escapeHtml(view.sumsUrl)}">${escapeHtml(page.checksum)} <span aria-hidden="true">↗</span></a>`);
  }
  const note = page.checksumNote ? `<p class="checksum-note">${escapeHtml(page.checksumNote)}</p>` : '';
  return `<p class="dl-meta-row">${bits.join('')}</p>${note}`;
}

export function renderNoscript(locale, manifest) {
  const page = copy[locale];
  const items = [];
  for (const os of ['macos', 'windows', 'linux']) {
    for (const entry of selectDownloads(manifest?.[os], null)) {
      const label = page.ui.download.replaceAll('{label}', entry.label);
      items.push(`<li><a class="btn btn-secondary" href="${escapeHtml(entry.url)}">${escapeHtml(label)}</a></li>`);
    }
  }
  if (!items.length) return `<p>${escapeHtml(page.noscriptSoon)}</p>`;
  return `<p>${escapeHtml(page.noscriptLead)}</p><ul class="noscript-downloads">${items.join('')}</ul>`;
}

function renderLocale(template, locale, extras) {
  const values = { ...copy[locale], ...extras };
  const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Missing {{${key}}} for ${locale}`);
    return RAW.has(key) ? String(values[key]) : escapeHtml(values[key]);
  });
  if (/\{\{\w+\}\}/.test(html)) throw new Error(`Unreplaced placeholder in ${locale}`);
  return html;
}

function rootPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#171310">
  <title>Tokengotchi</title>
  <link rel="icon" type="image/png" href="/assets/estagio-broto.png">
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#171310;color:#faf4ee;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
    a{color:#faf4ee}
    p{display:flex;gap:18px}
  </style>
  <script>
    (function () {
      var match = document.cookie.match(/(?:^|; )tokengotchi_locale=(en|pt)(?:;|$)/);
      var language = (navigator.languages && navigator.languages[0]) || navigator.language || '';
      var locale = match ? match[1] : language.toLowerCase().indexOf('pt') === 0 ? 'pt' : 'en';
      location.replace('/' + locale + '/' + location.search + location.hash);
    })();
  </script>
</head>
<body>
  <nav aria-label="Language">
    <p><a href="/en/">English</a><a href="/pt/">Português</a></p>
  </nav>
</body>
</html>
`;
}

export async function build() {
  const template = await readFile(new URL('./template.html', root), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('./downloads.json', root), 'utf8'));
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`downloads.json\n${errors.join('\n')}`);
  const year = String(new Date().getFullYear());

  await rm(output, { recursive: true, force: true });
  await mkdir(new URL('./en/', output), { recursive: true });
  await mkdir(new URL('./pt/', output), { recursive: true });

  for (const locale of ['en', 'pt']) {
    const html = renderLocale(template, locale, {
      year,
      uiJson: JSON.stringify(copy[locale].ui).replaceAll('<', '\\u003c'),
      noscriptHtml: renderNoscript(locale, manifest),
      fileCardsHtml: renderFileCardsHtml(locale, manifest, 'macos'),
      aptHtml: renderAptHtml(locale, manifest.linux),
      metaHtml: renderMetaHtml(locale, manifest),
      enCurrent: locale === 'en' ? ' aria-current="page"' : '',
      ptCurrent: locale === 'pt' ? ' aria-current="page"' : '',
    });
    await writeFile(new URL(`./${locale}/index.html`, output), html);
  }

  await writeFile(new URL('./index.html', output), rootPage());
  await writeFile(new URL('./_redirects', output), '/en /en/ 301\n/pt /pt/ 301\n');
  for (const file of ['styles.css', 'app.js', 'downloads.json', 'negotiate.mjs', 'downloads-logic.mjs', 'inline-code.mjs', 'assets']) {
    await cp(new URL(file, root), new URL(file, output), { recursive: true });
  }
  console.log('Static site built in site/dist');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
}
