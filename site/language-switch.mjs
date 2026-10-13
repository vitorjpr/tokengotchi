function explicitHash(hash) {
  if (typeof hash !== 'string') return '';
  const value = hash.trim();
  if (!value.startsWith('#') || value.length < 2) return '';
  return value;
}

/** True when the fragment's element intersects the viewport, null when it cannot be judged. */
function sectionInView({ targetTop = null, targetBottom = null, viewportHeight = 0 } = {}) {
  if (targetTop == null || targetBottom == null || !(viewportHeight > 0)) return null;
  if (!Number.isFinite(targetTop) || !Number.isFinite(targetBottom)) return null;
  return targetTop < viewportHeight * 0.85 && targetBottom > 48;
}

/**
 * Hash to put on an EN/PT link.
 * A fragment is kept while its section is on screen, and while the page is
 * still moving toward a fragment the user just followed. At the top of the
 * page a leftover fragment (typically #download) is dropped, so the other
 * language opens at the top.
 */
export function createLanguageSwitchHash() {
  let seenFor = '';
  return function languageSwitchHash(state = {}) {
    const hash = explicitHash(state.hash);
    if (!hash) {
      seenFor = '';
      return '';
    }
    const inView = sectionInView(state);
    if (inView === null) return hash;
    if (inView) {
      seenFor = hash;
      return hash;
    }
    const scrollY = Number.isFinite(state.scrollY) ? state.scrollY : 0;
    if (scrollY <= 48) {
      seenFor = '';
      return '';
    }
    if (seenFor === hash) return '';
    return hash;
  };
}
