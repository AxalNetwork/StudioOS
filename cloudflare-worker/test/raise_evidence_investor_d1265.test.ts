/** D1265 (#3288): the investor's evidence read and SCORING's pack. Real SQLite, production schema + migrations; all people and figures are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import dataRoom from '../src/routes/data_room.ts';
import deals from '../src/routes/deals.ts';
import { buildCandidates, acceptItem, setSharing, linkClaim, evidenceAudience, investorEvidence, evidencePack } from '../src/services/raiseEvidence.ts';
import { investorPage } from '../src/services/roundCalls.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); db.exec(read('../sql/schema_baseline.sql'));
  for (const f of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter(f => /^\d+_.*\.sql$/.test(f) && migrationNumber(f) > BASELINE_CUTOFF).sort(compareMigrations)) db.exec(read('../sql/migrations/' + f));
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 't'.repeat(64); // in-memory test signing seed only

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL),
   (4,'Synthetic Partner','four@example.invalid','partner',NULL,1,0,NULL),(5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0,'approved'),
   (7,'Outside Investor','seven@example.invalid','investor',NULL,1,0,'approved'),(8,'Synthetic Advisor','eight@example.invalid','investor',NULL,1,0,'approved');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('three',3,10);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', ROUND_CALLS_ENABLED: 'true' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>(); app.route('/api/data-room', dataRoom); app.route('/api/deals', deals);
  return { db, env, ctx, app };
}
type World = ReturnType<typeof world>;
function seed(w: World, table: string, values: Record<string, unknown>) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
  const row = { ...values }; for (const c of w.db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? table + '-' + String(values.id ?? 'one') : 'synthetic';
  const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
  w.db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k] as any));
}
/** Sources whose private parts are marked PRIVATE, and a balance no read may ever carry. */
function sources(w: World) {
  seed(w, 'integrations', { id: 1, user_id: 1, provider_key: 'mercury', status: 'active' });
  seed(w, 'data_room_files', { id: 1, uid: 'file-one', project_id: 1, name: 'PRIVATE FILE NAME', r2_key: 'PRIVATE KEY', visibility: 'nda', access_tier: 'invited' });
  seed(w, 'revenue_entries', { id: 1, uid: 'revenue-one', project_id: 1, customer: 'PRIVATE CUSTOMER', revenue_type: 'recurring', amount_cents: 100, currency: 'usd', received_on: '2026-09-01', source: 'manual', verification: 'supported', proof_document_id: 1 });
  seed(w, 'mercury_raise_facts', { id: 1, integration_id: 1, project_id: 1, kind: 'runway', fact_key: 'runway', value: 8, months: 3, amount_cents: 123400, label: 'product', as_of: '2026-09-02' });
  seed(w, 'mercury_raise_proposals', { id: 2, integration_id: 1, project_id: 1, kind: 'statement', source_key: 'statement-one', status: 'accepted', local_table: 'data_room_files', local_id: 1, payload_json: JSON.stringify({ month: '2026-09', account_id: 'PRIVATE ACCOUNT', last_four: '9876' }) });
  seed(w, 'discovery_interviews', { id: 1, project_id: 1, interviewee_name: 'PRIVATE INTERVIEWEE', interview_date: '2026-09-07', pains_json: '[]', quote_consent: 1, notes: 'PRIVATE QUOTE', icp_fit: 'strong' });
  seed(w, 'project_metrics', { id: 1, project_id: 1, snapshot_date: '2026-09-10', source: 'manual', mrr: 0, cash_balance: 987654321 });
  seed(w, 'raise_prospects', { id: 1, uid: 'prospect-one', project_id: 1, name: 'PRIVATE INVESTOR', email: 'private@example.invalid', stage: 'committed', commit_status: 'soft', amount_cents: 50000, currency: 'USD', updated_at: '2026-10-26' });
  seed(w, 'round_calls', { id: 1, uid: 'call-one', project_id: 1, company_id: 10, state: 'sent', instrument: 'safe', target_close: '2099-01-01' });
}
const proposalOf = (w: World, kind: string, area?: string) => w.db.prepare(`SELECT uid,payload_json FROM ai_rail_proposals WHERE status='proposed' AND json_extract(payload_json,'$.kind')=? AND (? IS NULL OR json_extract(payload_json,'$.area')=?) LIMIT 1`).get(kind, area ?? null, area ?? null) as any;
/** Pin one candidate of a kind and share it as asked. */
async function share(w: World, kind: string, visibility: 'private' | 'summary' | 'after_nda', area?: string) {
  const q = proposalOf(w, kind, area); assert.ok(q, 'candidate ' + kind);
  let item: any = await acceptItem(w.ctx, q.uid, JSON.parse(q.payload_json).snapshot_hash);
  if (item.visibility !== visibility) item = await setSharing(w.ctx, item.uid, { version: item.version, visibility });
  return item;
}
const grant = (w: World, investor = 5) => seed(w, 'data_room_grants', { id: investor, uid: 'grant-' + investor, project_id: 1, investor_user_id: investor, granted_by_user_id: 1, status: 'active' });
const nda = (w: World, investor = 5) => seed(w, 'pairwise_ndas', { party_a_user_id: 1, party_b_user_id: investor, status: 'active' });
const opens = (w: World) => Number((w.db.prepare("SELECT COUNT(*) n FROM data_room_access_log WHERE action='open_evidence'").get() as any).n);
const NEVER = /PRIVATE|987654321|123400|private@example|9876|Outside Investor|snapshot_hash|private_reason|source_ref|accepted_by/;
/** Item ids are random hex. A four-digit last-four can sit inside one, which is not the bank line. */
const shown = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{16,}/gi, '');

