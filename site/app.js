import { archFromSignals, detectDesktopOs, selectDownloads } from './downloads-logic.mjs';
import { LOCALE_COOKIE } from './negotiate.mjs';

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
let cpuArch = archFromSignals({ userAgent: navigator.userAgent });
let selected = detected || 'macos';
let downloads = {};
const result = document.querySelector('#download-result');
const detail = document.querySelector('#download-detail');

function detailText(os, entries) {
  const archs = new Set(entries.map((entry) => entry.arch));
  if (entries.length === 0) return ui.detail[os];
  if (archs.size === 1 && !archs.has('universal')) return ui.detail[`${os}_${[...archs][0]}`] || ui.detail[os];
  return ui.detail[os];
}

function render() {
  document.querySelectorAll('[data-os]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.os === selected));
  });
  const arch = selected === detected ? cpuArch : null;
  const entries = selectDownloads(downloads[selected], arch);
  detail.textContent = detailText(selected, entries);
  result.replaceChildren();
  for (const entry of entries) {
    const link = document.createElement('a');
    link.className = 'button';
    link.href = entry.url;
    link.textContent = ui.download.replaceAll('{label}', entry.label);
    result.append(link);
  }
  if (!result.childElementCount) {
    const notice = document.createElement('p');
    notice.className = 'availability';
    notice.textContent = ui.comingSoon.replaceAll('{os}', ui.os[selected]);
    result.append(notice);
  }
}

const hero = document.querySelector('#hero-download');
hero.textContent = detected ? ui.heroCtaFor.replaceAll('{os}', ui.os[detected]) : ui.heroCta;

document.querySelectorAll('[data-os]').forEach((button) => {
  button.addEventListener('click', () => {
    selected = button.dataset.os;
    render();
  });
});

document.querySelector('#year').textContent = String(new Date().getFullYear());
render();

async function loadDownloads() {
  try {
    const response = await fetch('/downloads.json');
    if (response.ok) downloads = (await response.json()) || {};
  } catch {
    /* Coming soon stays available offline. */
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
    /* A missing renderer string just leaves both architectures visible. */
  }
  const next = archFromSignals({ userAgent: navigator.userAgent, architecture, renderer });
  if (next) cpuArch = next;
}

await Promise.all([loadDownloads(), refineArch()]);
render();
