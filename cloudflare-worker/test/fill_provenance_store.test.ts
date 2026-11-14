/**
 * A filled value that cannot say where it came from makes the product lie.
 *
 * `SpinoutLabMarketPage` says three true things today: a comment stating that its
 * figures are "founder-entered/derived, not AI output, so the copy drops that
 * claim rather than lie about provenance"; on screen, "Nothing on this page is
 * auto-invented"; and per-card stamps reading "Founder research" and "Founder
 * model". `projects.tam` is a bare `REAL` with nothing beside it, so the moment a
 * model can write there all three are false at once.
 *
 * `fill_provenance` is what lets the label follow the figure. These tests run the
 * writer and the two readers against real SQLite built from MIGRATION 246 itself,
 * because every failure worth catching here is a query that answers plausibly and
 * wrongly:
 *
 *   · `edited` derived from a flag a caller passes would eventually be passed
 *     wrong, and a row claiming a value is untouched when a person corrected it
 *     is the one thing this table must never say.
 *   · A reader returning every historical row would make each page choose which
 *     one describes the screen, and two pages choosing differently is how they
 *     come to disagree about one value.
 *   · A page labelling from provenance ALONE would keep saying "Eadwyn · sourced"
 *     over a figure the founder has since typed over by hand — the same lie
 *     pointed the other way.
 *   · Trailing whitespace counted as an edit would make every accept look
 *     corrected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordFill, fillsForRow, filledColumns } from '../src/services/fills/provenance.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/**
 * The table comes FROM MIGRATION 246, not from a hand-written copy — the rule
 * `partner_pipeline_stores.test.ts` states in its own header. It matters twice
 * here, because `provenance.ts` also carries a lazy `CREATE TABLE IF NOT EXISTS`
 * for dev databases: if that copy and the migration drift apart, this fixture is
 * the migration's side and every assertion below runs against it.
 */
