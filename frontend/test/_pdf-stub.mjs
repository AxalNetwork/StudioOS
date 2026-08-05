// A recording stand-in for a jsPDF document, enough of one to lay out a page.
//
// It exists so `fund_brief_layout.test.mjs` can run the real drawing code from
// lib/fundBriefPdf.js under `node --test` — no browser, no jspdf install — and
// still get truthful text measurements. That matters because the one failure a
// single-page PDF has is silent: content past the page box is clipped, never
// paginated, so a brief that overflows looks fine right up until someone opens
// the download and a section is missing.
//
// MEASUREMENT. Widths are the Adobe AFM tables for the PDF core faces jsPDF
// uses when no font is embedded (Helvetica, Helvetica-Bold, Courier), in
// 1/1000 em. jsPDF computes a string's width as Σ(w/1000)·fontSize plus
// charSpace per character, which is what `getTextWidth` below does — so the
// numbers agree with the real renderer to within rounding.
//
// splitTextToSize is a greedy space-wrap. jsPDF's own splitter also breaks on
// hyphens, so it can produce MORE lines than this for hyphenated copy; the
// layout test leaves headroom for that rather than pretending to be exact.

/* eslint-disable no-multi-spaces */
const HELV = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '·': 278, '–': 556, '—': 1000, '’': 222, '‘': 222, '“': 333, '”': 333, '…': 1000, '×': 584,
};

const HELV_BOLD = {
  ...HELV,
  '!': 333, '"': 474, '&': 722, "'": 238, ':': 333, ';': 333, '?': 611, '@': 975,
  A: 722, B: 722, J: 556, K: 722, L: 611,
  '[': 333, ']': 333, '^': 584, '`': 333,
  b: 611, c: 556, d: 611, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278,
  m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, t: 333, u: 611, v: 556, w: 778,
  x: 556, y: 556,
  '{': 389, '|': 280, '}': 389,
};
/* eslint-enable no-multi-spaces */

const FALLBACK = 556; // unknown glyph — the common Helvetica width

function glyphWidth(ch, font, style) {
  if (font === 'courier') return 600;
  const table = style === 'bold' ? HELV_BOLD : HELV;
  return table[ch] ?? FALLBACK;
}

/**
 * @returns {object} a jsPDF-shaped doc that records what was drawn.
 *   `.maxY` / `.maxX` are the lowest and right-most edges touched, in points.
 *   `.calls` is every operation, for assertions about specific marks.
 */
export function createPdfStub() {
  const state = { font: 'helvetica', style: 'normal', size: 12, charSpace: 0 };
  const calls = [];
  let maxY = 0;
  let maxX = 0;

  const touch = (x, y) => {
    if (Number.isFinite(x) && x > maxX) maxX = x;
    if (Number.isFinite(y) && y > maxY) maxY = y;
  };

  const measure = (str) => {
    let units = 0;
    for (const ch of String(str)) units += glyphWidth(ch, state.font, state.style);
    return (units / 1000) * state.size + state.charSpace * String(str).length;
  };

  const doc = {
    get maxY() { return maxY; },
    get maxX() { return maxX; },
    calls,
    state,

    setFont(font, style) { state.font = font; state.style = style || 'normal'; },
    setFontSize(size) { state.size = size; },
    setCharSpace(v) { state.charSpace = v || 0; },
    setFillColor() {},
    setDrawColor() {},
    setTextColor() {},
    setLineWidth() {},
    setLineDashPattern() {},
    setProperties() {},

    rect(x, y, w, h) { calls.push({ op: 'rect', x, y, w, h }); touch(x + w, y + h); },
    roundedRect(x, y, w, h) { calls.push({ op: 'rrect', x, y, w, h }); touch(x + w, y + h); },
    line(x1, y1, x2, y2) { calls.push({ op: 'line', x1, y1, x2, y2 }); touch(Math.max(x1, x2), Math.max(y1, y2)); },

    getTextWidth(str) { return measure(str); },

    splitTextToSize(str, maxWidth) {
      const out = [];
      for (const paragraph of String(str).split('\n')) {
        const words = paragraph.split(' ');
        let line = '';
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && measure(candidate) > maxWidth) {
            out.push(line);
            line = word;
          } else {
            line = candidate;
          }
        }
        out.push(line);
      }
      return out;
    },

    text(text, x, y, options = {}) {
      const lines = Array.isArray(text) ? text : [text];
      const lh = options.lineHeightFactor ?? 1.15;
      const height = lines.length * state.size * lh;
      const width = Math.max(...lines.map((l) => measure(l)));
      const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
      calls.push({ op: 'text', text: lines.join(' '), x, y, left, width, height, size: state.size, align: options.align });
      // jsPDF's 'top' baseline puts y at the top of the first line; everything
      // this document draws uses it.
      touch(left + width, y + height);
      return doc;
    },

    save(name) { calls.push({ op: 'save', name }); },
  };
  return doc;
}
