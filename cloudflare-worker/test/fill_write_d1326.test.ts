/**
 * D1326 (#3487, #2431 part 3) — Fill with Eadwyn's write: `POST /api/ai/rail/run`
 * with its `form` handler, `POST /api/fills/record`, Accept all for rows
 * (`POST /api/fills/rows/accept`) and `POST /api/fills/:id/undo`.
 *
 * On the migrated schema, synthetic rows only. The model is a stub runner, so
 * no provider is reached; the switch is the router's own (`quoteRun`), and the
 * guard and budget refusals are the router's results as `run()` returns them.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_write_d1326.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { quoteRun } from '../src/services/aiRouter.ts';
import { budgetRefusalMessage } from '../src/services/aiRouter.ts';
import { ACCEPT_ALL_MAX, checkValue, fieldsToAsk, parseFields } from '../src/services/fills/formRun.ts';
import { fieldsOf } from '../src/services/fills/fields.ts';

const SECRET = 'synthetic-fill-write-secret-'.repeat(3);
test.after(() => removeMigratedDatabases());
const SD = 'Founder · Build · Solution design';
const OPTION = 'form:feature';

type Run = (env: any, input: any) => Promise<any>;
const answer = (output: unknown, extra: Record<string, unknown> = {}): Run => async () => ({
  ok: true, output: typeof output === 'string' ? output : JSON.stringify(output), usageLogId: null,
  usage: { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 }, ...extra,
});
const freeQuote = async () => ({ ok: true, hold_microusd: 1200, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }) as any;

function fixture(run: Run = answer({ fields: [] }), quote: any = freeQuote) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Owner','owner@example.test','founder',101,1),(22,'Other','other@example.test','founder',202,1),(33,'Advisor','adv@example.test','advisor',NULL,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (701,'v-acme','Acme Field',101),(702,'v-theirs','Theirs',202);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (701,33,'advisor','accepted');
    INSERT INTO pain_groups(id,project_id,title,sort_order) VALUES (51,701,'Inspections run late',0),(52,702,'Their pain',0);
    INSERT INTO hypotheses(id,project_id,code,claim,sort_order,retired_at) VALUES (61,701,'H3','Crews will book a slot',0,NULL),(62,701,'H4','Retired claim',1,'2026-10-01');
    INSERT INTO mvp_features(id,project_id,title,added_value,effort,pain_group_id,hypothesis_id) VALUES (81,701,'Scheduling','High','M',NULL,NULL);
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  const call = async (who: number, method: string, path: string, body?: unknown, support = false) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(support ? { impersonated_by: 99 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  /** The run's events, in order, as `{ event, data }`. */
  const runForm = async (who: number, body: Record<string, unknown>, support = false) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: SD, option: OPTION, project: 701, ...body }, support);
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, events, done: events.find((e) => e.event === 'done')?.data };
  };
  const proposals = () => db.prepare('SELECT uid, user_id, rail_option, record_ref, kind, payload_json, status, usage_log_id FROM ai_rail_proposals ORDER BY id').all()
    .map((p: any) => ({ ...p, payload: JSON.parse(p.payload_json) }));
  const features = () => db.prepare('SELECT id, title, effort, pain_group_id, hypothesis_id FROM mvp_features ORDER BY id').all();
  return { db, env, call, runForm, proposals, features };
}

// ── The parse ───────────────────────────────────────────────────────────────

