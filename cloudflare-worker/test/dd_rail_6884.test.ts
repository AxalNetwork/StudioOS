/** D6884 — real authenticated rail + canonical SQLite, adversarial scopes, private proposals and metered holds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { ddRailRunRoutes, mount, searchDdRoom } from '../src/routes/dd_rail_run.ts';
import legacyRailRun, { railRunRoutes } from '../src/routes/rail_run.ts';
import { attachRouteRegistry } from '../src/util/routeRegistry.ts';
import { DD_OPTIONS, DD_PAGE, ddDrafts, ddInput, identityScrubber } from '../src/services/ddRail.ts';
import { encField } from '../src/services/dueDiligence.ts';
import { getRail, decideRail } from '../src/services/railProposals.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';

const schema = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const rows = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[];
  db.close();
  return rows.map(r => r.sql);
})();
const secret = crypto.randomUUID();
const EMAIL = 'subject-canary@example.test', NAME = 'Synthetic Identity Canary';
const draft = (sources = ['item:1'], text = 'Recorded evidence needs clarification.') => JSON.stringify({ drafts: [{ text, sources }] });
const quote = async () => ({ ok: true, model: 'synthetic-model', hold_microusd: 100 });
async function world(opts: { real?: boolean; guard?: string } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  for (const ddl of schema) db.exec(ddl);
  const users = [[1, 'admin'], [2, 'partner'], [3, 'partner'], [4, 'partner'], [5, 'advisor'], [6, 'investor'], [7, 'founder'], [8, 'founder']] as const;
  for (const [id, role] of users) {
    db.prepare('INSERT INTO users(id,email,name,role,is_active) VALUES(?,?,?,?,1)').run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role);
    db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(id);
  }
  db.exec(`INSERT INTO founders(id,name,email) VALUES(1,'Synthetic Founder','synthetic7@example.test'),(2,'Other Founder','synthetic8@example.test');
    UPDATE users SET founder_id=1 WHERE id=7; UPDATE users SET founder_id=2 WHERE id=8;
    INSERT INTO projects(id,uid,name,founder_id) VALUES(10,'own-project','Own venture',1),(20,'other-project','Other venture',2);
    INSERT INTO dd_cases(id,uid,subject_type,subject_id,subject_label,owner_user_id,lead_user_id,status) VALUES
      (1,'own-case','project',10,'Synthetic Venture',3,2,'in_review'),(2,'other-case','project',20,'Other venture',6,6,'in_review');
    INSERT INTO dd_sections(id,case_id,section_key,title,status,blocking) VALUES
      (1,1,'corporate_legal','Own corporate section','in_review',1),(2,1,'market','PRIVATE OTHER SECTION','pending',0),(3,2,'corporate_legal','OTHER CASE SECTION','pending',1);
    INSERT INTO dd_reviewers(case_id,section_id,user_id,role) VALUES(1,1,4,'reviewer'),(1,1,5,'observer');
    INSERT INTO dd_checklist_items(id,case_id,section_id,item_key,title,status) VALUES
      (1,1,1,'corporate_legal.ip','Own item','flag'),(2,1,2,'market.sales','PRIVATE OTHER ITEM','pending'),(3,2,3,'corporate_legal.ip','OTHER CASE ITEM','flag');
    INSERT INTO dd_findings(id,case_id,section_id,source_kind,severity,title,state) VALUES
      (1,1,1,'manual','high','Own flag','open'),(2,1,2,'manual','high','PRIVATE OTHER FLAG','open'),(3,2,3,'manual','high','OTHER CASE FLAG','open');
    INSERT INTO dd_requests(id,case_id,section_id,title,details,state) VALUES(1,1,1,'Send the assignment','A copy of the assignment','requested'),(2,2,3,'Other request','OTHER REQUEST','requested');
    INSERT INTO dd_case_memos(id,uid,case_id,updated_by) VALUES(1,'memo-one',1,2);
    INSERT INTO data_room_files(id,uid,project_id,name,r2_key) VALUES(1,'own-file',10,'Assignment','synthetic-own'),(2,'foreign-file',20,'FOREIGN FILE','synthetic-other');`);
  db.prepare('INSERT INTO data_room_passages(project_id,file_id,seq,text,vector_id) VALUES(10,1,0,?,?)').run(`ROOM PASSAGE ${NAME} ${EMAIL}`, 'drf:1:0');
  db.exec("INSERT INTO data_room_passages(project_id,file_id,seq,text,vector_id) VALUES(20,2,0,'FOREIGN PASSAGE','drf:2:0')");
  const seen: any[] = [], searches: any[] = [], quotes: any[] = [], reads: string[] = [], writes: string[] = [];
  const binding = d1Over(db);
  const env: any = { DB: { ...binding, prepare(sql: string) { (/^\s*(SELECT|WITH)\b/i.test(sql) ? reads : writes).push(sql); return binding.prepare(sql); } }, JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const encrypt = async (table: string, column: string, id: number, text: string) => encField(env, table, column, id, text);
  db.prepare('UPDATE dd_cases SET subject_email_enc=?,subject_legal_name_enc=? WHERE id=1').run(await encrypt('dd_cases','subject_email',1,EMAIL), await encrypt('dd_cases','subject_legal_name',1,NAME));
  db.prepare('UPDATE dd_findings SET detail_enc=?,evidence_excerpt_enc=?,subject_name_enc=? WHERE id=1').run(
    await encrypt('dd_findings','detail',1,`FLAG DETAIL ${NAME} ${EMAIL}`), await encrypt('dd_findings','evidence_excerpt',1,'Recorded assignment is unsigned.'), await encrypt('dd_findings','subject_name',1,NAME));
  db.prepare('UPDATE dd_sections SET reviewer_notes_enc=? WHERE id=1').run(await encrypt('dd_sections','reviewer_notes',1,`OWN NOTES ${NAME}`));
  db.prepare('UPDATE dd_checklist_items SET note_enc=? WHERE id=1').run(await encrypt('dd_checklist_items','note',1,`OWN ITEM NOTES ${EMAIL}`));
  db.prepare('UPDATE dd_case_memos SET summary_enc=? WHERE id=1').run(await encrypt('dd_case_memos','summary',1,'PRIVATE MEMO'));
  let output = draft(), hook: (() => void) | null = null;
  let snippet = `ROOM PASSAGE ${NAME} ${EMAIL}`;
  const transport = withGuard({ run: async (_model: string, input: any) => { seen.push(input); hook?.(); return { response: output, usage: { prompt_tokens: 200, completion_tokens: 100 } }; } }, opts.guard ?? 'safe');
  env.AI = transport;
  const app = new Hono<any>();
  const injected: any = opts.real ? {} : { quote: async (_env: any, input: any) => { quotes.push(input); return quote(); }, run: async (_env: any, input: any) => { seen.push(input); hook?.(); return { ok: true, output, usage: { model: 'synthetic-model' } }; } };
  app.route('/api/ai/rail', ddRailRunRoutes({ ...injected, search: async (_env: any, user: number, project: number, query: string) => {
    searches.push({ user, project, query });
    return { available: true, value: { hits: [{ file_uid: 'own-file', file_name: 'Assignment', snippet, score: 1 }, { file_uid: 'foreign-file', file_name: 'FOREIGN FILE', snippet: 'FOREIGN PASSAGE', score: 1 }] } };
  } }));
  app.route('/api/ai/rail', railRunRoutes(injected));
  const call = async (who: number | null, option: string = 'dd:summary', extra: any = {}) => {
    const token = who === null ? null : await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const res = await app.request('/api/ai/rail/run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ page: DD_PAGE, option, case_uid: 'own-case', ...extra }) }, env);
    const raw = await res.text();
    const events = raw.startsWith('event:') ? Object.fromEntries(raw.trim().split('\n\n').map(s => { const [event, data] = s.split('\n'); return [event.slice(7), JSON.parse(data.slice(6))]; })) : {};
    return { status: res.status, body: events.done ?? JSON.parse(raw), events, raw };
  };
  const close = () => db.close();
  return { db, env, seen, reads, writes, searches, quotes, call, close, output: (s: string) => { output = s; }, hook: (fn: () => void) => { hook = fn; }, passage: (text: string) => { db.prepare('UPDATE data_room_passages SET text=? WHERE file_id=1').run(text); snippet = text.slice(0,320); } };
}
const ddState = (w: any) => JSON.stringify(['dd_cases','dd_sections','dd_checklist_items','dd_findings','dd_requests','dd_case_memos','dd_audit_log','dd_attachments'].map(t => w.db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));

for (const option of DD_OPTIONS) test(`${option}: outside-case and unsigned callers are refused before quote, retrieval or model`, async t => {
  const w = await world(); t.after(w.close);
  const extra = { section_id: 1, request_id: 1 };
  const outsider = await w.call(6, option, extra);
  assert.equal(outsider.status, 403);
  const anonymous = await w.call(null, option, extra);
  assert.equal(anonymous.status, 401);
  assert.equal(w.seen.length, 0);
  assert.equal(w.searches.length, 0);
  assert.equal(w.quotes.length, 0);
  assert.equal(w.db.prepare('SELECT count(*) AS n FROM ai_budget_reservations').get().n, 0);
});

for (const option of DD_OPTIONS.filter(o => o !== 'dd:summary')) test(`observer cannot use ${option}`, async t => {
  const w = await world(); t.after(w.close);
  const result = await w.call(5, option, { section_id: 1, request_id: 1 });
  assert.equal(result.status, 403);
  assert.equal(w.seen.length, 0);
  assert.equal(w.reads.some(q => q.includes('FROM dd_case_memos')), false);
});

test('reviewer and observer summaries read their section only; encrypted detail is scrubbed before guard and model', async t => {
  const w = await world(); t.after(w.close);
  for (const who of [4,5]) {
    const result = await w.call(who);
    assert.equal(result.body.proposals.length, 1);
    const prompt = JSON.stringify(w.seen.at(-1));
    assert.match(prompt, /FLAG DETAIL/);
    assert.match(prompt, /OWN NOTES/);
    assert.doesNotMatch(prompt, /PRIVATE OTHER|OTHER CASE|PRIVATE MEMO/);
    assert.doesNotMatch(prompt, new RegExp(`${EMAIL}|${NAME}`));
    assert.match(prompt, /BEGIN_RECORD_TEXT_UNTRUSTED_/);
    assert.equal(w.reads.some(q => q.includes('FROM dd_case_memos')), false);
  }
  assert.equal((await w.call(4, 'dd:summary', { section_id: 2 })).status, 403);
  assert.equal((await w.call(4, 'dd:memo_draft')).status, 403);
});

test('all five options create only user-private proposals, and the keep never publishes a case note', async t => {
  const w = await world(); t.after(w.close);
  const before = ddState(w);
  const scenarios = [
    { who: 2, option: 'dd:summary', output: draft() },
    { who: 3, option: 'dd:request_drafts', output: JSON.stringify({ drafts: [{ text: 'Please send the assignment.', sources: ['item:1'] }, { text: 'Please send the sales record.', sources: ['item:2'] }] }) },
    { who: 1, option: 'dd:memo_draft', output: JSON.stringify({ drafts: ['summary','verified','on_trust','conditions'].map(part => ({ part, text: 'Recorded evidence.', sources: ['flag:1'] })) }) },
    { who: 4, option: 'dd:section_summary', output: draft(['section:1']) },
    { who: 7, option: 'dd:answer_from_room', output: draft(['request:1','passage:0']) },
  ];
  for (const s of scenarios) {
    w.output(s.output);
    const result = await w.call(s.who, s.option, { section_id: s.option === 'dd:section_summary' ? 1 : undefined, request_id: 1, text: `FOUNDER ANSWER ${EMAIL} ${NAME}` });
    assert.equal(result.status, 200);
    assert.ok(result.body.proposals.length > 0, result.raw);
    const p = result.body.proposals[0];
    assert.equal(p.visibility, 'private');
    assert.equal(await getRail(w.env, 6, p.uid), null);
    assert.equal((await decideRail(w.env, s.who, p.uid, 'accept'))?.status, 'accepted');
    assert.equal(ddState(w), before);
    assert.doesNotMatch(JSON.stringify(w.seen.at(-1)), new RegExp(`${EMAIL}|${NAME}`));
    assert.doesNotMatch(JSON.stringify(w.seen.at(-1)), /OTHER CASE|OTHER REQUEST/);
  }
  assert.equal(w.writes.some(q => /\b(INSERT INTO|UPDATE|DELETE FROM)\s+dd_/i.test(q)), false);
});

test('memo is admitted to admin, lead and opener only and all four bounded parts carry revision and count', async t => {
  const w = await world(); t.after(w.close);
  w.output(JSON.stringify({ drafts: ['summary','verified','on_trust','conditions'].map(part => ({ part, text: 'x'.repeat(8000), sources: ['flag:1'] })) }));
  for (const who of [1,2,3]) {
    const result = await w.call(who, 'dd:memo_draft');
    assert.equal(result.body.proposals.length, 4);
    assert.equal(result.body.proposals[0].characters, 8000);
    assert.equal(result.body.proposals[0].max_characters, 8000);
    assert.match(JSON.stringify(w.seen.at(-1)), /PRIVATE MEMO/);
  }
  w.output(JSON.stringify({ drafts: ['summary','verified','on_trust','conditions'].map(part => ({ part, text: 'x'.repeat(8001), sources: ['flag:1'] })) }));
  assert.equal((await w.call(2, 'dd:memo_draft')).body.dropped[0]?.why, 'invalid_draft');
});

test('request drafts see only target titles and reject missing, duplicate or foreign citations', async t => {
  const w = await world(); t.after(w.close);
  w.output(JSON.stringify({ drafts: [{ text: 'Please send the assignment.', sources: ['item:1'] }, { text: 'Please send the sales record.', sources: ['item:2'] }] }));
  assert.equal((await w.call(2,'dd:request_drafts')).body.proposals.length, 2);
  assert.doesNotMatch(w.seen.at(-1).messages[1].content, /FLAG DETAIL|PRIVATE MEMO|OWN NOTES|OWN ITEM NOTES|high|severity/);
  for (const output of [draft(['item:1']), draft(['item:3']), JSON.stringify({ drafts: [{ text: 'a', sources: ['item:1'] }, { text: 'b', sources: ['item:1'] }] })]) {
    w.output(output);
    assert.equal((await w.call(2,'dd:request_drafts')).body.proposals.length, 0);
  }
});

test('section verdict note needs a real NDA and never accepts a verdict recommendation', async t => {
  const w = await world(); t.after(w.close);
  assert.equal((await w.call(4,'dd:section_summary',{ section_id: 1, mode: 'verdict_note', nda_signed: true })).status, 412);
  assert.equal(w.seen.length, 0);
  w.db.exec("INSERT INTO dd_attachments(case_id,section_id,filename,file_key,uploaded_by_user_id) VALUES(1,1,'other-nda.pdf','synthetic-other-nda',5)");
  assert.equal((await w.call(4,'dd:section_summary',{ section_id: 1, mode: 'verdict_note' })).status, 412);
  w.db.exec("INSERT INTO dd_attachments(case_id,section_id,filename,file_key,mime_type,size_bytes,uploaded_by_user_id) VALUES(1,1,'nda.pdf','synthetic-nda','application/pdf',100,4)");
  w.output(draft(['section:1'], 'The assignment is recorded as unsigned.'));
  assert.equal((await w.call(4,'dd:section_summary',{ section_id: 1, mode: 'verdict_note' })).body.proposals.length, 1);
  w.output(draft(['section:1'], 'I recommend Proceed.'));
  assert.equal((await w.call(4,'dd:section_summary',{ section_id: 1, mode: 'verdict_note' })).body.proposals.length, 0);
});

test('founder answers use their addressed request and matched own-room passages only', async t => {
  const w = await world(); t.after(w.close);
  w.output(draft(['request:1','passage:0']));
  const result = await w.call(7,'dd:answer_from_room',{ request_id: 1, text: `My proposed answer ${NAME} ${EMAIL}` });
  assert.equal(result.body.proposals.length, 1);
  assert.deepEqual(w.searches, [{ user: 7, project: 10, query: 'My proposed answer [identity withheld] [identity withheld]' }]);
  assert.doesNotMatch(JSON.stringify(w.seen), /PRIVATE OTHER|FOREIGN|FLAG DETAIL|PRIVATE MEMO|OWN NOTES/);
  assert.equal(result.body.proposals[0].citations[1].file_uid, 'own-file');
  assert.doesNotMatch(result.body.proposals[0].citations[1].passage, new RegExp(`${EMAIL}|${NAME}`));
  assert.equal((await w.call(8,'dd:answer_from_room',{ request_id: 1 })).status, 403);
  assert.equal((await w.call(7,'dd:answer_from_room',{ request_id: 2 })).status, 404);
});

test('an untouched case has no model call, fabricated risk or token hold', async t => {
  const w = await world(); t.after(w.close);
  w.db.exec('DELETE FROM dd_findings; DELETE FROM dd_case_memos; DELETE FROM dd_requests; UPDATE dd_sections SET reviewer_notes_enc=NULL,verdict=NULL,status=\'pending\'; UPDATE dd_checklist_items SET note_enc=NULL,status=\'pending\'');
  const result = await w.call(2);
  assert.equal(result.body.message, 'Nothing to summarise yet');
  assert.deepEqual(result.body.risk, { state: 'not_recorded', label: 'Not recorded' });
  assert.equal(w.seen.length, 0);
});

test('revoked case access and evidence changes during a run drop the result without writing diligence', async t => {
  const w = await world(); t.after(w.close);
  w.hook(() => w.db.exec('DELETE FROM dd_reviewers WHERE user_id=4'));
  assert.equal((await w.call(4)).body.dropped[0]?.why, 'access_changed');
  w.hook(() => w.db.exec("UPDATE dd_checklist_items SET status='pass' WHERE id=1"));
  assert.equal((await w.call(2)).body.dropped[0]?.why, 'record_changed');
  assert.equal(w.db.prepare('SELECT count(*) AS n FROM ai_rail_proposals').get().n, 0);
});

test('a withdrawn request or changed matched passage drops a founder draft after the model returns', async t => {
  const w = await world(); t.after(w.close);
  w.output(draft(['passage:0']));
  w.hook(() => w.db.exec("UPDATE dd_requests SET withdrawn_at='2026-11-16 11:00:00' WHERE id=1"));
  assert.equal((await w.call(7,'dd:answer_from_room',{ request_id: 1 })).body.dropped[0]?.why, 'access_changed');
  w.db.exec('UPDATE dd_requests SET withdrawn_at=NULL WHERE id=1');
  w.hook(() => w.db.exec("UPDATE data_room_passages SET text='A different passage' WHERE file_id=1"));
  assert.equal((await w.call(7,'dd:answer_from_room',{ request_id: 1 })).body.dropped[0]?.why, 'record_changed');
});

test('missing room passages and corrupt encrypted evidence are unavailable or empty without invented output', async t => {
  const w = await world(); t.after(w.close);
  w.db.exec('DELETE FROM data_room_passages');
  const empty = await w.call(7,'dd:answer_from_room',{ request_id: 1 });
  assert.equal(empty.body.reason, 'no_matching_passages');
  assert.equal(w.seen.length, 0);
  w.db.exec("UPDATE dd_findings SET detail_enc='synthetic-invalid-ciphertext' WHERE id=1");
  const unavailable = await w.call(2);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'dd_unreadable');
  assert.match(unavailable.body.detail, /unavailable/);
  assert.equal(w.quotes.length, 0);
});

test('identity redaction happens before serialisation, including quoted names and model output', async t => {
  const w = await world(); t.after(w.close);
  const name = 'Synthetic "CANARY_QUOTED_TOKEN" Person';
  const cipher = await encField(w.env,'dd_cases','subject_legal_name',1,name);
  w.db.prepare('UPDATE dd_cases SET subject_legal_name_enc=? WHERE id=1').run(cipher);
  const note = await encField(w.env,'dd_checklist_items','note',1,`Assignment for ${name}`);
  w.db.prepare('UPDATE dd_checklist_items SET note_enc=? WHERE id=1').run(note);
  w.output(draft(['item:1'],`Recorded for ${name} ${EMAIL}`));
  const result = await w.call(4);
  assert.equal(result.body.proposals.length, 1);
  assert.doesNotMatch(JSON.stringify(w.seen), /CANARY_QUOTED_TOKEN/);
  assert.doesNotMatch(result.raw, /CANARY_QUOTED_TOKEN|subject-canary/);
  assert.match(result.body.proposals[0].text, /identity withheld/);
});

for (const option of DD_OPTIONS) test(`${option}: real aiRouter settles the caller hold, attributes spend, and refunds a guard refusal`, async t => {
  const success = await world({ real: true }); t.after(success.close);
  const who = option === 'dd:answer_from_room' ? 7 : 2;
  const output = option === 'dd:memo_draft' ? JSON.stringify({ drafts: ['summary','verified','on_trust','conditions'].map(part => ({ part, text: 'Recorded evidence.', sources: ['flag:1'] })) })
    : option === 'dd:request_drafts' ? JSON.stringify({ drafts: [{ text: 'Send assignment.', sources: ['item:1'] }, { text: 'Send sales record.', sources: ['item:2'] }] })
    : option === 'dd:answer_from_room' ? draft(['passage:0']) : draft();
  success.output(output);
  const result = await success.call(who, option, { section_id: option === 'dd:section_summary' ? 1 : undefined, request_id: 1 });
  assert.ok(result.body.proposals.length > 0, result.raw);
  const holds = success.db.prepare('SELECT * FROM ai_budget_reservations WHERE user_id=?').all(who) as any[];
  assert.ok(holds.some(h => h.status === 'settled'));
  assert.equal(holds.some(h => h.status === 'pending'), false);
  const usage = success.db.prepare('SELECT * FROM ai_usage_logs WHERE id=?').get(result.body.usage_log_id) as any;
  assert.equal(usage.user_id, who);
  assert.equal(usage.rail_page, DD_PAGE);
  assert.equal(usage.rail_option, option);
  assert.equal(result.body.charged_microusd, usage.charged_microusd);
  const refused = await world({ real: true, guard: 'unsafe\nS1' }); t.after(refused.close);
  const no = await refused.call(who, option, { section_id: option === 'dd:section_summary' ? 1 : undefined, request_id: 1 });
  assert.equal(no.body.proposals.length, 0);
  assert.ok(no.body.refusal);
  assert.equal(refused.seen.length, 0);
  const noHolds = refused.db.prepare('SELECT status FROM ai_budget_reservations WHERE user_id=?').all(who) as any[];
  assert.ok(noHolds.some(h => h.status === 'refunded'));
  assert.equal(noHolds.some(h => ['pending','settled'].includes(h.status)), false);
});

test('data-room embedding and reranking redact identities before the real metered router sees them', async t => {
  const w = await world({ real: true }); t.after(w.close);
  const seen: any[] = [];
  w.env.DATAROOM_INDEX = { query: async () => ({ matches: [{ id: 'drf:1:0', score: 1 }] }) };
  w.env.AI = withGuard({ run: async (model: string, input: any) => {
    seen.push({ model, input });
    if (model.includes('embedding')) return { data: [Array(1024).fill(0.1)], usage: { prompt_tokens: 20, completion_tokens: 0 } };
    return { response: [{ id: 0, score: 1 }], usage: { prompt_tokens: 20, completion_tokens: 5 } };
  } });
  const result = await searchDdRoom(w.env, 7, 10, `${NAME} ${EMAIL} assignment`, identityScrubber([NAME,EMAIL]));
  assert.equal(result.available, true);
  assert.ok(seen.length >= 2);
  assert.doesNotMatch(JSON.stringify(seen), new RegExp(`${NAME}|${EMAIL}`));
});

test('strict inputs, Unicode redaction, cited output and route precedence leave other rail options intact', async t => {
  const w = await world(); t.after(w.close);
  assert.throws(() => ddInput({ page: DD_PAGE, option: 'dd:summary', case_uid: "x' OR 1=1--" }));
  assert.throws(() => ddInput({ page: DD_PAGE, option: 'dd:summary', case_uid: 'own-case', section_id: '1' }));
  assert.equal(identityScrubber(['Synthetic Identity Canary'])('Ｓｙｎｔｈｅｔｉｃ　Ｉｄｅｎｔｉｔｙ　Ｃａｎａｒｙ'), '[identity withheld]');
  const invalid = ddDrafts(draft(['flag:99']), { sources: [{ id: 'flag:1', kind: 'flag', text: 'Recorded flag' }], targets: [], revision: null, empty: false, risk: null, query: '', scrub: String }, { option: 'dd:summary', case_uid: 'x' });
  assert.deepEqual(invalid, []);
  const app = new Hono(); const registry = attachRouteRegistry(app, [{ file: 'dd_rail_run.ts', mount }]);
  app.route('/api/ai/rail', legacyRailRun); registry.mountRemaining();
  assert.equal(registry.mounted[0].file, 'dd_rail_run.ts');
  const legacy = await w.call(2, 'unhandled:option');
  assert.equal(legacy.status, 400);
  assert.equal((await w.call(2, 'form:unsupported')).status, 404);
});

test('a founder-only licence never admits the case-reader runs, even for an assigned opener', async t => {
  const w = await world(); t.after(w.close);
  w.db.exec('UPDATE dd_cases SET owner_user_id=7 WHERE id=1; INSERT INTO dd_reviewers(case_id,section_id,user_id) VALUES(1,1,7)');
  for (const option of DD_OPTIONS.filter(o => o !== 'dd:answer_from_room')) {
    assert.equal((await w.call(7,option,{ section_id: 1 })).status, 403);
  }
  assert.equal(w.quotes.length, 0);
  w.db.exec("UPDATE users SET role='advisor' WHERE id=7");
  assert.equal((await w.call(7,'dd:answer_from_room',{ request_id: 1 })).status, 403);
  // A second account on the same venture is still not the addressed subject.
  w.db.exec('UPDATE users SET founder_id=1 WHERE id=8');
  assert.equal((await w.call(8,'dd:answer_from_room',{ request_id: 1 })).status, 403);
});

test('short overlapping identity aliases do not reprocess the replacement marker', () => {
  assert.equal(identityScrubber(['i','identity','i'])('iii'), '[identity withheld][identity withheld][identity withheld]');
  assert.throws(() => ddInput({ page: DD_PAGE, option: 'dd:summary', case_uid: 123 }));
});

test('summary blocking facts reuse the existing Proceed gate rather than a model inference', async t => {
  const w = await world(); t.after(w.close);
  await w.call(2);
  const flag = () => JSON.parse(JSON.parse(w.seen.at(-1).messages[1].content.split('\n')[1]).sources.find((s: any) => s.id === 'flag:1').text);
  assert.equal(flag().blocks_proceed, true);
  w.db.exec("UPDATE dd_findings SET resolved_at='2026-11-16 11:00:00' WHERE id=1");
  await w.call(2);
  assert.equal(flag().blocks_proceed, false);
});

test('matched room passages use the search slice even when documents contain astral characters', async t => {
  const w = await world(); t.after(w.close);
  w.passage('📄'.repeat(200) + 'Recorded assignment');
  w.output(draft(['passage:0']));
  assert.equal((await w.call(7,'dd:answer_from_room',{ request_id: 1 })).body.proposals.length, 1);
});

test('the case page switch prevents drafting and paid retrieval for all five options', async t => {
  for (const option of DD_OPTIONS) {
    const w = await world(); t.after(w.close);
    const who = option === 'dd:answer_from_room' ? 7 : 2;
    w.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')").run(`off-${who}`, who, DD_PAGE.toLowerCase());
    const result = await w.call(who,option,{ section_id: option === 'dd:section_summary' ? 1 : undefined, request_id: 1 });
    assert.equal(result.body.refusal?.code, 'assist_off');
    assert.equal(w.seen.length, 0);
    assert.equal(w.quotes.length, 0);
    assert.equal(w.searches.length, 0);
  }
});
