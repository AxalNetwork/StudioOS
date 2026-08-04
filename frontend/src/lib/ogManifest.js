/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by `scripts/generate-og-images.mjs`. Maps an OG image key to the
 * SHA-256 (first 8 hex chars) of the generated PNG's bytes.
 *
 * The hash is appended to the image URL as `?v=<hash>`, which is what makes
 * cache-busting automatic: regenerating a card because its copy changed also
 * changes its content hash, so the URL changes, so CDNs and clients that keyed
 * on the old URL fetch the new bytes instead of serving a stale card.
 *
 * A key missing from this map is not an error — `ogImageUrl()` simply omits
 * the version param. That keeps the app booting if images have not been
 * generated yet (fresh clone, or a route added before its card was rendered).
 *
 * Regenerate with:  node scripts/generate-og-images.mjs
 */
export const OG_MANIFEST = {
  "articles": "e363a4a0",
  "company": "7d75c4c4",
  "content": "1631f280",
  "default": "7218d490",
  "home": "1e0dde2f",
  "jobs": "6cc8be5c",
  "pricing": "78d39a47",
  "product": "8ed8d67e",
  "product-advisors": "dd0b822a",
  "product-founders": "735998bb",
  "product-investors": "7cd298a0",
  "product-service-partners": "b3464c1d",
  "spinout-lab": "06c7aee7",
};
