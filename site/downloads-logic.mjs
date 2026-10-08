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

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['downloads.json must be an object with macos, windows, and linux arrays'];
  }
  if (Object.hasOwn(manifest, 'released') && manifest.released != null) {
    if (!isIsoDate(manifest.released)) errors.push('released must be a YYYY-MM-DD date');
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
      if (entry && Object.hasOwn(entry, 'size') && entry.size != null) {
        if (!Number.isInteger(entry.size) || entry.size <= 0) {
          errors.push(`${os}[${index}] size must be a positive integer of bytes`);
        }
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
 * Every valid file for one OS, in manifest order. Never drops an architecture.
 * `size` is a positive byte count, or null when the manifest omits it.
 */
export function listDownloads(entries) {
  if (!Array.isArray(entries)) return [];
  const valid = [];
  for (const entry of entries) {
    if (!entry || typeof entry.label !== 'string' || typeof entry.url !== 'string') continue;
    const label = entry.label.trim();
    if (!label || !isPublicHttps(entry.url)) continue;
    const arch = entry.arch == null || entry.arch === '' ? 'universal' : normalizeArch(entry.arch);
    if (!arch) continue;
    const size = Number.isInteger(entry.size) && entry.size > 0 ? entry.size : null;
    valid.push({ label, url: new URL(entry.url).href, arch, size });
  }
  return valid;
}

/**
 * Preferred file for one OS. Used for the hero link, not the download list.
 * `detectedArch` null shows a universal build when one exists, otherwise every arch.
 * A known arch prefers matching files, then a universal build, then every labeled file.
 */
export function selectDownloads(entries, detectedArch) {
  const valid = listDownloads(entries);
  const specific = valid.filter((entry) => entry.arch !== 'universal');
  const generic = valid.filter((entry) => entry.arch === 'universal');
  const want = normalizeArch(detectedArch);
  if (want && want !== 'universal' && specific.some((entry) => entry.arch === want)) {
    return specific.filter((entry) => entry.arch === want);
  }
  if (generic.length) return generic;
  return specific;
}

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  pt: ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'],
};

/** `101.6 MB` / `101,6 MB`, or null when `bytes` is missing. MiB, matching the release listing. */
export function formatSize(bytes, locale = 'en') {
  if (!Number.isInteger(bytes) || bytes <= 0) return null;
  const text = (bytes / 1048576).toFixed(1);
  const number = locale === 'pt' ? text.replace('.', ',') : text;
  return `${number} MB`;
}

/** `Oct 8, 2026` / `8 out. 2026`, or null when `iso` is missing or not a real date. */
export function formatReleaseDate(iso, locale = 'en') {
  if (!isIsoDate(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (locale === 'pt') return `${day} ${MONTHS.pt[month - 1]} ${year}`;
  return `${MONTHS.en[month - 1]} ${day}, ${year}`;
}

/** Safe download basename, or '' when the URL is not a plain public filename. */
export function fileNameOf(url) {
  if (typeof url !== 'string' || !isPublicHttps(url)) return '';
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return '';
  }
  const raw = pathname.split('/').pop() || '';
  if (!raw || raw.includes('%')) return '';
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return '';
  }
  return /^[A-Za-z0-9._+-]+$/.test(name) ? name : '';
}

export function fileExtension(url) {
  const match = fileNameOf(url).match(/(\.[A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/** `.../releases/tag/<tag>` for the shared release, or null. */
export function releaseNotesUrl(manifest) {
  const sums = checksumUrl(manifest);
  if (!sums) return null;
  return sums.replace('/releases/download/', '/releases/tag/').replace(/\/SHA256SUMS$/, '');
}

export function releaseTag(manifest) {
  const notes = releaseNotesUrl(manifest);
  if (!notes) return null;
  const tag = notes.split('/').pop() || '';
  return tag || null;
}

/**
 * Files to show for one OS tab. Every arch stays in the list.
 * The detected arch is badged and sorted first. With no detected arch, the
 * first file is the primary button and nothing is badged.
 */
export function downloadView(manifest, os, { detectedOs = null, cpuArch = null, locale = 'en', ui = {} } = {}) {
  const entries = listDownloads(manifest?.[os]);
  const known = normalizeArch(cpuArch);
  const archKnown = os === detectedOs && known && known !== 'universal';
  const files = entries.map((entry, index) => {
    const badge = Boolean(archKnown && entry.arch === known);
    const recommended = archKnown ? entry.arch === known : index === 0;
    const ext = fileExtension(entry.url);
    const archLabel = ui?.arch?.[os]?.[entry.arch] || entry.label;
    const sizeText = formatSize(entry.size, locale);
    const buttonText = ext && ui?.dlBtn
      ? ui.dlBtn.replaceAll('{ext}', ext)
      : String(ui?.download || '{label}').replaceAll('{label}', entry.label);
    const ariaBits = [buttonText, ui?.os?.[os] || os, archLabel];
    if (sizeText) ariaBits.push(sizeText);
    return {
      arch: entry.arch,
      archLabel,
      name: fileNameOf(entry.url),
      sizeText,
      ext,
      url: entry.url,
      recommended,
      badge,
      buttonText,
      ariaLabel: ariaBits.filter(Boolean).join(' · '),
    };
  });
  if (archKnown) files.sort((a, b) => Number(b.badge) - Number(a.badge));
  return {
    os,
    files,
    tag: releaseTag(manifest),
    released: formatReleaseDate(manifest?.released, locale),
    notesUrl: releaseNotesUrl(manifest),
    sumsUrl: checksumUrl(manifest),
  };
}

/**
 * Hero button. Phones and anything `detectDesktopOs` leaves unclassified
 * get the "get it on your computer" path. A known desktop arch with one
 * matching file links straight at that file.
 */
export function heroAction({ detectedOs, cpuArch, manifest, ui = {}, locale = 'en' } = {}) {
  if (!detectedOs) {
    return { kind: 'mobile', text: ui.ctaMobile || '', href: '#download', archLabel: null, sizeText: null };
  }
  const osName = ui.os?.[detectedOs] || detectedOs;
  const text = String(ui.ctaFor || '').replaceAll('{os}', osName);
  const known = normalizeArch(cpuArch);
  if (!known || known === 'universal') {
    return { kind: 'choose', text, href: '#download', archLabel: null, sizeText: null };
  }
  const preferred = selectDownloads(manifest?.[detectedOs], known);
  if (preferred.length !== 1) {
    return { kind: 'choose', text, href: '#download', archLabel: null, sizeText: null };
  }
  const file = preferred[0];
  return {
    kind: 'file',
    text,
    href: file.url,
    archLabel: ui.arch?.[detectedOs]?.[file.arch] || null,
    sizeText: formatSize(file.size, locale),
  };
}

export function heroMetaLine({ detectedOs, cpuArch, manifest, ui = {}, locale = 'en' } = {}) {
  const action = heroAction({ detectedOs, cpuArch, manifest, ui, locale });
  const parts = [];
  const tag = releaseTag(manifest);
  if (tag) parts.push(tag);
  if (action.kind === 'file') {
    if (action.archLabel) parts.push(action.archLabel);
    if (action.sizeText) parts.push(action.sizeText);
  }
  if (ui.freeLine) parts.push(ui.freeLine);
  return parts.join(' · ');
}

/** Phones, iPads, and anything else that is not a desktop OS stay null. The inline script in template.html mirrors this. */
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
 * Basename of a .deb on this repo's GitHub releases, or null.
 * Control characters are rejected before the URL parser can strip them.
 * A percent-encoded basename is rejected. The decoded name must be one
 * safe filename, so a shell metacharacter cannot become part of a command.
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

const DEB_ARCH_SUFFIX = { x64: '_amd64.deb', arm64: '_arm64.deb' };

function aptPlan(entry) {
  const name = debFileName(entry?.url);
  if (!name) return null;
  const arch = entry?.arch == null || entry.arch === '' ? 'universal' : normalizeArch(entry.arch);
  if (!arch) return null;
  const suffix = DEB_ARCH_SUFFIX[arch];
  if (suffix && !name.endsWith(suffix)) return null;
  const command = `sudo apt install ./${name}`;
  if (/[<>]/.test(command)) return null;
  return { command, arch, name };
}

/**
 * Apt plans for deb entries, in entry order. Unsafe names are skipped.
 * An x64 entry must end in `_amd64.deb`, and an arm64 entry in `_arm64.deb`.
 */
export function aptInstallPlans(entries) {
  if (!Array.isArray(entries)) return [];
  const plans = [];
  for (const entry of entries) {
    const plan = aptPlan(entry);
    if (plan) plans.push(plan);
  }
  return plans;
}

/** Paste-ready apt commands for deb entries, in entry order. Unsafe names are skipped. */
export function aptInstallCommands(entries) {
  return aptInstallPlans(entries).map((plan) => plan.command);
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
 * One specific arch uses that arch's lead. Several arches use the shared lead.
 * Each command is `sudo apt install ./` plus a .deb basename that passed
 * debFileName and the arch-suffix check. When none pass, returns the
 * fallback copy, which has no version placeholder.
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