async function fullPack(w: World) {
  sources(w); await buildCandidates(w.ctx);
  const kpi = await share(w, 'kpi-snapshot', 'after_nda', 'Investor narrative and Pitch deck');
  const icp = await share(w, 'icp-fit', 'summary');
  const runway = await share(w, 'bank-runway', 'after_nda');
  const quote = await share(w, 'consented-quote', 'after_nda');
  const commitment = await share(w, 'typed-commitment', 'after_nda');
  const statement = await share(w, 'bank-statement', 'after_nda');
  const proof = await share(w, 'revenue-proof', 'after_nda');
  const kept = await share(w, 'kpi-snapshot', 'private', 'Capital model');
  return { kpi, icp, runway, quote, commitment, statement, proof, kept };
}

test('the audience is a data-room grant, a round-call recipient or an invited investor; nobody else', async () => {
  const w = world(); try {
    sources(w);
    assert.equal(await evidenceAudience(w.env, 1, 7), null, 'an outsider');
    assert.equal(await evidenceAudience(w.env, 1, 1), null, 'the founder reads Raise › Evidence');
    // An advisor grant has no evidence scope (no such column), so it admits nothing on its own.
    seed(w, 'advisor_client_grants', { project_id: 1, advisor_user_id: 8, scope_project: 1, scope_data_room: 1, status: 'active' });
    assert.equal(await evidenceAudience(w.env, 1, 8), null, 'an advisor grant has no evidence scope');
    grant(w, 7); assert.deepEqual((await evidenceAudience(w.env, 1, 7))?.via, ['data_room']);
    seed(w, 'round_call_recipients', { id: 1, origin: 'chosen', call_id: 1, investor_user_id: 5 });
    assert.deepEqual((await evidenceAudience(w.env, 1, 5))?.via, ['round_call']);
    w.db.exec("UPDATE round_calls SET state='draft'");
    assert.equal(await evidenceAudience(w.env, 1, 5), null, 'a call not yet sent admits no one');
    seed(w, 'deals', { id: 9, project_id: 1, status: 'active' }); seed(w, 'deal_invitations', { deal_id: 9, investor_user_id: 5, status: 'invited' });
    const aud = await evidenceAudience(w.env, 1, 5);
    assert.deepEqual(aud?.via, ['invited']); assert.equal(aud?.folders?.size, 0, 'no grant opens no folder');
  } finally { w.db.close(); }
});

