import { inlineCodeSegments } from './inline-code.mjs';
import { LOCALE_COOKIE } from './negotiate.mjs';
import {
  aptInstallPlans,
  archFromSignals,
  detectDesktopOs,
  downloadView,
  heroAction,
  heroMetaLine,
  linuxDetail,
} from './downloads-logic.mjs';

const ui = JSON.parse(document.querySelector('#ui-copy').textContent);
const locale = document.documentElement.dataset.locale === 'pt' ? 'pt' : 'en';
document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;

function syncLanguageLinks() {
  for (const link of document.querySelectorAll('[data-switch]')) {
    const target = link.dataset.switch === 'pt' ? 'pt' : 'en';
    const url = new URL(`/${target}/`, location.origin);
    url.search = location.search;
    url.hash = location.hash;
    link.href = `${url.pathname}${url.search}${url.hash}`;
  }
}

syncLanguageLinks();
addEventListener('hashchange', syncLanguageLinks);

const detected = detectDesktopOs(navigator.userAgent, {
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints || 0,
});
document.documentElement.dataset.device = detected ? 'desktop' : 'phone';

let cpuArch = archFromSignals({ userAgent: navigator.userAgent });
let selected = detected || 'macos';
let downloads = null;
const order = ['macos', 'windows', 'linux'];

function shareTarget() {
  const url = new URL(`/${locale}/`, location.origin);
  url.hash = 'download';
  return url.toString();
}

async function writeText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function flash(button, next, restore) {
  button.textContent = next;
  setTimeout(() => { button.textContent = restore; }, 1500);
}

function applyHero() {
  const action = heroAction({
    detectedOs: detected,
    cpuArch,
    manifest: downloads,
    ui,
    locale,
  });
  const label = document.querySelector('#hero-download');
  if (label && action.kind !== 'mobile') label.textContent = action.text;
  const link = document.querySelector('#hero-cta');
  if (link) link.href = action.href;
  const meta = document.querySelector('#hero-meta');
  if (meta) {
    meta.textContent = heroMetaLine({
      detectedOs: detected,
      cpuArch,
      manifest: downloads,
      ui,
      locale,
    }) || ui.freeLine;
  }
}

