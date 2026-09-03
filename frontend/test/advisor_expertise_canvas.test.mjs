/**
 * Advisor Expertise canvas integration — profile completeness meter, service
 * stats, and proof attestation counts match Pages___Advisor_Expertise.dc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const profile = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/ProfileZone.jsx'), 'utf8');
const services = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/ServicesZone.jsx'), 'utf8');
const proof = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/ProofZone.jsx'), 'utf8');

test('Profile zone computes completeness from fields', () => {
  assert.match(profile, /profileCompleteness/);
  assert.match(profile, /Profile completeness/);
  assert.match(profile, /Missing · /);
});

test('Services zone shows canvas stats strip', () => {
  assert.match(services, /priced\.length/);
  assert.match(services, /unpriced\.length/);
  assert.match(services, /bookedCents/);
  assert.match(services, /unitsSold/);
});

test('Proof zone shows attested vs self-stated counts', () => {
  assert.match(proof, /attested\.length/);
  assert.match(proof, /selfStated\.length/);
  assert.match(proof, /awaiting\.length/);
});

test('no canvas sidebar is imported', () => {
  for (const src of [profile, services, proof]) {
    assert.doesNotMatch(src, /className="[^"]*\bside\b/);
  }
});

test('a failed profile load shows the error card, not a spinner forever', () => {
  // ZoneBody checks `loading` before `error`. The loading prop used to be
  // `state.loading || !draft` — and the catch path never sets `draft`, so
  // every failed read of /advisors/me kept `loading` true forever and the
  // error the page had just captured never rendered. Reported on production
  // as /expertise/profile hanging on a spinner.
  const code = codeOnly(profile);
  assert.match(code, /<ZoneBody loading=\{state\.loading\} error=\{state\.error\}/,
    'loading must come from the request state alone');
  assert.doesNotMatch(code, /loading=\{state\.loading \|\| !draft\}/,
    'draft is null after a failed load — it must not feed the loading flag');
  assert.match(code, /setState\(\{ loading: false, error:/,
    'the catch path must keep recording the error');

  // The kit's priority order is what turned this into a spinner; pin it so a
  // later reorder is a deliberate choice, and so every zone caller knows an
  // error only renders once loading is false.
  const kit = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/kit.jsx'), 'utf8');
  const body = kit.slice(kit.indexOf('export function ZoneBody'));
  assert.ok(body.indexOf('if (loading)') < body.indexOf('if (error)'),
    'ZoneBody renders loading before error — callers must not hold loading true after an error');
});

test('a stat the store cannot answer reads as absent, never as zero', () => {
  // `GET /me/services` returns `units_sold: null` on EVERY row — always, by
  // design — because `advisor_bookings` records a free-text topic rather than a
  // service id, so nothing counts sales per service. `routes/advisors.ts` and
  // migration 203 both say so in their headers.
  //
  // The first version of this strip read `s.sold`, a field that exists under no
  // name, and defaulted it to 0. That does not render blank: `money(0)` returns
  // "$0", so an advisor with real bookings saw a practice that had booked $0,
  // and "Most sold" named whichever row sorted first because nothing ever beat
  // zero. Two invented facts on the page built to demonstrate the opposite.
  // Comment-stripped: the fix's own header names the old field to explain the
  // bug, and a raw scan would read that prose as the defect itself.
  const code = codeOnly(services);
  assert.doesNotMatch(code, /\bs\.sold\b/,
    'there is no `sold` field — the DTO emits `units_sold`');
  assert.doesNotMatch(code, /units_sold\s*\?\?\s*0/,
    'defaulting an unknown unit count to 0 is what produced "$0 booked"');

  // Both derived stats must be null-gated, and null must reach the strip as the
  // shared absent marker rather than a dash or a zero.
  assert.match(services, /const anyUnitsKnown = state\.items\.some/,
    'the strip must ask whether ANY unit count is known before computing money');
  assert.match(services, /bookedCents == null \? <Unrecorded \/>/,
    'an unknown booked total renders Not recorded');
  assert.match(services, /mostSold\?\.title \|\| <Unrecorded \/>/,
    'an unknown best seller renders Not recorded');
  assert.match(services, /a booking records a topic, not a service/,
    'and the strip says why, rather than leaving a bare dash');
});

test('the completeness meter counts each profile field once', () => {
  // `headline` was listed twice — as "Positioning statement" and again as
  // "Match one-liner", the same value re-tested for length — so one field was
  // worth 2 of 8 and a 79-character headline produced a gap the advisor could
  // not close by filling any box on the page.
  const block = profile.slice(profile.indexOf('const fields = ['), profile.indexOf('const complete ='));
  assert.ok(block.length > 0, 'the field list must be findable');
  // One entry per line, and the FIRST field each entry reads is the one it
  // scores. A single entry may legitimately name its field twice —
  // `profile.sectors?.length ? profile.sectors : null` is a presence test, not
  // a second row — so the check is across entries, not across occurrences.
  const scored = block.split('\n')
    .filter((l) => /^\s*\['/.test(l))
    .map((l) => (l.match(/profile\.([a-z_]+)/) || [])[1])
    .filter(Boolean);
  assert.ok(scored.length >= 5, `only ${scored.length} scored fields parsed — the shape changed`);
  const dupes = scored.filter((f, i) => scored.indexOf(f) !== i);
  assert.deepEqual([...new Set(dupes)], [],
    `these profile fields are counted more than once: ${[...new Set(dupes)].join(', ')}`);
});
