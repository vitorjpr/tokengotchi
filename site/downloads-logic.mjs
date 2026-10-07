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
 * Pick installers for one OS.
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
