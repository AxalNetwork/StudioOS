/**
 * D5071 (#5071) — Raise readiness says what it means: each item names the workflow that fixes it, each
 * score reads the right inputs, and freshness is the hash of the exact inputs read. Synthetic facts only.
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/raise_readiness_truth_5071.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import {
  canonicalJson, computeReadiness, inputHash, latestScores, loadReadiness, nextSteps, readinessCard, readinessFix, readinessFreshness,
} from '../src/services/raiseCycle.ts';
import { rescoreReadiness } from '../src/services/raiseWriters.ts';

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => `${r.sql};`).join('\n');
  db.close(); return out;
})();
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Synthetic founder','founder@example.test',11,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11);`);
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development' };
  return { db, env, ctx: { env, projectId: 1, today: '2026-10-24' } as any };
}
const byKey = async (env: any) => Object.fromEntries((await computeReadiness(env, 1)).map((c) => [c.key, c]));
const monthAgo = "date('now','start of month','-1 month','+1 day')";

test('the fix for each item is the workflow that fixes it, from one table, never the readiness page', () => {
  const ctx: any = { projectId: 7 };
  const at = (key: string, score?: any) => readinessFix(ctx, key, score)!;
  assert.equal(at('narrative', null).href, '/raise/investor-narrative/new?project=7', 'no version: New version');
  assert.equal(at('narrative', { score: null, missing: 'Not enough recorded · save an investor narrative version.' }).href, '/raise/investor-narrative/new?project=7');
  assert.equal(at('narrative', { score: 6, missing: '2 figures differ from the stored metrics.' }).href, '/raise/investor-narrative/check?project=7', 'a disagreement: the Check tab');
  assert.equal(at('narrative', { score: null, missing: 'Not enough recorded' }).href, '/raise/investor-narrative/check?project=7');
  assert.equal(at('deck').href, '/raise/pitch?project_id=7');
  assert.equal(at('data_room').href, '/raise/data-room/checklist?project=7');
  assert.equal(at('cap_table').href, '/raise/cap-table?project=7');
  assert.equal(at('use_of_funds').href, '/raise/use-of-funds?project=7');
  for (const key of ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team', 'pmf']) {
    assert.ok(at(key, null).href, key);
    assert.doesNotMatch(at(key, { score: 3, missing: 'x' }).href, key === 'pmf' || key === 'traction' ? /^$/ : /fundraising-readiness/, `${key} does not route through the readiness page`);
  }
  assert.equal(readinessFix(ctx, 'unknown'), null);
});

test('the card step and the next steps open that item\'s workflow; a Narrative gap opens Narrative', async () => {
  const { db, ctx } = fixture();
  await rescoreReadiness(ctx.env, { projectId: 1, userId: 1 });
  const card: any = await readinessCard(ctx);
  assert.ok(card.next, 'a gap has a step');
  assert.doesNotMatch(card.next.href, /fundraising-readiness/, 'the step is the item\'s own workflow');
  // Narrative is the first gap here: nothing saved.
  assert.equal(card.next.href, '/raise/investor-narrative/new?project=1');
  const steps = await nextSteps(ctx);
  const hrefs = Object.fromEntries(steps.items.map((s) => [s.item_key, s.href]));
  for (const [key, href] of Object.entries(hrefs)) assert.doesNotMatch(String(href), /fundraising-readiness/, key);
  assert.equal(hrefs.data_room ?? '/raise/data-room/checklist?project=1', '/raise/data-room/checklist?project=1');
  db.close();
});

test('Pitch: 10 only for a current saved version with cards; a deck row alone is 3; none is 0', async () => {
  const { db, env } = fixture();
  assert.deepEqual([(await byKey(env)).deck.score, (await byKey(env)).deck.missing], [0, 'Build the pitch deck.']);
  db.exec("INSERT INTO pitch_decks(project_id,version,slides,is_current) VALUES (1,1,'[]',1)");
  let deck = (await byKey(env)).deck;
  assert.deepEqual([deck.score, deck.missing], [3, 'Add cards to the current deck.']);
  db.exec("UPDATE pitch_decks SET is_current = 0");
  deck = (await byKey(env)).deck; assert.deepEqual([deck.score, deck.missing], [3, 'Make a saved version the current deck.']);
  db.exec(`UPDATE pitch_decks SET is_current = 1, slides = '[{"title":"Cover"}]'`);
  deck = (await byKey(env)).deck; assert.deepEqual([deck.score, deck.missing], [10, null]);
  db.close();
});

test('Cap table: a recorded ownership is not the same as a scenario; a failed read is Unavailable, never 0', async () => {
  const { db, env } = fixture();
  let cap = (await byKey(env)).cap_table; assert.deepEqual([cap.score, cap.missing], [0, 'Set up the cap table.']);
  db.exec(`INSERT INTO cap_table_scenarios(uid,owner_user_id,project_id,name,inputs_json,result_json,is_variant) VALUES ('s1',1,1,'Base','{"founders":[]}','{"founding":[]}',0)`);
  cap = (await byKey(env)).cap_table;
  assert.equal(cap.score, 3, 'a scenario with no shares in it is not an ownership record');
  assert.equal(cap.evidence, 'stated');
  db.exec(`UPDATE cap_table_scenarios SET inputs_json='{"founders":[{"name":"Ada","shares":8000000}]}', result_json='{"founding":[{"holder":"Ada","shares":8000000,"pct":100}]}'`);
  cap = (await byKey(env)).cap_table;
  assert.equal(cap.score, 6, 'a model with shares is a stated model, not a recorded ownership');
  assert.match(String(cap.missing), /Record your holders/);
  db.exec('DROP TABLE cap_table_scenarios');
  cap = (await byKey(env)).cap_table;
  assert.deepEqual([cap.score, cap.evidence, cap.input_hash], [null, null, null], 'Unavailable: no score, and no hash that could be called current');
  assert.match(String(cap.missing), /^Unavailable/);
  db.close();
});

test('Traction is scored by the quality of its proof: none 0, stated 5, documented 8, measured 10', async () => {
  const { db, env } = fixture();
  assert.equal((await byKey(env)).traction.score, 0);
  db.exec('UPDATE projects SET mrr = 5000 WHERE id = 1');
  let t = (await byKey(env)).traction;
  assert.deepEqual([t.score, t.evidence], [5, 'stated']);
  assert.match(String(t.missing), /Connect Stripe or Mercury/);
  db.exec(`INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,revenue_type,received_on,source,verification,proof_document_id)
    VALUES ('r1',1,'Synthetic customer',50000,'one_time',${monthAgo},'manual','supported',1)`);
  t = (await byKey(env)).traction;
  assert.deepEqual([t.score, t.evidence], [8, 'pattern'], 'proof recorded, not connector-measured');
  db.exec(`UPDATE revenue_entries SET source = 'stripe', verification = 'verified'`);
  t = (await byKey(env)).traction;
  assert.deepEqual([t.score, t.evidence, t.missing], [10, 'measured', null]);
  db.close();
});

test('input hashes are deterministic: key order does not matter, content does', async () => {
  assert.equal(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] }), canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }));
  assert.equal(await inputHash({ b: 1, a: 2 }), await inputHash({ a: 2, b: 1 }));
  assert.notEqual(await inputHash({ a: 2 }), await inputHash({ a: 3 }));
  assert.match(await inputHash({}), /^[0-9a-f]{64}$/);
  const { db, env } = fixture();
  const one = await computeReadiness(env, 1); const two = await computeReadiness(env, 1);
  assert.deepEqual(one.map((c) => [c.key, c.input_hash]), two.map((c) => [c.key, c.input_hash]), 'the same inputs give the same hashes');
  db.close();
});

test('freshness: Current until an input changes, then Stale; no hash is Not recorded; a failed check is Unavailable; unscored is none', async () => {
  const { db, env, ctx } = fixture();
  const fresh = async () => {
    const { items, scores } = await loadReadiness(ctx);
    return Object.fromEntries([...(await readinessFreshness(ctx, latestScores(scores), items))]);
  };
  assert.deepEqual(await fresh(), {}, 'nothing scored: no freshness at all (Not scored, not Stale)');
  await rescoreReadiness(env, { projectId: 1, userId: 1 });
  const first = await fresh();
  for (const key of ['deck', 'use_of_funds', 'cap_table', 'traction', 'data_room', 'narrative']) assert.equal(first[key], 'current', key);
  assert.ok(!('team' in first) && !('pmf' in first), 'a person-scored item has no hash');
  db.exec('UPDATE projects SET funding_needed = 99000 WHERE id = 1');
  assert.equal((await fresh()).use_of_funds, 'stale', 'a typed field changed: its score is stale');
  assert.equal((await fresh()).deck, 'current', 'the other items are untouched');
  db.exec('UPDATE readiness_scores SET input_hash = NULL');
  assert.equal((await fresh()).deck, 'not_recorded');
  db.exec('DROP TABLE cap_table_scenarios');
  assert.equal((await fresh()).cap_table, 'unavailable', 'the cap table check cannot read: neither current nor stale');
  db.close();
});

test('a zero, a missing value and an unscored item stay three different things', async () => {
  const { db, env, ctx } = fixture();
  await rescoreReadiness(env, { projectId: 1, userId: 1 });
  const { items, scores } = await loadReadiness(ctx);
  const latest = latestScores(scores);
  const row = (key: string) => latest.get(Number(items.find((i) => i.item_key === key)!.id))!;
  assert.equal(row('deck').score, 0, 'no deck is a real zero');
  assert.equal(row('narrative').score, null, 'no version is not scored, not 0');
  assert.equal(items.find((i) => i.item_key === 'team') && latest.get(Number(items.find((i) => i.item_key === 'team')!.id)), undefined, 'Team was never scored: no row');
  db.close();
});
