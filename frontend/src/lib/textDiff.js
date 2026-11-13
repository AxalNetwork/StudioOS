// D717 (#1782) decision 9 — version compare, pure.
//
// `diffText(a, b)` compares two template bodies word by word: Myers' O(ND)
// diff over tokens, where a token is a word with the whitespace after it, so
// the parts join back into each text exactly. Above WORD_CAP words on either
// side it compares line by line instead and says so (`mode: 'lines'`,
// `capped: true`, `reason: 'word_cap'`). Past EDIT_BUDGET edits a word compare
// falls back to lines (`reason: 'edit_budget'`), and a line compare to the
// whole text replaced (`mode: 'whole'`), so a tab never stalls. The screen
// marks `ins` parts with <ins> and `del` parts with <del>; this module returns
// only the parts.
//
// `metaChanges(a, b)` lists the title, kind and party changes the compare
// view prints above the text.

export const WORD_CAP = 20000;
/** The most edits a compare shows before it falls back to lines, then to the whole text. */
export const EDIT_BUDGET = 1500;

const wordTokens = (s) => String(s ?? '').match(/\S+\s*|\s+/g) || [];
const lineTokens = (s) => String(s ?? '').match(/[^\n]*\n|[^\n]+$/g) || [];

/**
 * Myers' shortest edit script over two token arrays, as [op, token] pairs,
 * or null when it needs more than `budget` edits. Each step keeps only the
 * frontier it can reach (k in -d..d), so memory grows with the edits, not the
 * text: about budget² cells at most.
 */
function myers(a, b, budget) {
  const n = a.length; const m = b.length;
  const limit = Math.min(n + m, budget);
  let v = new Map([[1, 0]]);
  const trace = [];
  let reached = false;
  for (let d = 0; d <= limit && !reached; d++) {
    trace.push(v);
    const next = new Map();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      next.set(k, x);
      if (x >= n && y >= m) { reached = true; break; }
    }
    v = next;
  }
  if (!reached) return null;
  // Walk back: trace[d] is the frontier before step d.
  const out = [];
  let x = n; let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : (vd.get(prevK) ?? 0);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { out.push(['eq', a[x - 1]]); x--; y--; }
    if (d > 0) {
      if (x === prevX) { out.push(['ins', b[y - 1]]); y--; } else { out.push(['del', a[x - 1]]); x--; }
    }
  }
  while (x > 0 && y > 0) { out.push(['eq', a[x - 1]]); x--; y--; }
  return out.reverse();
}

/** Adjacent tokens with the same op, joined into one part. */
function merge(script) {
  const parts = [];
  for (const [op, text] of script) {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text; else parts.push({ op, text });
  }
  return parts;
}

/**
 * The parts that turn `a` into `b`: `{ op: 'eq' | 'ins' | 'del', text }`.
 * Joining the `eq` and `del` texts gives `a`; joining `eq` and `ins` gives `b`.
 */
export function diffText(a, b, { cap = WORD_CAP, budget = EDIT_BUDGET } = {}) {
  const wa = wordTokens(a); const wb = wordTokens(b);
  const words = (t) => t.filter((x) => /\S/.test(x)).length;
  const overCap = words(wa) > cap || words(wb) > cap;
  let mode = 'words';
  let reason = null;
  let script = overCap ? null : myers(wa, wb, budget);
  if (!script) {
    // Above the cap, or too many word edits to show usefully: compare lines.
    mode = 'lines';
    reason = overCap ? 'word_cap' : 'edit_budget';
    script = myers(lineTokens(a), lineTokens(b), budget);
  }
  if (!script) {
    // Too many line edits too: the whole text was replaced.
    mode = 'whole';
    script = [...(String(a ?? '') ? [['del', String(a)]] : []), ...(String(b ?? '') ? [['ins', String(b)]] : [])];
  }
  const parts = merge(script);
  return {
    mode,
    capped: mode !== 'words',
    reason,
    parts,
    changed: parts.some((p) => p.op !== 'eq'),
    inserted: parts.filter((p) => p.op === 'ins').length,
    deleted: parts.filter((p) => p.op === 'del').length,
  };
}

const META_FIELDS = Object.freeze([
  ['title', 'title'],
  ['kind', 'doc_kind'],
  ['party', 'axal_party'],
]);

/**
 * The title, kind and party changes between two versions (or a version and
 * the draft). A null kind or party means "from the slug", and is reported as
 * null so the screen can say so.
 */
export function metaChanges(a, b) {
  const out = [];
  for (const [field, key] of META_FIELDS) {
    const from = a?.[key] ?? null; const to = b?.[key] ?? null;
    if (from !== to) out.push({ field, from, to });
  }
  return out;
}
