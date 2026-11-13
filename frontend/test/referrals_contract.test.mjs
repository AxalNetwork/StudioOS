/**
 * One referral status vocabulary, written out by hand in three places.
 *
 * THE SHAPE OF WHAT WAS UNGUARDED. `/referrals` decides a row's colour from
 * `STATUS_TONE` in `ReferralsPage.jsx`. The worker decides what a status may be
 * from `STATUSES` in `services/referralSubmissions.ts`. D1 decides what may be
 * stored from the `CHECK (status IN (…))` in migration 175. All three are typed
 * out longhand, none of them imports another, and nothing compared them — so a
 * twelfth status added to the worker would render grey on the page forever, and
 * a status dropped from the migration would 500 on write with the page still
 * offering it.
 *
 * `trust_center_contract.test.mjs` exists one page over for exactly this class of
 * drift. This is the same idea applied to the page that had no guard at all.
 *
 * WHY IT PARSES SOURCE RATHER THAN IMPORTING. `ReferralsPage.jsx` is JSX and
 * pulls in `qrcode`, lucide icons and a CSS file; the migration is SQL and not
 * importable at all. Reading three files as text is the only thing that can put
 * all three in the same assertion. That does make these tests sensitive to the
 * SHAPE of the declarations, which is a real cost and is called out on each
 * matcher below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * The page WITHOUT its prose, and that is not a nicety.
 *
 * Every ban below names the thing it is banning, and the page explains each
 * removal in a comment that quotes it: the `'5 days'` placeholder, the "Drop
 * your 1:1 video or image here" slot with nothing behind it, the `rewardColor`
 * hexes. Run against the raw file, two of these assertions failed on their first
 * run — against correct code, matching the explanation of the fix rather than
 * the fix. `codeOnly` strips exactly the two comment shapes a string literal
 * cannot produce, which is where that prose lives.
 */
const PAGE = codeOnly(read('frontend/src/pages/ReferralsPage.jsx'));
const SERVICE = read('cloudflare-worker/src/services/referralSubmissions.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/175_referral_submissions.sql');

/**
 * The page's tone map. Found by the exact literal `const STATUS_TONE = {` and
 * read to its first `};` — reindenting is fine, renaming or moving it is not,
 * and this test failing with "parse broke" is how you find out.
 */
function pageStatuses() {
  const start = PAGE.indexOf('const STATUS_TONE = {');
  assert.ok(start >= 0, 'ReferralsPage.jsx no longer declares `const STATUS_TONE = {`');
  const end = PAGE.indexOf('};', start);
  const block = PAGE.slice(start, end);
  return new Set([...block.matchAll(/^\s*([a-z_]+):\s*'[a-z]+'/gm)].map((m) => m[1]));
}

