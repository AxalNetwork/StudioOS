/**
 * D1515 (#3767, deck v2 A4c, pd3) — editing a text block's rich text: B, I,
 * Accent and Link on D1500's model (#3750).
 *
 * A text block keeps `text`, its plain copy, and may keep `paras`:
 * `[{ runs: [{ text, b?, i?, u?, accent?, href? }] }]`, one paragraph per line
 * of `text`. The Worker rebuilds `text` from `paras` whenever `paras` holds a
 * run (`slideModel.parasOf`), so the two must never disagree: every change
 * here returns both, from one list of characters.
 *
 * Pure: no React, no network. Each character carries its marks; a change is
 * made on the characters and the runs are rebuilt by joining neighbours with
 * the same marks. A block with no mark left loses `paras` and is plain again.
 *
 * The Worker's limits are checked before anything changes, with its own
 * sentences: at most 40 paragraphs and 40 runs in each, at most 3 accent runs,
 * an accent that reads against the card (4.5 : 1), and a link that is https.
 */

export const MAX_PARAS = 40;
export const MAX_RUNS = 40;
export const MAX_ACCENT_RUNS = 3;
export const ACCENT_CONTRAST = 4.5;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

/** The marks B · I · Accent · Link set; `u` is kept as it was read. */
export const MARKS = Object.freeze(['b', 'i', 'accent', 'href']);
const KEPT = ['b', 'i', 'u', 'accent', 'href'];

const marksOfRun = (r) => {
  const m = {};
  for (const k of KEPT) if (r?.[k] !== undefined && r[k] !== false && r[k] !== null && r[k] !== '') m[k] = r[k];
  return m;
};
const sameMarks = (a, z) => KEPT.every((k) => (a[k] ?? null) === (z[k] ?? null));

/** The block as characters, each `{ ch, m }` (`ch` '\n' between paragraphs, with no marks). */
export function charsOf(block) {
  const out = [];
  if (Array.isArray(block?.paras) && block.paras.some((p) => Array.isArray(p?.runs) && p.runs.some((r) => typeof r?.text === 'string' && r.text))) {
    block.paras.forEach((p, i) => {
      if (i > 0) out.push({ ch: '\n', m: {} });
      for (const r of Array.isArray(p?.runs) ? p.runs : []) {
        if (typeof r?.text !== 'string') continue;
        const m = marksOfRun(r);
        for (const ch of r.text) out.push({ ch, m });
      }
    });
    return out;
  }
  for (const ch of String(block?.text ?? '')) out.push({ ch, m: {} });
  return out;
}

/** The plain words of a list of characters. */
export const textOf = (chars) => chars.map((c) => c.ch).join('');

/**
 * `{ text, paras }` for these characters; `paras` is null when no character
 * carries a mark (the block is plain).
 */
export function richOf(chars) {
  const text = textOf(chars);
  if (!chars.some((c) => Object.keys(c.m).length)) return { text, paras: null };
  const paras = [{ runs: [] }];
  for (const c of chars) {
    if (c.ch === '\n') { paras.push({ runs: [] }); continue; }
    const runs = paras[paras.length - 1].runs;
    const last = runs[runs.length - 1];
    if (last && sameMarks(last._m, c.m)) last.text += c.ch;
    else runs.push({ text: c.ch, _m: c.m });
  }
  return { text, paras: paras.map((p) => ({ runs: p.runs.map(({ _m, text: t }) => ({ text: t, ...(_m.b ? { b: true } : {}), ...(_m.i ? { i: true } : {}), ...(_m.u ? { u: true } : {}), ...(_m.accent ? { accent: _m.accent } : {}), ...(_m.href ? { href: _m.href } : {}) })) })) };
}

/** The block with these characters: `text` and `paras` together, and no `paras` key when it is plain. */
export function withChars(block, chars) {
  const { text, paras } = richOf(chars);
  const { paras: _old, ...rest } = block || {};
  return paras ? { ...rest, text, paras } : { ...rest, text };
}

/** What would make the Worker refuse or cut these paragraphs, as its sentence, or null. */
export function richProblem(paras, ground = '#ffffff') {
  if (!paras) return null;
  if (paras.length > MAX_PARAS) return `The text holds at most ${MAX_PARAS} paragraphs with styles.`;
  if (paras.some((p) => p.runs.length > MAX_RUNS)) return `A paragraph holds at most ${MAX_RUNS} styled pieces.`;
  const accents = paras.flatMap((p) => p.runs).filter((r) => r.accent);
  if (accents.length > MAX_ACCENT_RUNS) return `The text holds at most ${MAX_ACCENT_RUNS} accent runs.`;
  const bad = accents.find((r) => !COLOUR.test(r.accent) || contrastRatio(r.accent, ground) < ACCENT_CONTRAST);
  if (bad) return `The accent ${bad.accent} does not read against the card (contrast under ${ACCENT_CONTRAST}:1).`;
  return null;
}

