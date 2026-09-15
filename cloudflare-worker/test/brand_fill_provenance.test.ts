/**
 * A headline Eadwyn drafted, still knowable as one after it is published.
 *
 * `POST /brand/landing/autofill` has returned `ai_generated: true` since it
 * shipped and it works correctly: it drafts into the editor's LOCAL state, the
 * founder edits freely, and Save is the commit. Nothing about that needed
 * rebuilding. Its one defect was that the flag was read at the point of use and
 * thrown away, so a published headline the model wrote was indistinguishable from
 * one the founder typed — on the same page whose rail names the model that wrote
 * it and quotes what the run cost.
 *
 * WHAT THIS FILE PINS is the narrow claim that fixing it makes: per field, what
 * was proposed, what was saved, and whether the founder changed it in between.
 * The interesting cases are all the ones where a row should NOT be written —
 * a column the client named and the page does not have, a field cleared before
 * saving, a heuristic response that was never AI at all. Each of those would be a
 * provenance row asserting something false, which is worse than no row.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/brand_fill_provenance.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordCompositionFills, fillsForRow, filledColumns } from '../src/services/fills/provenance.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/** `fill_provenance`, from migration 246 rather than a hand-copy. */
function provenanceTable(): string {
  const src = read('sql/migrations/246_fills_the_blanks_everywhere.sql');
  const at = src.indexOf('CREATE TABLE IF NOT EXISTS fill_provenance');
  assert.ok(at >= 0, '246 no longer creates fill_provenance');
  const end = src.indexOf('\n);', at);
  assert.ok(end > at, "fill_provenance's DDL does not close the way this reader expects");
  // The FK to `validate_proposals` is dropped from the fixture: this path always
  // passes `proposalId: null` (a brand fill is not a Validate proposal) and the
  // fixture has no such table to point at.
  return `${src.slice(at, end)}\n);`
    .replace(/ REFERENCES validate_proposals\(id\) ON DELETE SET NULL/, '')
    .replace(/ REFERENCES users\(id\) ON DELETE SET NULL/, '');
}

const PAGE_ID = 501;
function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(provenanceTable());
  return db;
}
const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) }) as any;
const rows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM fill_provenance ORDER BY id').all() as any[];

