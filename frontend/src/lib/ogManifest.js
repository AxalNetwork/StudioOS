/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by `scripts/generate-og-images.mjs`. Maps an OG image key to the
 * SHA-256 (first 8 hex chars) of the card's RENDER INPUTS — its copy plus the
 * inlined font, mark and template. Deliberately not a hash of the PNG bytes:
 * those vary by browser build, which made the CI check fail on any machine but
 * the one that generated the cards.
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
  "articles": "f8ba8540",
  "company": "9e7ceb16",
  "content": "2bc2c9b1",
  "default": "1a45773f",
  "home": "69a1630b",
  "jobs": "83856fd8",
  "pricing": "8612984c",
  "product": "29a42ae7",
  "product-advisors": "e83acd0d",
  "product-founders": "896964db",
  "product-investors": "9d41dfcb",
  "product-service-partners": "3902653e",
  "spinout-lab": "59a05b30",
};
