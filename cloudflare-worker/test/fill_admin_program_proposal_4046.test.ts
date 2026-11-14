/**
 * #4046 Group B4 — Ask on Admin · Programs' Propose a program: a studio's
 * program proposal, its Name, One-line purpose and Eligibility. Composition
 * only: who it is for, group, join method, cycle, seats, rewards, templates,
 * what HQ receives, tools and HQ's note and decision are never listed.
 *
 *   - Who: `requireAdmin` then `ownRow`'s studio rule. A licence's admins share
 *     its proposals; an admin bound to no licence holds only their own. A new
 *     proposal hangs under the caller (`owner`). Written while a draft or sent
 *     back, never by a frozen admin (D135). A Super Admin reads one that is not
 *     a draft, read only. Anyone else is told it does not exist (concealed).
 *   - The run reads the studio's own other proposal names, the program names
 *     its admins can see (never HQ's `proposed` drafts) and this proposal's own
 *     choices; never HQ's note, seats, rewards, what HQ receives, or another
 *     studio's proposal. It writes nothing.
 *   - POST and PATCH answer the proposal's integer `id`; the record step after
 *     Save keeps what still equals each placed value; an Undo may put back a blank.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_admin_program_proposal_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import adminProgramProposals from '../src/routes/admin_program_proposals.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-program-proposal-4046-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PROGRAMS = 'Admin · Programs';
const FORM = 'program-proposal';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 51 and 52 administer licence lic-lis; 53 administers lic-nai; 54 is an admin bound to no licence; 55 is the
// Super Admin (no licence); 56 is an admin bound to no licence with an overdue notice (frozen); 11 a founder;
// 61 an Explorer. Proposals: 300 Lisbon's draft (by 51), 301 Nairobi's sent one, 302 Nairobi's draft,
// 303 Lisbon's sent one, 304 54's own HQ-held draft, 305 Lisbon's sent-back one.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (51,'Lia','lia@example.test','admin',1),(52,'Leo','leo@example.test','admin',1),(53,'Nia','nia@example.test','admin',1),
      (54,'Lou','lou@example.test','admin',1),(55,'Sam','sam@example.test','admin',1),(56,'Fay','fay@example.test','admin',1),
      (11,'Founder','f@example.test','founder',1),(61,'Explorer','x@example.test','exploring',1);
    INSERT INTO super_admins(user_id) VALUES (55);
    INSERT INTO territory_licences(id,uid,licence_ref,legal_entity_name,brand_name,status) VALUES
      (1,'lic-lis','PT-001','Studio Lisbon Lda','Studio Lisbon','active'),(2,'lic-nai','KE-001','Studio Nairobi Ltd','Studio Nairobi','active');
    INSERT INTO licence_admins(licence_id,user_id,admin_role) VALUES (1,51,'principal'),(1,52,'delegate'),(2,53,'principal');
    INSERT INTO admin_notices(uid,user_id,kind,subject,body,respond_by,status) VALUES ('an-1',56,'fees','Fees','Pay','2026-01-01 00:00:00','overdue');
    INSERT INTO program_proposals(id,uid,created_by_user_id,licence_uid,status,name,purpose,who_json,grp,join_method,cycle,seats,eligibility,rewards_json,hq_receives,hq_note) VALUES
      (300,'pp-300',51,'lic-lis','draft','Lisbon climate sprint',NULL,'["Founders"]','Learning','By application','cohorts',12,NULL,'["Cash"]','HQRECEIVES-monthly-report','HQNOTE-earlier-round'),
      (301,'pp-301',53,'lic-nai','sent','Nairobi agritech lab','Grow agritech','["Founders"]','Ventures','Open','rolling',NULL,NULL,NULL,NULL,NULL),
      (302,'pp-302',53,'lic-nai','draft','Nairobi hidden draft',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (303,'pp-303',51,'lic-lis','sent','Lisbon sent one','x',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (304,'pp-304',54,NULL,'draft','Lone own draft',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
      (305,'pp-305',52,'lic-lis','sent_back','Lisbon sent back',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Say how cohorts are picked');
    INSERT INTO programs(key,grp,name,status,position,licence_uid) VALUES
      ('fitness','Learning','Founder fitness sprint','live',1,NULL),
      ('nai-only','Access','Nairobi members club','live',2,'lic-nai'),
      ('hq-draft','Product','HQ proposed draft','proposed',3,NULL);
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run = async (_env: any, input: any) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/admin/programs/proposals', adminProgramProposals);
  const call = async (who: number, method: string, path: string, body?: unknown, opts: { support?: boolean } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(opts.support ? { impersonated_by: 55 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number> = {}, opts: { support?: boolean } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: PROGRAMS, form: FORM, ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, opts);
  const runForm = async (who: number, body: Record<string, unknown>) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: PROGRAMS, option: `form:${FORM}`, ...body });
    const evs = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: evs.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: a proposal\'s name, purpose and eligibility, composition; never its choices, terms, seats or HQ\'s decision', () => {
  // Mutation checked: an entry dropped from the SPA copy → the deepEqual fails.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(PROGRAMS, FORM).map((f) => [f.field, f.table, f.column, f.class, f.sources]),
    ['name', 'purpose', 'eligibility'].map((c) => [c, 'program_proposals', c, 'composition', ['eadwyn']]));
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'program_proposals'
    && /who|grp|join|cycle|weeks|seats|rewards|template|hq_|tools|decision|status|licence|created_by/.test(f.column)));
  for (const c of ['name', 'purpose', 'eligibility']) {
    const w = UNDO_WRITES[`program_proposals.${c}`];
    assert.deepEqual([w?.scoped, w?.required, w?.int], [true, false, false], `${c}: a draft may hold it blank`);
    assert.doesNotMatch(w.write, /status/, `${c}: no status clause, the scope refuses first`);
    assert.match(w.write, /strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/, `${c}: the ISO stamp startDraft and saveDraft write`);
  }
  assert.equal(RECORD_SCOPES.program_proposals.concealed, true);
  assert.equal((RECORD_SCOPES.program_proposals.read.match(/\?/g) || []).length, 1);
});

test('who gets Ask: an admin on a new proposal under themselves; the studio\'s admins on its draft; never another studio\'s', async () => {
  // Mutations checked: the studio rule dropped (any admin owns) → 53 reads Lisbon's draft as 200;
  // the editable-status check dropped → Lisbon's sent one reads can_fill true.
  const f = fixture();
  for (const who of [51, 53, 54, 55]) {
    const r = await f.sheet(who);
    assert.equal(r.status, 200, `user ${who}: ${r.text}`);
    assert.deepEqual([r.body.scope, r.body.can_fill, r.body.fields.map((x: any) => [x.field, x.trigger])],
      [`owner:${who}`, true, [['name', true], ['purpose', true], ['eligibility', true]]], `user ${who}`);
  }
  // A colleague on the same licence fills the draft and the sent-back one; its creator too.
  for (const [who, rec] of [[51, 300], [52, 300], [51, 305], [52, 305], [54, 304]] as const) {
    const r = await f.sheet(who, { record: rec });
    assert.deepEqual([r.status, r.body?.can_fill], [200, true], `user ${who} on ${rec}: ${r.text}`);
  }
  // A sent proposal is read, not filled.
  assert.deepEqual([(await f.sheet(51, { record: 303 })).status, (await f.sheet(51, { record: 303 })).body.can_fill], [200, false]);
  // Another studio's proposal, and an HQ-held one that is not yours, read as nothing (as `unknown_proposal` on the route).
  const missing = await f.sheet(51, { record: 9999 });
  assert.equal(missing.status, 404);
  for (const [who, rec, why] of [[53, 300, 'another studio\'s draft'], [51, 302, 'another studio\'s draft'], [51, 304, 'a lone admin\'s own'], [54, 300, 'a studio\'s'], [53, 303, 'another studio\'s sent one']] as const) {
    const r = await f.sheet(who, { record: rec });
    assert.deepEqual([r.status, r.body], [missing.status, missing.body], `${who} on ${rec}: ${why}`);
  }
  // The Super Admin reads a sent proposal of any studio, read only, and never another studio's draft.
  const sam = await f.sheet(55, { record: 301 });
  assert.deepEqual([sam.status, sam.body.can_fill], [200, false]);
  assert.equal((await f.sheet(55, { record: 302 })).status, 404);
  // A founder and an Explorer hold nothing here; a support session keeps nothing.
  assert.equal((await f.sheet(11)).status, 404);
  assert.equal((await f.sheet(11, { record: 300 })).status, 404);
  assert.deepEqual([(await f.sheet(61)).status, (await f.sheet(61)).body.error], [403, 'no_profile']);
  assert.equal((await f.sheet(51, {}, { support: true })).body.can_fill, false);
});

test('a frozen admin reads their own proposal and gets no Ask, as requireAdmin refuses their Save', async () => {
  // Mutation checked: the freeze check dropped from the scope → user 56 reads can_fill true and the run is held.
  const f = fixture();
  f.db.exec(`INSERT INTO program_proposals(id,uid,created_by_user_id,licence_uid,status,name) VALUES (306,'pp-306',56,NULL,'draft',NULL)`);
  const fresh = await f.sheet(56);
  assert.deepEqual([fresh.status, fresh.body.can_fill], [200, false], fresh.text);
  const own = await f.sheet(56, { record: 306 });
  assert.deepEqual([own.status, own.body.can_fill], [200, false]);
  assert.equal((await f.call(56, 'PATCH', '/api/admin/programs/proposals/pp-306', { name: 'x' })).status, 423, 'the route agrees');
  const r = await f.runForm(56, { input: { values: {} } });
  assert.equal(r.status, 403);
  assert.equal(f.quotes.length, 0, 'refused before any hold');
});

test('the run: the studio\'s own names and the programs it sees, this proposal\'s choices; never HQ\'s note, terms, or another studio\'s', async () => {
  // Mutations checked: the studio filter dropped from the gather → "Nairobi hidden draft" reaches Lisbon's prompt;
  // the `status <> 'proposed'` filter dropped → "HQ proposed draft" appears.
  const f = fixture({ fields: [{ field: 'purpose', value: 'Ship a climate pilot in six weeks.' }, { field: 'eligibility', value: 'Founders with a working prototype.' }, { field: 'seats', value: '30' }, { field: 'hq_note', value: 'Approve' }] });
  const run = await f.runForm(52, { record: { id: 300, type: 'program_proposals' }, input: { values: { name: 'Lisbon climate sprint', purpose: '', eligibility: '' } } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => p.field), ['purpose', 'eligibility']);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['seats', 'unknown_field'], ['hq_note', 'unknown_field']]);
  const p = prompt(f.runs[0]);
  assert.match(p, /Lisbon sent one/, 'the studio\'s own other proposals');
  assert.match(p, /Lisbon sent back/, 'a colleague\'s on the same licence');
  assert.match(p, /Founder fitness sprint/, 'a catalogue program');
  assert.match(p, /This proposal's name: Lisbon climate sprint/);
  assert.match(p, /Group: Learning/);
  assert.match(p, /Join method: By application/);
  assert.match(p, /Who it is for: Founders/);
  for (const never of [/Nairobi hidden draft/, /Nairobi agritech lab/, /Nairobi members club/, /HQ proposed draft/, /Lone own draft/,
    /HQNOTE/, /HQRECEIVES/, /Cash/, /\b12\b/, /lia@example/, /- seats/]) assert.doesNotMatch(p, never);
  assert.deepEqual({ ...(f.db.prepare('SELECT name, purpose, eligibility FROM program_proposals WHERE id = 300').get() as any) },
    { name: 'Lisbon climate sprint', purpose: null, eligibility: null }, 'the run writes nothing');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM program_proposals').get() as any).n, 6);
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'program_proposals:300']);
  // A new proposal: filed under the caller; another studio's draft is refused before any hold.
  const fresh = await f.runForm(53, { input: { values: {} } });
  assert.equal(fresh.status, 200, fresh.text);
  assert.doesNotMatch(prompt(f.runs[1]), /Lisbon/, 'Nairobi reads none of Lisbon\'s');
  assert.match(prompt(f.runs[1]), /Nairobi members club/);
  const held = f.quotes.length;
  assert.equal((await f.runForm(53, { record: { id: 300, type: 'program_proposals' }, input: { values: {} } })).status, 404);
  assert.equal(f.quotes.length, held);
});

test('Save: POST and PATCH answer the id; the new draft keeps its creator\'s fills; another studio keeps nothing; Undo may put back a blank', async () => {
  // Mutation checked: `id` dropped from proposalView → the record step has no proposal to name.
  const f = fixture({ fields: [{ field: 'name', value: 'Porto design residency' }, { field: 'purpose', value: 'Two weeks of design reviews.' }] });
  const run = await f.runForm(51, { input: { values: {} } });
  assert.equal(run.status, 200, run.text);
  const uids = run.done.proposals.map((p: any) => p.uid);
  const made = await f.call(51, 'POST', '/api/admin/programs/proposals', { name: 'Porto design residency', purpose: 'Two weeks of design reviews, weekly.' });
  assert.equal(made.status, 201, made.text);
  const id = made.body.proposal.id;
  assert.ok(Number.isSafeInteger(id) && id > 305, `an integer id: ${made.text}`);
  const patched = await f.call(51, 'PATCH', `/api/admin/programs/proposals/${made.body.proposal.uid}`, { eligibility: 'Studios in Porto.' });
  assert.equal(patched.body.proposal.id, id, 'PATCH answers the same id');
  assert.equal((await f.call(53, 'POST', '/api/fills/record', { page: PROGRAMS, form: FORM, record: id, proposals: uids })).status, 404, 'another studio\'s');
  const kept = await f.call(51, 'POST', '/api/fills/record', { page: PROGRAMS, form: FORM, record: id, proposals: uids });
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['name', 'kept'], ['purpose', 'not_kept']], kept.text);
  // Undo the name: a new draft held none before, and a blank is allowed in a draft.
  const pid = kept.body.outcomes[0].provenance_id;
  const undo = await f.call(52, 'POST', `/api/fills/${pid}/undo`);
  assert.deepEqual([undo.status, undo.body.ok, undo.body.value], [200, true, null], undo.text);
  const after = f.db.prepare('SELECT name, purpose, updated_at FROM program_proposals WHERE id = ?').get(id) as any;
  assert.deepEqual([after.name, after.purpose], [null, 'Two weeks of design reviews, weekly.']);
  assert.match(after.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'the ISO stamp the route writes');
  assert.deepEqual([(await f.call(51, 'POST', `/api/fills/${pid}/undo`)).body.error], ['already_undone']);
});

test('Undo is refused once the proposal is sent, and by another studio, without touching it', async () => {
  // Mutation checked: the status test dropped from access → the undo of a sent proposal answers 200 and writes.
  const f = fixture({ fields: [{ field: 'eligibility', value: 'Founders with a pilot customer.' }] });
  const run = await f.runForm(51, { record: { id: 300, type: 'program_proposals' }, input: { values: {} } });
  const uids = run.done.proposals.map((p: any) => p.uid);
  await f.call(51, 'PATCH', '/api/admin/programs/proposals/pp-300', { eligibility: 'Founders with a pilot customer.' });
  const kept = await f.call(51, 'POST', '/api/fills/record', { page: PROGRAMS, form: FORM, record: 300, proposals: uids });
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['eligibility', 'kept']], kept.text);
  const pid = kept.body.outcomes[0].provenance_id;
  assert.equal((await f.call(53, 'POST', `/api/fills/${pid}/undo`)).status, 404, 'another studio\'s');
  f.db.exec(`UPDATE program_proposals SET status = 'sent' WHERE id = 300`);
  const undo = await f.call(51, 'POST', `/api/fills/${pid}/undo`);
  assert.deepEqual([undo.status, undo.body.error], [404, 'fill_not_found']);
  assert.equal((f.db.prepare('SELECT eligibility FROM program_proposals WHERE id = 300').get() as any).eligibility, 'Founders with a pilot customer.');
  assert.equal((f.db.prepare('SELECT undone_at FROM fill_provenance WHERE id = ?').get(pid) as any).undone_at, null, 'the fill is not marked undone');
});
