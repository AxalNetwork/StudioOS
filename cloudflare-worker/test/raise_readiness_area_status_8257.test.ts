/**
 * D8257 (#8257) — the Raise overview's readiness card names each area by key, with its status and the
 * day it was last scored, by the rule Fundraising readiness draws (RA-23). Synthetic facts only.
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/raise_readiness_area_status_8257.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { readinessAreaStatus, readinessCard } from '../src/services/raiseCycle.ts';
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
const bars = (card: any) => card.series.find((s: any) => s.kind === 'hbar').items as any[];
const byKey = (card: any) => Object.fromEntries(bars(card).map((i) => [i.key, i]));

test('each status, by the rule Fundraising readiness draws', () => {
  assert.equal(readinessAreaStatus(null), 'not_recorded', 'nothing scored it');
  assert.equal(readinessAreaStatus(undefined, 'stale'), 'not_recorded', 'no score is never Stale');
  assert.equal(readinessAreaStatus({ score: null, missing: null }), 'not_recorded', 'a score row that holds nothing');
  assert.equal(readinessAreaStatus({ score: 8, missing: null }), 'ready');
  assert.equal(readinessAreaStatus({ score: 8, missing: '  ' }), 'ready', 'blank missing is nothing missing');
  assert.equal(readinessAreaStatus({ score: 6, missing: '2 figures differ from the stored metrics.' }), 'attention');
  assert.equal(readinessAreaStatus({ score: 0, missing: 'Build the pitch deck.' }), 'missing', 'a measured 0 with a gap is Missing');
  assert.equal(readinessAreaStatus({ score: null, missing: 'Not enough recorded' }), 'missing');
  assert.equal(readinessAreaStatus({ score: 8, missing: null }, 'stale'), 'stale', 'inputs changed since it was scored');
  assert.equal(readinessAreaStatus({ score: 6, missing: 'x' }, 'stale'), 'stale', 'Stale before Needs attention');
  assert.equal(readinessAreaStatus({ score: 8, missing: null }, 'current'), 'ready');
  assert.equal(readinessAreaStatus({ score: 8, missing: null }, 'unavailable'), 'ready', 'a freshness that could not be worked out is not Stale');
  assert.equal(readinessAreaStatus({ score: null, missing: 'Unavailable: the cap table could not be read.' }, 'stale'), 'unavailable', 'Unavailable before Stale');
});

test('the card names each area by key, with its status and the day it was scored', async () => {
  const { db, ctx } = fixture();
  await rescoreReadiness(ctx.env, { projectId: 1, userId: 1 });
  const card: any = await readinessCard(ctx);
  assert.equal(card.state === 'unreadable', false);
  const items = bars(card);
  assert.ok(items.length > 0);
  for (const i of items) {
    assert.equal(typeof i.key, 'string', `${i.label} has a key`);
    assert.ok(['ready', 'attention', 'missing', 'stale', 'unavailable', 'not_recorded'].includes(i.status), `${i.label}: ${i.status}`);
    assert.ok(i.assessed_at === null || /^\d{4}-\d{2}-\d{2}$/.test(i.assessed_at), `${i.label}: a day or null`);
    assert.ok('label' in i && 'value' in i && 'tone' in i, 'the bar keeps what the chart draws');
  }
  const k = byKey(card);
  assert.ok(k.pmf, 'Product-market fit is a bar here; the Overview leaves it out by its key');
  assert.equal(k.deck.status, 'missing', 'no deck: a measured 0 with a gap');
  assert.match(k.deck.assessed_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(k.team.status, 'not_recorded', 'a person scores Team; nobody has');
  assert.equal(k.team.assessed_at, null);
  db.close();
});

test('an input that changes after scoring makes that area Stale and leaves the others', async () => {
  const { db, ctx } = fixture();
  await rescoreReadiness(ctx.env, { projectId: 1, userId: 1 });
  const before = byKey(await readinessCard(ctx));
  assert.notEqual(before.use_of_funds.status, 'stale');
  db.exec('UPDATE projects SET funding_needed = 99000 WHERE id = 1');
  const after = byKey(await readinessCard(ctx));
  assert.equal(after.use_of_funds.status, 'stale', 'a typed field changed: Stale');
  assert.equal(after.use_of_funds.assessed_at, before.use_of_funds.assessed_at, 'Stale keeps the day it was scored');
  assert.equal(after.deck.status, before.deck.status, 'the other areas are untouched');
  db.close();
});

test('this file is the one D8257 names', () => {
  const d = readFileSync(new URL('../../documentation/architecture/decisions/D8257.md', import.meta.url), 'utf8');
  assert.match(d, /raise_readiness_area_status_8257\.test\.ts/);
});
