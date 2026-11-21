/**
 * #7591: the opening tag (from its `<` to its `>`) whose attributes hold `attr` exactly as written, for tests that
 * read rendered markup; '' when no tag does. `ok(tag)` narrows which tags count (`(t) => t.startsWith('<a')`).
 * A literal scan, not a pattern built from the attribute (Semgrep detect-non-literal-regexp is fixed, not suppressed:
 * GOTCHAS.md); it returns what `<…[^>]*ATTR[^>]*>` returned for the tags these tests render.
 */
export function tagHolding(html, attr, ok = () => true) {
  for (let i = html.indexOf(attr); i >= 0; i = html.indexOf(attr, i + 1)) {
    const start = html.lastIndexOf('<', i);
    const end = html.indexOf('>', i);
    if (start < 0 || end < 0 || html.indexOf('>', start) < i) continue;
    const tag = html.slice(start, end + 1);
    if (ok(tag)) return tag;
  }
  return '';
}
