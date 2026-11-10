/**
 * D4826 (#4826, Expertise UX) — the Thinking shelf's editorial states against
 * the statuses the Worker actually writes.
 *
 * D4681 already gave every state its own pill, audience line and next step
 * (`expertise_workflows_4681.test.mjs` pins those). What was still missing is
 * the thing that keeps it true: nothing tied `expertiseModel`'s states to the
 * column, so a status added to either router would have fallen through to the
 * `unknown` fallback — silently, on a founder's own shelf. **The first test
 * below reads both routers and fails on exactly that.**
 *
 * The rest is what this issue found still wrong: the export carried the stored
 * column value rather than the shelf's words, and the `unknown` fallback drew
 * that value as a founder-facing label.
 *
 * All fixtures are synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/expertise_states_4826.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARTICLE_STAGE_KEYS, ARTICLE_STATUSES, articleStage, articleStateLabel, stageKey,
} from '../src/pages/advisor/expertise/expertiseModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** The canvas's eight editorial states, in the order #4826's body lists them. */
const CANVAS_STATES = ['Draft', 'Submitted', 'In review', 'Changes requested', 'Approved', 'Scheduled', 'Published', 'Rejected'];

test('every status the Worker writes to articles.status has a state on the shelf', () => {
  // Mutation checked: a status deleted from ARTICLE_STATUSES → the "found in
  // the routers" assert fails; a key deleted from STAGES → the stage assert
  // fails. This is the guard the issue needs: it is what stops a new status
  // reaching a founder's shelf as the `unknown` fallback.
  const routers = ['cloudflare-worker/src/routes/articles.ts', 'cloudflare-worker/src/routes/admin_articles.ts'].map(read).join('\n');
  // Every form the two routers write it in: `status='x'`, `status = 'x'` and
  // the object form `{ status: 'x', … }` the admin's own helper takes. These
  // two files name no other table's status, so this is an EQUALITY, not a
  // subset: a status added to either router, or dropped from the list here,
  // fails this test rather than reaching a founder's shelf as `unknown`.
  const written = [...new Set([...routers.matchAll(/\bstatus\s*[:=]\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(written, [...ARTICLE_STATUSES].sort(), 'the statuses the routers write are exactly the ones this page has states for');
  for (const s of ARTICLE_STATUSES) {
    // Each one has a state, so none of them reaches the unknown fallback.
    assert.notEqual(articleStage({ id: 1, status: s }).key, 'unknown', `${s} has no state`);
    assert.equal(stageKey({ id: 1, status: s }), s, `${s} is its own state`);
  }
  // The column's own default is one of them, so a new row is never `unknown`.
  assert.match(read('cloudflare-worker/sql/schema_baseline.sql'), /CREATE TABLE articles \([^;]*status TEXT NOT NULL DEFAULT 'draft'/);
  assert.ok(ARTICLE_STATUSES.includes('draft'));
});

test("the canvas's eight states are the shelf's, and Scheduled is the one that is derived", () => {
  // Mutation checked: `stageKey` returning 'approved' for a scheduled piece →
  // the derived assert fails; 'scheduled' added to ARTICLE_STATUSES → the
  // "not a column value" assert fails.
  assert.equal(ARTICLE_STAGE_KEYS.length, CANVAS_STATES.length, 'one state per canvas state');
  const labels = ARTICLE_STAGE_KEYS.map((k) => articleStage({ id: 1, status: k === 'scheduled' ? 'approved' : k, publish_at: k === 'scheduled' ? '2026-12-01T09:00:00Z' : null, slug: 'a-synthetic-piece' }).label);
  // "Not accepted" is D4681's word for the canvas's "Rejected": the shelf
  // speaks to the writer, and that is a departure D4681 recorded, not a gap.
  assert.deepEqual(labels, ['Draft', 'Submitted', 'In review', 'Changes requested', 'Not accepted', 'Approved', 'Scheduled', 'Published']);
  assert.deepEqual([...CANVAS_STATES].sort(), [...labels.map((l) => (l === 'Not accepted' ? 'Rejected' : l))].sort(), 'every canvas state is drawn');

  // Scheduled is the one state with no status of its own: it is approved with
  // a publish_at, as the admin queue derives it too (D484, migration 346).
  assert.equal(ARTICLE_STATUSES.includes('scheduled'), false, 'scheduled is not a column value');
  assert.equal(stageKey({ status: 'approved', publish_at: '2026-12-01T09:00:00Z' }), 'scheduled');
  assert.equal(stageKey({ status: 'approved', publish_at: null }), 'approved');
  assert.match(read('cloudflare-worker/src/services/articleQueue.ts'), /status = 'approved' AND [a-z.]*publish_at IS NOT NULL THEN 'scheduled'/,
    'the Worker derives it the same way, so the shelf is not inventing it');
  // The column exists, so this is derived from a store and not from nothing.
  assert.match(read('cloudflare-worker/sql/migrations/346_article_publish_at.sql'), /ADD COLUMN publish_at TEXT/);
  // And the advisor's own read returns it, or the shelf could never see it.
  assert.match(read('cloudflare-worker/src/routes/advisors_cohorts.ts'), /SELECT id, slug, title, subtitle, status, published_at, publish_at/);
});

test('a status this page has no words for is Not recorded, never drawn as the stored value', () => {
  // Mutation checked: the label back to `String(a?.status)` → the first assert
  // reads 'archived' and fails, which is what a founder used to be shown.
  const odd = articleStage({ id: 7, status: 'archived' });
  assert.equal(odd.key, 'unknown');
  assert.equal(odd.label, 'Not recorded', 'never the column value as a label');
  assert.match(odd.audience, /recorded as “archived”/, 'the stored value is named in the record, where it belongs');
  assert.match(odd.audience, /Who can read it is not recorded\.$/, 'and it does not guess who can read it');
  assert.equal(odd.next.to, '/articles/edit/7', 'there is still one next step');
  const blank = articleStage({ id: 8 });
  assert.equal(blank.label, 'Not recorded');
  assert.match(blank.audience, /^No state is recorded for it\./);
  assert.doesNotMatch(blank.audience, /“/, 'nothing is quoted when nothing is stored');
});

test('the export carries the shelf’s words for the state, not the column value', () => {
  // Mutation checked: the cell back to `a.status` → the source assert fails
  // and the export names six states in the store's language.
  for (const [status, label] of [
    ['draft', 'Draft'], ['submitted', 'Submitted'], ['in_review', 'In review'],
    ['changes_requested', 'Changes requested'], ['rejected', 'Not accepted'],
    ['approved', 'Approved'], ['published', 'Published'],
  ]) {
    assert.equal(articleStateLabel({ id: 1, status }), label, status);
  }
  assert.equal(articleStateLabel({ id: 1, status: 'approved', publish_at: '2026-12-01T09:00:00Z' }), 'Scheduled');
  const zone = read('frontend/src/pages/advisor/expertise/ThinkingZone.jsx');
  assert.match(zone, /cells: \(a\) => \[a\.title, a\.subtitle, a\.sector, articleStateLabel\(a\)/, 'the export row uses the label');
  assert.doesNotMatch(zone, /a\.sector, a\.status,/, 'and no longer the column value');
});

test('the shelf row keeps its state and figures at a phone’s width', () => {
  // Mutation checked: the `flex-col`/`sm:flex-row` pair back to a plain
  // `flex … justify-between` → the stacking assert fails, which is the layout
  // that squeezed the pill and the figures on a phone.
  const zone = read('frontend/src/pages/advisor/expertise/ThinkingZone.jsx');
  assert.match(zone, /className="flex flex-col gap-2 py-2\.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"/, 'the row stacks below sm');
  assert.match(zone, /text-left text-\[11px\] tabular-nums text-axal-faint sm:text-right/, 'and the figures read from the start when it does');
  // The state is a word as well as a colour, at either width (D4681's Pill
  // draws `stage.label`), and the row carries its state for a test to read.
  assert.match(zone, /<Pill tone=\{stage\.tone\}>\{stage\.label\}<\/Pill>/, 'the pill is the label, so colour is never the only signal');
  assert.match(zone, /data-stage=\{stage\.key\}/);
});