/** The marks every character in [start, end) carries (an empty range reads the character before it). */
export function marksAt(block, start, end) {
  const chars = charsOf(block);
  const [s, e] = range(chars, start, end);
  const pick = e > s ? chars.slice(s, e).filter((c) => c.ch !== '\n') : chars.slice(Math.max(0, s - 1), s);
  if (!pick.length) return {};
  const out = {};
  for (const k of MARKS) {
    const v = pick[0].m[k];
    if (v !== undefined && pick.every((c) => c.m[k] === v)) out[k] = v;
  }
  return out;
}

function range(chars, start, end) {
  const n = chars.length;
  const s = Math.max(0, Math.min(n, Number.isInteger(start) ? start : 0));
  const e = Math.max(s, Math.min(n, Number.isInteger(end) ? end : n));
  return [s, e];
}

/**
 * Set (or, with `value` undefined, clear) one mark on [start, end): `b` and
 * `i` take true, `accent` a colour, `href` an https link. An empty range
 * marks the whole block. `{ block }`, or `{ error }` with the sentence and
 * nothing changed. `ground` is what the card's text sits on (the Worker's
 * `groundOf`).
 */
export function setMark(block, start, end, mark, value, { ground = '#ffffff' } = {}) {
  if (!MARKS.includes(mark)) return { error: 'That is not a text style.' };
  if (mark === 'href' && value !== undefined && !/^https:\/\/[^\s]+\.[^\s]+/i.test(String(value))) return { error: 'A link starts with https:// and names a site.' };
  if (mark === 'accent' && value !== undefined && !COLOUR.test(String(value))) return { error: 'The accent is not a colour like #1a2b3c.' };
  const chars = charsOf(block);
  let [s, e] = range(chars, start, end);
  if (e === s) { s = 0; e = chars.length; }
  if (!chars.slice(s, e).some((c) => c.ch !== '\n')) return { error: 'Type some words first.' };
  const next = chars.map((c, i) => {
    if (i < s || i >= e || c.ch === '\n') return c;
    const m = { ...c.m };
    if (value === undefined || value === false) delete m[mark];
    else m[mark] = mark === 'accent' ? String(value).toLowerCase() : value;
    return { ch: c.ch, m };
  });
  const out = withChars(block, next);
  const problem = richProblem(out.paras || null, ground);
  return problem ? { error: `${problem} Nothing changed.` } : { block: out };
}

/** B and I: on when every character in the range has it, so a press turns it off; otherwise on. */
export function toggleMark(block, start, end, mark, opts) {
  const on = marksAt(block, start === end ? 0 : start, start === end ? charsOf(block).length : end)[mark];
  return setMark(block, start, end, mark, on ? undefined : true, opts);
}

/**
 * The block after its words were typed over: the change between the old
 * words and `text` is found (the shared start and end kept), and the new
 * characters take the marks of the one before them, as a word processor
 * does. A plain block stays plain.
 */
export function retext(block, text) {
  const next = String(text ?? '');
  if (!Array.isArray(block?.paras)) return { ...block, text: next };
  const chars = charsOf(block);
  const old = textOf(chars);
  if (old === next) return block;
  let p = 0;
  while (p < old.length && p < next.length && old[p] === next[p]) p += 1;
  let q = 0;
  while (q < old.length - p && q < next.length - p && old[old.length - 1 - q] === next[next.length - 1 - q]) q += 1;
  return withChars(block, spliceChars(chars, p, old.length - q, next.slice(p, next.length - q)));
}

/**
 * Replace [start, end) with `insert`. The new characters take the marks of
 * the first one they replace, or, when nothing is replaced, of the one before
 * (the one after, at the start of a paragraph).
 */
export function spliceChars(chars, start, end, insert) {
  const markOf = (c) => (c && c.ch !== '\n' ? c.m : null);
  const before = (end > start ? markOf(chars[start]) : null) ?? markOf(chars[start - 1]) ?? markOf(chars[start]) ?? {};
  const added = [...String(insert)].map((ch) => ({ ch, m: ch === '\n' ? {} : before }));
  return [...chars.slice(0, start), ...added, ...chars.slice(end)];
}

/** The contrast ratio of two #rrggbb colours, 1 to 21 (the Worker's `contrastRatio`). */
export function contrastRatio(a, z) {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(z)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** What a card's text sits on: its own background colour, else white (the Worker's `groundOf`). */
export const groundOf = (card) => (typeof card?.background?.color === 'string' && COLOUR.test(card.background.color) ? card.background.color.toLowerCase() : '#ffffff');