test('the parse keeps what its field\'s class allows and says why it drops the rest', () => {
  const fields = fieldsOf(SD, 'feature');
  const gather = { choices: new Map([['pain_group_id', [{ id: 51, label: 'Inspections run late' }]], ['hypothesis_id', [{ id: 61, label: 'H3' }]]]), existing: [] };
  const out = parseFields(JSON.stringify({ fields: [
    { field: 'title', value: '  Crew slot booking ' },
    { field: 'pain_group_id', value: 51 },
    { field: 'hypothesis_id', value: 62 },
    { field: 'effort', value: 'Medium' },
    { field: 'signature', value: 'Ana' },
    { field: 'valuation_cap', value: '5000000' },
    { field: 'added_value', value: 'High' },
    { field: 'title', value: 'A second title' },
  ] }), fields, fields, gather);
  assert.deepEqual(out.kept.map((k) => [k.field, k.value]), [['title', 'Crew slot booking'], ['pain_group_id', 51], ['effort', 'M']]);
  assert.deepEqual(out.dropped.map((d) => [d.field, d.why]), [
    ['hypothesis_id', 'unmatched'], ['signature', 'never_fill'], ['valuation_cap', 'never_fill'], ['added_value', 'unknown_field'],
  ]);
  // A composition aimed at a measured field, and a sourced value with no citation.
  const mrr = fieldsOf('Founder · Grow · Revenue and traction', 'kpi')[0];
  assert.deepEqual(checkValue(mrr, 'value', '12000', null, new Set(['value']), gather), { field: 'value', why: 'measured' });
  const sourced = { ...fields[0], class: 'sourced' as const };
  assert.deepEqual(checkValue(sourced, 'title', 'X', null, new Set(['title']), gather), { field: 'title', why: 'no_citation' });
  assert.equal((checkValue(sourced, 'title', 'X', { kind: 'library', document_id: 1, title: 'Doc', chunk: 0, quote: 'A quote long enough to read' }, new Set(['title']), gather) as any).citation.kind, 'library');
  // A typed field is never asked.
  assert.deepEqual(fieldsToAsk(fields, { title: 'Mine' }).map((f) => f.field), ['pain_group_id', 'hypothesis_id', 'effort']);
  assert.equal(parseFields('not json', fields, fields, gather).kept.length, 0);
});

// ── The run ─────────────────────────────────────────────────────────────────

test('the run streams meta, guard and done; one proposal per kept field with its run; the record is never written', async () => {
  const seen: any[] = [];
  const run: Run = async (_env, input) => { seen.push(input); return { ...(await answer({ fields: [{ field: 'hypothesis_id', value: 61 }, { field: 'pain_group_id', value: 51 }, { field: 'title', value: 'Overwrite me' }] })()), usageLogId: 9 }; };
  const f = fixture(run);
  f.db.exec("INSERT INTO ai_usage_logs(id,user_id,task,model,charged_microusd) VALUES (9,11,'rail_write','m',900)");
  const before = f.features();
  const r = await f.runForm(11, { record: { type: 'mvp_features', id: 81 }, input: { text: 'Crews keep missing slots.' } });
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/event-stream/);
  assert.deepEqual(r.events.map((e) => e.event), ['meta', 'guard', 'done']);
  assert.deepEqual(r.events[0].data, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', hold_microusd: 1200 });
  assert.deepEqual(r.events[1].data, { input: 'pass', output: 'pass' });
  assert.deepEqual(r.done.proposals.map((p: any) => [p.field, p.value]), [['hypothesis_id', 61], ['pain_group_id', 51]]);
  assert.deepEqual(r.done.dropped, [{ field: 'title', why: 'not_asked' }], 'the title holds a value, so it was not asked');
  assert.deepEqual([r.done.usage_log_id, r.done.charged_microusd], [9, 900]);
  assert.ok('budget' in r.done);
  // The run carried the rail context, and the guard checks the member's words only.
  assert.deepEqual(seen[0].rail, { page: SD, option: OPTION, record: 'mvp_features:81' });
  assert.equal(seen[0].guardText, 'Crews keep missing slots.');
  assert.equal(seen[0].task, 'rail_write');
  const rows = f.proposals();
  assert.deepEqual(rows.map((p: any) => [p.user_id, p.rail_option, p.record_ref, p.kind, p.status, p.usage_log_id, p.payload.field, p.payload.prior]),
    [[11, OPTION, 'mvp_features:81', 'proposal', 'proposed', 9, 'hypothesis_id', null], [11, OPTION, 'mvp_features:81', 'proposal', 'proposed', 9, 'pain_group_id', null]]);
  assert.deepEqual(f.features(), before, 'Save is the only write: the run wrote no record');
});

