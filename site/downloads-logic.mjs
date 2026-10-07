const ARCH_ALIASES = {
  x64: 'x64',
  amd64: 'x64',
  x86_64: 'x64',
  intel: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
  arm: 'arm64',
  apple: 'arm64',
  'apple-silicon': 'arm64',
  universal: 'universal',
  any: 'universal',
};

export function normalizeArch(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return ARCH_ALIASES[key] || null;
}

export function isPublicHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['downloads.json must be an object with macos, windows, and linux arrays'];
  }
  for (const os of ['macos', 'windows', 'linux']) {
    const entries = manifest[os];
    if (!Array.isArray(entries)) {
      errors.push(`${os} must be an array`);
      continue;
    }
    entries.forEach((entry, index) => {
      if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) {
        errors.push(`${os}[${index}] needs a label`);
      }
      if (!entry || !isPublicHttps(entry.url)) {
        errors.push(`${os}[${index}] needs a public https URL`);
      }
      if (entry?.arch != null && entry.arch !== '' && !normalizeArch(entry.arch)) {
        errors.push(`${os}[${index}] has an unknown arch "${entry.arch}"`);
      }
    });
  }
  return errors;
}

/**
 * Release base for a GitHub download asset, or null when the URL is not one.
 * `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`
 * → `https://github.com/<owner>/<repo>/releases/download/<tag>`
 */
