/**
 * D4811 (#4811) part 2 — Corporate Governance's attention view on
 * `GET /api/admin/governance`: each entity's expected records and their six
 * states, the facts and counts, what a confidential record tells an admin who
 * may not open it (its state, nothing else), and the group structure read from
 * the ownership rows (intercompany links only, never another holder). Real
 * migrated schema; every person, title and file is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_attention_4811.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { EXPECTED_RECORDS, groupOf, recordOf } from '../src/services/governanceAttention.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const scratch = mkdtempSync(join(tmpdir(), 'governance-attention-4811-'));
const seed = join(scratch, 'schema.sqlite');
{ const db = new DatabaseSync(seed, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); loadSchema(db); db.close(); }
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-4811-attention-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, FOUNDER = 3;


let n = 0;
function fixture({ branch = false } = {}) {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sam Made-up', 'sam@example.test');
  u.run(ADMIN, 'admin', 'Alex Made-up', 'alex@example.test');
  u.run(FOUNDER, 'founder', 'Fay Made-up', 'fay@example.test');
  // The Super Admin is an elevation on admin: a super_admins row (migration 199).
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md) VALUES ('operating_agreement_v1', 'Operating Agreement', 'gp', 'x')").run();
  db.prepare("INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status) VALUES (40, 'env-40', 'other', 'Holdings OA', 'synthetic', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 'completed'), (41, 'env-41', 'other', 'GP consent', 'synthetic', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 'sent')").run();
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const FILES = {
    async put(key: string, bytes: Uint8Array, o: any) { files.set(key, { bytes: new Uint8Array(bytes), type: o?.httpMetadata?.contentType }); },
    async get(key: string) { const v = files.get(key); return v ? { body: new Blob([v.bytes]).stream() } : null; },
    async head(key: string) { return files.has(key) ? {} : null; },
    async delete(key: string) { files.delete(key); },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES, ...(branch ? { BRANCH_CODE: 'north' } : {}) };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const audits = () => (db.prepare('SELECT action, details FROM activity_logs ORDER BY id').all() as any[]).map((r) => ({ action: r.action, details: JSON.parse(r.details) }));
  return { db, app, env, files, audits };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) return { status: res.status, body: await res.json() as any, headers: res.headers };
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers, body: null as any };
}

let seq = 0;
function addDoc(f: F, o: { entity: string; category: string; title: string; status?: string; confidential?: number; versions?: number; effective?: string | null; signed?: boolean }) {
  const uid = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const status = o.status ?? 'draft';
  const versions = o.versions ?? 0;
  f.db.prepare(`INSERT INTO governance_documents (uid, entity_key, category, title, status, effective_date, confidential, executed_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, o.entity, o.category, o.title, status, o.effective ?? null, o.confidential ?? 0, status === 'executed' ? 1 : null);
  for (let v = 1; v <= versions; v++) {
    f.db.prepare(`INSERT INTO governance_document_versions (document_uid, version, signed, r2_key, file_sha256, file_bytes, content_type)
      VALUES (?, ?, ?, ?, ?, 10, 'application/pdf')`).run(uid, v, v === 1 && status === 'executed' ? 1 : 0, `governance/${o.entity}/${uid}/v${v}.pdf`, 'c'.repeat(64));
  }
  return uid;
}
const recs = (body: any, key: string) => body.entities.find((e: any) => e.key === key).attention.records;
const stateOf = (body: any, key: string, category: string) => recs(body, key).find((r: any) => r.category === category).state;

test('the expected set: one record per D4563 category per entity, under the entity\'s own name; member registers are conditional for the single-member LLCs', () => {
  assert.deepEqual(Object.keys(EXPECTED_RECORDS), ['holdings', 'management', 'gp']);
  for (const list of Object.values(EXPECTED_RECORDS)) assert.deepEqual(list.map((r) => r.category), ['operating_agreement', 'formation_certificate', 'member_register', 'resolution', 'signing_authority']);
  assert.equal(EXPECTED_RECORDS.holdings.find((r) => r.category === 'member_register')!.conditional, false);
  assert.equal(EXPECTED_RECORDS.management.find((r) => r.category === 'member_register')!.conditional, true);
  assert.equal(EXPECTED_RECORDS.gp.find((r) => r.category === 'signing_authority')!.label, 'Authorized signatories');
});

test('record states: Missing, Not recorded, Current, Review required, Incomplete; archived documents do not count', () => {
  const doc = (o: any) => ({ row: { id: o.id ?? 1, uid: `u${o.id ?? 1}`, entity_key: 'holdings', category: 'operating_agreement', title: 'T', status: 'draft', effective_date: null, confidential: 0, ...o }, versions: o.versions ?? 1, latestVersion: o.versions ?? 1 }) as any;
  const oa = EXPECTED_RECORDS.holdings[0];
  const reg = EXPECTED_RECORDS.management[2];
  assert.equal(recordOf(oa, [], false).state, 'missing');
  assert.equal(recordOf(reg, [], false).state, 'not_recorded');
  assert.equal(recordOf(oa, [doc({ status: 'archived' })], false).state, 'missing', 'an archived document is not a record');
  assert.equal(recordOf(oa, [doc({ status: 'executed' })], false).state, 'current');
  assert.equal(recordOf(oa, [doc({ status: 'approved' })], false).state, 'current');
  assert.equal(recordOf(oa, [doc({ status: 'review' })], false).state, 'review_required');
  assert.equal(recordOf(oa, [doc({ status: 'draft', versions: 1 })], false).state, 'review_required', 'a draft with a file needs review');
  assert.equal(recordOf(oa, [doc({ status: 'draft', versions: 0 })], false).state, 'incomplete', 'a record with no file is incomplete');
  assert.equal(recordOf(oa, [doc({ id: 1, status: 'executed' }), doc({ id: 2, status: 'draft', versions: 1 })], false).state, 'review_required', 'an amendment drafted beside the executed record needs review');
  const both = recordOf(oa, [doc({ id: 1, status: 'executed' }), doc({ id: 2, status: 'review', title: 'A&R v2' })], false);
  assert.deepEqual([both.state, both.current!.status, both.attention!.title], ['review_required', 'executed', 'A&R v2'], 'the executed one stays current; the one in review is what needs attention');
});

test('a confidential record: an admin sees "Restricted" and nothing else; the Super Admin sees its real state, still counted as restricted', async () => {
  const f = fixture();
  addDoc(f, { entity: 'holdings', category: 'member_register', title: 'Register (secret holders)', status: 'approved', versions: 1, confidential: 1, effective: '2026-07-01' });
  addDoc(f, { entity: 'holdings', category: 'operating_agreement', title: 'Holdings OA', status: 'executed', versions: 1, effective: '2025-01-15' });
  const a = await call(f, ADMIN, 'GET', '');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const reg = recs(a.body, 'holdings').find((r: any) => r.category === 'member_register');
  assert.deepEqual([reg.state, reg.restricted, reg.recorded, reg.current, reg.attention], ['restricted', true, 0, null, null]);
  assert.doesNotMatch(JSON.stringify(a.body), /secret holders|2026-07-01/, 'nothing of a confidential record leaves for an admin');
  assert.equal(stateOf(a.body, 'holdings', 'operating_agreement'), 'current');
  assert.equal(a.body.entities[0].attention.counts.restricted, 1);
  const s = await call(f, SUPER, 'GET', '');
  const sreg = recs(s.body, 'holdings').find((r: any) => r.category === 'member_register');
  assert.deepEqual([sreg.state, sreg.restricted, sreg.current.title], ['current', true, 'Register (secret holders)']);
  assert.equal(s.body.entities[0].attention.counts.restricted, 1, 'both viewers count the same restricted records');
});

test('the facts: latest executed, last review not recorded, the outstanding issue and the next action point at real records', async () => {
  const f = fixture();
  addDoc(f, { entity: 'gp', category: 'operating_agreement', title: 'GP OA v1', status: 'executed', versions: 1, effective: '2023-04-20' });
  addDoc(f, { entity: 'gp', category: 'formation_certificate', title: 'GP certificate', status: 'approved', versions: 1 });
  const res = await call(f, ADMIN, 'GET', '');
  const gp = res.body.entities.find((e: any) => e.key === 'gp').attention;
  assert.equal(gp.facts.latest_executed.title, 'GP OA v1');
  assert.equal(gp.facts.last_review, null, 'no legal-review store yet: unknown, never a date');
  assert.deepEqual([gp.facts.outstanding_issue.kind, gp.facts.outstanding_issue.category], ['missing', 'resolution']);
  assert.deepEqual([gp.facts.next_action.kind, gp.facts.next_action.label], ['add', 'Parent Member Consent and GP resolutions']);
  assert.deepEqual([gp.counts.current, gp.counts.missing, gp.counts.not_recorded], [2, 2, 1]);
  const empty = res.body.entities.find((e: any) => e.key === 'holdings').attention;
  assert.equal(empty.facts.latest_executed, null);
  assert.equal(empty.counts.missing, 5, 'nothing recorded: every expected record is missing, none is 0-of-something');
});

test('group structure: intercompany rows only, read from the ownership metadata; another holder never leaves', async () => {
  const f = fixture();
  const own = f.db.prepare('INSERT INTO governance_entity_profiles (entity_key, ownership_json) VALUES (?, ?)');
  own.run('management', JSON.stringify([{ holder: 'Axal VC Holdings LLC', percent: 100 }]));
  own.run('gp', JSON.stringify([{ holder: '  axal vc holdings  llc', percent: null }]));
  own.run('holdings', JSON.stringify([{ holder: 'Pat Made-up Founder', percent: 70 }, { holder: 'Axal VC Holdings LLC', percent: 1 }]));
  const res = await call(f, ADMIN, 'GET', '');
  assert.deepEqual(res.body.group.links, [{ parent: 'holdings', child: 'management', percent: 100 }, { parent: 'holdings', child: 'gp', percent: null }],
    'a percent not entered stays unknown; an entity naming itself is no link');
  assert.doesNotMatch(JSON.stringify(res.body), /Pat Made-up|70/, 'a beneficial owner never reaches the view');
  assert.deepEqual(groupOf([]), { links: [] }, 'not recorded: no links, never a hard-coded 100%');
  assert.deepEqual(groupOf([{ entity_key: 'gp', ownership_json: 'not json' }]), { links: [] });
});

test('only HQ: a branch Worker and a founder are refused', async () => {
  assert.equal((await call(fixture({ branch: true }), ADMIN, 'GET', '')).status, 403);
  assert.equal((await call(fixture(), FOUNDER, 'GET', '')).status, 403);
});
