/**
 * #4568 (D4568, D1 scale S2) — the two partial indexes on ai_usage_logs and the
 * one-agent area read, held to what they must not change.
 *
 *   · the migration adds both, partial, and the charge reads that scanned the
 *     table now search it (and scan again without them);
 *   · `chargedFor` answers exactly what a reference model over the rows says,
 *     with and without the indexes — an unrecorded row is unknown, never 0;
 *   · a whole mix (AI calls, agent runs, failures, a raced idempotency key)
 *     ends with the same charges, balances, ledger and proposals with and
 *     without them, and every #4567 invariant at 0;
 *   · `agentArea(id)` is `agentAreas().get(id)` for every agent, ties and
 *     untagged skills included, and reads only that agent's links;
 *   · the dependency matrix names every usage table, plans its statements, and
 *     holds no literal value.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/usage_indexes_4568.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migratedDatabase, migratedTemplate, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { CANDIDATE_INDEX_NAMES, benchWorld, invariants, prng, runClosed, schedule, withoutCandidates } from './_d1_bench.ts';
import { chargedFor } from '../src/services/agents/agentRun.ts';
import { agentArea, agentAreas } from '../src/services/agents/adminReads.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { DatabaseSync } from 'node:sqlite';
import { CANDIDATE_INDEXES, TABLES, buildMatrix, planDiff } from '../../scripts/lib/usageTablesMatrix.mjs';

afterAll(() => removeMigratedDatabases());
const ROOT = new URL('../../', import.meta.url).pathname;
const MIGRATION = readFileSync(new URL('../sql/migrations/202611070806_ai_usage_guard_reservation_indexes.sql', import.meta.url), 'utf8');
const plan = (db: any, sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map((r) => String(r.detail)).join('; ');
const CHARGED = 'SELECT SUM(charged_microusd) AS charged, SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded FROM ai_usage_logs WHERE id = ? OR guard_for = ?';
const STEP = 'SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE reservation_uid = ?1 AND record_ref = ?2';
const TAG = 'UPDATE ai_usage_logs SET skill_id = ?, skill_version = ? WHERE id = ? OR guard_for = ?';

test('#4568: the migration adds both partial indexes, and the charge reads search instead of scan', () => {
  const db = migratedTemplate();
  try {
    for (const name of CANDIDATE_INDEX_NAMES) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) as any;
      assert.ok(row, `${name} exists on the migrated schema`);
      assert.match(String(row.sql), /WHERE \w+ IS NOT NULL$/, `${name} is partial`);
    }
    // The library's candidates are the migration's statements, word for word.
    for (const s of CANDIDATE_INDEXES) assert.ok(MIGRATION.includes(`${s};`), s);
    assert.match(plan(db, CHARGED), /SEARCH ai_usage_logs USING (?:COVERING )?INDEX idx_ai_usage_logs_guard_for/);
    assert.match(plan(db, TAG), /SEARCH ai_usage_logs USING (?:COVERING )?INDEX idx_ai_usage_logs_guard_for/);
    assert.match(plan(db, STEP), /SEARCH ai_usage_logs USING INDEX idx_ai_usage_logs_reservation_ref \(reservation_uid=\? AND record_ref=\?\)/);
  } finally { db.close(); }
  // Without them, each is the scan #4567 measured.
  const bare = migratedDatabase();
  try {
    for (const n of CANDIDATE_INDEX_NAMES) bare.exec(`DROP INDEX ${n}`);
    for (const sql of [CHARGED, TAG, STEP]) assert.match(plan(bare, sql), /SCAN ai_usage_logs/, sql);
  } finally { bare.close(); }
});

test('#4568: chargedFor is exactly the reference model, with and without the indexes; unrecorded is unknown', async () => {
  const db = migratedDatabase();
  try {
    const env: any = { DB: d1Over(db) };
    const rnd = prng(4568);
    const ins = db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, guard_for) VALUES (1, 'rail_numbers', 'synthetic', ?, ?)");
    const runs: number[] = [];
    for (let i = 0; i < 300; i++) {
      const charge = rnd() < 0.05 ? null : Math.floor(rnd() * 5000);
      const id = Number(ins.run(charge, null).lastInsertRowid);
      runs.push(id);
      for (let g = 0; g < Math.floor(rnd() * 3); g++) ins.run(rnd() < 0.05 ? null : Math.floor(rnd() * 100), id);
    }
    const reference = (id: number) => {
      const rows = db.prepare('SELECT charged_microusd AS c FROM ai_usage_logs WHERE id = ? OR guard_for = ?').all(id, id) as any[];
      if (rows.some((r) => r.c == null)) return { available: false };
      return { available: true, value_microusd: rows.reduce((s, r) => s + Number(r.c), 0) };
    };
    const answers = async () => Promise.all(runs.map((id) => chargedFor(env, id)));
    const withIdx = await answers();
    for (const n of CANDIDATE_INDEX_NAMES) db.exec(`DROP INDEX ${n}`);
    const without = await answers();
    assert.deepEqual(withIdx, without, 'the indexes change no answer');
    runs.forEach((id, k) => assert.deepEqual(withIdx[k], reference(id), `run ${id}`));
    assert.ok(withIdx.some((a) => !a.available), 'some charges are unknown: an unrecorded row is never read as 0');
    assert.deepEqual(await chargedFor(env, null), { available: false });
    assert.deepEqual(await chargedFor(env, 99_999_999), { available: false }, 'missing usage is unknown, not 0');
  } finally { db.close(); }
});

test('#4568: a whole mix ends with the same money with and without the indexes, every invariant at 0', async () => {
  const money = (w: any) => ({
    charged: w.db.prepare('SELECT user_id, COUNT(*) AS n, SUM(charged_microusd) AS c, SUM(charged_microusd IS NULL) AS unk FROM ai_usage_logs GROUP BY user_id ORDER BY user_id').all().map((r: any) => ({ ...r })),
    balances: w.db.prepare('SELECT user_id, balance_microusd FROM ai_topup_accounts ORDER BY user_id').all().map((r: any) => ({ ...r })),
    spend: w.db.prepare('SELECT user_id, period_kind, spend_microusd FROM ai_included_spend ORDER BY 1, 2, 3').all().map((r: any) => ({ ...r })),
    ledger: w.db.prepare('SELECT user_id, kind, COUNT(*) AS n, SUM(delta_microusd) AS d FROM ai_credit_ledger GROUP BY 1, 2 ORDER BY 1, 2').all().map((r: any) => ({ ...r })),
    holds: w.db.prepare('SELECT status, COUNT(*) AS n, SUM(actual_included_microusd + actual_topup_microusd) AS s FROM ai_budget_reservations GROUP BY 1 ORDER BY 1').all().map((r: any) => ({ ...r })),
    proposals: w.db.prepare('SELECT user_id, status, COUNT(*) AS n FROM ai_rail_proposals GROUP BY 1, 2 ORDER BY 1, 2').all().map((r: any) => ({ ...r })),
    runs: w.db.prepare('SELECT status, COUNT(*) AS n FROM agent_task_runs GROUP BY 1 ORDER BY 1').all().map((r: any) => ({ ...r })),
  });
  const ops = schedule({ ops: 90, tenants: 4, seed: 4568, mix: { B: 40, C: 30, E: 30 } });
  // Exact equality needs a deterministic run: one operation at a time. Concurrent runs interleave by timing
  // and random uids, so at concurrency 4 each world is held to the invariants instead, with and without.
  const a = benchWorld({ tenants: 4, agentsPerTenant: 2 });
  const b = withoutCandidates(benchWorld({ tenants: 4, agentsPerTenant: 2 }));
  const c4 = benchWorld({ tenants: 4, agentsPerTenant: 2 });
  const d4 = withoutCandidates(benchWorld({ tenants: 4, agentsPerTenant: 2 }));
  try {
    assert.equal((b.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_ai_usage_logs_guard_for'").get() as any).n, 0);
    const ra = await runClosed(a, ops, 1);
    const rb = await runClosed(b, ops, 1);
    // Mutation checked: a charge read rewritten to drop `OR guard_for = ?` → the guard rows go uncounted and the sums differ.
    assert.deepEqual(money(a), money(b), 'charges, balances, ledger, holds, proposals and runs are identical');
    assert.ok(money(a).ledger.length > 0, 'the ledger was written');
    assert.deepEqual(ra.map((r) => [r.ok, r.code ?? null]), rb.map((r) => [r.ok, r.code ?? null]), 'every operation ended the same way');
    for (const [w, r] of [[a, ra], [b, rb], [c4, await runClosed(c4, ops, 4)], [d4, await runClosed(d4, ops, 4)]] as const) {
      for (const [k, n] of Object.entries(invariants(w, r))) assert.equal(n, 0, k);
    }
  } finally { for (const w of [a, b, c4, d4]) w.db.close(); }
});

test('#4568: agentArea is agentAreas().get for every agent, and reads only that agent', async () => {
  const db = migratedDatabase();
  try {
    const env: any = { DB: d1Over(db) };
    const rnd = prng(17);
    const cats = [...RADAR_AXES.map((a) => a.slug), 'not_an_axis'];
    const tax = db.prepare('INSERT INTO skills (slug, category_slug, label) VALUES (?, ?, ?)');
    for (let i = 0; i < 24; i++) tax.run(`tax-${i}`, cats[i % cats.length], `Synthetic ${i}`);
    const tag = db.prepare("INSERT OR IGNORE INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, 'working')");
    for (let s = 1; s <= 30; s++) for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) tag.run(s, `tax-${Math.floor(rnd() * 24)}`);
    const link = db.prepare('INSERT OR IGNORE INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, ?, 1, 1)');
    for (let a = 1; a <= 60; a++) for (let k = 0; k < Math.floor(rnd() * 5); k++) link.run(a, 1 + Math.floor(rnd() * 34)); // skills 31–34 carry no tags
    // Agent 70: its most-tagged category is not a radar axis, so its area is the next one, product.
    tax.run('tax-off', 'not_an_axis', 'Synthetic off-axis'); tax.run('tax-prod', 'product', 'Synthetic product');
    for (const [skill, slug] of [[40, 'tax-off'], [41, 'tax-off'], [42, 'tax-prod']] as const) { tag.run(skill, slug); link.run(70, skill); }
    const all = await agentAreas(env);
    assert.equal(all.get(70), 'product');
    assert.equal(await agentArea(env, 70), 'product', 'an off-axis top category is skipped, as agentAreas skips it');
    let seen = 0;
    for (let a = 1; a <= 62; a++) {
      const one = await agentArea(env, a);
      assert.equal(one, all.get(a) ?? null, `agent ${a}`);
      if (one) seen++;
    }
    assert.ok(seen > 20 && seen < 62, 'some agents have an area and some have none');
    // Mutation checked: agentArea without `WHERE l.agent_id = ?` → the plan scans and this fails.
    // The statement agentArea itself sends, planned: a search of the one agent's links.
    const sent: string[] = [];
    const spy: any = { DB: { prepare: (sql: string) => { sent.push(sql); return env.DB.prepare(sql); } } };
    await agentArea(spy, 1);
    assert.equal(sent.length, 1);
    assert.match(plan(db, sent[0]), /SEARCH l USING COVERING INDEX \w+ \(agent_id=\?\)/);
    assert.doesNotMatch(plan(db, sent[0]), /SCAN l\b/);
    const src = readFileSync(new URL('../src/services/agents/agentRun.ts', import.meta.url), 'utf8');
    assert.match(src, /await agentArea\(env, a\.id\)/, 'the run path reads one agent');
    assert.doesNotMatch(src, /agentAreas\(/, 'and never every agent');
  } finally { db.close(); }
});

test('#4568: the dependency matrix names every usage table, plans its statements, and holds no value', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  try {
    const m = buildMatrix({ root: ROOT, db });
    assert.deepEqual(m.tables.map((t: any) => t.table), [...TABLES]);
    for (const t of m.tables) {
      assert.ok(t.writers.length >= 1 && t.readers.length >= 1, `${t.table} has writers and readers`);
      assert.ok(t.unplanned <= 2, `${t.table}: at most a couple of statements cannot be planned (${t.unplanned})`);
    }
    const guard = m.indexes.find((i: any) => i.name === 'idx_ai_usage_logs_guard_for');
    assert.ok(guard.files_using.includes('cloudflare-worker/src/services/agents/agentRun.ts'), 'chargedFor uses the guard index');
    assert.ok(m.foreign_keys.some((f: any) => f.from === 'ai_rail_proposals' && f.column === 'usage_log_id' && f.on_delete === 'SET NULL'));
    // Shapes mask every literal: the only quoted text left is '?'.
    for (const s of m.statements) assert.doesNotMatch(s.shape.replace(/'\?'/g, '').replace(/''/g, ''), /'/, `${s.file}:${s.line}`);
    // The diff, on a schema without the candidates: the two run-path scans become searches.
    const bare = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
    loadSchema(bare);
    for (const n of CANDIDATE_INDEX_NAMES) bare.exec(`DROP INDEX ${n}`);
    const d = planDiff({ root: ROOT, db: bare });
    bare.close();
    assert.ok(d.scans_after < d.scans_before, `${d.scans_before} → ${d.scans_after}`);
    for (const f of ['services/agents/agentRun.ts', 'services/decks/stepExecutor.ts', 'services/agents/skillEval.ts']) {
      const c = d.changed.find((x: any) => x.file.endsWith(f));
      assert.ok(c && /scan/.test(c.before) && /search idx_ai_usage_logs_/.test(c.after), `${f}: ${c?.before} → ${c?.after}`);
    }
  } finally { db.close(); }
});
