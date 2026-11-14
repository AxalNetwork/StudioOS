// Guards the audience→destination chain that makes a landing-page signup show
// up on the right founder surface. Three links have to agree, and each is
// maintained in a different file, so drift between them is silent:
//
//   1. the catalog entry's `audience`      (frontend/src/lib/brand/templates.js)
//   2. the audience the rendered page POSTs (singleWaitlistScript in
//      cloudflare-worker/src/services/landingTemplates.ts)
//   3. the destination routeFor() sends it to (worker routes/contacts.ts)
//
// This is not hypothetical. Two templates shipped mis-filed by NAME rather
// than content, and the mismatch was invisible end to end:
//   - "Distribution Deck" is a partnership memo (customer-overlap tables,
//     channel economics, "Discuss distribution fit") but was catalogued as
//     `investor` and posted `investor` — so partner leads landed in Capital.
//   - "Builder's Launchpad" is a technical co-founder brief (hiring badge,
//     equity terms, "Join as technical co-founder") but was catalogued as
//     `customer` and posted `customer` — so co-founder applicants landed in
//     Customer Discovery.
// Both now post the audience their content actually addresses.
//
// MUST stay in the test:drift file list in the root package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingTemplate } from '../src/services/landingTemplates.ts';
import { routeFor, CONTACT_AUDIENCES } from '../src/routes/contacts.ts';
import { TEMPLATES, AUDIENCES } from '../../frontend/src/lib/brand/templates.js';

const baseRow = {
  name: 'Northwind Labs',
  tagline: 'The operating system for ambitious founders.',
  headline: 'Build, launch, and grow — all in one place.',
  subheadline: 'Everything early teams need to go from idea to traction.',
  cta_text: 'Join the waitlist',
  font_pairing: 'editorial',
};

/** The fixed audience the rendered page's capture script POSTs. */
function postedAudience(visualTemplate: string): string {
  const html = renderLandingTemplate(
    { ...baseRow, template: visualTemplate },
    { noindex: true, nonce: 'test-nonce' },
  );
  const matches = [...html.matchAll(/audience:"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(matches.length, 1, `${visualTemplate} must post exactly one fixed audience`);
  return matches[0];
}

// Every audience the catalog can assign must have a real destination — no
// template may route its leads into the generic 'network' fallback inbox.
test('every catalog audience routes to a real destination', () => {
  for (const a of AUDIENCES) {
    assert.ok(CONTACT_AUDIENCES.includes(a), `audience "${a}" is unknown to the contacts hub`);
    assert.notEqual(routeFor(a), 'network', `audience "${a}" falls through to the generic inbox`);
  }
});

for (const tpl of TEMPLATES) {
  test(`"${tpl.id}" posts the audience its catalog entry declares`, () => {
    assert.equal(
      postedAudience(tpl.visualTemplate),
      tpl.audience,
      `catalog says "${tpl.audience}" but the published page posts a different audience — `
      + 'a signup would be filed under the wrong audience and routed to the wrong page',
    );
  });
}

// The two templates that were mis-filed. Pinned by id so a future rename or
// "tidy-up" can't quietly revert them to the wrong bucket.
test('Distribution Deck is a partner template (was mis-filed as investor)', () => {
  const t = TEMPLATES.find((x) => x.id === 'distribution-deck');
  assert.ok(t, 'distribution-deck missing from the catalog');
  assert.equal(t.audience, 'partner');
  assert.equal(postedAudience(t.visualTemplate), 'partner');
  assert.equal(routeFor('partner'), 'marketplace');
});

test("Builder's Launchpad is a co-founder template (was mis-filed as customer)", () => {
  const t = TEMPLATES.find((x) => x.id === 'builders-launchpad');
  assert.ok(t, 'builders-launchpad missing from the catalog');
  assert.equal(t.audience, 'cofounder');
  assert.equal(postedAudience(t.visualTemplate), 'cofounder');
  assert.equal(routeFor('cofounder'), 'team');
});