test('an unedited pick records both values and edited = 0', async () => {
  const db = freshDb();
  const n = await recordCompositionFills(env(db), {
    table: 'landing_pages',
    rowId: PAGE_ID,
    proposals: { headline: 'Close in days, not quarters' },
    written: { headline: 'Close in days, not quarters', tagline: 'typed by the founder' },
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    task: 'brand_autofill',
    decidedBy: 12,
  });
  assert.equal(n, 1);
  const all = rows(db);
  assert.equal(all.length, 1, 'the founder’s own tagline was recorded as a fill');
  assert.equal(all[0].target_table, 'landing_pages');
  assert.equal(Number(all[0].target_row_id), PAGE_ID);
  assert.equal(all[0].target_column, 'headline');
  assert.equal(all[0].fill_class, 'composition');
  assert.equal(Number(all[0].edited), 0);
  assert.equal(all[0].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(all[0].task, 'brand_autofill');
  assert.equal(all[0].citation_json, null, 'a composition fill carries a citation');
  assert.equal(all[0].proposal_id, null, 'a brand fill is filed as a Validate proposal');
});

test('a drafted line the founder rewrote keeps both values and edited = 1', async () => {
  // THE CASE THE MAP-NOT-A-SET DESIGN EXISTS FOR. A founder who took a drafted
  // headline and rewrote half of it has produced something that is neither the
  // model's work nor unaided, and dropping the proposal on their first keystroke
  // would have lost exactly that.
  const db = freshDb();
  await recordCompositionFills(env(db), {
    table: 'landing_pages',
    rowId: PAGE_ID,
    proposals: { headline: 'Close in days, not quarters' },
    written: { headline: 'Close in days — not quarters, and not by email' },
    model: 'm', task: 'brand_autofill', decidedBy: 12,
  });
  const all = rows(db);
  assert.equal(all.length, 1);
  assert.equal(Number(all[0].edited), 1);
  assert.equal(all[0].proposed_value, 'Close in days, not quarters');
  assert.equal(all[0].written_value, 'Close in days — not quarters, and not by email');
});

test('whitespace is not an edit', async () => {
  // A trailing space nobody typed would otherwise mark every accept corrected.
  const db = freshDb();
  await recordCompositionFills(env(db), {
    table: 'landing_pages', rowId: PAGE_ID,
    proposals: { tagline: 'Procurement, solved' },
    written: { tagline: '  Procurement, solved\n' },
    model: 'm', task: 'brand_autofill', decidedBy: 1,
  });
  assert.equal(Number(rows(db)[0].edited), 0);
});

test('a column the page does not have files nothing', async () => {
  // The client sends the columns it BELIEVES it filled — `body` maps to a
  // per-audience column it computes itself — so a stale or wrong name has to file
  // nothing rather than file provenance against a value nobody set.
  const db = freshDb();
  const n = await recordCompositionFills(env(db), {
    table: 'landing_pages', rowId: PAGE_ID,
    proposals: { headline: 'kept', audience_investor_body: 'this page has no investor body' },
    written: { headline: 'kept' },
    model: 'm', task: 'brand_autofill', decidedBy: 1,
  });
  assert.equal(n, 1);
  assert.deepEqual(rows(db).map((r) => r.target_column), ['headline']);
});

test('a field cleared before saving is not a fill of anything', async () => {
  // A row saying "Eadwyn proposed X and the page holds nothing" would put
  // provenance behind an empty field, which `filledColumns` would then have to
  // special-case. The founder deleted it; there is nothing to attribute.
  const db = freshDb();
  const n = await recordCompositionFills(env(db), {
    table: 'landing_pages', rowId: PAGE_ID,
    proposals: { headline: 'Close in days', subheadline: 'never mind' },
    written: { headline: 'Close in days', subheadline: '   ' },
    model: 'm', task: 'brand_autofill', decidedBy: 1,
  });
  assert.equal(n, 1);
  assert.deepEqual(rows(db).map((r) => r.target_column), ['headline']);

  // And an empty PROPOSAL is not one either.
  const empty = await recordCompositionFills(env(db), {
    table: 'landing_pages', rowId: PAGE_ID,
    proposals: { tagline: '' }, written: { tagline: 'the founder wrote this' },
    model: 'm', task: 'brand_autofill', decidedBy: 1,
  });
  assert.equal(empty, 0);
});

test('no proposals is no rows and no error', async () => {
  const db = freshDb();
  for (const proposals of [{}, null as any, 'nonsense' as any]) {
    const n = await recordCompositionFills(env(db), {
      table: 'landing_pages', rowId: PAGE_ID, proposals, written: { headline: 'x' },
    });
    assert.equal(n, 0);
  }
  assert.equal(rows(db).length, 0);
});

test('the newest row per column is what a page reads back', async () => {
  // A founder who picks a suggestion, saves, edits it and saves again leaves two
  // rows behind, and only the last describes what is on the page.
  const db = freshDb();
  await recordCompositionFills(env(db), {
    table: 'landing_pages', rowId: PAGE_ID,
    proposals: { headline: 'first draft' }, written: { headline: 'first draft' },
    model: 'm', task: 'brand_autofill', decidedBy: 1,
  });
  await recordCompositionFills(env(db), {
    table: 'landing_pages', rowId: PAGE_ID,
    proposals: { headline: 'first draft' }, written: { headline: 'first draft, corrected' },
    model: 'm', task: 'brand_autofill', decidedBy: 1,
  });
  const fills = await fillsForRow(env(db), 'landing_pages', PAGE_ID);
  assert.equal(fills.length, 1, 'both states are returned, so a page has to choose');
  assert.equal(fills[0].written_value, 'first draft, corrected');
  assert.equal(fills[0].edited, true);

  // AND A PAGE ONLY LABELS WHAT STILL HOLDS IT. The founder typing over a drafted
  // line by hand owns it, and a card still reading "Eadwyn" over their words would
  // be the same lie pointed the other way.
  assert.equal(filledColumns(fills, { headline: 'first draft, corrected' }).size, 1);
  assert.equal(filledColumns(fills, { headline: 'something else entirely' }).size, 0);
  assert.equal(filledColumns(fills, {}).size, 0);
});

test('the autofill route reports the model that ran, and the save route records it', () => {
  const route = read('src/routes/brand.ts');
  // `usage.model`, not the requested one: `brand_autofill` degrades to
  // SMALL_LLAMA, and a provenance row naming the primary after the fallback
  // answered would be a false receipt from the table that exists to stop those.
  assert.match(route, /model: res\.usage\?\.model \?\? null,/,
    'aiTemplateContent no longer reports the model that ran');
  assert.match(route, /await recordCompositionFills\(c\.env, \{/,
    'the page save no longer records what Eadwyn wrote');

  const at = route.indexOf('await recordCompositionFills');
  const call = route.slice(at, at + 700);
  assert.match(call, /table: 'landing_pages'/);
  assert.match(call, /written: row \|\| \{\}/,
    'the written values do not come from the row the save produced');
  assert.match(call, /task: 'brand_autofill'/);

  // READ AFTER THE WRITE. `row` is re-selected after `updateLandingRow`, so
  // `written` is what the page holds rather than what the request asked for.
  assert.ok(
    route.indexOf('await updateLandingRow(', 0) < at,
    'provenance is recorded before the row is written',
  );
});

test('the editor keeps the proposal through the draft and drops it with the session', () => {
  const page = read('../frontend/src/pages/SpinoutLabBrandPage.jsx');
  // A MAP, NOT A SET — the difference between recording an edit and losing it.
  assert.match(page, /const \[aiProposed, setAiProposed\] = useState\(\{\}\)/);
  assert.match(page, /if \(suggest\?\.fromAi\) setAiProposed\(\(m\) => \(\{ \.\.\.m, \[blockKey\]: text \}\)\)/,
    'a picked suggestion is no longer remembered as one');
  // A heuristic response is not something Eadwyn wrote.
  assert.match(page, /fromAi: r\?\.ai_generated === true/);
  // And nothing leaks between editor sessions, which would file one page's
  // drafted headline against another's row.
  const opens = [...page.matchAll(/setAiProposed\(\{\}\)/g)].length;
  assert.ok(opens >= 2, `the proposals are cleared in ${opens} place(s); open and close both need it`);
  assert.match(page, /payload\.ai_proposals = proposals;/);
  assert.match(page, /payload\.ai_model = aiModelRef\.current \|\| null;/);
  // `body` writes to a per-audience column, which is the mapping the server
  // cannot guess and the reason the client sends column names at all.
  assert.match(page, /blockKey === 'body' \? `audience_\$\{editorAud\}_body` : blockKey/);
});
