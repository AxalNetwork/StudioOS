/**
 * Office Hours follow-ups on the pages — D355.
 *
 * The Worker enforces who may do what (partner_booking_followups_d355.test.ts).
 * These pin what the PAGES claim from the reads:
 *   * a partner nobody rated reads "No ratings yet" — never ★ 0 — and a
 *     failed read of the averages is not "no ratings";
 *   * an average always travels with its count, from the first rating;
 *   * an item's owner is "You" or the side that added it;
 *   * only the founder rates, and only a completed session; the partner's page
 *     shows the founder's rating read-only, comment included;
 *   * the canvas's fabricated partner ratings and action-item fixtures are
 *     not reproduced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  ratingBadge, formatRating, ownerLabel, sortItems, canRate, takesItems, toolLink, LINKED_TOOL_LABELS,
} from '../src/lib/sessionFollowups.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const FOUNDER = codeOnly(raw('frontend/src/pages/SpinoutLabOfficeHoursPage.jsx'));
const PARTNER = codeOnly(raw('frontend/src/pages/PartnerOfficeHoursPage.jsx'));
const COMPONENT = codeOnly(raw('frontend/src/components/officehours/SessionFollowups.jsx'));
const SERVICE = raw('cloudflare-worker/src/services/partnerBookingFollowups.ts');
const CANVAS = raw('design/canvases/out-of-scope/Office Hours.dc.html');

const ok = (items) => ({ state: 'ok', data: { items } });

test('an unrated partner is "none", a failed read is "failed", never an average of zero', () => {
  assert.deepEqual(ratingBadge(ok([]), 7), { state: 'none' });
  assert.deepEqual(ratingBadge(ok([{ partner_id: 8, average: 4, count: 1 }]), 7), { state: 'none' });
  assert.deepEqual(ratingBadge(ok([{ partner_id: 7, average: 0, count: 0 }]), 7), { state: 'none' });
  assert.deepEqual(ratingBadge({ state: 'failed' }, 7), { state: 'failed' });
  assert.deepEqual(ratingBadge(null, 7), { state: 'failed' });
});

test('the average shows from the first rating and always carries its count', () => {
  const one = ratingBadge(ok([{ partner_id: 7, average: 5, count: 1 }]), 7);
  assert.deepEqual(one, { state: 'ok', average: 5, count: 1 });
  assert.equal(formatRating(one), '★ 5.0 · 1 rating');
  assert.equal(formatRating(ratingBadge(ok([{ partner_id: '7', average: 4.5, count: 2 }]), 7)), '★ 4.5 · 2 ratings');
});

test('owner reads "You" for the viewer, else the side that added it', () => {
  assert.equal(ownerLabel({ added_by_you: true, added_by: 'partner' }), 'You');
  assert.equal(ownerLabel({ added_by_you: false, added_by: 'partner' }), 'Partner');
  assert.equal(ownerLabel({ added_by_you: false, added_by: 'founder' }), 'Founder');
});

test('open items come first, then by due date with undated last', () => {
  const items = [
    { id: 1, done: true, due_date: '2026-01-01' },
    { id: 2, done: false, due_date: null },
    { id: 3, done: false, due_date: '2026-10-09' },
    { id: 4, done: false, due_date: '2026-10-02' },
    { id: 5, done: false, due_date: '2026-10-02' },
  ];
  assert.deepEqual(sortItems(items).map((i) => i.id), [4, 5, 3, 2, 1]);
});

test('only the founder rates, and only a completed session; cancelled sessions take no items', () => {
  assert.equal(canRate({ status: 'completed' }, 'founder'), true);
  assert.equal(canRate({ status: 'completed' }, 'partner'), false);
  assert.equal(canRate({ status: 'confirmed' }, 'founder'), false);
  assert.equal(takesItems({ status: 'cancelled' }), false);
  assert.equal(takesItems({ status: 'completed' }), true);
});

test('linked tools are the Worker allowlist, and link into the Lab', () => {
  const worker = SERVICE.slice(SERVICE.indexOf('export const LINKED_TOOLS'), SERVICE.indexOf('] as const;'));
  const keys = [...worker.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(LINKED_TOOL_LABELS).sort(), keys.sort());
  assert.deepEqual(toolLink('83b'), { label: '83(b) Election', to: '/spinout-lab/83b' });
  assert.equal(toolLink('constructor'), null);
  assert.equal(toolLink(null), null);
});

test('the founder page draws the directory badge and its three states', () => {
  assert.match(FOUNDER, /<PartnerRating read=\{ratings\} partnerId=\{p\.id\} \/>/);
  assert.match(FOUNDER, /badge\.state === 'none'\) return .*<Unrecorded reason="No founder has rated a session with this partner yet\.">No ratings yet<\/Unrecorded>/);
  assert.match(FOUNDER, /badge\.state === 'failed'\) return .*Ratings could not be read/);
  assert.match(FOUNDER, /\{formatRating\(badge\)\}/);
  assert.match(FOUNDER, /\.catch\(\(\) => \{ if \(!dead\) setRatings\(\{ state: 'failed' \}\); \}\)/);
});

test('the founder rates from history; the partner sees the rating read-only', () => {
  assert.match(FOUNDER, /<SessionRating booking=\{b\} viewerSide="founder" onRated=\{refreshBookings\} \/>/);
  assert.match(PARTNER, /<SessionRating booking=\{b\} viewerSide="partner" \/>/);
  assert.match(COMPONENT, /if \(!canRate\(booking, viewerSide\)\) \{\s*if \(booking\.status !== 'completed'\) return null;/);
  assert.match(COMPONENT, /booking\.rating_comment && <div/);
  assert.match(COMPONENT, /<Unrecorded reason="The founder has not rated this session\.">Not rated yet<\/Unrecorded>/);
});

test('both pages draw the same action-items component, and it never sends a user id', () => {
  assert.match(FOUNDER, /<SessionActionItems booking=\{b\} onChange=\{loadMyItems\} \/>/);
  assert.match(PARTNER, /<SessionActionItems booking=\{b\} \/>/);
  assert.match(COMPONENT, /\{it\.added_by_you && \(/, 'Delete only on your own items');
  assert.match(COMPONENT, /Added by \{ownerLabel\(it\)\}/);
  assert.match(COMPONENT, /read\.state === 'failed'\) return <div className="mt-2"><Unreadable/);
  assert.doesNotMatch(COMPONENT, /user_id|userId/);
});

test('the rail lists open items from the founder\'s sessions, and a failed read says so', () => {
  assert.match(FOUNDER, /<MySessionItems read=\{myItems\} onRetry=\{loadMyItems\} \/>/);
  assert.match(FOUNDER, /read\.state === 'failed'\) return <Unreadable what="Your session action items"/);
  assert.match(FOUNDER, /const open = sortItems\(read\.data\?\.items\)\.filter\(\(it\) => !it\.done\);/);
});

test('the canvas draws ★ ratings and owned, tool-linked action items — its fixtures are not reproduced', () => {
  assert.match(CANVAS, /★<\/span><span[^>]*>\{\{ p\.rating \}\}/);
  assert.match(CANVAS, /→ \{\{ a\.linkedTool \}\}<\/span><span[^>]*>\{\{ a\.owner \}\} · \{\{ a\.due \}\}/);
  for (const fixture of ['Sofia Menendez', "rating:'4.9'", 'File 83(b) within 30-day window']) {
    assert.ok(CANVAS.includes(fixture));
    for (const src of [FOUNDER, PARTNER, COMPONENT]) assert.ok(!src.includes(fixture), fixture);
  }
});