test('who may run: a writer in their own session, on their venture, an existing record of it, a form FILL_FIELDS knows', async () => {
  const f = fixture();
  assert.equal((await f.runForm(22, {})).status, 403, 'another founder');
  assert.equal((await f.runForm(33, {})).status, 403, 'an advisor reads, never fills');
  assert.equal((await f.runForm(11, {}, true)).body.error, 'support_session_refused');
  assert.equal((await f.runForm(11, { option: 'explain:zone' })).body.error, 'unknown_handler');
  assert.equal((await f.runForm(11, { option: 'form:nope' })).body.error, 'unknown_form');
  assert.equal((await f.runForm(11, { record: { type: 'mvp_features', id: 999 } })).body.error, 'record_not_found');
  assert.equal((await f.runForm(11, { record: { type: 'projects', id: 701 } })).body.error, 'record_not_found');
  assert.equal((await f.runForm(11, { input: { values: { title: 'a', pain_group_id: 51, hypothesis_id: 61, effort: 'M' } } })).body.error, 'nothing_to_fill');
  assert.equal((await f.runForm(11, { page: 'Founder · Grow · Revenue and traction', option: 'form:kpi' })).body.error, 'nothing_to_fill', 'a measured field is never asked');
  assert.equal(f.proposals().length, 0);
});

test('the switch: a page with AI off is refused as assist_off before anything runs or is held', async () => {
  let ran = 0;
  const f = fixture(async () => { ran += 1; return { ok: true }; }, quoteRun);
  f.db.exec(`INSERT INTO ai_rail_preferences(uid, user_id, section, task, model, mode) VALUES ('pref-1', 11, '${SD.toLowerCase()}', '', NULL, 'manual')`);
  const r = await f.runForm(11, {});
  assert.deepEqual(r.events.map((e) => e.event), ['done']);
  assert.equal(r.done.refusal.code, 'assist_off');
  assert.equal(r.done.refusal.status, 403);
  assert.equal(ran, 0, 'the model is never called');
  assert.equal(f.proposals().length, 0);
});

test('every guard and budget refusal ends the run in its own words, proposing nothing', async () => {
  const budget = ['budget_user_day', 'budget_user_month', 'budget_org_month', 'budget_review', 'kill_switch', 'spend_limit'];
  for (const refusal of budget) {
    const f = fixture(async () => ({ ok: false, refusal, error: 'Your monthly limit of $5.00 is reached until 1 Nov.' }));
    const r = await f.runForm(11, {});
    assert.equal(r.done.refusal.code, refusal);
    assert.equal(r.done.refusal.status, 402);
    assert.equal(r.done.refusal.message, refusal === 'spend_limit' ? 'Your monthly limit of $5.00 is reached until 1 Nov.' : budgetRefusalMessage(refusal), refusal);
    assert.equal(f.proposals().length, 0, refusal);
  }
  for (const [refusal, status, where] of [['guard_blocked', 422, 'block'], ['guard_blocked_output', 422, 'pass'], ['guard_unavailable', 503, 'fail']] as const) {
    const f = fixture(async () => ({ ok: false, refusal, error: 'Eadwyn cannot help with that.', guard: { input: where, output: refusal === 'guard_blocked_output' ? 'block' : 'none', codes: [], calls: 1 } }));
    const r = await f.runForm(11, {});
    assert.deepEqual(r.events.map((e) => e.event), ['meta', 'guard', 'done'], refusal);
    assert.equal(r.done.refusal.code, refusal);
    assert.equal(r.done.refusal.status, status);
    assert.equal(f.proposals().length, 0);
  }
  // A refusal at the quote (a stale model pick) is the run's own too.
  const stale = fixture(answer({ fields: [] }), async () => ({ ok: false, refusal: 'model_not_offered', error: 'x is not offered' }));
  assert.equal((await stale.runForm(11, {})).done.refusal.code, 'model_not_offered');
});

