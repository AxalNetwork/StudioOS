/**
 * #4046 Group B4 — Ask on HQ's New segment (Super Admin · Content · Personas /
 * `segment-profile`). Two composition fields on `segment_profiles`: `name` and
 * `who`. The key (the segment's permanent identity), its profile and status
 * (HQ's decisions) and its typical, needs and offers are never listed.
 *
 *   - `requireSuperAdmin`'s rule exactly: an HQ Super Admin fills; a plain
 *     Admin reads with no trigger; a Super Admin on a branch fills nothing; a
 *     partner and a founder are refused (not concealed: the route conceals
 *     nothing from an admin and refuses everyone else). A new segment hangs
 *     under the caller (`updated_by` on its first version).
 *   - The run reads the segment names already on file and nothing else: never
 *     a key, another segment's who, a member or a history reason.
 *   - The 201 names the segment's rowid; the record step keeps what was
 *     placed. An Undo is always refused (`no_prior`): one statement cannot add
 *     the history row and audit copy every segment write keeps.
 *
 * On the migrated schema, synthetic rows only; the model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_admin_segment_profile_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import segmentsRoute from '../src/routes/persona_segments.ts';
import { ROW_REQUIRED, railRunRoutes } from '../src/routes/rail_run.ts';
import { FILL_FIELDS, fieldsOf, fillFieldProblems } from '../src/services/fills/fields.ts';
import { UNDO_WRITES } from '../src/services/fills/keep.ts';
import { RECORD_SCOPES } from '../src/services/fills/scopes.ts';
import { FILL_FIELDS as SPA_FIELDS } from '../../frontend/src/lib/fillFields.js';

const SECRET = 'synthetic-fill-segment-profile-4046-'.repeat(3);
test.after(() => removeMigratedDatabases());

const PAGE = 'Super Admin · Content · Personas';
const FORM = 'segment-profile';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const NAME = 'Climate hardware founders';
const WHO = 'Founders building physical climate products who need lab space and pilots.';

// 51 plain admin; 53 Super Admin; 54 another Super Admin; 31 partner; 11 founder; 61 explorer.
// Segment 'synthetic_hidden_key' carries a who and a history reason the run must never read.
function fixture(output: unknown = { fields: [] }, opts: { branch?: string } = {}) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (51,'Admin','ad@example.test','admin',1),
      (53,'Super','su@example.test','admin',1),
      (54,'Super two','su2@example.test','admin',1),
      (31,'Partner','pa@example.test','partner',1),
      (11,'Founder','fo@example.test','founder',1),
      (61,'Explorer','x@example.test','exploring',1);
    INSERT INTO super_admins(user_id) VALUES (53),(54);
    INSERT INTO segment_profiles(key,name,profile,status,who,updated_by) VALUES
      ('synthetic_hidden_key','Existing studio segment','founder','draft','Private who text about these members.',53);
    INSERT INTO segment_profile_history(segment_key,version,action,fields_json,reason,actor_user_id) VALUES
      ('synthetic_hidden_key',1,'edited','["name"]','Private history reason',53);
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run = async (_env: any, input: any) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(opts.branch ? { BRANCH_CODE: opts.branch } : {}) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/personas/segments', segmentsRoute);
  const call = async (who: number, method: string, path: string, body?: unknown, o: { support?: boolean } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(o.support ? { impersonated_by: 54 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number> = {}, o: { support?: boolean } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: PAGE, form: FORM, ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, o);
  const runForm = async (who: number, body: Record<string, unknown>) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: PAGE, option: `form:${FORM}`, ...body });
    const evs = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: evs.find((e) => e.event === 'done')?.data };
  };
  const create = (who: number, body: Record<string, unknown>) => call(who, 'POST', '/api/personas/segments', { key: 'climate_hardware', profile: 'founder', status: 'draft', ...body });
  return { db, call, sheet, runForm, create, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');

test('the registry: the name and who they are, in both copies; never the key, profile, status, typical, needs or offers', () => {
  // Mutation checked: the `who` entry dropped from the SPA copy → the deepEqual fails.
  assert.deepEqual(fillFieldProblems(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(SPA_FIELDS)), JSON.parse(JSON.stringify(FILL_FIELDS)));
  assert.deepEqual(fieldsOf(PAGE, FORM).map((f) => [f.field, f.label, f.table, f.column, f.class, f.sources]), [
    ['name', 'Name', 'segment_profiles', 'name', 'composition', ['eadwyn']],
    ['who', 'Who they are', 'segment_profiles', 'who', 'composition', ['eadwyn']],
  ]);
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'segment_profiles' && /^(key|profile|status|typical|needs|offers|version|reason)/.test(f.column)));
  for (const c of ['name', 'who']) {
    const undo = UNDO_WRITES[`segment_profiles.${c}`];
    assert.deepEqual([undo?.scoped, undo?.required, undo?.int], [true, true, false], `${c}: an Undo has no prior`);
    assert.match(undo.write, /WHERE rowid = \? AND/);
    assert.match(undo.write, /version = version \+ 1, updated_at = datetime\('now'\)/);
  }
  assert.notEqual(RECORD_SCOPES.segment_profiles.concealed, true);
  assert.equal((RECORD_SCOPES.segment_profiles.read.match(/\?/g) || []).length, 1);
  assert.ok(!Object.hasOwn(ROW_REQUIRED, 'segment_profiles'), 'no "add several rows": no row writer stands behind one');
});

test('who gets Ask: an HQ Super Admin; a plain Admin reads with no trigger; a partner and a founder are refused; a support session keeps nothing', async () => {
  // Mutation checked: `isSuperAdmin(user)` dropped from the write rule → the plain Admin reads can_fill true.
  // Mutation checked: `isAdminUser` dropped from the scope → the partner and the founder read 200.
  const f = fixture();
  for (const who of [53, 54]) {
    const r = await f.sheet(who);
    assert.equal(r.status, 200, `user ${who}: ${r.text}`);
    assert.deepEqual([r.body.scope, r.body.can_fill, r.body.fields.map((x: any) => [x.field, x.trigger])], [`owner:${who}`, true, [['name', true], ['who', true]]], `user ${who}`);
  }
  const plain = await f.sheet(51);
  assert.equal(plain.status, 200, plain.text);
  assert.equal(plain.body.can_fill, false, 'a plain Admin reads, and fills nothing');
  for (const who of [31, 11]) assert.equal((await f.sheet(who)).status, 403, `user ${who} is refused`);
  assert.deepEqual([(await f.sheet(61)).status, (await f.sheet(61)).body.error], [403, 'no_profile']);
  assert.equal((await f.sheet(53, {}, { support: true })).body.can_fill, false);
  // A parent named by the request is ignored: the Worker names the caller.
  assert.equal((await f.sheet(53, { parent: 54 })).body.scope, 'owner:53');
  // A saved segment, by its rowid: a Super Admin fills it, a plain Admin reads it.
  const rowid = (f.db.prepare("SELECT rowid AS id FROM segment_profiles WHERE key = 'synthetic_hidden_key'").get() as any).id;
  assert.equal((await f.sheet(53, { record: rowid })).body.can_fill, true);
  assert.equal((await f.sheet(51, { record: rowid })).body.can_fill, false);
});

test('on a branch, a Super Admin fills nothing (requireSuperAdmin is HQ only), and the run is refused before any hold', async () => {
  // Mutation checked: `&& !branchOf(env)` dropped from the write rule → the direct call on a branch answers write: true.
  const f = fixture({ fields: [{ field: 'name', value: NAME }] }, { branch: 'pt' });
  const r = await f.sheet(53);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.can_fill, false);
  const run = await f.runForm(53, { input: { values: { name: '', who: '' } } });
  assert.equal(run.status, 403, run.text);
  assert.equal(f.quotes.length, 0);  // The scope's own second lock: on a branch, a user object that claims the elevation still writes nothing
  // (`hydrateSuperAdmin` already answers 0 there, so only a direct call reaches this line).
  const scope = RECORD_SCOPES.segment_profiles;
  const claimed: any = { id: 53, role: 'admin', is_super_admin: 1 };
  assert.deepEqual(await scope.access({ BRANCH_CODE: 'pt' } as any, claimed, null, 53), { read: true, write: false });
  assert.deepEqual(await scope.access({} as any, claimed, null, 53), { read: true, write: true }, 'on HQ it writes');
  assert.deepEqual(await scope.access({} as any, claimed, null, 54), { read: false, write: false }, 'never under another admin');
});

test('the run: the segment names on file, never a key, another segment\'s who or a history reason; nothing is written', async () => {
  // Mutation checked: the gather's `SELECT name` → `SELECT key || ' ' || who` → the key and the who reach the prompt.
  const f = fixture({ fields: [{ field: 'name', value: NAME }, { field: 'who', value: WHO }, { field: 'key', value: 'climate_x' }, { field: 'status', value: 'active' }] });
  const before = (f.db.prepare('SELECT COUNT(*) AS n FROM segment_profiles').get() as any).n;
  const run = await f.runForm(53, { input: { values: { name: '', who: '' } } });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.done.proposals.map((p: any) => [p.field, p.value]), [['name', NAME], ['who', WHO]]);
  assert.deepEqual(run.done.dropped.map((d: any) => [d.field, d.why]), [['key', 'unknown_field'], ['status', 'unknown_field']]);
  const p = prompt(f.runs[0]);
  assert.match(p, /Existing studio segment/);
  for (const never of [/synthetic_hidden_key/, /Private who text/, /Private history reason/, /su@example\.test/]) assert.doesNotMatch(p, never);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM segment_profiles').get() as any).n, before, 'the run writes nothing');
  const payload = JSON.parse((f.db.prepare('SELECT payload_json FROM ai_rail_proposals').get() as any).payload_json);
  assert.deepEqual([payload.project, payload.scope], [null, 'owner:53']);
  // A plain Admin is refused before any hold.
  const refused = await f.runForm(51, { input: { values: { name: '', who: '' } } });
  assert.equal(refused.status, 403);
  assert.equal(f.quotes.length, 1);
});

test('after Create: the 201 names the rowid; the creator keeps both; a plain Admin records nothing; an Undo is refused and writes nothing', async () => {
  // Mutation checked: `id` dropped from createProfile's answer → the 201 names no id.
  // Mutation checked: `required: true` → false on the who undo → the Undo writes NULL and answers 200.
  const f = fixture({ fields: [{ field: 'name', value: NAME }, { field: 'who', value: WHO }] });
  const run = await f.runForm(53, { input: { values: { name: '', who: '' } } });
  const uids = run.done.proposals.map((p: any) => p.uid);
  const made = await f.create(53, { name: NAME, who: WHO });
  assert.equal(made.status, 201, made.text);
  const id = made.body.segment.id;
  assert.ok(Number.isSafeInteger(id) && id > 0, 'the 201 names the rowid');
  assert.equal((f.db.prepare('SELECT rowid AS id FROM segment_profiles WHERE key = ?').get('climate_hardware') as any).id, id);
  assert.equal(made.body.segment.key, 'climate_hardware', 'the rest of the answer is unchanged');
  assert.equal((await f.call(51, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: id, proposals: uids })).status, 403, 'a plain Admin records nothing');
  const kept = await f.call(53, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: id, proposals: uids });
  assert.equal(kept.status, 200, kept.text);
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['name', 'kept'], ['who', 'kept']]);
  for (const o of kept.body.outcomes) {
    const undo = await f.call(53, 'POST', `/api/fills/${o.provenance_id}/undo`);
    assert.deepEqual([undo.status, undo.body.error], [409, 'no_prior'], o.field);
  }
  const row = f.db.prepare('SELECT name, who, version FROM segment_profiles WHERE key = ?').get('climate_hardware') as any;
  assert.deepEqual([row.name, row.who, row.version], [NAME, WHO, 1], 'the segment is as HQ created it');
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM segment_profile_history WHERE segment_key = 'climate_hardware'").get() as any).n, 1);
});

test('after Create: words typed over are let go', async () => {
  const f = fixture({ fields: [{ field: 'name', value: NAME }, { field: 'who', value: WHO }] });
  const run = await f.runForm(53, { input: { values: {} } });
  const uids = run.done.proposals.map((p: any) => p.uid);
  const made = await f.create(53, { name: NAME, who: 'My own words instead.' });
  assert.equal(made.status, 201, made.text);
  const kept = await f.call(53, 'POST', '/api/fills/record', { page: PAGE, form: FORM, record: made.body.segment.id, proposals: uids });
  assert.deepEqual(kept.body.outcomes.map((o: any) => [o.field, o.outcome]), [['name', 'kept'], ['who', 'not_kept']], kept.text);
});