test('before the NDA an investor reads coverage only: kind, count, source and date, never a value', async () => {
  const w = world(); try {
    await fullPack(w); grant(w);
    const r: any = await investorEvidence(w.env, 1, 5);
    assert.equal(r.nda_signed, false); assert.equal(r.items, null); assert.equal(r.claims, null);
    assert.match(r.before_nda, /NDA/);
    // Mutation checked: return items before the NDA → value_num appears and this fails.
    assert.doesNotMatch(JSON.stringify(r), /value_num|"value/);
    assert.doesNotMatch(shown(r), NEVER);
    const kinds = r.coverage.groups.map((g: any) => g.kind).sort();
    // The private item never counts; the file gated by the NDA is not counted before it.
    assert.deepEqual(kinds, ['bank-runway', 'consented-quote', 'icp-fit', 'kpi-snapshot', 'typed-commitment']);
    assert.equal(r.coverage.groups.find((g: any) => g.kind === 'kpi-snapshot').count, 1);
    assert.equal(opens(w), 1);
  } finally { w.db.close(); }
});

test('after the NDA: After NDA with values, Summary without, and never a private item, a balance, a bank line or another investor', async () => {
  const w = world(); try {
    const p = await fullPack(w); grant(w); nda(w);
    const r: any = await investorEvidence(w.env, 1, 5);
    assert.equal(r.nda_signed, true); assert.equal(r.items.state, 'recorded');
    const by = new Map(r.items.rows.map((i: any) => [i.uid, i]));
    // Mutation checked: let a private item through (visibility IN (... 'private')) → this fails.
    assert.equal(by.has(p.kept.uid), false, 'private');
    assert.equal((by.get(p.kpi.uid) as any).value_num, 0, 'a measured zero stays a zero');
    assert.equal((by.get(p.runway.uid) as any).value_num, 8, 'a derived bank figure after the NDA (owner question 1)');
    const icp: any = by.get(p.icp.uid); assert.equal(icp.value_num, null); assert.equal(icp.value_reason, 'Shared as a summary only.');
    // Mutation checked: empty ONE_INVESTOR → the commitment's 50000 reaches the investor.
    const c: any = by.get(p.commitment.uid); assert.equal(c.value_num, null); assert.match(c.value_reason, /One investor/);
    assert.ok(by.has(p.statement.uid) && by.has(p.proof.uid), 'files the grant and the NDA admit');
    assert.equal((by.get(p.statement.uid) as any).value_num, null);
    assert.doesNotMatch(shown(r), NEVER);
  } finally { w.db.close(); }
});

test('an item whose source changed, a withdrawn quote consent and a refused file are left out at read', async () => {
  const w = world(); try {
    const p = await fullPack(w); grant(w); nda(w);
    const uids = async () => new Set(((await investorEvidence(w.env, 1, 5)) as any).items.rows.map((i: any) => i.uid));
    // Mutation checked: drop the fingerprint comparison in currentShared → the changed figure is returned.
    w.db.exec('UPDATE project_metrics SET mrr=25');
    assert.equal((await uids()).has(p.kpi.uid), false, 'source changed');
    // Withdrawn consent removes the source candidate, so the fingerprint leaves the quote out; quoteConsented is a second lock.
    w.db.exec('UPDATE discovery_interviews SET quote_consent=0');
    assert.equal((await uids()).has(p.quote.uid), false, 'consent withdrawn');
    // Mutation checked: make fileAdmits return true → the committed-only file is returned.
    w.db.exec("UPDATE data_room_files SET access_tier='committed'");
    const now = await uids();
    assert.equal(now.has(p.statement.uid), false); assert.equal(now.has(p.proof.uid), false);
    assert.ok(now.has(p.runway.uid));
  } finally { w.db.close(); }
});

test('a recipient with no grant reads no file-backed item, even after the NDA', async () => {
  const w = world(); try {
    const p = await fullPack(w); nda(w); seed(w, 'round_call_recipients', { id: 1, origin: 'chosen', call_id: 1, investor_user_id: 5 });
    const rows = ((await investorEvidence(w.env, 1, 5)) as any).items.rows.map((i: any) => i.uid);
    assert.equal(rows.includes(p.statement.uid), false); assert.equal(rows.includes(p.proof.uid), false);
    assert.ok(rows.includes(p.kpi.uid));
  } finally { w.db.close(); }
});

test('each shared claim shows its state, never its stated figure', async () => {
  const w = world(); try {
    const p = await fullPack(w); grant(w); nda(w);
    seed(w, 'raise_claims', { id: 1, uid: 'claim-one', project_id: 1, surface: 'narrative', surface_version: '3', field_key: 'mrr', claim_kind: 'metric', stated_value: '18400', state: 'backed' });
    await linkClaim(w.ctx, 'claim-one', { item_id: p.kpi.uid, item_version: (w.db.prepare('SELECT version FROM raise_evidence_items WHERE uid=?').get(p.kpi.uid) as any).version });
    const r: any = await investorEvidence(w.env, 1, 5);
    assert.equal(r.claims.rows.length, 1); assert.equal(r.claims.rows[0].state, 'not_backed'); assert.deepEqual(r.claims.rows[0].items, [p.kpi.uid]);
    assert.doesNotMatch(JSON.stringify(r.claims), /18400|stated_value/);
  } finally { w.db.close(); }
});

test('the routes: the room, the deal page and the round call each read the same, and each open is logged', async () => {
  const w = world(); try {
    await fullPack(w); grant(w); nda(w);
    const tokenFor = async (id: number) => 'Bearer ' + await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const get = async (who: number, path: string) => { const r = await w.app.request('/api' + path, { headers: { Authorization: await tokenFor(who) } }, w.env).catch((e: any) => e); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };
    const room = await get(5, '/data-room/shared/venture-one/evidence');
    assert.equal(room.status, 200); assert.equal(room.body.nda_signed, true); assert.doesNotMatch(shown(room.body), NEVER);
    // An outsider and a missing venture answer alike.
    assert.deepEqual([(await get(7, '/data-room/shared/venture-one/evidence')).status, (await get(7, '/data-room/shared/nope/evidence')).status], [404, 404]);
    assert.equal((await get(3, '/data-room/shared/venture-one/evidence')).status, 403);
    seed(w, 'deals', { id: 9, project_id: 1, status: 'active' }); seed(w, 'deal_invitations', { deal_id: 9, investor_user_id: 5, status: 'invited' });
    const deal = await get(5, '/deals/9/evidence');
    assert.equal(deal.status, 200); assert.deepEqual(deal.body.items.rows.map((i: any) => i.uid).sort(), room.body.items.rows.map((i: any) => i.uid).sort());
    assert.equal((await get(4, '/deals/9/evidence')).body.code, 'investor_only');
    assert.equal((await get(7, '/deals/9/evidence')).status, 403);
    seed(w, 'round_call_recipients', { id: 1, origin: 'chosen', call_id: 1, investor_user_id: 5 });
    const call = w.db.prepare('SELECT * FROM round_calls WHERE id=1').get() as any;
    const page: any = await investorPage(w.env, call, w.db.prepare('SELECT * FROM users WHERE id=5').get() as any);
    assert.equal(page.evidence.nda_signed, true);
    assert.equal(opens(w), 3, 'room, deal and call; the refusals log nothing');
  } finally { w.db.close(); }
});

test('SCORING reads only items shared beyond Private, current at read, under one pack hash', async () => {
  const w = world(); try {
    const p = await fullPack(w);
    const a = await evidencePack(w.env, 1, { audience: 'scoring' });
    assert.equal(a.items.some(i => i.uid === p.kept.uid), false, 'owner question 6');
    assert.ok(a.items.some(i => i.uid === p.icp.uid), 'a summary is beyond Private');
    assert.match(a.pack_hash, /^[a-f0-9]{64}$/);
    assert.equal((await evidencePack(w.env, 1, { audience: 'scoring' })).pack_hash, a.pack_hash, 'the same pack hashes the same');
    // Mutation checked: leave the items out of the hash → it does not move when one leaves the pack.
    const item: any = w.db.prepare('SELECT version FROM raise_evidence_items WHERE uid=?').get(p.icp.uid);
    await setSharing(w.ctx, p.icp.uid, { version: item.version, visibility: 'private' });
    const b = await evidencePack(w.env, 1, { audience: 'scoring' });
    assert.notEqual(b.pack_hash, a.pack_hash); assert.equal(b.items.some(i => i.uid === p.icp.uid), false);
    assert.doesNotMatch(JSON.stringify(b), /PRIVATE|987654321|private@example/);
    await assert.rejects(() => evidencePack(w.env, 1, { audience: 'investor' } as any), { code: 'invalid' });
    assert.equal(opens(w), 0, 'SCORING reads are not investor opens');
  } finally { w.db.close(); }
});
