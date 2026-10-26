/** D1231: real migrated SQLite, Hono/auth, private R2 stub; no provider host. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kyb from '../src/routes/kyb_admin.ts';
import { resyncKycKyb } from '../src/services/trust.ts';
import { APPROVAL_SOURCES, approvalBoard, laneCounts } from '../src/services/approvalSources.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = process.cwd(), JWT_SECRET = 'test-'.repeat(12);
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const migrations = readdirSync(resolve(ROOT, 'cloudflare-worker/sql/migrations')).filter(f => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const schema = [read('cloudflare-worker/sql/schema_baseline.sql'), ...migrations.filter(f => migrationNumber(f) > BASELINE_CUTOFF).map(f => read(`cloudflare-worker/sql/migrations/${f}`))];
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  schema.forEach(s => db.exec(s));
  const result = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all() as any[]).map(r => r.sql as string);
  db.close(); return result;
})();
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No external provider may be reached by KYB tests'); };
test.after(() => { globalThis.fetch = originalFetch; });

function fixture(router = kyb) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  ddl.forEach(s => db.exec(s));
  db.exec(`INSERT INTO users (id, role, name, email, kyc_status) VALUES
    (1,'admin','Super','super@example.test','approved'), (2,'admin','Admin','admin@example.test','approved'),
    (3,'investor','Investor','investor@example.test','pending'), (4,'partner','Partner','partner@example.test','approved'),
    (5,'founder','Owner A','owner-a@example.test','approved'), (6,'founder','Owner B','owner-b@example.test','pending');
    INSERT INTO super_admins (user_id) VALUES (1);
    INSERT INTO user_sessions (user_id,jti,factor,created_at) VALUES
      (1,'fresh-1','totp',datetime('now')), (2,'fresh-2','totp',datetime('now')), (3,'fresh-3','totp',datetime('now')),
      (2,'stale','totp',datetime('now','-2 days'));
    INSERT INTO company_profiles (id,uid,company_name) VALUES (1,'cp1','Company One'),(2,'cp2','Company Two');
    INSERT INTO company_kyb_records (uid,company_id,started_by_user_id,status,entity_name,registration_number,registered_address,submitted_at)
      VALUES ('old-company',1,5,'in_review','Company One Ltd','secret-registration-5577','secret-address',datetime('now','-7 days'));
    INSERT INTO corporate_profiles (user_id,entity_name,registration_number,registered_address_line1,ubo_disclosed,ubos_json,directors_json)
      VALUES (3,'Investor Ltd','secret-number-9988','secret-street',1,'[{"name":"Owner A","ownership_pct":60,"user_id":5,"dob":"1980-01-02"},{"name":"Owner B","ownership_pct":40,"user_id":6}]','[{"name":"Director A","title":"Director","email":"hidden@example.test"}]'),
      (4,'Partner Ltd',NULL,NULL,0,'[]','[]');
    INSERT INTO kyc_partner_imports (id,user_id,legal_name,jurisdiction) VALUES (1,2,'Imported Ltd','PT');
    INSERT INTO legal_obligations (user_id,obligation_key,required,status) VALUES (3,'kyb_v1',1,'pending'),(4,'kyb_v1',1,'pending'),(5,'kyb_v1',1,'pending');`);
  db.exec("INSERT INTO kyb_cases (uid,studio_code,status,source_revision,owners_json,owners_disclosed) SELECT 'account-3','hq','in_review',source_revision,owners_json,owners_disclosed FROM kyb_business_sources WHERE uid='account-3'");
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  let failure = '', deletesFail = false;
  const base = d1Over(db);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: {
    ...base, prepare(sql: string) {
      if (failure && sql.includes(failure)) throw new Error('secret-database-error');
      return base.prepare(sql);
    },
  }, FILES: {
    async put(key: string, bytes: Uint8Array, opts: any) { objects.set(key, { bytes, contentType: opts.httpMetadata.contentType }); },
    async get(key: string) { const value = objects.get(key); return value ? { body: value.bytes, size: value.bytes.length, httpMetadata: { contentType: value.contentType } } : null; },
    async delete(key: string) { if (deletesFail) throw new Error('secret-storage-error'); objects.delete(key); },
  } };
  const app = new Hono<any>();
  app.route('/businesses', router);
  app.onError((e, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  const call = async (path: string, method = 'GET', body?: unknown, as = 2, jti = `fresh-${as}`, headers: Record<string, string> = {}) => {
    const token = as ? await new SignJWT({ user_id: as, role: as < 3 ? 'admin' : 'investor', jti })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET)) : null;
    const res = await app.request(`/businesses${path === '/' ? '' : path.startsWith('/?') ? path.slice(1) : path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data, text, headers: res.headers };
  };
  return { db, env, objects, call, breakRead: (s: string) => { failure = s; }, failDeletes: (v: boolean) => { deletesFail = v; } };
}
const checks = { registry_matches: true, owners_identified: true, owners_checked_or_explained: true };
const approve = (f: ReturnType<typeof fixture>, id = 'account-3', body = checks) => f.call(`/${id}/approve`, 'PATCH', body);
const statusOf = (f: ReturnType<typeof fixture>, id = 3) => (f.db.prepare("SELECT status, expires_at FROM legal_obligations WHERE user_id = ? AND obligation_key = 'kyb_v1'").get(id) as any);
const preparedOwners = [{ name: 'Owner A', ownership_pct: 60, user_id: 5 }, { name: 'Owner B', ownership_pct: 40, user_id: 6 }];

async function ownerScenario(router = kyb) {
  const f = fixture(router);
  try {
    const denied = await approve(f);
    assert.equal(denied.status, 400, denied.text);
    assert.equal(denied.body.error, 'unchecked_owner_reason_required');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM kyb_cases WHERE status = 'approved'").get()?.n, 0);
    const explained = await approve(f, 'account-3', { ...checks, unchecked_owner_reason: 'Owner B is awaiting an identity document.' } as any);
    assert.equal(explained.status, 200, explained.text);
    assert.equal(explained.body.status, 'approved');
    assert.ok(Date.parse(explained.body.expires_at) > Date.now());
    await resyncKycKyb(f.env);
    assert.equal(statusOf(f).status, 'satisfied');
    assert.equal(statusOf(f).expires_at, explained.body.expires_at);
    assert.equal(statusOf(f, 5).status, 'pending', 'a company member must not inherit entity KYB');
    const second = await resyncKycKyb(f.env);
    assert.equal(second.updated, 0, 'nightly sync must not move the approval expiry');
    const history = f.db.prepare('SELECT action FROM kyb_case_events').all() as any[];
    assert.deepEqual(history.map(e => e.action), ['kyb_approved']);
    f.db.exec("UPDATE corporate_profiles SET registration_number = 'changed-with-the-same-timestamp' WHERE user_id = 3");
    await resyncKycKyb(f.env);
    assert.equal(statusOf(f).status, 'pending', 'changed legal details must invalidate a previous decision');
  } finally { f.db.close(); }
}
test('an unchecked owner needs a reason; approved cases satisfy KYB with a fixed expiry; source edits revoke it', () => ownerScenario());

async function scopeScenario(router = kyb) {
  const f = fixture(router);
  try {
    f.db.exec("INSERT OR REPLACE INTO kyb_cases (uid,studio_code,status,source_revision) SELECT 'account-3','other-studio','in_review',source_revision FROM kyb_business_sources WHERE uid='account-3'");
    for (const [path, method, body] of [['/account-3','GET',undefined], ['/account-3/approve','PATCH',checks], ['/account-3/owners','PUT',{ owners: preparedOwners, disclosed: true }], ['/account-3/sensitive/address','GET',undefined]] as const) {
      assert.equal((await f.call(path, method, body)).status, 404);
    }
    const list = await f.call('/');
    assert.equal(list.status, 200, list.text);
    assert.ok(!list.body.items.some((r: any) => r.uid === 'account-3'));
    assert.equal((await f.call('/account-4','GET',undefined,3)).status, 403);
    assert.equal((await f.call('/account-4','GET',undefined,0)).status, 401);
    assert.equal((await f.call('/account-4/approve','PATCH',checks,2,'stale')).status, 403);
    f.env.BRANCH_CODE = 'pt';
    f.db.exec("INSERT OR REPLACE INTO branch_licence (id,licence_uid,status,pushed_at) VALUES (1,'fixture-licence','suspended',datetime('now'))");
    assert.equal((await f.call('/account-4/request-documents','PATCH',{ kinds: ['incorporation'], message: 'Please provide the certificate.' })).status, 423);
    assert.equal((await f.call('/account-4')).status, 200, 'frozen studios retain reads');
  } finally { f.db.close(); }
}
test('another studio, members, anonymous callers, stale sessions and suspended studios cannot decide', () => scopeScenario());

async function privacyScenario(router = kyb) {
  const f = fixture(router);
  try {
    const detail = await f.call('/account-3');
    assert.equal(detail.status, 200, detail.text);
    for (const secret of ['secret-street', 'secret-number-9988', '1980-01-02', 'hidden@example.test']) assert.equal(detail.text.includes(secret), false, secret);
    assert.equal(detail.body.owners.value[0].kyc_status, 'approved');
    assert.equal(detail.body.owners.value[1].kyc_status, 'pending');
    assert.equal(detail.body.directors[0].name, 'Director A');
    assert.equal(detail.body.entity.tax_id, null);
    assert.equal(detail.body.due_diligence.recorded, false);
    const shown = await f.call('/account-3/sensitive/address');
    assert.equal(shown.body.value, 'secret-street');
    const dob = await f.call('/account-3/sensitive/owner_dob?index=0');
    assert.equal(dob.body.value, '1980-01-02');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='kyc_field_shown'").get()?.n, 2);
    const logs = JSON.stringify(f.db.prepare('SELECT * FROM activity_logs').all());
    for (const secret of ['secret-street','1980-01-02','secret-number','Owner A']) assert.equal(logs.includes(secret), false);
    f.breakRead('INSERT INTO activity_logs');
    const refused = await f.call('/account-3/sensitive/address');
    assert.equal(refused.status, 503);
    assert.equal(refused.text.includes('secret-street'), false);
    assert.equal(refused.text.includes('secret-database-error'), false);
  } finally { f.db.close(); }
}
test('sensitive values stay masked, each showing is audited, and audit failure withholds the value', () => privacyScenario());

async function documentScenario(router = kyb) {
  const f = fixture(router);
  try {
    const uploaded = await f.call('/account-3/documents','POST',{ kind: 'incorporation', data_uri: 'data:application/pdf;base64,JVBERi1zeW50aGV0aWM=' });
    assert.equal(uploaded.status, 201, uploaded.text);
    assert.equal(f.objects.size, 1);
    assert.equal(uploaded.text.includes('file_key'), false);
    const path = `/account-3/documents/${uploaded.body.uid}`;
    f.env.CF_ACCESS_TEAM_DOMAIN = 'synthetic.cloudflareaccess.com'; f.env.CF_ACCESS_AUD = 'synthetic-audience';
    assert.equal((await f.call(path)).status, 403, 'Access must gate the R2 stream');
    delete f.env.CF_ACCESS_TEAM_DOMAIN; delete f.env.CF_ACCESS_AUD;
    const viewed = await f.call(path);
    assert.equal(viewed.status, 200, viewed.text);
    assert.equal(viewed.text, '%PDF-synthetic');
    assert.equal(viewed.headers.get('cache-control'), 'private, no-store');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='kyb_document_access'").get()?.n, 1);
    assert.equal((await f.call(`/account-4/documents/${uploaded.body.uid}`)).status, 404);
    f.breakRead('INSERT INTO activity_logs');
    assert.equal((await f.call(path)).status, 503, 'an unaudited document must not leave');
    f.breakRead('');
    const rejected = await f.call('/account-3/reject','PATCH',{ reason: 'The registry record does not match.' });
    assert.equal(rejected.status, 200, rejected.text);
    assert.equal(f.objects.size, 0);
    assert.equal((await f.call(path)).status, 404);
  } finally { f.db.close(); }
}
test('private R2 documents are Access guarded, scope checked, audited before streaming and purged on rejection', () => documentScenario());

test('documents and decisions roll back when their audit cannot be saved; partial purge is retryable', async () => {
  const f = fixture();
  try {
    f.breakRead('INSERT INTO activity_logs');
    assert.equal((await f.call('/account-3/documents','POST',{ kind: 'other', data_uri: 'data:application/pdf;base64,JVBERg==' })).status, 503);
    assert.equal(f.objects.size, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM kyb_documents').get()?.n, 0);
    assert.equal((await approve(f,'account-3',{ ...checks, unchecked_owner_reason: 'Awaiting identity.' } as any)).status, 503);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM kyb_cases WHERE status='approved'").get()?.n, 0);
    f.breakRead('');
    const up = await f.call('/account-3/documents','POST',{ kind: 'other', data_uri: 'data:application/pdf;base64,JVBERg==' });
    f.failDeletes(true);
    const reject = await f.call('/account-3/reject','PATCH',{ reason: 'Registry mismatch.' });
    assert.equal(reject.status, 503);
    assert.equal((await f.call(`/account-3/documents/${up.body.uid}`)).status, 404, 'tombstoned bytes must not be streamable while cleanup retries');
    f.failDeletes(false);
    assert.equal((await f.call('/account-3/reject','PATCH',{ reason: 'Registry mismatch.' })).status, 200);
    assert.equal(f.objects.size, 0);
  } finally { f.db.close(); }
});

test('source discovery, paged counts, missing blocks and independent failed reads remain honest', async () => {
  const f = fixture();
  try {
    const list = await f.call('/?limit=2');
    assert.equal(list.body.total, 5);
    assert.equal(list.body.items.length, 2);
    assert.equal(list.body.items[0].uid, 'company-1', 'oldest submission first');
    const search = await f.call('/?q=Investor&kind=investing_entity');
    assert.equal(search.body.total, 1);
    assert.equal(search.body.items[0].uid, 'account-3');
    assert.equal((await f.call('/?limit=-1')).status, 400);
    f.breakRead('FROM kyb_documents');
    const one = await f.call('/account-3');
    assert.equal(one.status, 200); assert.equal(one.body.documents.available, false);
    assert.equal(one.body.owners.available, true);
    f.breakRead('FROM kyb_businesses b');
    const failed = await f.call('/');
    assert.equal(failed.status, 503); assert.equal(failed.body.items, undefined);
    assert.equal(failed.text.includes('secret-database-error'), false);
  } finally { f.db.close(); }
});

test('owner links, document requests and imports use one local case and never inherit an approval', async () => {
  const f = fixture();
  try {
    assert.equal((await f.call('/company-1/owners','PUT',{ owners: preparedOwners, directors: [{ name: 'Officer' }], disclosed: true })).status, 200);
    assert.equal((await approve(f,'company-1')).status, 400);
    f.db.exec("UPDATE users SET kyc_status='approved' WHERE id=6");
    assert.equal((await approve(f,'company-1')).status, 200);
    assert.equal(f.db.prepare('SELECT status FROM company_kyb_records WHERE company_id=1').get()?.status, 'approved');
    await resyncKycKyb(f.env); assert.equal(statusOf(f,5).status,'pending');
    assert.equal((await f.call('/company-1/request-documents','PATCH',{ kinds: ['shareholders'], message: 'Please provide a current share register.' })).status, 200);
    assert.equal((await f.call('/company-1')).body.status, 'needs_info');
    assert.equal(f.db.prepare('SELECT status FROM company_kyb_records WHERE company_id=1').get()?.status, 'needs_info');
    assert.equal((await f.call('/import-1/dismiss','PATCH',{ reason: 'Imported in error.' })).status, 200);
    assert.equal((await f.call('/import-1/link-account','PATCH',{ user_id: 4 })).status, 400);
    f.db.exec("INSERT INTO kyc_partner_imports (id,user_id,legal_name) VALUES (2,2,'Another Import')");
    assert.equal((await f.call('/import-2/link-account','PATCH',{ user_id: 999 })).status, 404);
    assert.equal((await f.call('/import-2/link-account','PATCH',{ user_id: 4 })).status, 200);
    assert.equal((await f.call('/import-2/dismiss','PATCH',{ reason: 'No longer needed.' })).status, 409);
    assert.equal((await f.call('/import-2')).body.linked_user_id,4);
    assert.equal((await f.call('/company-1/owners','PUT',{ owners: [{ name: 'Bad account', ownership_pct: 100, user_id: 999 }], disclosed: true })).status,404);
    assert.equal((await f.call('/company-1/owners','PUT',{ owners: [{ name: 'Bad percentage', ownership_pct: 101 }], disclosed: true })).status,400);
  } finally { f.db.close(); }
});

test('only a Super Admin records or reads a licensed studio; one case per licence', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO territory_licences (id,uid,licence_ref,legal_entity_name,brand_name) VALUES (1,'licence-1','TEST-01','Studio Ltd','Studio')");
    const b = { licence_uid: 'licence-1', jurisdiction: 'PT', registered_address: 'Private studio address' };
    assert.equal((await f.call('/licensed-studios','POST',b)).status,403);
    const created = await f.call('/licensed-studios','POST',b,1);
    assert.equal(created.status,201,created.text);
    assert.equal((await f.call(`/${created.body.uid}`)).status,403);
    assert.equal((await f.call(`/${created.body.uid}`,'GET',undefined,1)).body.licence_ref,'TEST-01');
    assert.ok(!(await f.call('/')).body.items.some((r: any) => r.kind === 'licensed_studio'));
    assert.ok((await f.call('/','GET',undefined,1)).body.items.some((r: any) => r.kind === 'licensed_studio'));
    assert.equal((await f.call('/licensed-studios','POST',b,1)).status,409);
    f.env.BRANCH_CODE = 'pt';
    assert.equal((await f.call('/licensed-studios','POST',b,1)).status,403);
  } finally { f.db.close(); }
});

test('Approvals counts all waiting business kinds and links to the business queue', async () => {
  const f = fixture();
  try {
    const source = APPROVAL_SOURCES.filter(s => s.key === 'kyb');
    const counts = await laneCounts(f.env,source), board = await approvalBoard(f.env,100,Date.now(),source);
    assert.equal(counts[0].count,4);
    assert.equal(board.items.length,4);
    assert.equal(counts[0].decided_on,'KYC & KYB › Businesses');
    assert.equal(counts[0].decision_path,'/admin/kyc/businesses');
    assert.equal(board.items[0].who,'Company One');
    f.db.exec("INSERT OR REPLACE INTO kyb_cases (uid,studio_code,status,source_revision) SELECT 'account-3','other-studio','in_review',source_revision FROM kyb_business_sources WHERE uid='account-3'");
    assert.equal((await laneCounts(f.env,source))[0].count,3);
  } finally { f.db.close(); }
});

test('company source edits cannot preserve a projected approval or suppress its next review', async () => {
  const f = fixture();
  try {
    f.db.exec("UPDATE users SET kyc_status='approved' WHERE id=6");
    assert.equal((await f.call('/company-1/owners','PUT',{ owners: preparedOwners, disclosed: true })).status,200);
    assert.equal((await approve(f,'company-1')).status,200);
    f.db.exec("UPDATE company_profiles SET company_name='Company changed in the same second' WHERE id=1");
    const changed = await f.call('/company-1');
    assert.equal(changed.body.status,'in_review');
    assert.equal(changed.body.expires_at,null);
    assert.equal((await f.call('/company-1/owners','PUT',{ owners: preparedOwners, disclosed: true })).status,200);
    assert.equal((await approve(f,'company-1')).status,200);
    f.db.exec("UPDATE kyb_cases SET expires_at = datetime('now','-1 day') WHERE uid='company-1'");
    assert.equal((await f.call('/company-1')).body.status,'expired');
  } finally { f.db.close(); }
});

async function selfReviewScenario(router = kyb) {
  const f = fixture(router);
  try {
    f.db.exec("INSERT INTO corporate_profiles (user_id,entity_name) VALUES (2,'Admin entity')");
    const own = await f.call('/account-2');
    assert.equal(own.status,200,'own read is allowed'); assert.equal(own.body.can_review,false);
    for (const [path,method,body] of [['/account-2/approve','PATCH',checks],['/account-2/owners','PUT',{owners:[],disclosed:true}],
      ['/import-1/link-account','PATCH',{user_id:2}],['/company-1/owners','PUT',{owners:[{name:'Admin',ownership_pct:100,user_id:2}],disclosed:true}]] as const) {
      assert.equal((await f.call(path,method,body)).status,403);
    }
    assert.equal((await f.call('/account-2/owners','PUT',{owners:[{name:'Independent owner',ownership_pct:100,user_id:5}],disclosed:true},1)).status,200);
    assert.equal((await f.call('/account-2/approve','PATCH',checks,1)).status,200,'a different Super Admin can review the entity');
    assert.equal((await f.call('/company-1/owners','PUT',{owners:[{name:'Admin owner',ownership_pct:100,user_id:2}],disclosed:true},1)).status,200);
    assert.equal((await f.call('/company-1/approve','PATCH',checks)).status,403,'an actor linked as owner cannot review');
  } finally { f.db.close(); }
}
test('staff cannot review their own entity or introduce their own owner/account link', () => selfReviewScenario());

test('reconciliation preserves satisfied obligations backed by other evidence', async () => {
  const f = fixture();
  try {
    f.db.exec(`UPDATE legal_obligations SET status='satisfied',expires_at='2099-01-01',evidence_meta='{"source":"manual_review"}' WHERE user_id=3`);
    await resyncKycKyb(f.env);
    assert.equal(statusOf(f).status,'satisfied'); assert.equal(statusOf(f).expires_at,'2099-01-01');
    assert.equal((await approve(f,'account-3',{ ...checks,unchecked_owner_reason:'A separate review covers this owner.' } as any)).status,200);
    await resyncKycKyb(f.env);
    assert.equal(statusOf(f).expires_at,'2099-01-01','a case must not replace independent evidence');
    assert.equal((await f.call('/account-3/reject','PATCH',{reason:'Registry needs a new review.'})).status,200);
    await resyncKycKyb(f.env);
    assert.equal(statusOf(f).status,'satisfied');
  } finally { f.db.close(); }
});

test('registration search requires the full value and does not reveal substrings', async () => {
  const f = fixture();
  try {
    assert.equal((await f.call('/?q=number-99')).body.total,0);
    const exact = await f.call('/?q=secret-number-9988');
    assert.equal(exact.body.total,1);
    assert.equal(exact.text.includes('secret-number-9988'),false);
  } finally { f.db.close(); }
});

async function resubmissionScenario(router = kyb) {
  for (const [path,method,payload,status] of [
    ['/account-3/owners','PUT',{ owners:[{name:'Current owner',ownership_pct:100,user_id:5}],disclosed:true },'in_review'],
    ['/account-3/request-documents','PATCH',{kinds:['incorporation'],message:'Please provide the updated record.'},'needs_info'],
    ['/account-3/documents','POST',{kind:'incorporation',data_uri:'data:application/pdf;base64,JVBERg=='},'in_review'],
  ] as const) {
    const f = fixture(router);
    try {
      assert.equal((await f.call('/account-3/reject','PATCH',{reason:'Old registry mismatch.'})).status,200);
      f.db.exec("UPDATE corporate_profiles SET entity_name='Resubmitted current entity' WHERE user_id=3");
      assert.equal((await f.call('/account-3')).body.status,'in_review');
      const changed = await f.call(path,method,payload);
      assert.ok(changed.status < 300,changed.text);
      const after = await f.call('/account-3');
      assert.equal(after.body.status,status);
      assert.equal(after.body.reviewed_at,null);
      assert.equal(after.body.registry.recorded,false);
      assert.equal(after.body.decision_reason,method === 'PATCH' ? payload.message : null);
      if (method !== 'PUT') assert.equal(after.body.owners.value[0].user_id,null,'stale staff links must not return on the new revision');
    } finally { f.db.close(); }
  }
}
test('non-decision edits cannot revive a prior rejection, review metadata or stale owner links', () => resubmissionScenario());

async function staffBoundaryScenario(router = kyb) {
  const f = fixture(router);
  try {
    f.db.exec(`UPDATE kyb_cases SET owners_json='[{"name":"Super owner","ownership_pct":100,"user_id":1}]' WHERE uid='account-3'`);
    assert.equal((await f.call('/account-3')).status,403);
    assert.equal((await f.call('/account-3/sensitive/address')).status,403);
    const queue = await f.call('/?q=Investor');
    assert.equal(queue.body.total,0); assert.equal(queue.body.items.length,0);
    assert.equal((await f.call('/account-3','GET',undefined,1)).status,200);
  } finally { f.db.close(); }
}
test('another administrator in the verified owner links remains Super Admin data', () => staffBoundaryScenario());

// Exercise the same behavioural assertions with faults injected, then restored.
// Data-URL modules keep mutations out of the working tree and concurrent tests.
async function mutated(from: string, to: string) {
  const file = resolve(ROOT,'cloudflare-worker/src/routes/kyb_admin.ts'), original = readFileSync(file,'utf8');
  assert.ok(original.includes(from), `mutation target missing: ${from}`);
  let code = stripTypeScriptTypes(original.replace(from,to));
  code = code.replace(/from '([^']+)'/g, (_, spec) => `from '${spec.startsWith('.') ? new URL(spec + '.ts', 'file://' + file).href : import.meta.resolve(spec)}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}
test('D1231 mutation checks: the guards, audit, redaction and decision paths fail with their fault and pass restored', async () => {
  const mutations: Array<[string,string,(r: any) => Promise<void>]> = [
    ["relevant.some(p => !checkedIds.has(p.user_id))",'false',ownerScenario],
    ["owners_checked_or_explained !== true",'owners_checked_or_explained === true',ownerScenario],
    ["'kyb_approved'","'kyb_wrong_action'",ownerScenario],
    ["row.source_revision, user.id, expires", "'invalid-source-version', user.id, expires",ownerScenario],
    ["ref, scope(c.env)).first<Row>()", "ref, 'other-studio').first<Row>()",scopeScenario],
    ['await requireStepUp(c);','',scopeScenario],
    ['await requireBranchNotSuspended(c);','',scopeScenario],
    ["maskFor('address', row.registered_address)", 'row.registered_address',privacyScenario],
    ["maskFor('date_of_birth', p.dob || null)", 'p.dob || null',privacyScenario],
    ["'kyc_field_shown'", "'kyb_wrong_showing'",privacyScenario],
    ["kyb.use('/:id/documents/:documentId', requireCfAccess());",'',documentScenario],
    ["await c.env.FILES!.delete(doc.file_key);",';',documentScenario],
    ["'kyb_document_access'", "'kyb_wrong_document_action'",documentScenario],
    ['row.linked_user_id === user.id', 'false', selfReviewScenario],
    ['if (ids.includes(user.id))', 'if (false)', selfReviewScenario],
    ['if (account.id === user.id)', 'if (false)', selfReviewScenario],
    ["status = 'in_review',\n      registry_matches", "status = status,\n      registry_matches", resubmissionScenario],
    ['row.case_owners_json ?? null', 'row.owners_json ?? null', resubmissionScenario],
    ['if (target) await requireSuperAdmin(c);', 'if (false) await requireSuperAdmin(c);', staffBoundaryScenario],
    ['u.id = b.linked_user_id OR u.id IN', 'u.id = b.linked_user_id AND u.id IN', staffBoundaryScenario],
  ];
  for (const [from,to,scenario] of mutations) {
    await scenario();
    const router = await mutated(from,to);
    await assert.rejects(() => scenario(router), { code: 'ERR_ASSERTION' }, `survived: ${from}`);
    await scenario();
  }
});
