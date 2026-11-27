// D717 (#1852) — the template editor's scroll sync, as pure functions.
//
// The Markdown source and the live paper scroll together: each pane's
// headings are anchors, the two lists are paired in order by heading text,
// and an offset in one pane maps to the other exactly at a paired heading and
// proportionally between two. A start and an end anchor bound both panes.

const TOKEN = /\{\{[^}]*\}\}/g;
const BRACKET_LABEL = /\[[^\]]*\]/g;

/**
 * The text two headings are compared by: lowercased, the leading `#`s, `*`,
 * double-brace tokens and square-bracket labels removed, spaces collapsed. The
 * source writes `{{deal.amount}}` where the paper prints a bracket label, so
 * both drop out.
 */
export function headingKey(text) {
  return String(text ?? '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(TOKEN, ' ')
    .replace(BRACKET_LABEL, ' ')
    .replace(/\*/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The source's anchors: each line starting `#`, `##` or `###`, at its row's offset. */
export function sourceAnchors(lines, offsets) {
  const out = [];
  (lines || []).forEach((line, i) => {
    if (!/^#{1,3}\s+\S/.test(line)) return;
    const y = offsets?.[i];
    if (!Number.isFinite(y)) return;
    const text = headingKey(line);
    if (text) out.push({ text, y });
  });
  return out;
}

/**
 * Pair the two anchor lists in order by heading text. A source heading with no
 * paper match after the last pair (the dropped title, a run-in) is skipped.
 * The answer starts at `{ s: 0, p: 0 }` and ends at the two pane ends, and is
 * strictly increasing in both panes.
 */
export function pairAnchors(source, paper, { sourceEnd, paperEnd }) {
  const pairs = [{ s: 0, p: 0 }];
  const paperKeyed = (paper || []).map((a) => ({ text: headingKey(a.text), y: a.y }));
  let from = 0;
  for (const a of source || []) {
    const key = headingKey(a.text);
    if (!key) continue;
    let j = from;
    while (j < paperKeyed.length && paperKeyed[j].text !== key) j += 1;
    if (j >= paperKeyed.length) continue;
    const last = pairs[pairs.length - 1];
    if (a.y > last.s && paperKeyed[j].y > last.p) pairs.push({ s: a.y, p: paperKeyed[j].y });
    from = j + 1;
  }
  const last = pairs[pairs.length - 1];
  const end = { s: Math.max(sourceEnd || 0, last.s), p: Math.max(paperEnd || 0, last.p) };
  if (end.s > last.s || end.p > last.p) pairs.push(end);
  return pairs;
}

/**
 * The other pane's offset for `y` in pane `from` ('s' or 'p'), clamped to the
 * pairs' range: exact at a paired heading, proportional between two.
 */
export function mapOffset(y, pairs, from, to) {
  if (!pairs?.length) return 0;
  const first = pairs[0], last = pairs[pairs.length - 1];
  if (!(y > first[from])) return first[to];
  if (y >= last[from]) return last[to];
  for (let i = 0; i < pairs.length - 1; i += 1) {
    const a = pairs[i], b = pairs[i + 1];
    if (y >= a[from] && y <= b[from]) {
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((y - a[from]) / span) * (b[to] - a[to]) : a[to];
    }
  }
  return last[to];
}
