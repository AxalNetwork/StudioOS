/**
 * #4690 — Delivery audit 3/6: the page half of the measurements.
 *
 * The Worker half is `cloudflare-worker/test/partner_delivery_measurements_4690.test.ts`.
 * These pin what the pages SAY so they cannot drift from what the Worker
 * computes: the period a chip names is the period it reads, the figure shown
 * against hours is the cap the Worker compared with, an unavailable read is
 * never drawn as a finding, and mode comes from the engagement's seats.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { partnerZoneFilters } from '../src/workspaces/partnerZoneFilters.js';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));
const capacity = read('frontend/src/pages/partner/delivery/CapacityZone.jsx');
const home = read('frontend/src/pages/partner/PartnerHomeP2.jsx');
const deliverables = read('frontend/src/pages/partner/delivery/DeliverablesZone.jsx');
const health = read('frontend/src/pages/partner/delivery/HealthZone.jsx');
const board = read('frontend/src/pages/partner/delivery/BoardZone.jsx');
const reports = read('frontend/src/pages/partner/delivery/StatusReportsZone.jsx');

test('the capacity period chips say month because the period they read is a month', () => {
  const chips = partnerZoneFilters('delivery/capacity', { value: 'this_week', onChange: () => {} });
  const labels = chips.map((c) => c.label);
  assert.deepEqual(labels.slice(0, 2), ['This month', 'Next month']);
  assert.ok(!labels.some((l) => /week/i.test(l)), 'a chip names a week over a monthly period');
  // Next month's period is the `YYYY-MM` the Worker accepts, one month on.
  assert.match(capacity, /Date\.UTC\(now\.getUTCFullYear\(\), now\.getUTCMonth\(\) \+ 1, 1\)/);
  assert.match(capacity, /padStart\(2, '0'\)/);
});

test('#5314 capacity is drawn on one basis, hours a week, against the cap as stated', () => {
  // The total and the cap are the two figures the Worker compared.
  assert.match(capacity, /`\$\{p\.total_hours_per_week\} of \$\{p\.cap_hours\} h`/,
    'the weekly total is not shown against the weekly cap');
  assert.ok(!/\$\{p\.total_hours\} of \$\{p\.cap_hours\}/.test(capacity), 'monthly hours are shown against a weekly cap');
  assert.ok(!/period_cap_hours|period_days/.test(capacity), 'the page still draws the per-month cap');
  // The basis line says so, and no longer explains a mismatch.
  assert.match(capacity, /hours a week/);
  assert.ok(!/compared over the month’s days|monthly totals/.test(capacity), 'the mismatch explanation is back');
  // Every hour column reads its weekly figure.
  for (const f of ['project_hours_per_week', 'seat_hours_per_week', 'internal_hours_per_week', 'total_hours_per_week']) {
    assert.ok(capacity.includes(`p.${f}`), `the row stopped reading ${f}`);
  }
  // The strip's two hour tiles are weekly too, and Not recorded when absent, never 0.
  assert.match(capacity, /nr=\{d\?\.project_hours_total_per_week == null\}/);
  assert.match(capacity, /nr=\{d\?\.seat_hours_total_per_week == null\}/);
  assert.ok(!/project_hours_total(?:_per_week)? \?\? 0/.test(capacity), 'an absent total reads 0');
  // The home card says the same thing in the same unit.
  assert.match(home, /`\$\{p\.total_hours_per_week\} h a week against a cap of \$\{p\.cap_hours\} h a week`/);
});

test('a deliverable is only called unopened where opens are observable', () => {
  assert.match(deliverables, /const unopened = items\.filter\(\(r\) => r\.is_unopened === true\);/);
  assert.match(deliverables, /readsUnavailable = d\?\.read_tracking\?\.available === false/);
  // D4822: the canvas's words for the same absence.
  assert.match(deliverables, /Read status unavailable/);
  assert.match(deliverables, /nr=\{readsUnavailable\}/, 'the Never opened tile is drawn as a number while opens are unobservable');
  assert.match(deliverables, /const isUnopened = row\.is_unopened === true;/, 'a not-recorded row is tinted as a failure');
  // Health states what it could not count rather than printing 0 of N.
  assert.match(health, /row\.deliverables_unopened == null/);
  assert.match(health, /opens not recorded/);
  // A report draft's unknown open is not "not opened".
  assert.match(reports, /x\.opened === false/);
  assert.ok(!/!x\.opened\b/.test(reports), 'an unknown open is printed as "not opened"');
});

test('mode on Health and Board comes from the seat collection, not one row\'s scope', () => {
  assert.match(health, /r\.mode === 'embedded' \? 'Embedded' : 'Project'/);
  assert.ok(!/r\.seat_scope \? 'Embedded'/.test(health), 'an empty-scope seat makes the engagement a project');
  // D4822: Board v2 reads the row's derived state (`seat_state`, from the whole collection) to treat a fully
  // revoked engagement as closed; mode itself is the Worker's `seats.mode`.
  assert.match(board, /r\.seat_state === 'revoked'/);
});

test('Embedded / month is Not recorded, not zero, when no recurring amount is recorded', () => {
  // D4822: Board v2 prints an embedded row's value only when a recurring amount is recorded, never $0.
  const attention = read('frontend/src/pages/partner/delivery/boardAttention.js');
  assert.match(attention, /return row\.recurring_monthly_cents != null \? `Embedded seat · \$\{dollars\(row\.recurring_monthly_cents \/ 100\)\} \/ mo` : 'Embedded seat';/);
});
