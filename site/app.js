const platforms = {
  macos: { name: 'macOS', detail: 'For Apple Silicon and Intel Macs.' },
  windows: { name: 'Windows', detail: 'Choose the installer for your Windows PC.' },
  linux: { name: 'Linux', detail: 'AppImage and Debian packages, when available.' },
};
const ua = navigator.userAgent;
const detected = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ? null : /Mac/i.test(ua) ? 'macos' : /Windows/i.test(ua) ? 'windows' : /Linux/i.test(ua) ? 'linux' : null;
let selected = detected || 'macos';
let downloads = {};
const result = document.querySelector('#download-result');
function render() {
  document.querySelectorAll('[data-os]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.os === selected)));
  document.querySelector('#download-detail').textContent = platforms[selected].detail;
  result.replaceChildren();
  const entries = Array.isArray(downloads[selected]) ? downloads[selected] : [];
  for (const entry of entries) {
    if (typeof entry.label !== 'string' || typeof entry.url !== 'string') continue;
    let url;
    try { url = new URL(entry.url); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const link = document.createElement('a');
    link.className = 'button';
    link.href = url.href;
    link.textContent = `Download ${entry.label} ↓`;
    result.append(link);
  }
  if (!result.childElementCount) {
    const notice = document.createElement('p');
    notice.className = 'availability';
    notice.textContent = `Public downloads for ${platforms[selected].name} are coming soon.`;
    result.append(notice);
  }
}
if (detected) document.querySelector('#hero-download').textContent = `Get Tokengotchi for ${platforms[detected].name}`;
document.querySelectorAll('[data-os]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.os; render(); }));
document.querySelector('#year').textContent = new Date().getFullYear();
render();
try {
  const response = await fetch('./downloads.json');
  if (response.ok) downloads = await response.json() || {};
} catch { /* The coming-soon state remains available offline. */ }
render();
