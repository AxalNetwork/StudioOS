/**
 * #3661 — measurements of a rendered card for `preflightModel.js`: whether a
 * block's text is clipped, its computed font size, and an image's own pixels.
 * The caller renders the card at export size (1920 × 1080, `BlockGrid`'s
 * `print` size, as the print page the PDF and PowerPoint photograph does) and
 * hands each block's cell element. Nothing is guessed: a value the browser
 * did not give is left out, and the preflight then says "Not measured".
 *
 * `entries` is `[{ card, block, el }]`: the card's index, the block's id, and
 * the block's cell (the element whose box is the block's range).
 * `getStyle` is `window.getComputedStyle`, passed in so a test can stub it.
 */
export function measureBlocks(entries, getStyle = globalThis.getComputedStyle) {
  const out = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    const el = e?.el;
    if (!el || !Number.isInteger(e.card) || typeof e.block !== 'string') continue;
    const m = {};
    const box = [el.scrollHeight, el.clientHeight, el.scrollWidth, el.clientWidth];
    // A box the layout has not sized (0 × 0, or not attached) tells nothing.
    if (box.every((n) => Number.isFinite(n)) && el.clientHeight > 0 && el.clientWidth > 0) {
      m.clipped = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    }
    const text = typeof el.querySelector === 'function' ? el.querySelector('span, li, p') : null;
    if (text && typeof getStyle === 'function') {
      const px = parseFloat(getStyle(text)?.fontSize);
      if (Number.isFinite(px) && px > 0) m.font_px = px;
    }
    const img = typeof el.querySelector === 'function' ? el.querySelector('img') : null;
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      m.natural_w = img.naturalWidth;
      m.natural_h = img.naturalHeight;
    }
    if (Object.keys(m).length) out[`${e.card}:${e.block}`] = m;
  }
  return out;
}
