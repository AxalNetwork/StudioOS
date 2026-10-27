/** D1266 (#3289): the two reads the founder's Evidence view adds — investor opens and See as an investor. Real SQLite,
 *  production schema + migrations; all people and figures are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router from '../src/routes/cycle_raise.ts';
import { buildCandidates, acceptItem, setSharing, investorEvidence, previewEvidence, readRaiseEvidence, PREVIEW_AS } from '../src/services/raiseEvidence.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); db.exec(read('../sql/schema_baseline.sql'));
  for (const f of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter(f => /^\d+_.*\.sql$/.test(f) && migrationNumber(f) > BASELINE_CUTOFF).sort(compareMigrations)) db.exec(read('../sql/migrations/' + f));
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 't'.repeat(64); // in-memory test signing seed only

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status,display_name) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL,NULL),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL,NULL),
   (5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0,'approved','Synthetic Fund'),(7,'Second Investor','seven@example.invalid','investor',NULL,1,0,'approved',NULL);
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('three',3,10);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>(); app.route('/api/cycles/raise', router);
  return { db, env, ctx, app };
}
type World = ReturnType<typeof world>;
function seed(w: World, table: string, values: Record<string, unknown>) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
  const row = { ...values }; for (const c of w.db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? table + '-' + String(values.id ?? 'one') : 'synthetic';
  const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
  w.db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k] as any));
}
function sources(w: World) {
  seed(w, 'integrations', { id: 1, user_id: 1, provider_key: 'mercury', status: 'active' });
  seed(w, 'data_room_files', { id: 1, uid: 'file-one', project_id: 1, name: 'PRIVATE FILE NAME', r2_key: 'PRIVATE KEY', visibility: 'nda', access_tier: 'invited' });
  seed(w, 'mercury_raise_facts', { id: 1, integration_id: 1, project_id: 1, kind: 'runway', fact_key: 'runway', value: 8, months: 3, amount_cents: 123400, label: 'product', as_of: '2026-09-02' });
  seed(w, 'mercury_raise_proposals', { id: 2, integration_id: 1, project_id: 1, kind: 'statement', source_key: 'statement-one', status: 'accepted', local_table: 'data_room_files', local_id: 1, payload_json: JSON.stringify({ month: '2026-09', account_id: 'PRIVATE ACCOUNT', last_four: '9876' }) });
  seed(w, 'discovery_interviews', { id: 1, project_id: 1, interviewee_name: 'PRIVATE INTERVIEWEE', interview_date: '2026-09-07', pains_json: '[]', quote_consent: 1, notes: 'PRIVATE QUOTE', icp_fit: 'strong' });
  seed(w, 'project_metrics', { id: 1, project_id: 1, snapshot_date: '2026-09-10', source: 'manual', mrr: 1840, cash_balance: 987654321 });
}
const proposalOf = (w: World, kind: string) => w.db.prepare(`SELECT uid,payload_json FROM ai_rail_proposals WHERE status='proposed' AND json_extract(payload_json,'$.kind')=? LIMIT 1`).get(kind) as any;
async function share(w: World, kind: string, visibility: 'private' | 'summary' | 'after_nda') {
  const q = proposalOf(w, kind); assert.ok(q, 'candidate ' + kind);
  let item: any = await acceptItem(w.ctx, q.uid, JSON.parse(q.payload_json).snapshot_hash);
  if (item.visibility !== visibility) item = await setSharing(w.ctx, item.uid, { version: item.version, visibility });
  return item;
}
const grant = (w: World, investor: number, extra: Record<string, unknown> = {}) => seed(w, 'data_room_grants', { id: investor, uid: 'grant-' + investor, project_id: 1, investor_user_id: investor, granted_by_user_id: 1, status: 'active', ...extra });
const nda = (w: World, investor: number) => seed(w, 'pairwise_ndas', { party_a_user_id: 1, party_b_user_id: investor, status: 'active' });
const opens = (w: World) => Number((w.db.prepare("SELECT COUNT(*) n FROM data_room_access_log WHERE action='open_evidence'").get() as any).n);
async function call(w: World, who: number, tail: string) {
  const auth = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const r = await w.app.request('/api/cycles/raise' + tail, { headers: { 'X-Company-Id': '10', Authorization: auth } }, w.env);
  return { status: r.status, cache: r.headers.get('Cache-Control'), body: await r.json() as any };
}
const NEVER = /PRIVATE|987654321|123400|9876|five@example|snapshot_hash|private_reason|source_ref|accepted_by/;
/** The investor's own read, less what only a log or a real grant changes. */
const strip = (v: any) => { const { preview, preview_as, audience, ...rest } = v; return rest; };

