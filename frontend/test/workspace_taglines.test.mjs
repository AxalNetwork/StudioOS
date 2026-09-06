/**
 * A bucket root's h1 is its TAGLINE, so every bucket must have one.
 *
 * `tagline` sat on the shells since they were written and nothing rendered it:
 * a root drew `bucket.label` in the crumb AND in the h1, so `/pipeline` said
 * "Pipeline" twice while the canvas said "Pipeline ‹ crumb" over "Win the work".
 * `bucketTitle()` makes the field live, which turns a missing tagline from
 * dead config into an empty heading — hence this file.
 *
 * The canvas pinning below is not new policy. `founder_shell_canvas.test.mjs:17`
 * and `investor_shell_canvas.test.mjs:17` have pinned those two roles' taglines
 * to their canvas headings for as long as the field has existed; advisor and
 * partner simply never got the same guard, which is exactly why two advisor
 * strings drifted (Practice read "Win and deliver" against V3's "Run my advisory
 * business", Expertise "Be findable" against V4's "Package what I know") and two
 * partner buckets had no tagline at all. Five of the seven already matched their
 * artboard verbatim — the field was always meant to be the h1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHELLS, bucketsFor, bucketTitle } from '../src/workspaces/shellConfig.js';

test('every bucket in every shell carries a non-empty tagline', () => {
  const missing = [];
  for (const role of Object.keys(SHELLS)) {
    for (const bucket of bucketsFor(role)) {
      if (typeof bucket.tagline !== 'string' || !bucket.tagline.trim()) {
        missing.push(`${role} ${bucket.prefix}`);
      }
    }
  }
  assert.deepEqual(missing, [],
    'a bucket with no tagline renders an empty h1 on its root');
});

test('bucketTitle prefers the tagline and never returns an empty string', () => {
  assert.equal(bucketTitle({ label: 'Pipeline', tagline: 'Win the work' }), 'Win the work');
  // The fallback exists so a bucket added without a tagline degrades to today's
  // behaviour rather than rendering a blank heading. The test above is what
  // actually stops that shipping.
  assert.equal(bucketTitle({ label: 'Pipeline' }), 'Pipeline');
  assert.equal(bucketTitle(null), undefined);
});

test('advisor bucket taglines match the Advisor Canvas artboard headings', () => {
  // V3 :251, V4 :409, V5 :522, V6 :589 in
  // design/canvases/integrated/Advisor Canvas.dc.html. Cohorts has no artboard
  // there — `Pages · Advisor Cohorts.dc.html` draws its five zones and no root —
  // so its tagline is the shell's own and is pinned here rather than to a canvas.
  const expected = {
    Practice: 'Run my advisory business',
    Cohorts: 'Guide the batch',
    Expertise: 'Package what I know',
    Network: 'Work my relationships',
    Research: 'Know more than the room',
  };
  for (const row of bucketsFor('advisor')) {
    assert.equal(row.tagline, expected[row.label],
      `${row.label} tagline drifted from the Advisor Canvas`);
  }
});

test('partner bucket taglines match the Partner Operator Canvas artboard headings', () => {
  // P3 :206, P4 :330, P5 :438, P6 :560, P7 :623 in
  // design/canvases/backlog/Partner Operator Canvas.dc.html.
  const expected = {
    Pipeline: 'Win the work',
    Delivery: 'Ship the work',
    Offers: 'Package what we sell',
    Network: 'Work our relationships',
    Research: "Know the client's world",
  };
  for (const row of bucketsFor('partner')) {
    assert.equal(row.tagline, expected[row.label],
      `${row.label} tagline drifted from the Partner Operator Canvas`);
  }
});

test('a partner tagline says "our", a personal licence says "my"', () => {
  // The canvases draw this distinction deliberately: a firm works OUR
  // relationships, an advisor works MY relationships. Normalising the two would
  // read as a typo fix and would lose the firm-versus-person seam.
  const partnerNetwork = bucketsFor('partner').find((b) => b.prefix === '/network');
  const advisorNetwork = bucketsFor('advisor').find((b) => b.prefix === '/network');
  assert.equal(partnerNetwork.tagline, 'Work our relationships');
  assert.equal(advisorNetwork.tagline, 'Work my relationships');
});
