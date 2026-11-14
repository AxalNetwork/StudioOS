/** #2391: real router/SQLite, synthetic provider responses; no production writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import dd from '../src/routes/dd.ts';
import { CONNECTORS, runConnector, encField, decField } from '../src/services/dueDiligence.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';

const SECRET = ['synthetic', 'dd', 'regression'].join('-');
const SUBJECT = 'A'.repeat(11); // Previously fabricated a Critical sanctions match.
const schema = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const serviceFile = new URL('../src/services/dueDiligence.ts', import.meta.url);
const routeFile = new URL('../src/routes/dd.ts', import.meta.url);
const serviceSource = readFileSync(serviceFile, 'utf8');
const routeSource = readFileSync(routeFile, 'utf8');
const keyFlags = Object.fromEntries(CONNECTORS.map(c => [c.flag_env, 'on']));
const credentials = { CRUNCHBASE_USER_KEY_ID: 'synthetic-id', CRUNCHBASE_API_KEY: 'synthetic-key' };
const liveResponse = { entities: [{ uuid: 'synthetic-org', identifier: { value: 'Synthetic company', permalink: 'synthetic' }, properties: {
  short_description: 'Synthetic evidence.', operating_status: 'active', funding_total: { value_usd: 1000000 },
} }] };

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'dd_cases', 'dd_sections', 'dd_external_sources', 'dd_findings', 'dd_audit_log', 'dd_checklist_items', 'mi_pro_subscriptions', 'super_admins']) {
    const start = schema.indexOf(`CREATE TABLE ${name} (`);
    assert.ok(start >= 0, `canonical ${name} schema`);
    const end = schema.indexOf('\nCREATE ', start + 1);
    db.exec(schema.slice(start, end < 0 ? undefined : end));
  }
  const recovery = readFileSync(new URL('../sql/migrations/277_user_recovery_state.sql', import.meta.url), 'utf8');
  db.exec(recovery.slice(recovery.indexOf('CREATE TABLE IF NOT EXISTS user_recovery_state'), recovery.indexOf(');', recovery.indexOf('CREATE TABLE IF NOT EXISTS user_recovery_state')) + 2));
  db.exec(`INSERT INTO users (id, role, name, email) VALUES (44, 'admin', 'Synthetic admin', 'admin@example.test');
    INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id, risk_score, risk_band)
      VALUES (1, 'synthetic-case', 'founder', 1, 'Synthetic subject', 44, 0.64, 'yellow');
    INSERT INTO dd_sections (id, case_id, section_key, title, weight) VALUES
      (1, 1, 'compliance_aml', 'Compliance', 1.5), (2, 1, 'market_position', 'Market', 1);`);
  db.prepare('UPDATE dd_cases SET subject_label = ? WHERE id = 1').run(SUBJECT);
  let notificationCalls = 0;
  const DB = {
    prepare(sql: string) {
      if (/notifications_inbox/.test(sql)) notificationCalls++;
      let values: any[] = [];
      const statement: any = {
        bind(...args: any[]) { values = args.map(x => x === undefined ? null : x); return statement; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return statement;
    },
  };
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', ...keyFlags };
  return { db, env, notificationCalls: () => notificationCalls };
}

async function scan(w: ReturnType<typeof world>, connectors?: string[], router = dd) {
  const app = new Hono(); app.route('/api/dd', router);
  const token = await new SignJWT({ user_id: 44, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const pending: Promise<unknown>[] = [];
  const response = await app.request('/api/dd/cases/synthetic-case/scan', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ connectors }),
  }, w.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} });
  assert.equal(response.status, 202); await Promise.all(pending);
}

async function withFetch(check: (calls: URL[]) => Promise<void>, response = liveResponse, status = 200) {
  const previous = globalThis.fetch; const calls: URL[] = [];
  globalThis.fetch = async (input) => { const url = new URL(String(input)); calls.push(url); assert.equal(url.hostname, 'api.crunchbase.com'); return Response.json(response, { status }); };
  try { await check(calls); } finally { globalThis.fetch = previous; _clearOauthCredsCache(); }
}

async function unavailable(runner = runConnector) {
  await withFetch(async calls => {
    const w = world();
    try {
      for (const meta of CONNECTORS.filter(c => c.key !== 'crunchbase')) {
        for (const subject of [SUBJECT, 'B'.repeat(22), 'Synthetic subject']) {
          const r = await runner({ ...w.env, ...credentials, [meta.secret_env || 'SYNTHETIC_UNUSED']: 'synthetic-key' }, meta, subject);
          assert.equal(r.status, 'disabled'); assert.equal(r.records_count, 0); assert.equal(r.raw_response, null);
          assert.deepEqual(r.findings, []); assert.match(r.error_message || '', /Not live/);
        }
      }
      const cb = CONNECTORS.find(c => c.key === 'crunchbase')!;
      const off = await runner({ ...w.env, ...credentials, DD_FLAG_CRUNCHBASE: 'off' }, cb, SUBJECT);
      assert.equal(off.status, 'disabled'); assert.deepEqual(off.findings, []);
      const missing = await runner(w.env, cb, SUBJECT);
      assert.equal(missing.status, 'disabled'); assert.deepEqual(missing.findings, []); assert.match(missing.error_message || '', /Not live/);
      assert.equal(calls.length, 0);
    } finally { w.db.close(); }
  });
}

async function noEvidence(router = dd) {
  await withFetch(async calls => {
    const w = world();
    try {
      const detail = await encField(w.env, 'dd_findings', 'detail', 1, 'Synthetic legacy stub.');
      const raw = await encField(w.env, 'dd_external_sources', 'raw_response', 1, JSON.stringify({ stub: true, subject: SUBJECT }));
      w.db.prepare("INSERT INTO dd_external_sources (id, case_id, connector, status, raw_response_enc, records_count, findings_emitted) VALUES (1, 1, 'sanctions_ofac', 'ok', ?, 1, 1)").run(raw);
      w.db.prepare("INSERT INTO dd_findings (id, case_id, section_id, source_id, source_kind, severity, title, detail_enc) VALUES (1, 1, 1, 1, 'sanctions_ofac', 'critical', 'Synthetic legacy finding', ?)").run(detail);
      const sourceBefore = w.db.prepare('SELECT * FROM dd_external_sources WHERE id = 1').get();
      const before = w.db.prepare('SELECT * FROM dd_findings').all();
      await scan(w, undefined, router);
      assert.deepEqual(w.db.prepare('SELECT * FROM dd_findings').all(), before, 'existing findings must remain byte-for-byte intact');
      assert.deepEqual({ ...w.db.prepare('SELECT risk_score, risk_band FROM dd_cases').get() }, { risk_score: 0.64, risk_band: 'yellow' });
      assert.deepEqual(w.db.prepare('SELECT * FROM dd_external_sources WHERE id = 1').get(), sourceBefore);
      const sources: any[] = w.db.prepare('SELECT * FROM dd_external_sources WHERE id <> 1').all();
      assert.equal(sources.length, 9);
      for (const s of sources) {
        assert.deepEqual([s.status, s.records_count, s.findings_emitted, s.raw_response_enc], ['disabled', 0, 0, null]);
        assert.match(s.error_message, /Not live/); assert.ok(s.completed_at);
      }
      assert.equal(w.notificationCalls(), 0, 'a non-live scan must not notify the owner'); assert.equal(calls.length, 0);
      w.db.exec('UPDATE dd_cases SET risk_score = NULL, risk_band = NULL');
      await scan(w, ['sanctions_ofac'], router);
      assert.equal(w.db.prepare('SELECT risk_score FROM dd_cases').get().risk_score, null, 'no evidence must not invent a score');
    } finally { w.db.close(); }
  });
}

async function liveEvidence(router = dd) {
  await withFetch(async calls => {
    const w = world(); Object.assign(w.env, credentials);
    try {
      await scan(w, ['crunchbase', 'sanctions_ofac'], router);
      const findings: any[] = w.db.prepare('SELECT * FROM dd_findings').all();
      assert.equal(findings.length, 1); assert.equal(findings[0].source_kind, 'crunchbase');
      assert.equal(findings[0].severity, 'info'); assert.match(findings[0].detail_enc, /^v1\./);
      assert.match(await decField(w.env, 'dd_findings', 'detail', findings[0].id, findings[0].detail_enc) || '', /Synthetic evidence/);
      const source: any = w.db.prepare("SELECT * FROM dd_external_sources WHERE connector = 'crunchbase'").get();
      assert.deepEqual([source.status, source.records_count, source.findings_emitted], ['ok', 1, 1]);
      const raw = JSON.parse((await decField(w.env, 'dd_external_sources', 'raw_response', source.id, source.raw_response_enc))!);
      assert.equal(raw.uuid, 'synthetic-org'); assert.equal(raw.stub, undefined);
      assert.deepEqual({ ...w.db.prepare('SELECT risk_score, risk_band FROM dd_cases').get() }, { risk_score: 1, risk_band: 'green' });
      assert.equal(calls.length, 1); assert.equal(calls[0].pathname, '/api/v4/searches/organizations');
      assert.equal(w.notificationCalls(), 0);
    } finally { w.db.close(); }
  });
}

test('unimplemented connectors and unavailable Crunchbase never return evidence', () => unavailable());
test('non-live scan preserves existing findings and scores and sends no warning', () => noEvidence());
test('live Crunchbase still stores encrypted evidence and recomputes the score', () => liveEvidence());
test('a provider failure records error, not sample findings or a new score', async () => {
  await withFetch(async calls => {
    const w = world(); Object.assign(w.env, credentials);
    try {
      await scan(w, ['crunchbase']);
      assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM dd_findings').get().n, 0);
      const source: any = w.db.prepare('SELECT * FROM dd_external_sources').get();
      assert.deepEqual([source.status, source.findings_emitted, source.raw_response_enc], ['error', 0, null]);
      assert.equal(w.db.prepare('SELECT risk_score FROM dd_cases').get().risk_score, 0.64);
      assert.equal(w.notificationCalls(), 0); assert.equal(calls.length, 1);
    } finally { w.db.close(); }
  }, { entities: [] }, 401);
});

let serial = 0;
function moduleUrl(source: string, file: URL) {
  let js = stripTypeScriptTypes(source, { mode: 'strip' });
  const resolve = (spec: string) => spec.startsWith('.') ? new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec + '.ts', file).href : spec.startsWith('data:') ? spec : import.meta.resolve(spec);
  js = js.replace(/(\bfrom\s*['"])([^'"]+)(['"])/g, (_m, a, s, b) => a + resolve(s) + b)
    .replace(/(\bimport\(\s*['"])([^'"]+)(['"]\s*\))/g, (_m, a, s, b) => a + resolve(s) + b);
  return 'data:text/javascript;base64,' + Buffer.from(js + `\n//# sourceURL=dd2391-mutant-${++serial}.mjs`).toString('base64');
}
function change(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, 'one mutation target'); return source.replace(before, () => after);
}
const serviceMutations = [
  ['unimplemented connector fabricates a critical', "return { status: 'disabled', records_count: 0, raw_response: null, findings: [], error_message: 'Not live: this connector has no live implementation.' };", "return { status: 'ok', records_count: 1, raw_response: {stub: true}, findings: [{source_kind: connector.key, severity: 'critical', title: 'Synthetic warning', detail: 'Synthetic', section_key: 'compliance_aml'}] };"],
  ['flag ignored', 'if (!isFlagged(env, connector.flag_env)) {', 'if (false) {'],
  ['missing credential called a success', "return { status: 'disabled', records_count: 0, raw_response: null, findings: [], error_message: 'Not live: Crunchbase credentials are not available.' };", "return { status: 'ok', records_count: 0, raw_response: null, findings: [] };"],
];
for (const [name, before, after] of serviceMutations) test(`mutation: ${name}`, async () => {
  const mutant = await import(moduleUrl(change(serviceSource, before, after), serviceFile));
  await assert.rejects(() => unavailable(mutant.runConnector), { name: 'AssertionError' }); await unavailable();
});
for (const [name, before, after, check] of [
  ['non-live scan recomputes the score', 'if (progress.findingsEmitted > 0) await recomputeAndStoreScore(c.env, caseId);', 'await recomputeAndStoreScore(c.env, caseId);', noEvidence],
  ['live scan never recomputes', 'if (progress.findingsEmitted > 0) await recomputeAndStoreScore(c.env, caseId);', 'if (false) await recomputeAndStoreScore(c.env, caseId);', liveEvidence],
  ['emitted findings not counted', '      progress.findingsEmitted++;', '', liveEvidence],
] as const) test(`mutation: ${name}`, async () => {
  const mutant = await import(moduleUrl(change(routeSource, before, after), routeFile));
  await assert.rejects(() => check(mutant.default), { name: 'AssertionError' }); await check();
});

async function nonLiveResultRoute(removeGuard = false) {
  // A future connector must not make disabled/error results into evidence,
  // even if it accidentally leaves a finding attached to the result.
  const service = change(serviceSource,
    "return { status: 'disabled', records_count: 0, raw_response: null, findings: [], error_message: 'Not live: this connector has no live implementation.' };",
    "return { status: 'disabled', records_count: 0, raw_response: null, findings: [{source_kind: connector.key, severity: 'critical', title: 'Synthetic warning', detail: 'Synthetic', section_key: 'compliance_aml'}], error_message: 'Not live: this connector has no live implementation.' };");
  let route = change(routeSource, "from '../services/dueDiligence'", `from '${moduleUrl(service, serviceFile)}'`);
  if (removeGuard) route = change(route, "for (const f of r.status === 'ok' ? r.findings : [])", 'for (const f of r.findings)');
  return (await import(moduleUrl(route, routeFile))).default;
}
test('disabled results cannot persist or alert even if they contain a finding', async () => {
  await noEvidence(await nonLiveResultRoute());
});
test('mutation: non-live result findings reach persistence and alerts', async () => {
  await assert.rejects(() => nonLiveResultRoute(true).then(noEvidence), { name: 'AssertionError' });
  await noEvidence(await nonLiveResultRoute());
});


test('real evidence still updates the score if source completion fails after the insert', async () => {
  await withFetch(async () => {
    const w = world(); Object.assign(w.env, credentials);
    const prepare = w.env.DB.prepare;
    w.env.DB.prepare = (sql: string) => {
      if (/UPDATE dd_external_sources[\s\S]*findings_emitted/.test(sql)) throw new Error('synthetic source completion failure');
      return prepare(sql);
    };
    try {
      await scan(w, ['crunchbase']);
      assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM dd_findings').get().n, 1);
      assert.equal(w.db.prepare('SELECT risk_score FROM dd_cases').get().risk_score, 1);
    } finally { w.db.close(); }
  });
});