/** The worker's `STATUSES` tuple, read between its `= [` and `] as const`. */
function workerStatuses() {
  const m = /export const STATUSES = \[([\s\S]*?)\] as const;/.exec(SERVICE);
  assert.ok(m, 'referralSubmissions.ts no longer declares `export const STATUSES = [ … ] as const;`');
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

/** The migration's CHECK constraint on `referral_submissions.status`. */
function migrationStatuses() {
  const m = /status\s+TEXT NOT NULL DEFAULT 'submitted'\s*CHECK \(status IN \(([\s\S]*?)\)\)/.exec(MIGRATION);
  assert.ok(m, 'migration 175 no longer declares a CHECK constraint on `status`');
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

const sorted = (s) => [...s].sort();

test('the page, the worker and the migration name the same eleven statuses', () => {
  const page = pageStatuses();
  const worker = workerStatuses();
  const migration = migrationStatuses();

  // Guard the parse before guarding the content: three empty sets are equal to
  // each other, and would make this test pass while reading nothing at all.
  assert.equal(worker.size, 11, `parsed ${worker.size} worker statuses, expected 11`);

  assert.deepEqual(sorted(page), sorted(worker),
    'ReferralsPage STATUS_TONE and the worker STATUSES disagree — a status the '
    + 'page does not know renders grey, and one the worker does not know cannot be stored');
  assert.deepEqual(sorted(migration), sorted(worker),
    'migration 175 CHECK and the worker STATUSES disagree — D1 would reject a write the worker allows');
});

test('every status the worker labels is a status the worker allows', () => {
  const worker = workerStatuses();
  const m = /export const STATUS_LABELS: Record<Status, string> = \{([\s\S]*?)\n\};/.exec(SERVICE);
  assert.ok(m, 'referralSubmissions.ts no longer declares `STATUS_LABELS`');
  const labelled = new Set([...m[1].matchAll(/^\s*([a-z_]+):\s*'/gm)].map((x) => x[1]));
  assert.equal(labelled.size, worker.size, `parsed ${labelled.size} labels for ${worker.size} statuses`);
  assert.deepEqual(sorted(labelled), sorted(worker),
    'STATUS_LABELS and STATUSES disagree — an unlabelled status falls back to its wire name in the UI');
});

test("the pipeline filter offers only statuses that can exist", () => {
  const worker = workerStatuses();
  const m = /const PIPELINE_FILTERS = \[([\s\S]*?)\];/.exec(PAGE);
  assert.ok(m, 'ReferralsPage.jsx no longer declares `PIPELINE_FILTERS`');
  const filters = [...m[1].matchAll(/'([A-Za-z_]+)'/g)].map((x) => x[1]);
  assert.ok(filters.length > 1, `parsed ${filters.length} filters, expected the list`);
  // 'All' is the page's own sentinel, not a status.
  const claimed = filters.filter((f) => f !== 'All');
  const unreal = claimed.filter((f) => !worker.has(f));
  assert.deepEqual(unreal, [],
    `PIPELINE_FILTERS offers ${unreal.join(', ')}, which no referral can ever have — `
    + 'a filter that can only ever match nothing is as dishonest as one that matches everything (D51)');
});

test('the verdict statuses partition the vocabulary, and each name is real', () => {
  const worker = workerStatuses();
  const m = /export const PRE_VERDICT_STATUSES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/.exec(SERVICE);
  assert.ok(m, 'referralSubmissions.ts no longer declares `PRE_VERDICT_STATUSES`');
  const pre = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.ok(pre.length >= 3, `parsed ${pre.length} pre-verdict statuses, expected the list`);

  // `VERDICT_STATUSES` is DERIVED as the complement, so it cannot disagree with
  // `STATUSES` by construction. What it CAN do is silently include a status that
  // should have been named pre-verdict, because a typo here — 'under_reveiw' —
  // would leave the real status on the verdict side and make "Avg. review time"
  // count a review as finished the moment it started. That is the failure this
  // catches: every name must be a status that exists.
  const notReal = pre.filter((s) => !worker.has(s));
  assert.deepEqual(notReal, [],
    `PRE_VERDICT_STATUSES names ${notReal.join(', ')}, which is not a real status — `
    + 'the real one then counts as a verdict and shortens the measured review time');

  // And the two sides must both be non-empty, or the measurement is degenerate:
  // everything pre-verdict means nothing is ever measured, and nothing
  // pre-verdict means every submission is measured as decided on arrival.
  assert.ok(pre.length < worker.size,
    'every status is pre-verdict, so no review can ever be measured as finished');
});

test('the reward tile reports a count, and does not scrape a figure out of free text', () => {
  // `reward_label` is TEXT by deliberate design (migration 175: rewards settle
  // off-platform, and no amount column exists). The tile used to regex a `$…`
  // figure out of the first matching row and present it as a total, falling back
  // to a count when no row had one — two units from one tile, and the dollar
  // branch was one row's label wearing a total's clothes.
  //
  // Asserted against the CODE, not the prose: the comment above the tile
  // describes the removed regex, so a bare-literal ban would match the
  // explanation of the fix rather than the fix.
  assert.ok(!/rows\.find\([^)]*reward_label/.test(PAGE),
    'the rewards tile is scraping a figure out of the free-text reward_label again');
  assert.ok(!/reward_label\?\.match\(/.test(PAGE),
    'the rewards tile is matching a currency figure out of reward_label again');
  assert.ok(/k: 'Rewards issued', v: String\(rewardIssued\)/.test(PAGE),
    'the rewards tile no longer reports the plain count of issued rewards');
});

test('"Avg. review time" comes from the worker, and says so when there is nothing to say', () => {
  // The tile's VALUE SLOT, not the bare string. `codeOnly` already removes the
  // comment that quotes the old placeholder, but a ban that only works because
  // of the stripper is a ban one indent change away from a false pass; this one
  // matches the shape the defect actually had — `v: '5 days'` in the tile array.
  assert.ok(!/v: '\d+ days?'/.test(PAGE), 'a hard-coded review time is back in the tile array');
  assert.ok(/overview\?\.avg_review_days/.test(PAGE),
    'the page no longer reads avg_review_days from the overview payload');
  assert.ok(/return 'Not recorded'/.test(PAGE),
    'the page no longer says "Not recorded" when nothing has reached a verdict');
  assert.ok(/avg_review_days: avgReviewDays/.test(read('cloudflare-worker/src/routes/refer_earn.ts')),
    'GET /refer-earn/overview no longer returns avg_review_days');
});

test('one status, one colour — the page has a single status→colour scheme', () => {
  // `rewardColor()` returned raw hexes off its own enumeration and disagreed
  // with STATUS_TONE on `converted`, `reward_eligible`, `qualified` and
  // `in_conversation`, so one row rendered two colours. It also ignored dark
  // mode. Both maps are keyed by tone now.
  assert.ok(!/function rewardColor\(/.test(PAGE), 'the second colour scheme is back');
  assert.ok(!/style=\{\{ color: reward/.test(PAGE), 'reward text is being coloured by inline hex again');
  assert.ok(/CHIP_TEXT\[STATUS_TONE\[status\]/.test(PAGE),
    'reward text no longer derives its colour from STATUS_TONE');

  // Every tone `STATUS_TONE` can produce must exist in BOTH maps, or a status
  // silently falls through to grey in one of them.
  const tones = new Set([...PAGE.matchAll(/^\s*[a-z_]+:\s*'([a-z]+)',/gm)].map((m) => m[1]));
  for (const map of ['CHIP', 'CHIP_TEXT']) {
    const block = PAGE.slice(PAGE.indexOf(`const ${map} = {`), PAGE.indexOf('};', PAGE.indexOf(`const ${map} = {`)));
    assert.ok(block.length > 20, `could not read the ${map} map`);
    for (const tone of ['green', 'amber', 'grey', 'purple', 'red']) {
      assert.ok(tones.has(tone) === false || new RegExp(`\\b${tone}:`).test(block),
        `${map} has no entry for the '${tone}' tone that STATUS_TONE produces`);
    }
  }
});

test('every share format offers only what the browser can actually produce', () => {
  // The canvas this came from drew three "download" buttons whose handlers were
  // `() => this.toast('1:1 card downloaded …')` over a drop slot with nothing
  // behind it. A control that reports success without doing anything is worse
  // than an absent one, and a drop target with no store is the same defect.
  //
  // Probed STRUCTURALLY rather than by its label: a drop slot is a file input,
  // and what matters is what it ACCEPTS. Both of this page's inputs take CSV and
  // both have a real destination — `parseLinkedInCsv` and `api.referralImport`.
  // A slot for the story video would accept `video/*` or `image/*`, and there is
  // nowhere on this platform to put one.
  //
  // The first draft of this assertion demanded exactly ONE file input and failed
  // — because there are two, both legitimate. That was the test being wrong
  // about the page, not the page being wrong; counting inputs was never the
  // point, and this is the assertion that was actually meant.
  const accepts = [...PAGE.matchAll(/<input[^>]*type="file"[^>]*accept="([^"]*)"/g)].map((m) => m[1]);
  const inputs = [...PAGE.matchAll(/type="file"/g)].length;
  assert.equal(accepts.length, inputs,
    `${inputs} file inputs but ${accepts.length} carry an accept= — an input that accepts anything accepts a video`);
  const nonCsv = accepts.filter((a) => !/csv/i.test(a));
  assert.deepEqual(nonCsv, [],
    `a file input accepting ${nonCsv.join(', ')} — no media store exists to receive it`);
  assert.ok(/renderShareCard\(/.test(PAGE), 'the share cards are no longer generated');
  // Each format must name real pixel dimensions — a format that cannot say how
  // big it is cannot have been rendered.
  const block = PAGE.slice(PAGE.indexOf('const SHARE_FORMATS = ['), PAGE.indexOf('\n];', PAGE.indexOf('const SHARE_FORMATS = [')));
  const widths = [...block.matchAll(/width: (\d+)/g)].map((m) => Number(m[1]));
  const heights = [...block.matchAll(/height: (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 3, `parsed ${widths.length} share formats, expected 3`);
  assert.equal(heights.length, 3, `parsed ${heights.length} format heights, expected 3`);
  for (const [i, w] of widths.entries()) {
    assert.ok(w >= 1080 && heights[i] >= 1080,
      `format ${i} is ${w}×${heights[i]} — below 1080 on an edge, which Instagram resamples`);
  }
});
