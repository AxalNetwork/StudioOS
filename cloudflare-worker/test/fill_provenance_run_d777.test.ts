// D777 part 2 (#2102): an accepted fill names its proposal and the
// ai_usage_logs row of the run that produced it, so a member can see which run
// filled a field and what it cost.
//
//   · `aiRun` returns the id of the usage row it wrote (`usageLogId`), with the
//     run's rail page and option on that row (D762, D765).
//   · The propose route stores it on each proposal (`validate_proposals.ai_usage_log_id`).
//   · The accept route copies it, and the proposal's `target_ref`, onto the
//     provenance row (`fill_provenance.ai_usage_log_id`, `target_row_ref`).
//   · `fillsForRow` answers the run: its page, option, charge and cost. A fill
//     with no run, or a run whose row cannot be read, answers `run: null`
//     ("Not recorded"), never a zero cost.
//   · A database made before migration 503 gains its columns at runtime.
//
// Real SQLite: the AI fixture (`_ai_budget_fixture.mjs`), and the Validate
// tables from the baseline plus every later migration's ADD COLUMN, 503's
// included, so the migration itself is what the test runs. env.AI is stubbed.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/fill_provenance_run_d777.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { run as aiRun, __resetForTest } from '../src/services/aiRouter.ts';
import { recordFill, fillsForRow } from '../src/services/fills/provenance.ts';
import founderValidate from '../src/routes/founder_validate.ts';

const SQL = new URL('../sql/', import.meta.url);
const BASELINE = readFileSync(new URL('schema_baseline.sql', SQL), 'utf8');
const MIGRATIONS = readdirSync(new URL('migrations/', SQL)).filter((f) => f.endsWith('.sql')).sort();
const migration = (name: string) => readFileSync(new URL(`migrations/${name}`, SQL), 'utf8');
const ADMIN = 1;

