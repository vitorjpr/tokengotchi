export const LOCALE_COOKIE = 'tokengotchi_locale';

export function readLocaleCookie(cookieHeader = '') {
  for (const part of String(cookieHeader).split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== LOCALE_COOKIE) continue;
    const value = part.slice(separator + 1).trim().toLowerCase();
    if (value === 'en' || value === 'pt') return value;
  }
  return null;
}

/** Highest-q language tag. `pt*` → `pt`, everything else → `en`. */
export function preferredLocale(acceptLanguage = '') {
  const ranked = [];
  for (const part of String(acceptLanguage).split(',')) {
    const [rawTag, ...params] = part.trim().split(';');
    const tag = rawTag.trim().toLowerCase();
    if (!tag || tag === '*') continue;
    let q = 1;
    for (const param of params) {
      const [key, raw] = param.trim().split('=');
      if (key.trim() !== 'q') continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) q = parsed;
    }
    ranked.push({ tag, q, index: ranked.length });
  }
  ranked.sort((a, b) => b.q - a.q || a.index - b.index);
  const best = ranked.find((item) => item.q > 0);
  return best?.tag.startsWith('pt') ? 'pt' : 'en';
}

export function chooseLocale({ cookieHeader = '', acceptLanguage = '' } = {}) {
  return readLocaleCookie(cookieHeader) || preferredLocale(acceptLanguage);
}
