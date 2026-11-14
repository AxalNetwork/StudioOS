/**
 * D903 (#2682): the overlay's contrast rule, with no imports, so the Worker's
 * test can hold it to `services/decks/images.ts` figure for figure.
 *
 * A background's text is light on an overlay in the brand ink. The image under
 * it could be anything, so the figure is the worst case: the overlay over a
 * white pixel, against the text, by WCAG 2.x relative luminance.
 */
export const OVERLAY_ALPHA = Object.freeze({ none: 0, light: 0.65, strong: 0.8 });
export const BACKGROUND_TEXT = '#fbfaf7';
export const DEFAULT_INK = '#0f2a3d';
export const CONTRAST_MIN = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** The worst-case contrast of a background's text on this overlay, to two places (the Worker's figure). */
export function overlayContrast(overlay, ink = DEFAULT_INK, text = BACKGROUND_TEXT) {
  const a = OVERLAY_ALPHA[overlay] ?? 0;
  const inkRgb = channels(HEX.test(ink || '') ? ink : DEFAULT_INK);
  const under = inkRgb.map((c) => Math.round(a * c + (1 - a) * 255));
  const [hi, lo] = [luminance(channels(text)), luminance(under)].sort((x, y) => y - x);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** An ink as its three channels, the default ink when it is not a colour. */
export const inkChannels = (ink) => channels(HEX.test(ink || '') ? ink : DEFAULT_INK);
