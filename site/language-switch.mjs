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
 * Kept only while that section exists and is on screen, or while the page is
 * still moving toward a hash the reader just followed and has not yet reached.
 * A missing section, an undecodable hash, and a hash whose section has left
 * the screen stay off the links. Scrolling back down does not restore one.
 */
export function createLanguageSwitchHash() {
  let followed = '';
  let sawInView = false;
  let dismissed = false;
  let moved = false;

  return function languageSwitchHash(state = {}) {
    const hash = explicitHash(state.hash);
    if (!hash || state.found === false) {
      followed = '';
      sawInView = false;
      dismissed = false;
      moved = false;
      return '';
    }
    const inView = sectionInView(state);
    if (inView === null) {
      followed = '';
      sawInView = false;
      dismissed = false;
      moved = false;
      return '';
    }
    const armedNow = hash !== followed;
    if (armedNow) {
      followed = hash;
      sawInView = false;
      dismissed = false;
      moved = false;
    }
    if (inView) {
      sawInView = true;
      moved = true;
      dismissed = false;
      return hash;
    }
    if (sawInView || dismissed) {
      dismissed = true;
      return '';
    }
    const scrollY = Number.isFinite(state.scrollY) ? state.scrollY : 0;
    if (scrollY > 48) {
      moved = true;
      return hash;
    }
    if (moved) dismissed = true;
    return '';
  };
}
