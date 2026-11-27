// Shared jsPDF drawing surface for the Axal VC documents.
//
// Extracted from fundBriefPdf.js when the quarterly report arrived and needed
// the same primitives. Both documents are Claude Design exports authored on a
// letter page box, which at 96dpi is 816 × 1056 CSS px; letter at 72dpi is
// 612 × 792 pt. Every length in those files therefore maps to points by ×0.75,
// so the renderers work in the design's own px throughout and convert once, at
// the drawing call. Design numbers can be transcribed verbatim and compared
// against the source by eye.
//
// Nothing here knows about a specific document — no palette, no page furniture.
// Each renderer keeps its own colours and section helpers.

/** The letter page box, in the design px these renderers lay out in. */
export const BOARD = { w: 816, h: 1056 };

/** One design px, in points. */
export const PT = 0.75;

export const pt = (px) => px * PT;

export const hex = (h) => {
  const s = String(h).replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

/** Ink used when a caller passes no colour. Overridden per document in practice. */
const DEFAULT_INK = '#18181b';

/**
 * Thin wrapper giving a jsPDF document a design-px vocabulary.
 *
 * Every method takes and returns design px. `text` uses jsPDF's 'top' baseline
 * so `y` is the TOP of the first line — which is how a CSS box is specified —
 * and returns the y the block ends at, so callers can flow down a column.
 */
export function board(doc) {
  const setFill = (h) => { const [r, g, b] = hex(h); doc.setFillColor(r, g, b); };
  const setDraw = (h) => { const [r, g, b] = hex(h); doc.setDrawColor(r, g, b); };
  const setText = (h) => { const [r, g, b] = hex(h); doc.setTextColor(r, g, b); };
  const spacing = (n) => { if (typeof doc.setCharSpace === 'function') doc.setCharSpace(pt(n || 0)); };

  const font = ({ size = 11, style = 'normal', mono = false }) => {
    doc.setFont(mono ? 'courier' : 'helvetica', style);
    doc.setFontSize(pt(size));
  };

  return {
    doc,

    rect(x, y, w, h, fill) { setFill(fill); doc.rect(pt(x), pt(y), pt(w), pt(h), 'F'); },

    rrect(x, y, w, h, r, { fill, stroke, lineWidth = 1 } = {}) {
      if (fill) setFill(fill);
      if (stroke) { setDraw(stroke); doc.setLineWidth(pt(lineWidth)); }
      const mode = fill && stroke ? 'FD' : fill ? 'F' : 'S';
      doc.roundedRect(pt(x), pt(y), pt(w), pt(h), pt(r), pt(r), mode);
    },

    hline(x1, x2, y, color, width = 1) {
      setDraw(color);
      doc.setLineWidth(pt(width));
      doc.line(pt(x1), pt(y), pt(x2), pt(y));
    },

    vline(x, y1, y2, color, width = 1) {
      setDraw(color);
      doc.setLineWidth(pt(width));
      doc.line(pt(x), pt(y1), pt(x), pt(y2));
    },

    /** Dotted rule — jsPDF has setLineDashPattern; fall back to solid. */
    dotted(x1, x2, y, color) {
      setDraw(color);
      doc.setLineWidth(pt(1));
      if (typeof doc.setLineDashPattern === 'function') {
        doc.setLineDashPattern([pt(1), pt(2)], 0);
        doc.line(pt(x1), pt(y), pt(x2), pt(y));
        doc.setLineDashPattern([], 0);
      } else {
        doc.line(pt(x1), pt(y), pt(x2), pt(y));
      }
    },

    width(str, opts = {}) { font(opts); return doc.getTextWidth(String(str)) / PT; },

    wrap(str, maxW, opts = {}) { font(opts); return doc.splitTextToSize(String(str), pt(maxW)); },

    text(str, x, y, opts = {}) {
      const { size = 11, color = DEFAULT_INK, align = 'left', lineHeight = 1.25, ls = 0, maxW } = opts;
      font(opts);
      setText(color);
      spacing(ls);
      const lines = maxW ? doc.splitTextToSize(String(str), pt(maxW)) : [String(str)];
      doc.text(lines, pt(x), pt(y), { align, baseline: 'top', lineHeightFactor: lineHeight });
      spacing(0);
      return y + lines.length * size * lineHeight;
    },

    /**
     * Horizontal gradient as vertical slices — jsPDF has no gradient primitive.
     * `stops` is an array of hex colours with an optional `mid` fraction naming
     * where the second stop sits (the designs use a 42–44% midpoint).
     */
    gradientBand(x, y, w, h, stops, mid = 0.42) {
      const SLICES = 96;
      const rgb = stops.map(hex);
      for (let i = 0; i < SLICES; i++) {
        const t = i / (SLICES - 1);
        const [a, b2, k] = t < mid
          ? [rgb[0], rgb[1], t / mid]
          : [rgb[1], rgb[2] ?? rgb[1], (t - mid) / (1 - mid)];
        const mix = a.map((v, j) => Math.round(v + (b2[j] - v) * k));
        doc.setFillColor(mix[0], mix[1], mix[2]);
        // +1px overlap so slice seams never show as hairlines at high zoom,
        // clamped at the last slice so the band does not bleed past the trim.
        const sx = x + (i * w) / SLICES;
        doc.rect(pt(sx), pt(y), pt(Math.min(w / SLICES + 1, x + w - sx)), pt(h), 'F');
      }
    },
  };
}
