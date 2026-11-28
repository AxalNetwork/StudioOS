// D7004 (#7004): JSON-LD from recorded facts only — Organization on / and /about, BreadcrumbList on the trust
// subsections (prerendered) and on each help guide, Article and Event from their records.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/structured_data_7004.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OG_ROUTES, prerenderedRoutes } from '../src/lib/ogRegistry.js';
import { SOCIAL_LINKS } from '../src/lib/siteLinks.js';
import {
  FORBIDDEN_LD_KEYS, articleLd, eventLd, isoDate, jsonLdScript, structuredDataFor, withStructuredData,
} from '../src/lib/structuredData.js';
import { SECTIONS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { guideBreadcrumbLd } from '../src/pages/docs/helpCenter.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Run the real prerender, in plain Node, over the source shell in a scratch directory. */
function prerender() {
  const out = mkdtempSync(join(tmpdir(), 'structured-data-7004-'));
  cpSync(join(ROOT, 'frontend/index.html'), join(out, 'index.html'));
  execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', out], { stdio: 'pipe' });
  return out;
}
const OUT = prerender();
test.after(() => rmSync(OUT, { recursive: true, force: true }));
const html = (path) => readFileSync(join(OUT, path === '/' ? 'index.html' : `${path.replace(/^\//, '')}/index.html`), 'utf8');

/** Every `application/ld+json` block in a page, parsed (throws on invalid JSON). Index scanning, not a body regex. */
function ldBlocks(doc) {
  const out = [];
  const open = '<script type="application/ld+json">';
  for (let at = doc.indexOf(open); at !== -1; at = doc.indexOf(open, at + 1)) {
    const start = at + open.length;
    out.push(JSON.parse(doc.slice(start, doc.toLowerCase().indexOf('</script', start))));
  }
  return out;
}
const types = (doc) => ldBlocks(doc).map((b) => b['@type']);
function keysOf(v, into = []) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, into));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { into.push(k); keysOf(x, into); }
  return into;
}

test('/ carries valid JSON-LD: one Organization, from the facts the site states', () => {
  // Mutation checked: the prerender hook removed → no block on /; `sameAs` from a hand list → the deepEqual fails.
  const blocks = ldBlocks(html('/'));
  assert.deepEqual(blocks.map((b) => b['@type']), ['Organization']);
  const [org] = blocks;
  assert.equal(org['@context'], 'https://schema.org');
  assert.equal(org.name, 'Axal VC');
  assert.equal(org.url, 'https://axal.vc');
  assert.equal(org.logo, 'https://axal.vc/axal-mark.png');
  assert.deepEqual(org.sameAs, SOCIAL_LINKS.map((l) => l.href));
  assert.ok(readFileSync(join(ROOT, 'frontend/public/axal-mark.png')).length > 0, 'the logo is a real file');
});

test('/about carries the Organization; a trust subsection its BreadcrumbList; other routes none', () => {
  // Mutation checked: `/about` dropped from structuredDataFor → its check fails; the trust branch widened to /trust → its check fails.
  assert.deepEqual(types(html('/about')), ['Organization']);
  const [crumb] = ldBlocks(html('/trust/security'));
  assert.equal(crumb['@type'], 'BreadcrumbList');
  assert.deepEqual(crumb.itemListElement, [
    { '@type': 'ListItem', position: 1, name: OG_ROUTES.find((r) => r.path === '/trust').title, item: 'https://axal.vc/trust' },
    { '@type': 'ListItem', position: 2, name: OG_ROUTES.find((r) => r.path === '/trust/security').title },
  ]);
  for (const p of ['/trust', '/pricing', '/for-founders', '/team']) assert.deepEqual(types(html(p)), [], `${p} has no block`);
  for (const r of OG_ROUTES.filter((x) => /^\/trust\/./.test(x.path))) assert.deepEqual(types(html(r.path)), ['BreadcrumbList'], r.path);
});

test('no prerendered page carries a rating, review, price, employee count or founding date', () => {
  // Mutation checked: `foundingDate: '2020'` added to organizationLd → this fails on / and /about.
  for (const r of prerenderedRoutes()) {
    for (const k of keysOf(ldBlocks(html(r.path)))) assert.ok(!FORBIDDEN_LD_KEYS.includes(k), `${r.path} carries ${k}`);
  }
  assert.doesNotMatch(html('/'), /aggregateRating|"review"|"offers"|numberOfEmployees|foundingDate|Testimonial/);
});

test('re-running the prerender over its own output leaves one block, byte for byte', () => {
  // Mutation checked: the old block not stripped first → / holds two Organization blocks.
  const again = mkdtempSync(join(tmpdir(), 'structured-data-7004-again-'));
  try {
    cpSync(join(OUT, 'index.html'), join(again, 'index.html'));
    execFileSync(process.execPath, [join(ROOT, 'scripts/prerender-og.mjs'), '--out', again], { stdio: 'pipe' });
    assert.equal(readFileSync(join(again, 'index.html'), 'utf8'), html('/'));
    assert.equal(readFileSync(join(again, 'trust/security/index.html'), 'utf8'), html('/trust/security'));
  } finally { rmSync(again, { recursive: true, force: true }); }
});

