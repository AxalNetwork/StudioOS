/** D8398: the partner console retains the Offers kit and leaves the two overlays untouched.
 *
 * From frontend/test/README.md (moved by #6472): D8398: partner console Offers controls, labels,
 * typography and failed reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/pages/PerksPage.jsx', import.meta.url), 'utf8');
const consoleSource = source.slice(source.indexOf('const INPUT ='), source.indexOf('export const PERKS_REVIEW_PATH'));
test('partner controls use the shared Offers actions, input and heading owners', () => {
  assert.match(consoleSource, /const INPUT = offerInputClass/);
  assert.match(consoleSource, /offerButtonClass} w-full/);
  assert.match(consoleSource, /OfferHeading title="Submit a perk"/);
  assert.match(consoleSource, /OfferHeading title="Listing performance"/);
  assert.doesNotMatch(consoleSource, /className="[^"\n]*(?:bg-violet-600|text-violet-700)[^"\n]*"/);
});
test('console type has a 12px floor and visible performance labels', () => {
  for (const [, size] of consoleSource.matchAll(/text-\[([\d.]+)px\]/g)) assert.ok(Number(size) >= 12);
  assert.doesNotMatch(consoleSource, /text-axal-faint/);
  assert.match(consoleSource, /PerkField label="New cap"/);
  assert.match(consoleSource, /PerkField label="Redemption code"/);
});
test('both failed reads use the shared written error and SectionState', () => {
  assert.match(consoleSource, /setReadErr\(zoneReadError\(e\)\)/);
  assert.match(consoleSource, /setLoadErr\(zoneReadError\(e\)\)/);
  assert.match(consoleSource, /SectionState what="Your listings" error={loadErr}/);
  assert.match(consoleSource, /SectionState what="This listing’s performance" error={readErr}/);
  assert.doesNotMatch(consoleSource, /<Unreadable/);
});

test('rendered embedded console has labelled date and grant fields, an amber phone primary', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: PerksPage } = await import('../src/pages/PerksPage.jsx');
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, {}, React.createElement(PerksPage, { embedded: true, role: 'partner' })));
  assert.match(html, /<h2[^>]*>Submit a perk<\/h2>/);
  assert.match(html, /<label[^>]*>Ends \(optional\)<input[^>]*type="date"/);
  assert.match(html, /<label[^>]*>What it grants beyond the offer, and for how long \(optional\)<input/);
  assert.match(html, /<button[^>]*type="submit"[^>]*class="[^"]*bg-amber-700[^"]*max-sm:min-h-\[48px\]/);
});