test('See as an investor is the investor’s own projection, before and after the NDA, and is never logged as an open', async () => {
  const w = world(); sources(w); await buildCandidates(w.ctx);
  await share(w, 'kpi-snapshot', 'after_nda'); await share(w, 'icp-fit', 'summary'); await share(w, 'bank-runway', 'after_nda');
  await share(w, 'bank-statement', 'after_nda'); await share(w, 'consented-quote', 'private');
  grant(w, 5); nda(w, 5);
  const after = await previewEvidence(w.ctx, true), before = await previewEvidence(w.ctx, false);
  assert.equal(opens(w), 0, 'a preview writes no open_evidence');
  assert.equal(after.preview, true); assert.equal(after.preview_as, PREVIEW_AS);
  // An unscoped invited grant with an NDA reads exactly what the preview shows.
  assert.deepEqual(strip(after), JSON.parse(JSON.stringify(await investorEvidence(w.env, 1, 5))));
  assert.equal(opens(w), 1, 'the investor’s own read is logged');
  assert.equal(before.nda_signed, false); assert.equal(before.items, null); assert.ok((before.coverage as any).groups.length >= 3);
  const rows = (after.items as any).rows;
  assert.ok(rows.some((r: any) => r.kind === 'icp-fit' && r.value_reason === 'Shared as a summary only.'));
  assert.ok(!rows.some((r: any) => r.kind === 'consented-quote'), 'a Private item never shows');
  assert.ok(!NEVER.test(JSON.stringify([after, before])), 'no balance, account, bank line, investor contact or internal key');
  // Who can see it now: counts, never names.
  assert.deepEqual(after.audience, { state: 'recorded', data_room: 1, nda_signed: 1 });
  grant(w, 7); grant(w, 6, { status: 'revoked' });
  assert.deepEqual((await previewEvidence(w.ctx, true)).audience, { state: 'recorded', data_room: 2, nda_signed: 1 });
});

test('the preview is the founder’s: an admin, a bad flag and a support session are refused; the read is not cached', async () => {
  const w = world(); sources(w); await buildCandidates(w.ctx);
  await assert.rejects(previewEvidence({ ...w.ctx, founder: false }, true), (e: any) => e.code === 'forbidden');
  assert.equal((await call(w, 3, '/evidence/preview?project=1&nda=1')).status, 403);
  assert.equal((await call(w, 1, '/evidence/preview?project=1&nda=2')).status, 400);
  const ok = await call(w, 1, '/evidence/preview?project=1&nda=0');
  assert.equal(ok.status, 200); assert.equal(ok.cache, 'no-store'); assert.equal(ok.body.nda_signed, false);
  const support = await w.app.request('/api/cycles/raise/evidence/preview?project=1&nda=1', { headers: { 'X-Company-Id': '10', Authorization: 'Bearer ' + await new SignJWT({ user_id: 1, impersonated_by: 3 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) } }, w.env);
  assert.equal(support.status, 403);
  assert.equal(opens(w), 0);
});

test('investor opens: the last 30 days, counted by open and by investor, named for the founders and admins, never by email', async () => {
  const w = world(); sources(w); await buildCandidates(w.ctx);
  await share(w, 'kpi-snapshot', 'after_nda'); grant(w, 5); grant(w, 7);
  await investorEvidence(w.env, 1, 5); await investorEvidence(w.env, 1, 5); await investorEvidence(w.env, 1, 7);
  w.db.prepare("INSERT INTO data_room_access_log(project_id,file_id,user_id,action,created_at) VALUES(1,NULL,7,'open_evidence',datetime('now','-31 days'))").run();
  w.db.prepare("INSERT INTO data_room_access_log(project_id,file_id,user_id,action,created_at) VALUES(1,1,7,'download',datetime('now'))").run();
  const founder: any = await readRaiseEvidence(w.ctx);
  assert.equal(founder.opens.state, 'recorded'); assert.equal(founder.opens.days, 30);
  assert.equal(founder.opens.count, 3, 'three opens in the window; the older one and a download are not opens of the evidence');
  assert.equal(founder.opens.investors, 2);
  assert.deepEqual(founder.opens.rows.map((r: any) => r.investor).sort(), ['Second Investor', 'Synthetic Fund', 'Synthetic Fund'], 'the display name, else the name');
  assert.ok(!/@example/.test(JSON.stringify(founder.opens)));
  const admin: any = await readRaiseEvidence({ ...w.ctx, user: w.db.prepare('SELECT * FROM users WHERE id=3').get(), founder: false });
  assert.equal(admin.opens.count, 3);
  // A failed read is Unreadable, never a zero.
  w.db.exec('ALTER TABLE data_room_access_log RENAME TO data_room_access_log_gone');
  const failed: any = await readRaiseEvidence(w.ctx);
  assert.deepEqual([failed.opens.state, failed.opens.count, failed.opens.rows], ['unreadable', null, null]);
  assert.equal(failed.items.state, 'recorded', 'one failed block never blanks the read');
});

test('the source: bound statements only, the route before its siblings, the client', () => {
  const svc = read('../src/services/raiseEvidence.ts'), route = read('../src/routes/cycle_raise.ts');
  const start = svc.indexOf('const PREVIEW_AUDIENCE'), end = svc.indexOf('async function sha256Hex');
  assert.ok(start > 0 && end > start);
  assert.ok(!/prepare\(`[^`]*\$\{/.test(svc.slice(start, end)), 'no interpolated SQL in the preview');
  assert.ok(!/prepare\(`[^`]*\$\{/.test(svc.slice(svc.indexOf('D1266 (#3289): who opened'), svc.indexOf('return {items,opens,'))), 'no interpolated SQL in the opens read');
  assert.ok(/cycleRaise\.get\('\/evidence\/preview', async c => \{\n\s+try \{ const ctx = await evidenceScope\(c, true\)/.test(route), 'the preview needs the founder’s write scope');
  const client = read('../../frontend/src/lib/api/raiseEvidence.js');
  assert.ok(client.includes("preview: (projectId, nda) => request(`/cycles/raise/evidence/preview?"));
});