test('a changed form drops the result: a record written during the run is never proposed over', async () => {
  let f: any;
  f = fixture(async () => {
    f.db.exec('UPDATE mvp_features SET hypothesis_id = 61 WHERE id = 81');
    return answer({ fields: [{ field: 'hypothesis_id', value: 61 }] })();
  });
  const r = await f.runForm(11, { record: { type: 'mvp_features', id: 81 } });
  assert.deepEqual(r.done.dropped, [{ field: '', why: 'record_changed' }]);
  assert.deepEqual(r.done.proposals, []);
  assert.equal(f.proposals().length, 0);
});

// ── After Save: the record ─────────────────────────────────────────────────

test('record: after the Save, only fields equal to what was proposed are kept, each with its provenance, source and prior value', async () => {
  const f = fixture(answer({ fields: [{ field: 'pain_group_id', value: 51 }, { field: 'hypothesis_id', value: 61 }] }));
  const r = await f.runForm(11, { record: { type: 'mvp_features', id: 81 } });
  const uid = Object.fromEntries(r.done.proposals.map((p: any) => [p.field, p.uid]));
  // The form's own Save: the pain theme as proposed; the founder cleared the hypothesis before saving.
  f.db.exec('UPDATE mvp_features SET pain_group_id = 51, hypothesis_id = NULL WHERE id = 81');
  const out = await f.call(11, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 81, proposals: [uid.pain_group_id, uid.hypothesis_id] });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.outcomes.map((o: any) => [o.field, o.outcome, o.why ?? null]),
    [['pain_group_id', 'kept', null], ['hypothesis_id', 'not_kept', 'changed_before_save']]);
  const prov = f.db.prepare('SELECT target_column, written_value, edited, source_kind, prior_value, ai_proposal_id, decided_by FROM fill_provenance ORDER BY id').all();
  assert.deepEqual(prov.map((p: any) => [p.target_column, p.written_value, p.source_kind, p.prior_value, p.decided_by, !!p.ai_proposal_id]),
    [['pain_group_id', '51', 'eadwyn', null, 11, true]]);
  assert.deepEqual(f.proposals().map((p: any) => [p.payload.field, p.status]), [['pain_group_id', 'accepted'], ['hypothesis_id', 'discarded']]);
  // Each uid is decided once.
  const again = await f.call(11, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 81, proposals: [uid.pain_group_id] });
  assert.deepEqual(again.body.outcomes.map((o: any) => o.why), ['decided']);
});

test('record refuses another member\'s proposal, another venture, a never-fill field, and a support session', async () => {
  const f = fixture();
  f.db.exec(`
    INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status) VALUES
      ('p-theirs-0001',22,'${SD}','${OPTION}',NULL,'proposal','{"field":"effort","value":"M","project":701}','proposed'),
      ('p-elsewhere-01',11,'${SD}','${OPTION}',NULL,'proposal','{"field":"effort","value":"M","project":702}','proposed'),
      ('p-signature-01',11,'${SD}','${OPTION}',NULL,'proposal','{"field":"signature","value":"Ana","project":701}','proposed'),
      ('p-measured-01',11,'${SD}','${OPTION}',NULL,'proposal','{"field":"value","value":"9","project":701}','proposed');
  `);
  const out = await f.call(11, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 81, proposals: ['p-theirs-0001', 'p-elsewhere-01', 'p-signature-01', 'p-measured-01'] });
  assert.deepEqual(out.body.outcomes.map((o: any) => o.why), ['not_found', 'other_venture', 'never_fill', 'not_offered']);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM fill_provenance').get().n, 0);
  assert.equal((await f.call(22, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 81, proposals: ['p-theirs-0001'] })).status, 403);
  assert.equal((await f.call(11, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 81, proposals: ['p-theirs-0001'] }, true)).body.error, 'support_session_refused');
  assert.equal((await f.call(11, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 9999, proposals: ['p-theirs-0001'] })).body.error, 'record_not_found');
});