/** A table as production has it: the baseline's, plus every later migration's ADD COLUMN for it. */
function build(db: any, table: string, create?: string) {
  db.exec(create ?? tableFromBaseline(BASELINE, table));
  const have = () => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name));
  const re = new RegExp(`ALTER TABLE ${table} ADD COLUMN ([a-z_0-9]+)([^;]*);`, 'g');
  for (const f of MIGRATIONS) {
    for (const m of migration(f).matchAll(re)) {
      if (!have().has(m[1])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${m[1]}${m[2]};`);
    }
  }
}
/** `fill_provenance` is created by migration 246, after the baseline's cutoff. */
function fillProvenanceDDL(): string {
  const src = migration('246_fills_the_blanks_everywhere.sql');
  const at = src.indexOf('CREATE TABLE IF NOT EXISTS fill_provenance');
  return src.slice(at, src.indexOf(');', at) + 2);
}

function world(opts: { before503?: boolean } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec("UPDATE users SET role = 'admin' WHERE id = 1");
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(ADMIN, 5_000_000);
  f.db.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
             INSERT INTO projects(id,name,founder_id) VALUES(7,'Harbour',NULL);`);
  build(f.db, 'hypotheses');
  // The cycle-write log the accept path appends to, as production has it.
  f.db.exec('DROP TABLE activity_logs');
  build(f.db, 'activity_logs');
  if (opts.before503) {
    // A dev database from before 503: 246's columns and none of 503's.
    f.db.exec(tableFromBaseline(BASELINE, 'validate_proposals'));
    for (const col of ['surface TEXT', 'fill_class TEXT', 'citation_json TEXT', 'target_ref TEXT']) f.db.exec(`ALTER TABLE validate_proposals ADD COLUMN ${col}`);
    f.db.exec(fillProvenanceDDL());
  } else {
    build(f.db, 'validate_proposals');
    build(f.db, 'fill_provenance', fillProvenanceDDL());
  }
  const ai = { calls: 0, async run() { this.calls += 1; return { response: 'A drafted line.', usage: { prompt_tokens: 30, completion_tokens: 9 } }; } };
  const env: any = { DB: f.DB, AI: withGuard(ai, () => 'safe'), JWT_SECRET: 'd777-fixture-only-secret', ENVIRONMENT: 'development' };
  return { f, env };
}
async function accept(w: any, id: number) {
  const jwt = await new SignJWT({ user_id: ADMIN }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const app = new Hono();
  app.onError((e: any, c) => c.json({ detail: String(e?.message) }, (AUTH_ERROR_STATUSES[e?.message] || 500) as any));
  app.route('/api/founder/validate', founderValidate);
  const r = await app.request(`/api/founder/validate/proposals/${id}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: '{}' }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
/** One run as the propose route makes it: the member, the fill's page and option. */
const run = (w: any) => aiRun(w.env, {
  task: 'validate_draft_hypotheses' as any, userId: ADMIN, surface: 'validate',
  rail: { page: 'Founder · Validate · Experiments and evidence', option: 'fill:hypothesis', recordRef: 'project:7' } as any,
  systemPrompt: 'Draft a claim.', messages: [{ role: 'user', content: 'Pain themes.' }], maxTokens: 50,
});
const one = (w: any, sql: string, ...a: unknown[]) => ({ ...(w.f.db.prepare(sql).get(...a) as any) });

test('D777 aiRun names the usage row it wrote, with the run\'s page and option on it', async () => {
  const w = world();
  const r = await run(w);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Number.isSafeInteger(r.usageLogId) && Number(r.usageLogId) > 0, `usageLogId: ${r.usageLogId}`);
  const row = one(w, 'SELECT user_id, task, rail_option, guard_for FROM ai_usage_logs WHERE id = ?', r.usageLogId);
  assert.deepEqual([row.user_id, row.task, row.rail_option, row.guard_for], [ADMIN, 'validate_draft_hypotheses', 'fill:hypothesis', null],
    'the run\'s own row, not one of the guard\'s');
});

test('D777 the propose route stores the run on each proposal', () => {
  const src = readFileSync(new URL('../src/routes/founder_validate.ts', import.meta.url), 'utf8');
  const insert = src.slice(src.indexOf('INSERT INTO validate_proposals'), src.indexOf('created.push(', src.indexOf('INSERT INTO validate_proposals')));
  assert.match(insert, /target_ref, ai_usage_log_id\)\s+VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/);
  assert.match(insert, /p\.targetRef,\s*(?:\/\/[^\n]*\n\s*)*r\.usageLogId \?\? null,\s*\)\.run\(\)/, 'the run\'s usage row is bound last');
});

test('D777 an accepted value carries its proposal, its row reference and the run that produced it', async () => {
  const w = world();
  const r = await run(w);
  const ins = w.f.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, model, task, created_by, surface, fill_class, target_ref, ai_usage_log_id)
    VALUES (7, 'hypothesis', ?, ?, 'validate_draft_hypotheses', 1, 'validate/hypotheses', 'restatement', 'hypotheses', ?)`)
    .run(JSON.stringify({ claim: 'Ops leads will pay to stop reconciling by hand.' }), r.usage.model, r.usageLogId);
  const proposalId = Number(ins.lastInsertRowid);
  const a = await accept(w, proposalId);
  assert.ok(a.status === 201, JSON.stringify(a.body));
  const fp = one(w, 'SELECT target_table, target_row_id, target_column, proposal_id, target_row_ref, ai_usage_log_id FROM fill_provenance');
  assert.deepEqual(fp, {
    target_table: 'hypotheses', target_row_id: a.body.hypothesis.id, target_column: 'claim',
    proposal_id: proposalId, target_row_ref: 'hypotheses', ai_usage_log_id: r.usageLogId,
  });

  const [filled] = await fillsForRow(w.env, 'hypotheses', a.body.hypothesis.id);
  const log = one(w, 'SELECT rail_page, rail_option, charged_microusd, est_cost_usd FROM ai_usage_logs WHERE id = ?', r.usageLogId);
  assert.deepEqual(filled.run, {
    usage_log_id: r.usageLogId, rail_page: log.rail_page, rail_option: 'fill:hypothesis',
    charged_microusd: log.charged_microusd, est_cost_usd: log.est_cost_usd,
  });
  assert.ok(Number(filled.run?.charged_microusd) > 0, 'what the run cost the member');
});

test('D777 a fill with no run, or a run whose row is gone, reads as not recorded, never as a zero cost', async () => {
  const w = world();
  await recordFill(w.env, { target: { table: 'hypotheses', rowId: 5, column: 'claim' }, proposalId: null, fillClass: 'restatement', proposedValue: 'a', writtenValue: 'a' });
  await recordFill(w.env, { target: { table: 'hypotheses', rowId: 6, column: 'claim' }, proposalId: null, fillClass: 'restatement', proposedValue: 'b', writtenValue: 'b', usageLogId: 999_999 });
  assert.equal((await fillsForRow(w.env, 'hypotheses', 5))[0].run, null);
  assert.equal((await fillsForRow(w.env, 'hypotheses', 6))[0].run, null);
  // An unreadable usage log answers the fill, with no run.
  w.f.db.exec('DROP TABLE ai_usage_logs');
  const [still] = await fillsForRow(w.env, 'hypotheses', 6);
  assert.deepEqual([still.written_value, still.run], ['b', null]);
});

test('D777 a database from before migration 503 gains its columns, and an accept still records its run', async () => {
  const w = world({ before503: true });
  const r = await run(w);
  const ins = w.f.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, task, created_by, surface, fill_class, target_ref)
    VALUES (7, 'hypothesis', ?, 'validate_draft_hypotheses', 1, 'validate/hypotheses', 'restatement', 'hypotheses')`)
    .run(JSON.stringify({ claim: 'Finance teams will switch for an audit trail.' }));
  const id = Number(ins.lastInsertRowid);
  // The read heals the table; then the run is set as the propose route would.
  const a0 = await accept(w, 999);
  assert.equal(a0.status, 404);
  w.f.db.prepare('UPDATE validate_proposals SET ai_usage_log_id = ? WHERE id = ?').run(r.usageLogId, id);
  const a = await accept(w, id);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const fp = one(w, 'SELECT target_row_ref, ai_usage_log_id FROM fill_provenance');
  assert.deepEqual(fp, { target_row_ref: 'hypotheses', ai_usage_log_id: r.usageLogId });
});

test('D777 migration 503 is additive, and declares what the runtime adds', () => {
  const sql = migration('503_fill_provenance_run.sql');
  const statements = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
  assert.deepEqual(statements, [
    'ALTER TABLE validate_proposals ADD COLUMN ai_usage_log_id INTEGER;',
    'ALTER TABLE fill_provenance ADD COLUMN target_row_ref TEXT;',
    'ALTER TABLE fill_provenance ADD COLUMN ai_usage_log_id INTEGER;',
    'CREATE INDEX IF NOT EXISTS idx_fill_provenance_usage ON fill_provenance (ai_usage_log_id);',
  ]);
  const runtime = readFileSync(new URL('../src/services/fills/provenance.ts', import.meta.url), 'utf8');
  for (const ddl of ['ALTER TABLE validate_proposals ADD COLUMN ai_usage_log_id INTEGER', 'ALTER TABLE fill_provenance ADD COLUMN target_row_ref TEXT',
    'ALTER TABLE fill_provenance ADD COLUMN ai_usage_log_id INTEGER', 'CREATE INDEX IF NOT EXISTS idx_fill_provenance_usage ON fill_provenance (ai_usage_log_id)']) {
    assert.ok(runtime.includes(ddl), `the runtime repeats: ${ddl}`);
  }
});
