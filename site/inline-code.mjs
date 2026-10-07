/** Split `backtick` spans out of a plain string so callers can render `<code>`. */
export function inlineCodeSegments(text) {
  const parts = [];
  const pattern = /`([^`]+)`/g;
  let cursor = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > cursor) parts.push({ code: false, value: text.slice(cursor, match.index) });
    parts.push({ code: true, value: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || parts.length === 0) parts.push({ code: false, value: text.slice(cursor) });
  return parts;
}