// ── Accept all ─────────────────────────────────────────────────────────────

test('Accept all: row proposals through the form\'s own writer, each outcome reported, at most 50', async () => {
  const f = fixture(answer({ rows: [
    { title: 'Crew slot booking', effort: 'low', pain_group_id: 51 },
    { title: 'Reminder texts', hypothesis_id: 61 },
    { effort: 'high' },
    { title: 'Theirs', pain_group_id: 52 },
  ] }));
  const r = await f.runForm(11, { input: { rows: 5 } });
  assert.equal(r.done.proposals.length, 3, 'a row with no title is dropped');
  assert.deepEqual(r.done.dropped.map((d: any) => [d.field, d.why, d.row]), [['title', 'empty', 2], ['pain_group_id', 'unmatched', 3]], 'another venture\'s pain theme is never linked');
  assert.deepEqual(r.done.proposals[2].row, { title: 'Theirs' });
  const uids = r.done.proposals.map((p: any) => p.uid);
  const out = await f.call(11, 'POST', '/api/fills/rows/accept', { page: SD, form: 'feature', project: 701, proposals: [...uids, 'missing-uid-01'] });
  assert.deepEqual(out.body.outcomes.map((o: any) => [o.outcome, o.why ?? null]), [['created', null], ['created', null], ['created', null], ['refused', 'not_found']]);
  const made = f.features().filter((x: any) => x.id !== 81);
  assert.deepEqual(made.map((x: any) => [x.title, x.effort, x.pain_group_id, x.hypothesis_id]), [['Crew slot booking', 'S', 51, null], ['Reminder texts', 'M', null, 61], ['Theirs', 'M', null, null]]);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'build_feature_created'").get().n, 3, 'the writer\'s own activity line');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM fill_provenance WHERE source_kind = 'eadwyn' AND target_table = 'mvp_features'").get().n, 6);
  // A second Accept all creates nothing twice.
  const again = await f.call(11, 'POST', '/api/fills/rows/accept', { page: SD, form: 'feature', project: 701, proposals: uids });
  assert.deepEqual(again.body.outcomes.map((o: any) => o.why), ['decided', 'decided', 'decided']);
  // A row naming another venture's record, stored by hand, is refused and put back, writing nothing.
  f.db.exec(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status) VALUES ('row-bad-0001',11,'${SD}','${OPTION}',NULL,'proposal','{"row":{"title":"X","pain_group_id":52},"table":"mvp_features","project":701}','proposed')`);
  const bad = await f.call(11, 'POST', '/api/fills/rows/accept', { page: SD, form: 'feature', project: 701, proposals: ['row-bad-0001'] });
  assert.deepEqual(bad.body.outcomes.map((o: any) => o.why), ['unmatched']);
  assert.equal(f.proposals().find((p: any) => p.uid === 'row-bad-0001').status, 'proposed', 'put back for the member to decide');

  // At most 50: the rest are reported, untouched.
  const many = fixture();
  const ins = many.db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status) VALUES (?,11,'${SD}','${OPTION}',NULL,'proposal',?,'proposed')`);
  const all = Array.from({ length: ACCEPT_ALL_MAX + 3 }, (_, i) => { const u = `row-uid-${String(i).padStart(4, '0')}`; ins.run(u, JSON.stringify({ row: { title: `F${i}` }, table: 'mvp_features', project: 701 })); return u; });
  const big = await many.call(11, 'POST', '/api/fills/rows/accept', { page: SD, form: 'feature', project: 701, proposals: all });
  assert.equal(big.body.outcomes.length, ACCEPT_ALL_MAX);
  assert.ok(big.body.outcomes.every((o: any) => o.outcome === 'created'));
  assert.deepEqual(big.body.over_limit, all.slice(ACCEPT_ALL_MAX));
  assert.equal(many.features().length, 1 + ACCEPT_ALL_MAX);
  assert.equal(many.db.prepare("SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE status = 'proposed'").get().n, 3);
});

