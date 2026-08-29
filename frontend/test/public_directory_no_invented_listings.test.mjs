/**
 * The public Directory names nobody who does not exist (Wave 3 audit find).
 *
 * Three of the four Directory tabs are not live yet. They were filled with
 * invented listings — including three invented PEOPLE ("Dr. Priya Nair",
 * "Marcus Vale", "Lena Fischer") with specialities and locations — rendered on
 * a public, unauthenticated page in the same card shape as the live Service
 * Partners tab.
 *
 * Each card did carry a "Preview" chip, which is why this survived earlier
 * passes. But a "Preview" chip beside a plausible person's name reads as
 * "preview of this listing", not "this person is fictional", and the chip does
 * not travel with a screenshot of one card.
 *
 * The cards now show the FIELD SHAPE of a future listing with the identity
 * slot left blank. This file keeps it that way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('no preview entry carries a name at all', async () => {
  const mod = await import(resolve(root, 'frontend/src/data/network.js'));
  const groups = Object.entries(mod.DIRECTORY_PREVIEWS);
  assert.ok(groups.length >= 3, 'the not-yet-live tabs must still be described');
  for (const [tab, rows] of groups) {
    assert.ok(rows.length > 0, `${tab} must show the field shape`);
    for (const r of rows) {
      assert.ok(!('name' in r), `${tab} entry still carries a name: ${JSON.stringify(r)}`);
      assert.ok(r.id, `${tab} entry needs a stable key that is not a name`);
      // Every remaining value must be a field label, not an entity. A real
      // place or a real person's name would contain a comma or a capitalised
      // second word; the labels here are single generic nouns.
      for (const v of [r.category, r.geography, r.stage]) {
        assert.ok(typeof v === 'string' && !v.includes(','),
          `${tab}: "${v}" looks like a real value, not a field label`);
      }
    }
  }
});

test('the invented listings are gone from the source', () => {
  const s = read('frontend/src/data/network.js');
  // The comment above the block names them to explain what was removed, so
  // check the exported data instead of the file text.
  const i = s.indexOf('export const DIRECTORY_PREVIEWS');
  const block = s.slice(i);
  for (const gone of ['Priya', 'Marcus', 'Lena', 'Northwind', 'Ledgerly', 'Ceres', 'Meridian', 'Harbor', 'Atlas']) {
    assert.ok(!block.includes(gone), `${gone} is still listed`);
  }
});

test('the card renders a blank identity, not a name', () => {
  const s = read('frontend/src/pages/PublicDirectoryPage.jsx');
  const i = s.indexOf('function PreviewCard');
  const body = s.slice(i, s.indexOf('function ComingSoonTab'));
  assert.ok(!body.includes('p.name'), 'the card must not render a name');
  assert.match(body, /aria-hidden className="h-4 w-2\/3 rounded bg-gray-200/,
    'the identity slot must be a blank rule');
  assert.match(body, />\s*Example\s*</, 'the badge must read Example, not Preview');
});

test('the tab banner says nobody is listed yet', () => {
  const s = read('frontend/src/pages/PublicDirectoryPage.jsx');
  assert.match(s, /Nobody is listed yet/,
    'the absence must be stated plainly, not implied by a chip');
});

test('the live Service Partners tab still renders real listings', () => {
  // The fix must not have blanked the tab that DOES have data behind it.
  const s = read('frontend/src/pages/PublicDirectoryPage.jsx');
  assert.match(s, /function PartnerCard/);
  assert.match(s, /\{p\.name\}/, 'real partner rows still show their real name');
  assert.match(s, /api\./, 'the live tab must still fetch');
});