test('one article, written into the home shell as the Worker does, parses as an Article and drops the Organization', () => {
  // Mutation checked: articleLd without `headline` → its check fails.
  const doc = withStructuredData(html('/'), [articleLd({
    title: 'Why ledgers drift', author_name: 'Ada Quill', published_at: '2026-10-01 09:00:00', updated_at: '2026-10-03 12:30:00',
    excerpt: 'A synthetic essay.', path: '/articles/ledgers',
  })]);
  const blocks = ldBlocks(doc);
  assert.deepEqual(blocks.map((b) => b['@type']), ['Article']);
  assert.equal(blocks[0].headline, 'Why ledgers drift');
  assert.deepEqual(blocks[0].author, { '@type': 'Person', name: 'Ada Quill' });
  assert.equal(blocks[0].datePublished, '2026-10-01T09:00:00Z');
  assert.equal(blocks[0].dateModified, '2026-10-03T12:30:00Z');
  assert.deepEqual(withStructuredData(html('/'), []).includes('ld:managed'), false, 'no payload: no block at all');
});

test('one help guide parses as a BreadcrumbList with the trail its page draws', () => {
  // Mutation checked: the area item dropped from helpGuideBreadcrumbLd → the trail has two items and fails.
  const visible = filterSectionsForRole(SECTIONS, 'public');
  const section = visible.find((s) => s.id === 'getting-started');
  const sub = section.subsections.find((g) => g.id === 'what-is-studioos');
  assert.ok(sub, 'the guide exists for a signed-out reader');
  const [crumb] = ldBlocks(jsonLdScript(guideBreadcrumbLd(visible, 'getting-started', 'what-is-studioos')));
  assert.equal(crumb['@type'], 'BreadcrumbList');
  assert.deepEqual(crumb.itemListElement.map((i) => i.name), ['Help', 'Getting started', sub.title]);
  assert.equal(crumb.itemListElement[0].item, 'https://axal.vc/help');
  assert.equal(crumb.itemListElement[1].item, 'https://axal.vc/help?view=all#area-getting-started');
  assert.equal('item' in crumb.itemListElement[2], false, 'the page itself has no item');
  assert.equal(guideBreadcrumbLd(visible, 'getting-started', 'no-such-guide'), null);
  const adminAnchor = SECTIONS.find((s) => s.id === 'admin')?.subsections[0]?.id;
  if (adminAnchor) assert.equal(guideBreadcrumbLd(visible, 'admin', adminAnchor), null, 'an admin guide is not a public crumb');
});

test('a value cannot close the script element: < > & are written as \\u escapes and parse back', () => {
  // Mutation checked: the `<` replacement removed → the payload's `</script>` closes the element early and this fails.
  const nasty = 'A </script><script>alert(1)</script> <!-- & \u2028 end';
  const tag = jsonLdScript({ '@type': 'Article', headline: nasty });
  assert.equal(tag.toLowerCase().split('</script').length - 1, 1, 'exactly one closing tag');
  const body = tag.slice('<script type="application/ld+json">'.length, -'</script>'.length);
  assert.doesNotMatch(body, /[<>&\u2028]/, 'no raw < > & or U+2028 inside the element');
  assert.equal(ldBlocks(tag)[0].headline, nasty);
});

test('Event only with a start date and a place or an online format; never the join link or price', () => {
  // Mutation checked: the start-date gate removed → the undated record gives an Event.
  const base = { title: 'Synthetic Day', path: '/events/d', location_url: 'https://meet.example.test/secret', price_cents: 2500, capacity: 40 };
  assert.equal(eventLd({ ...base, location_kind: 'virtual' }), null, 'no start date');
  assert.equal(eventLd({ ...base, starts_at: '2026-12-01 17:00:00', location_kind: 'in_person' }), null, 'in person, no place');
  assert.equal(eventLd({ ...base, starts_at: 'soon', location_kind: 'virtual' }), null, 'not a date');
  const online = eventLd({ ...base, starts_at: '2026-12-01 17:00:00', location_kind: 'virtual' });
  assert.equal(online['@type'], 'Event');
  assert.deepEqual(online.location, { '@type': 'VirtualLocation' });
  assert.doesNotMatch(JSON.stringify(online), /secret|2500|\b40\b|offers|price/);
  const there = eventLd({ ...base, starts_at: '2026-12-01T17:00', location_kind: 'in_person', location_text: 'Geneva' });
  assert.equal(there.startDate, '2026-12-01T17:00:00Z');
  assert.equal(there.location.name, 'Geneva');
});

test('dates: a zoneless D1 stamp is UTC; anything else is left out', () => {
  assert.equal(isoDate('2026-10-01 09:00:00'), '2026-10-01T09:00:00Z');
  assert.equal(isoDate('2026-10-01T09:00:00+02:00'), '2026-10-01T09:00:00+02:00');
  assert.equal(isoDate('2026-10-01'), '2026-10-01');
  assert.equal(isoDate(''), null);
  assert.equal(isoDate(null), null);
  assert.equal(isoDate('next week'), null);
  assert.equal(articleLd({ title: '' }), null, 'no headline, no Article');
  assert.deepEqual(structuredDataFor('/nowhere'), []);
});
