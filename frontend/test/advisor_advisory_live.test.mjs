/**
 * The advisor Advisory workspace is live data, not fixtures (Wave 1b).
 *
 * Companion to partner_operations_live.test.mjs. All five
 * /advisor/advisory/* tabs rendered data/advisor/advisory.js — 716 lines of
 * invented opportunities, clients, engagements, deliverables and contracts,
 * with a demo clock pinned to 2026-07-11 — shown to real signed-in advisors
 * with zero API calls. PLATFORM-DELIVERY-AUDIT.md §6 named this and the
 * partner Operations cluster as the platform's worst standing defect.
 *
 * These tests pin the repair the same way, and additionally pin the ONE
 * honest gap: Delivery has no deliverables store, so it must keep saying so
 * rather than growing invented content back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DIR = resolve(process.cwd(), 'frontend/src/pages/advisor/advisory');
const pages = () => readdirSync(DIR).filter((f) => f.endsWith('.jsx'));
const src = (f) => readFileSync(join(DIR, f), 'utf8');

test('the fixture module is deleted', () => {
  assert.ok(
    !existsSync(resolve(process.cwd(), 'frontend/src/data/advisor/advisory.js')),
    'data/advisor/advisory.js is back — the invented advisory practice must not return',
  );
});

test('no advisory page imports from a data/ fixture directory', () => {
  for (const f of pages()) {
    assert.ok(
      !/from\s+['"][^'"]*\/data\//.test(src(f)),
      `${f} imports from a data/ fixture directory`,
    );
  }
});

test('every tab is wired to the real API', () => {
  const required = {
    'OpportunitiesPage.jsx': [
      'getMyAdvisor', 'listMyAdvisorBookings', 'confirmAdvisorBooking',
      'cancelAdvisorBooking', 'listAdvisorSlots', 'createAdvisorSlot',
    ],
    'ClientsPage.jsx': ['getMyAdvisor', 'listMyAdvisorBookings'],
    'EngagementsPage.jsx': ['listMyAdvisorBookings', 'completeAdvisorBooking', 'noShowAdvisorBooking'],
    'DeliveryPage.jsx': ['listMyAdvisorBookings', 'listBookingReviews'],
    'ContractsPage.jsx': ['esignList'],
  };
  for (const [file, methods] of Object.entries(required)) {
    const s = src(file);
    assert.ok(s.includes("from '../../../lib/api'"), `${file} does not import the api client`);
    for (const m of methods) {
      assert.ok(s.includes(`api.${m}(`), `${file} no longer calls api.${m}()`);
    }
  }
});

test('every api method these tabs call actually exists in api.js', () => {
  // Wave 1b caught a real defect this way: the first draft called
  // api.getAdvisorSlots(), which does not exist — the method is
  // listAdvisorSlots(). A missing method fails silently at runtime inside a
  // try/catch, which is exactly the class of bug this Wave exists to remove.
  // Both sides are harvested with ONE hardcoded regex each and compared as
  // sets. The first version built `new RegExp(\`\\b${m}\\s*:\`)` per method,
  // which Semgrep flagged (detect-non-literal-regexp, alert 5937) and which
  // apex_route_coverage.test.mjs was already flagged for — see its header.
  // The finding is right about the shape even though these names come from
  // this repo's own source and match [A-Za-z0-9_]+, so no metacharacter can
  // reach the constructor. Set membership is exact, faster, and removes the
  // question entirely.
  const apiJs = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');
  const defined = new Set(
    [...apiJs.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]),
  );
  const called = new Set();
  for (const f of pages()) {
    for (const m of src(f).matchAll(/\bapi\.([a-zA-Z][A-Za-z0-9_]*)\(/g)) called.add(m[1]);
  }
  assert.ok(called.size >= 8, `expected the tabs to call several api methods, saw ${called.size}`);
  assert.ok(defined.size > 100, `api.js should define hundreds of methods, harvested ${defined.size}`);
  const missing = [...called].filter((m) => !defined.has(m));
  assert.deepEqual(missing, [], 'these api methods are called but not defined in api.js');
});

test('Delivery keeps stating that deliverables are not tracked', () => {
  // The canvas asks for a document version trail with opened/unopened
  // receipts. No store exists. If someone builds one, delete this test along
  // with the notice — but never delete the notice alone.
  const s = src('DeliveryPage.jsx');
  assert.match(s, /not tracked yet/i, 'the Delivery honesty notice is gone');

  // Check for USE, not for mention: the file's header comment names
  // `deliverable_snapshots` precisely to record that it belongs to cohort
  // timing and must not be wired here, and that warning should survive. So
  // strip comments first — an earlier version of this assertion banned the
  // string outright and failed on its own documentation.
  const code = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  assert.ok(
    !/deliverable_snapshots/.test(code),
    'deliverable_snapshots belongs to cohort timing, not advisory — do not wire it here',
  );
});

test('reviews are never authored by the advisor', () => {
  // An advisor writing their own review is fabricated proof. The worker only
  // exposes filing a review as the counterparty; these pages must read.
  for (const f of ['DeliveryPage.jsx', 'ClientsPage.jsx', 'EngagementsPage.jsx']) {
    assert.ok(
      !src(f).includes('api.fileAdvisorReview('),
      `${f} files a review — reviews must come from the person who was advised`,
    );
  }
});

test('the enriched booking list is scoped to the caller in the worker', () => {
  const advisors = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/advisors.ts'), 'utf8',
  );
  assert.match(
    advisors, /WHERE b\.advisor_id = \?/,
    '/me/bookings must filter by the resolved advisor id',
  );
  // The slot join must name the table that actually exists. `advisor_slots` is
  // a DIFFERENT table (mentor_user_id/start_at) and joining it here silently
  // returned no slot times — caught by the column guard during Wave 1b.
  assert.match(
    advisors, /LEFT JOIN advisor_office_hour_slots s ON s\.id = b\.slot_id/,
    'the slot join must target advisor_office_hour_slots',
  );
  assert.ok(
    !/LEFT JOIN advisor_slots\b/.test(advisors),
    'advisor_slots is the wrong table for advisor bookings',
  );
});