export function githubReleaseBase(url) {
  if (!isPublicHttps(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com' || parsed.port || parsed.search || parsed.hash) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 6) return null;
  const [owner, repo, releases, download, tag, file] = parts;
  if (releases !== 'releases' || download !== 'download') return null;
  const segment = /^[A-Za-z0-9._-]+$/;
  if (!segment.test(owner) || !segment.test(repo) || !segment.test(tag) || !segment.test(file)) return null;
  if (file === '.' || file === '..') return null;
  return `${parsed.origin}/${owner}/${repo}/releases/download/${tag}`;
}

/**
 * SHA256SUMS URL for the release that published every asset, or null.
 * Derived only when every manifest URL shares one GitHub release base.
 */
export function checksumUrl(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  const bases = new Set();
  for (const os of ['macos', 'windows', 'linux']) {
    if (!Array.isArray(manifest[os])) return null;
    for (const entry of manifest[os]) {
      const base = githubReleaseBase(entry?.url);
      if (!base) return null;
      bases.add(base);
    }
  }
  if (bases.size !== 1) return null;
  return `${[...bases][0]}/SHA256SUMS`;
}

/**
 * Pick downloads for one OS.
 * `detectedArch` null shows a universal build when one exists, otherwise every arch.
 * A known arch prefers matching files, then a universal build, then every labeled file.
 */
export function selectDownloads(entries, detectedArch) {
  if (!Array.isArray(entries)) return [];
  const valid = [];
  for (const entry of entries) {
    if (!entry || typeof entry.label !== 'string' || typeof entry.url !== 'string') continue;
    const label = entry.label.trim();
    if (!label || !isPublicHttps(entry.url)) continue;
    const arch = entry.arch == null || entry.arch === '' ? 'universal' : normalizeArch(entry.arch);
    if (!arch) continue;
    valid.push({ label, url: new URL(entry.url).href, arch });
  }
  const specific = valid.filter((entry) => entry.arch !== 'universal');
  const generic = valid.filter((entry) => entry.arch === 'universal');
  const want = normalizeArch(detectedArch);
  if (want && want !== 'universal' && specific.some((entry) => entry.arch === want)) {
    return specific.filter((entry) => entry.arch === want);
  }
  if (generic.length) return generic;
  return specific;
}

export function detectDesktopOs(userAgent = '', { platform = '', maxTouchPoints = 0 } = {}) {
  const mobile = /Android|iPhone|iPad|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (mobile) return null;
  if (/Mac/i.test(userAgent)) return 'macos';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Linux/i.test(userAgent)) return 'linux';
  return null;
}

const SAFE_DEB_NAME = /^[A-Za-z0-9._+-]+\.deb$/;
const RELEASE_ROOT = 'https://github.com/vitorjpr/tokengotchi/releases/download/';

/**
 * Basename of a .deb published on this repo's GitHub release, or null.
 * Control characters are rejected before the URL parser can strip them.
 * A percent-encoded basename is rejected. A plain basename is checked
 * after decoding, so `;`, `$()`, a backtick, a newline, or a space cannot
 * become a command.
 */
export function debFileName(url) {
  if (typeof url !== 'string' || !url) return null;
  if (/[\u0000-\u001F\u007F]/.test(url)) return null;
  const base = githubReleaseBase(url);
  if (!base?.startsWith(RELEASE_ROOT)) return null;
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const raw = pathname.split('/').pop() || '';
  if (raw.includes('%')) return null;
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SAFE_DEB_NAME.test(name) ? name : null;
}

/** Paste-ready apt commands for deb entries, in entry order. Unsafe names are skipped. */
export function aptInstallCommands(entries) {
  if (!Array.isArray(entries)) return [];
  const commands = [];
  for (const entry of entries) {
    const name = debFileName(entry?.url);
    if (!name) continue;
    const command = `sudo apt install ./${name}`;
    if (/[<>]/.test(command)) continue;
    commands.push(command);
  }
  return commands;
}

/**
 * Lead plus one code-marked apt command per file.
 * Returns null when there is no safe command, so callers keep the fallback sentence.
 */
export function formatAptSentence(lead, commands, { verb, orWord } = {}) {
  if (!lead || !verb || !orWord || !Array.isArray(commands) || !commands.length) return null;
  if (commands.some((command) => typeof command !== 'string' || /[<>]/.test(command))) return null;
  const coded = commands.map((command) => `\`${command}\``);
  const list = coded.length === 1 ? coded[0] : `${coded.slice(0, -1).join(', ')} ${orWord} ${coded.at(-1)}`;
  return `${lead} ${verb} ${list}.`;
}

/**
 * Linux install sentence for the downloads on screen.
 * One non-universal arch uses that arch's lead and its command; more than
 * one arch uses the shared lead and every command. Each command is
 * `sudo apt install ./` plus a validated .deb basename from this repo's
 * GitHub release. When none validate, returns the fallback copy, which
 * has no version placeholder.
 */
export function linuxDetail(ui, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const commands = aptInstallCommands(list);
  const archs = new Set(list.map((entry) => entry?.arch).filter((arch) => arch && arch !== 'universal'));
  const arch = list.length && archs.size === 1 ? [...archs][0] : null;
  const lead = (arch && ui?.linuxLead?.[arch]) || ui?.linuxLead?.both || '';
  const sentence = formatAptSentence(lead, commands, {
    verb: ui?.linuxInstallWith,
    orWord: ui?.linuxInstallOr,
  });
  if (sentence) return sentence;
  if (arch && ui?.detail?.[`linux_${arch}`]) return ui.detail[`linux_${arch}`];
  return ui?.detail?.linux || '';
}

/** Client hints win, then the UA, then a GPU renderer string for Macs that still say Intel. */
export function archFromSignals({ userAgent = '', architecture = '', renderer = '' } = {}) {
  const hinted = String(architecture || '').toLowerCase();
  if (hinted.includes('arm')) return 'arm64';
  if (hinted === 'x86' || hinted === 'x64' || hinted.includes('x86')) return 'x64';
  if (/aarch64|arm64|armv8/i.test(userAgent)) return 'arm64';
  if (/\b(x86_64|win64|amd64|x64)\b/i.test(userAgent)) return 'x64';
  if (/Apple\s*M\d/i.test(renderer) || (/Apple GPU/i.test(renderer) && !/Intel/i.test(renderer))) return 'arm64';
  if (/Intel|AMD|Radeon|NVIDIA|GeForce/i.test(renderer)) return 'x64';
  return null;
}