function renderCards(view) {
  const host = document.querySelector('#dl-files');
  if (!host) return;
  host.replaceChildren();
  if (!view.files.length) {
    const notice = document.createElement('p');
    notice.className = 'availability';
    notice.textContent = ui.comingSoon.replaceAll('{os}', ui.os[view.os] || view.os);
    host.append(notice);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'dl-files';
  for (const file of view.files) {
    const card = document.createElement('div');
    card.className = file.recommended ? 'dl-file is-rec' : 'dl-file';
    const head = document.createElement('div');
    head.className = 'dl-file-head';
    const arch = document.createElement('span');
    arch.className = 'dl-arch';
    arch.textContent = file.archLabel;
    head.append(arch);
    if (file.badge) {
      const badge = document.createElement('span');
      badge.className = 'dl-badge';
      badge.textContent = ui.detected;
      head.append(badge);
    }
    card.append(head);
    if (file.name) {
      const name = document.createElement('code');
      name.className = 'dl-name';
      name.textContent = file.name;
      card.append(name);
    }
    if (file.sizeText) {
      const size = document.createElement('span');
      size.className = 'dl-size';
      size.textContent = file.sizeText;
      card.append(size);
    }
    const link = document.createElement('a');
    link.className = `btn ${file.recommended ? 'btn-primary' : 'btn-secondary'}`;
    link.href = file.url;
    link.textContent = file.buttonText;
    if (file.ariaLabel) link.setAttribute('aria-label', file.ariaLabel);
    card.append(link);
    grid.append(card);
  }
  host.append(grid);
}

function renderMeta() {
  const host = document.querySelector('#dl-meta');
  if (!host || !downloads) return;
  const view = downloadView(downloads, 'macos', { locale, ui });
  host.replaceChildren();
  const row = document.createElement('p');
  row.className = 'dl-meta-row';
  const addFact = (kicker, value) => {
    const span = document.createElement('span');
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = kicker;
    span.append(k, ` ${value}`);
    row.append(span);
  };
  if (view.tag) addFact(ui.version, view.tag);
  if (view.released) addFact(ui.released, view.released);
  const addLink = (href, text) => {
    const link = document.createElement('a');
    link.href = href;
    link.append(text, ' ');
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    link.append(arrow);
    row.append(link);
  };
  if (view.notesUrl && ui.notes) addLink(view.notesUrl, ui.notes);
  if (view.sumsUrl && ui.checksum) addLink(view.sumsUrl, ui.checksum);
  host.append(row);
  if (ui.checksumNote) {
    const note = document.createElement('p');
    note.className = 'checksum-note';
    note.textContent = ui.checksumNote;
    host.append(note);
  }
}

function renderApt(entries) {
  const host = document.querySelector('#apt-rows');
  const lead = document.querySelector('#apt-lead');
  if (!host) return;
  host.replaceChildren();
  const plans = aptInstallPlans(entries);
  if (lead) lead.hidden = plans.length === 0;
  if (!plans.length) {
    const paragraph = document.createElement('p');
    paragraph.className = 'help-lead';
    for (const part of inlineCodeSegments(linuxDetail(ui, entries))) {
      if (!part.code) {
        paragraph.append(part.value);
        continue;
      }
      const code = document.createElement('code');
      code.textContent = part.value;
      paragraph.append(code);
    }
    host.append(paragraph);
    return;
  }
  for (const plan of plans) {
    const row = document.createElement('div');
    row.className = 'apt-row';
    const arch = document.createElement('span');
    arch.className = 'apt-arch';
    arch.textContent = ui.arch?.linux?.[plan.arch] || plan.arch;
    const code = document.createElement('code');
    code.textContent = plan.command;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'apt-copy';
    button.textContent = ui.copy;
    button.setAttribute('aria-label', `${ui.copy}: ${plan.command}`);
    row.append(arch, code, button);
    host.append(row);
  }
}

function render() {
  if (!downloads) return;
  for (const os of order) {
    const tab = document.querySelector(`#tab-${os}`);
    if (!tab) continue;
    const on = os === selected;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    const existing = tab.querySelector('.os-detected');
    if (os === detected) {
      const badge = existing || tab.appendChild(document.createElement('span'));
      badge.className = 'os-detected';
      badge.textContent = ui.detected;
    } else if (existing) {
      existing.remove();
    }
  }
  const panel = document.querySelector('#os-panel');
  if (panel) panel.setAttribute('aria-labelledby', `tab-${selected}`);
  for (const help of document.querySelectorAll('[data-help]')) {
    help.hidden = help.dataset.help !== selected;
  }
  renderCards(downloadView(downloads, selected, {
    detectedOs: detected,
    cpuArch,
    locale,
    ui,
  }));
  renderMeta();
  renderApt(downloads.linux);
}

function choose(os) {
  if (!order.includes(os)) return;
  selected = os;
  render();
  document.querySelector(`#tab-${os}`)?.focus();
}

for (const os of order) {
  const tab = document.querySelector(`#tab-${os}`);
  if (!tab) continue;
  tab.addEventListener('click', () => {
    selected = os;
    render();
  });
  tab.addEventListener('keydown', (event) => {
    const index = order.indexOf(os);
    let next = null;
    if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
    else if (event.key === 'ArrowLeft') next = order[(index + order.length - 1) % order.length];
    else if (event.key === 'Home') next = order[0];
    else if (event.key === 'End') next = order[order.length - 1];
    if (!next) return;
    event.preventDefault();
    choose(next);
  });
}

document.querySelector('#download-desktop')?.addEventListener('click', async (event) => {
  const button = event.target.closest?.('.apt-copy');
  if (!button) return;
  const command = button.closest('.apt-row')?.querySelector('code')?.textContent || '';
  if (!command.startsWith('sudo apt install ./')) return;
  if (!(await writeText(command))) return;
  flash(button, ui.copied, ui.copy);
});

const filesToggle = document.querySelector('#phone-files-toggle');
filesToggle?.addEventListener('click', () => {
  const panel = document.querySelector('#download-desktop');
  const open = panel.classList.toggle('is-open');
  filesToggle.setAttribute('aria-expanded', String(open));
});

const copyLink = document.querySelector('#copy-link');
copyLink?.addEventListener('click', async () => {
  if (!(await writeText(shareTarget()))) return;
  flash(copyLink, ui.copied, ui.copyLink);
});

const shareLink = document.querySelector('#share-link');
if (shareLink && !navigator.share) shareLink.hidden = true;
shareLink?.addEventListener('click', async () => {
  const url = shareTarget();
  try {
    await navigator.share({ title: 'Tokengotchi', url });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (await writeText(url)) flash(shareLink, ui.copied, shareLink.textContent);
  }
});

const year = document.querySelector('#year');
if (year) year.textContent = String(new Date().getFullYear());
const mobileUrl = document.querySelector('#mobile-url');
if (mobileUrl) mobileUrl.textContent = `${location.host}/${locale}/`;

applyHero();

async function loadDownloads() {
  try {
    const response = await fetch('/downloads.json');
    if (!response.ok) return;
    const json = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) return;
    downloads = json;
  } catch {
    /* The built-in cards stay. */
  }
}

async function refineArch() {
  let architecture = '';
  let renderer = '';
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const hints = await navigator.userAgentData.getHighEntropyValues(['architecture']);
      architecture = hints.architecture || '';
    }
  } catch {
    /* Client hints are optional. */
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && extension) renderer = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '';
  } catch {
    /* A missing renderer string leaves every architecture visible. */
  }
  const next = archFromSignals({ userAgent: navigator.userAgent, architecture, renderer });
  if (next) cpuArch = next;
}

await Promise.all([loadDownloads(), refineArch()]);
applyHero();
render();
