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
  // The draft guard survives, but only behind `!state.error`. Every field in
  // the body reads `draft.<key>` unconditionally, so dropping it outright
  // would trade a spinner for a null deref the moment React stops batching
  // the two setState calls in `load`.
  assert.match(code, /loading=\{state\.loading \|\| \(!draft && !state\.error\)\}/,
    'an error must beat the skeleton, and children must never see a null draft');
  assert.doesNotMatch(code, /loading=\{state\.loading \|\| !draft\}/,
    'draft alone is null after a failed load — it must not feed the loading flag');
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

/**
 * EACH ZONE'S OWN HEADING AND LINE, DERIVED FROM THE CANVAS RATHER THAN TYPED.
 *
 * `AdvisorBucketRoutes.jsx` passed `title` only on the bucket root and `intro`
 * from a map keyed by PREFIX, so all five Expertise zones printed one sentence
 * — "How the market finds you, and what it finds when it does." — under five
 * headings that were each the nav pill's label. The canvas gives every artboard
 * an `h1` that is deliberately not the pill (`Practice profile` under `Profile`,
 * `Evidence` under `Proof`) and a `sub` naming what that zone lists.
 *
 * The expected strings are parsed out of the canvas here, so this cannot pass
 * on a table that agrees with a typo. If the canvas is re-exported with
 * different copy, this fails and the table is what has to move.
 */
const CANVAS = readFileSync(
  resolve(process.cwd(), 'design/incoming/Pages · Advisor Expertise.dc.html'), 'utf8');
const ROUTES = readFileSync(
  resolve(process.cwd(), 'frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'), 'utf8');

/** `route → { h1, sub }` for every Expertise artboard the canvas declares. */
function canvasHeads() {
  const out = {};
  for (const chunk of CANVAS.split(/route:\s*'/).slice(1)) {
    const route = chunk.slice(0, chunk.indexOf("'"));
    const h1 = chunk.match(/h1:\s*'((?:[^'\\]|\\.)*)'/);
    const sub = chunk.match(/sub:\s*'((?:[^'\\]|\\.)*)'/);
    if (!h1 || !sub || !route.startsWith('/expertise/')) continue;
    out[route.slice('/expertise/'.length)] = { h1: h1[1], sub: sub[1] };
  }
  return out;
}

test('every Expertise zone carries the canvas’s own heading and line', () => {
  const heads = canvasHeads();
  assert.equal(Object.keys(heads).length, 5,
    `the canvas declared ${Object.keys(heads).length} Expertise artboards with an h1 and a sub, not 5`);

  const table = ROUTES.slice(ROUTES.indexOf('const EXPERTISE_ZONE_HEAD = {'));
  assert.ok(table.length > 0, 'the per-zone heading table is gone');
  const body = table.slice(0, table.indexOf('\n  };'));

  for (const [slug, { h1, sub }] of Object.entries(heads)) {
    const row = body.match(new RegExp(`\\n\\s*${slug}: \\{ h1: '([^']*)', sub: '([^']*)' \\}`));
    assert.ok(row, `${slug} has no row in EXPERTISE_ZONE_HEAD`);
    assert.equal(row[1], h1, `${slug}'s heading is not the canvas's`);
    assert.equal(row[2], sub, `${slug}'s line is not the canvas's`);
    // The canvas's h1 is deliberately NOT the nav pill's label. A row that
    // matched the pill would mean the table had been filled in from the router.
    assert.notEqual(h1.toLowerCase(), slug, `${slug}'s canvas h1 is just the slug — re-read the export`);
  }
});

test('a zone reaches the shell with its own heading, not the bucket’s line', () => {
  // The wiring, not just the table: `title` was `isRoot ? … : undefined` and
  // `intro` was `INTRO[prefix]` flat, which is what made all five identical.
  assert.match(ROUTES, /title=\{isRoot \? bucketTitle\(bucket\) : zoneHead\?\.h1\}/,
    'a zone no longer passes its own heading to the shell');
  assert.match(ROUTES, /intro=\{zoneHead\?\.sub \|\| INTRO\[prefix\]\}/,
    'a zone no longer prefers its own line over the bucket sentence');
  assert.match(ROUTES, /prefix === '\/expertise' && !isRoot \? EXPERTISE_ZONE_HEAD\[slug\] : null/,
    'the per-zone lookup is gone, or now fires on the bucket root too');

  // The bucket ROOT keeps the bucket sentence and the tagline heading — task
  // #75's rule, which this must not undo.
  assert.match(ROUTES, /'\/expertise': 'How the market finds you/,
    'the bucket-root sentence was deleted rather than scoped to the root');
});
