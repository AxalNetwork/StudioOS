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
  "articles": "e89e5bb0",
  "authors": "3bffb97f",
  "company": "c2905dde",
  "content": "8c8ea435",
  "default": "ef323c4c",
  "event": "6fa3f14d",
  "home": "6ea003fc",
  "jobs": "54a75533",
  "pricing": "21ab152f",
  "pricing-investor": "29cb8816",
  "privacy": "8015b6ee",
  "privacy-interviews": "189295f2",
  "private": "34ba2c74",
  "product": "6c19a0ac",
  "product-advisors": "e6be160b",
  "product-founders": "15043d1b",
  "product-investors": "52bbb8e6",
  "product-service-partners": "346158bc",
  "profile": "96532f1b",
  "risk-disclosures": "ea8af5a3",
  "spinout-lab": "d78e31ed",
  "terms": "1fdbc129",
  "trust": "bcf0c4e4",
  "trust-data": "ee33d877",
  "trust-disclosure": "9386880c",
  "trust-documents": "7cbbd355",
  "trust-security": "40cc9824",
  "trust-subprocessors": "80c308de",
};
