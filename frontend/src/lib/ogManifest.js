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
  "articles": "727775fb",
  "authors": "02676621",
  "company": "5642b840",
  "content": "e9ba2ee0",
  "default": "7c0dd1a3",
  "event": "3f66533b",
  "home": "fcff10ae",
  "jobs": "168a1a2c",
  "pricing": "3359603a",
  "pricing-investor": "8914e7b7",
  "privacy": "692d1bd4",
  "privacy-interviews": "d66dab02",
  "private": "c6c4ca6e",
  "product": "5fab2746",
  "product-advisors": "df55b034",
  "product-founders": "a74cbcb5",
  "product-investors": "e101c189",
  "product-service-partners": "c7c4cda8",
  "profile": "2b19792b",
  "risk-disclosures": "8a99a8e8",
  "spinout-lab": "880ef769",
  "terms": "4c77b05a",
  "trust": "224099fc",
  "trust-data": "69e04a69",
  "trust-disclosure": "9fa59e4c",
  "trust-documents": "5e9cf148",
  "trust-security": "164e9fbc",
  "trust-subprocessors": "91fd737f",
};
