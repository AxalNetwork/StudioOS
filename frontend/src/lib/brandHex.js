/** Expand #rgb to #rrggbb for CSS colour and alpha suffixes (D457). */
export function cssHex(hex) {
  const h = String(hex || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h;
}

/** `#rrggbb` + two-digit alpha, or undefined when the input is not a hex colour. */
export function hexWithAlpha(hex, alpha = '14') {
  const full = cssHex(hex);
  if (/^#[0-9a-fA-F]{6}$/.test(full)) return `${full}${alpha}`;
  return undefined;
}