function tableFromMigration(name: string, table: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `${table} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(');', at) + 2);
}

const MIGRATION = '246_fills_the_blanks_everywhere';

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT);');
  db.exec('CREATE TABLE validate_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT);');
  db.exec(tableFromMigration(MIGRATION, 'fill_provenance'));
  db.prepare('INSERT INTO users (id, role) VALUES (?,?)').run(7, 'founder');
  return db;
}
const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) }) as any;

const TARGET = { table: 'projects', rowId: 41, column: 'tam' };
const CITATION = {
  kind: 'library' as const, document_id: 9, title: 'Sector sizing 2026', chunk: 2,
  quote: 'The European segment was valued at $1.2bn in 2026.',
};

test('the migration is what the lazy ensure copies, field for field', () => {
  // Both definitions exist on purpose — one for D1, one for a dev database that
  // has not migrated. Two definitions is how two definitions drift, so the only
  // defence is to compare them.
  const migration = tableFromMigration(MIGRATION, 'fill_provenance');
  const lazy = readFileSync(resolve(HERE, '../src/services/fills/provenance.ts'), 'utf8');
  for (const col of [
    'target_table', 'target_row_id', 'target_column', 'proposal_id', 'fill_class',
    'proposed_value', 'written_value', 'edited', 'citation_json', 'model', 'task',
    'decided_by', 'created_at',
  ]) {
    assert.ok(migration.includes(col), `migration 246 no longer declares ${col}`);
    assert.ok(lazy.includes(col), `the lazy ensure no longer declares ${col}`);
  }
  // `edited` must default to 0 in both, or an un-migrated dev row reads as
  // corrected when nobody touched it.
  assert.match(migration, /edited INTEGER NOT NULL DEFAULT 0/);
  assert.match(lazy, /edited INTEGER NOT NULL DEFAULT 0/);
});

test('an accepted fill is recorded once, at the address it was written to', async () => {
  const db = freshDb();
  const e = env(db);
  const id = await recordFill(e, {
    target: TARGET, proposalId: null, fillClass: 'sourced',
    proposedValue: '1200000000', writtenValue: '1200000000',
    citation: CITATION, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', task: 'fill_market_sizing',
    decidedBy: 7,
  });
  assert.ok(id > 0, 'nothing was written');

  const fills = await fillsForRow(e, 'projects', 41);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].target_column, 'tam');
  assert.equal(fills[0].fill_class, 'sourced');
  assert.equal(fills[0].edited, false);
  assert.deepEqual(fills[0].citation, CITATION);
  assert.equal(fills[0].model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

  // Another row's fills are not this row's. The address is three parts and all
  // three have to match, or a project would read its neighbour's provenance.
  assert.deepEqual(await fillsForRow(e, 'projects', 42), []);
  assert.deepEqual(await fillsForRow(e, 'company_profiles', 41), []);
});

test('`edited` is derived from the two values, never from a caller saying so', async () => {
  const db = freshDb();
  const e = env(db);
  await recordFill(e, {
    target: TARGET, proposalId: null, fillClass: 'sourced',
    proposedValue: '1200000000', writtenValue: '980000000', citation: CITATION,
  });
  const [f] = await fillsForRow(e, 'projects', 41);
  assert.equal(f.edited, true, 'a corrected figure reads as untouched');
  assert.equal(f.proposed_value, '1200000000', 'what Eadwyn said is gone');
  assert.equal(f.written_value, '980000000', 'what the founder wrote is gone');
});

test('whitespace is not an edit, because counting it would make every accept look corrected', async () => {
  const db = freshDb();
  const e = env(db);
  await recordFill(e, {
    target: TARGET, proposalId: null, fillClass: 'composition',
    proposedValue: 'A calmer way to close the books.',
    writtenValue: '  A calmer way to close the books.\n',
  });
  const [f] = await fillsForRow(e, 'projects', 41);
  assert.equal(f.edited, false);
});

test('the newest row per column is what a page reads, not every row ever written', async () => {
  const db = freshDb();
  const e = env(db);
  // Three accepts on one column: filled, corrected, then filled again.
  for (const [proposed, written] of [['100', '100'], ['200', '150'], ['300', '300']]) {
    await recordFill(e, {
      target: TARGET, proposalId: null, fillClass: 'sourced',
      proposedValue: proposed, writtenValue: written, citation: CITATION,
    });
  }
  await recordFill(e, {
    target: { ...TARGET, column: 'sam' }, proposalId: null, fillClass: 'sourced',
    proposedValue: '40', writtenValue: '40', citation: CITATION,
  });

  const fills = await fillsForRow(e, 'projects', 41);
  assert.equal(fills.length, 2, 'a page is being handed every historical row and made to choose');
  const byCol = Object.fromEntries(fills.map((f) => [f.target_column, f]));
  assert.equal(byCol.tam.written_value, '300', 'the newest fill is not the one returned');
  assert.equal(byCol.tam.edited, false);
  assert.equal(byCol.sam.written_value, '40');
});

test('a value the founder has since typed over is no longer Eadwyn’s', async () => {
  const db = freshDb();
  const e = env(db);
  await recordFill(e, {
    target: TARGET, proposalId: null, fillClass: 'sourced',
    proposedValue: '1200000000', writtenValue: '1200000000', citation: CITATION,
  });
  const fills = await fillsForRow(e, 'projects', 41);

  // Still Eadwyn's: the row holds what was written.
  assert.ok(filledColumns(fills, { tam: 1200000000 }).has('tam'));
  // A numeric column's own formatting is not a change of answer.
  assert.ok(filledColumns(fills, { tam: '1200000000.0' }).has('tam'));
  // Typed over by hand — the card must stop claiming Eadwyn sourced it.
  assert.ok(!filledColumns(fills, { tam: 950000000 }).has('tam'),
    'a hand-typed figure still reads as AI-sourced');
  // Cleared entirely, and a null is not a match for anything.
  assert.ok(!filledColumns(fills, { tam: null }).has('tam'));
  assert.ok(!filledColumns(fills, {}).has('tam'));
});

test('a citation round-trips, and unparseable JSON is absent rather than fatal', async () => {
  const db = freshDb();
  const e = env(db);
  const research = {
    kind: 'research' as const, task: 'research_ask',
    query: 'European market size for close-the-books software 2026',
    source: 'Sector sizing 2026', quote: 'valued at $1.2bn',
  };
  await recordFill(e, {
    target: { ...TARGET, column: 'sam' }, proposalId: null, fillClass: 'sourced',
    proposedValue: '40', writtenValue: '40', citation: research,
  });
  assert.deepEqual((await fillsForRow(e, 'projects', 41))[0].citation, research);

  // A row whose JSON is corrupt must not take the whole read down with it — the
  // page's job is to label values, and one unreadable citation is not a reason
  // to stop labelling the rest.
  db.prepare("UPDATE fill_provenance SET citation_json = '{not json' WHERE id = 1").run();
  const after = await fillsForRow(e, 'projects', 41);
  assert.equal(after.length, 1, 'a corrupt citation took the read down');
  assert.equal(after[0].citation, null);
});

test('a restatement and a composition record no citation, and that is not a gap', async () => {
  const db = freshDb();
  const e = env(db);
  await recordFill(e, {
    target: { table: 'hypotheses', rowId: 3, column: 'claim' }, proposalId: 11,
    fillClass: 'restatement', proposedValue: 'Buyers delay because onboarding takes weeks',
    writtenValue: 'Buyers delay because onboarding takes weeks',
  });
  const [f] = await fillsForRow(e, 'hypotheses', 3);
  assert.equal(f.citation, null, 'a restatement invented a citation');
  assert.equal(f.fill_class, 'restatement');
  // `fill_class` is stored rather than joined through `proposal_id`, because the
  // reference is ON DELETE SET NULL and this row has to stay readable without it.
  db.prepare('UPDATE fill_provenance SET proposal_id = NULL WHERE id = 1').run();
  assert.equal((await fillsForRow(e, 'hypotheses', 3))[0].fill_class, 'restatement');
});
