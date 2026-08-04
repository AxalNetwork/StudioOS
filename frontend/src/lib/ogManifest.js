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
  "articles": "a58fa6df",
  "company": "4c30a70f",
  "content": "8cc826c5",
  "default": "b8e2d3dc",
  "home": "88aa287c",
  "jobs": "11dcbf8f",
  "pricing": "410ae5e8",
  "product": "eb4e2a52",
  "product-advisors": "78559744",
  "product-founders": "dece2995",
  "product-investors": "f54ae8c5",
  "product-service-partners": "b64d1e59",
  "spinout-lab": "c72b2c5b",
};