// ── Undo ───────────────────────────────────────────────────────────────────

test('undo puts back the prior value only while the field holds the fill, and records who and when', async () => {
  const f = fixture(answer({ fields: [{ field: 'pain_group_id', value: 51 }, { field: 'hypothesis_id', value: 61 }] }));
  f.db.exec('UPDATE mvp_features SET hypothesis_id = NULL WHERE id = 81');
  const r = await f.runForm(11, { record: { type: 'mvp_features', id: 81 } });
  const uid = Object.fromEntries(r.done.proposals.map((p: any) => [p.field, p.uid]));
  f.db.exec('UPDATE mvp_features SET pain_group_id = 51, hypothesis_id = 61 WHERE id = 81');
  const kept = (await f.call(11, 'POST', '/api/fills/record', { page: SD, form: 'feature', project: 701, record: 81, proposals: [uid.pain_group_id, uid.hypothesis_id] })).body.outcomes;
  const pid = Object.fromEntries(kept.map((o: any) => [o.field, o.provenance_id]));
  assert.equal((await f.call(22, 'POST', `/api/fills/${pid.pain_group_id}/undo`)).status, 404, 'another founder\'s fill reads as none');
  assert.equal((await f.call(33, 'POST', `/api/fills/${pid.pain_group_id}/undo`)).status, 404, 'an advisor reads, never undoes');
  assert.equal((await f.call(11, 'POST', `/api/fills/${pid.pain_group_id}/undo`, undefined, true)).body.error, 'support_session_refused');
  const ok = await f.call(11, 'POST', `/api/fills/${pid.pain_group_id}/undo`);
  assert.deepEqual([ok.status, ok.body.value], [200, null]);
  assert.equal((f.db.prepare('SELECT pain_group_id FROM mvp_features WHERE id = 81').get() as any).pain_group_id, null);
  const row = f.db.prepare('SELECT undone_at, undone_by FROM fill_provenance WHERE id = ?').get(pid.pain_group_id) as any;
  assert.ok(row.undone_at);
  assert.equal(row.undone_by, 11);
  assert.equal((await f.call(11, 'POST', `/api/fills/${pid.pain_group_id}/undo`)).body.error, 'already_undone');
  // An edited field is the member's: undo refuses it and writes nothing.
  f.db.exec('UPDATE mvp_features SET hypothesis_id = NULL WHERE id = 81');
  const edited = await f.call(11, 'POST', `/api/fills/${pid.hypothesis_id}/undo`);
  assert.deepEqual([edited.status, edited.body.error], [409, 'edited']);
  assert.equal((f.db.prepare('SELECT hypothesis_id FROM mvp_features WHERE id = 81').get() as any).hypothesis_id, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'fill_undone'").get().n, 1);
});

test('undo of a field a writer never leaves blank: nothing to put back on an Add, the prior value on an edit', async () => {
  const f = fixture(answer({ rows: [{ title: 'Crew slot booking', effort: 'high' }] }));
  const r = await f.runForm(11, { input: { rows: 1 } });
  const made = (await f.call(11, 'POST', '/api/fills/rows/accept', { page: SD, form: 'feature', project: 701, proposals: [r.done.proposals[0].uid] })).body.outcomes[0].id;
  const prov = Object.fromEntries((f.db.prepare('SELECT id, target_column FROM fill_provenance WHERE target_row_id = ?').all(made) as any[]).map((p) => [p.target_column, p.id]));
  assert.equal((await f.call(11, 'POST', `/api/fills/${prov.title}/undo`)).body.error, 'no_prior', 'a feature always has a title');
  f.db.exec(`UPDATE fill_provenance SET prior_value = 'M' WHERE id = ${prov.effort}`);
  assert.equal((await f.call(11, 'POST', `/api/fills/${prov.effort}/undo`)).body.value, 'M');
  assert.equal((f.db.prepare('SELECT effort FROM mvp_features WHERE id = ?').get(made) as any).effort, 'M');
});
