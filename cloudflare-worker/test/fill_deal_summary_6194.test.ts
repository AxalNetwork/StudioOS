/**
 * #6194 — Deal notes' "Draft a deal summary": the deal note's fill scope asked
 * for a summary (`input.draft: 'deal_summary'`). It reads only what this
 * investor may read (the deal's terms as a Free reader sees them, the shared
 * evidence through `investorEvidence`, their own diligence case and their
 * firm's notes), names each source and its state, and keeps a longer body.
 * A second firm's notes and diligence never enter the draft; before the NDA
 * nothing behind it is read. The model and the quoter are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fill_deal_summary_6194.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import fills from '../src/routes/fills.ts';
import dealContext from '../src/routes/deal_context.ts';
import { railRunRoutes } from '../src/routes/rail_run.ts';
import { DEAL_SUMMARY_MAX, dealSummarySources } from '../src/services/fills/formRun.ts';

const SECRET = 'synthetic-fill-deal-summary-6194-'.repeat(3);
test.after(() => removeMigratedDatabases());

const DEAL_ROOM = 'Investor · Deals · Deal room';
type Run = (env: any, input: any) => Promise<any>;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// 41 and 42: investors at firm 1 (one link each); 43: investor at firm 2; 44: investor with no firm;
// 45: investor at firm 1 with no invitation; 46: investor at firms 1 and 2; 47: another investor with no firm;
// 11 founder; 51 admin (holding an invitation); 61 explorer.
function fixture(output: unknown = { fields: [] }) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),
      (41,'Investor A','a@example.test','investor',NULL,1),(42,'Colleague','b@example.test','investor',NULL,1),
      (43,'Other firm','c@example.test','investor',NULL,1),(44,'Solo','d@example.test','investor',NULL,1),
      (45,'Uninvited','e@example.test','investor',NULL,1),(46,'Two firms','g@example.test','investor',NULL,1),(47,'Solo two','s2@example.test','investor',NULL,1),
      (51,'Admin','h@example.test','admin',NULL,1),(61,'Explorer','x@example.test','exploring',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'cp1','Firm One'),(2,'cp2','Firm Two');
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',1,41),('l2',1,42),('l3',2,43),('l5',1,45),('l6',1,46),('l7',2,46);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (801,'v-acme','Acme Field',101);
    INSERT INTO deals(id,project_id,status,instrument,target_raise,currency,closing_deadline) VALUES (900,801,'scored','SAFE',2000000,'USD','2026-12-31');
    INSERT INTO deal_invitations(deal_id,investor_user_id,company_id,status) VALUES
      (900,41,1,'interested'),(900,42,1,'interested'),(900,43,2,'interested'),(900,44,NULL,'interested'),(900,46,NULL,'interested'),(900,47,NULL,'interested'),
      -- an admin who still holds an invitation from an investor seat: the role, not the invitation, refuses them.
      (900,51,NULL,'interested');
    INSERT INTO deal_notes(id,uid,deal_id,author_user_id,company_id,tag,body) VALUES
      (701,'n-1',900,41,1,'','Met the CTO; the pilot list is real.'),
      (702,'n-2',900,43,2,'','Other firm view, never read by firm one.'),
      (703,'n-3',900,44,NULL,'','A firm-less note of my own.');
  `);
  // 41's own diligence case on the company, with one open finding; 43 (the other firm) has its own, never read for 41.
  db.exec(`
    INSERT INTO dd_cases(id,uid,subject_type,subject_id,subject_label,status,risk_band,owner_user_id) VALUES
      (61,'dd-41','project',801,'Acme Field','in_review','amber',41),(62,'dd-43','project',801,'Acme Field','open','red',43);
    INSERT INTO dd_findings(case_id,source_kind,severity,title) VALUES (61,'manual','high','Customer contracts unsigned'),(62,'manual','critical','OTHER FIRM FINDING');
  `);
  const runs: any[] = [];
  const quotes: any[] = [];
  const run: Run = async (_env, input) => {
    runs.push(input);
    return { ok: true, output: JSON.stringify(output), usageLogId: null, usage: { model: MODEL }, guard: { input: 'pass', output: 'pass', codes: [], calls: 2 } };
  };
  const quote = async (_env: any, input: any) => { quotes.push(input); return { ok: true, hold_microusd: 1200, model: MODEL } as any; };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.onError((e: any, c: any) => c.json({ detail: e.message }, 500));
  app.route('/api/ai/rail', railRunRoutes({ run, quote }));
  app.route('/api/fills', fills);
  app.route('/api/deals', dealContext);
  const call = async (who: number, method: string, path: string, body?: unknown, opts: { support?: boolean; firm?: number } = {}) => {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any;
    const jwt = await new SignJWT({ user_id: who, role: u.role, ...(opts.support ? { impersonated_by: 51 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
    if (opts.firm != null) headers['X-Company-Id'] = String(opts.firm);
    const r = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, type: r.headers.get('content-type') || '', text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const sheet = (who: number, q: Record<string, string | number>, opts: { firm?: number } = {}) =>
    call(who, 'GET', `/api/fills/sheet?${new URLSearchParams(Object.entries({ page: DEAL_ROOM, form: 'deal-note', ...q }).map(([k, v]) => [k, String(v)]))}`, undefined, opts);
  const runForm = async (who: number, body: Record<string, unknown>, opts: { support?: boolean; firm?: number } = {}) => {
    const r = await call(who, 'POST', '/api/ai/rail/run', { page: DEAL_ROOM, option: 'form:deal-note', ...body }, opts);
    const events = r.type.startsWith('text/event-stream')
      ? r.text.trim().split('\n\n').map((b) => ({ event: /^event: (.+)$/m.exec(b)![1], data: JSON.parse(/^data: (.+)$/m.exec(b)![1]) }))
      : [];
    return { ...r, done: events.find((e) => e.event === 'done')?.data };
  };
  return { db, call, sheet, runForm, runs, quotes };
}
const prompt = (input: any) => input.messages.map((m: any) => m.content).join('\n');
const SUMMARY = { draft: 'deal_summary', values: { body: '' } };
const byKey = (sources: any[]) => Object.fromEntries(sources.map((s: any) => [s.key, s.state]));

test('a deal summary reads the terms, the caller\'s own diligence and their firm\'s notes, and names each source', async () => {
  // Mutation checked: the purpose dropped in rail_run → no sources and no terms in the prompt.
  const f = fixture({ fields: [{ field: 'body', value: 'Acme Field raises on a SAFE. ' + 'x'.repeat(600) }] });
  const run = await f.runForm(41, { parent: 900, input: SUMMARY });
  assert.equal(run.status, 200, run.text);
  const p = prompt(f.runs[0]);
  assert.match(p, /Instrument: SAFE/);
  assert.match(p, /Target raise: 2000000 USD/);
  assert.match(p, /Closing date: 2026-12-31/);
  assert.match(p, /Diligence case: in_review, risk band amber/);
  assert.match(p, /Open diligence finding \(high\): Customer contracts unsigned/);
  assert.match(p, /Met the CTO/);
  assert.match(p, /deal summary/);
  assert.deepEqual(byKey(run.done.sources), { deal: 'used', terms: 'used', evidence: 'not_shared', diligence: 'used', notes: 'used' });
  assert.ok(run.done.sources.every((s: any) => s.label && s.note), 'each source says what it is and what happened');
  // A summary keeps more than a title's 300 characters, up to its own cap.
  assert.ok(run.done.proposals[0].value.length > 300 && run.done.proposals[0].value.length <= DEAL_SUMMARY_MAX);
});

test('a second firm\'s notes and diligence never enter the draft, and a firm-less note of someone else\'s never does', async () => {
  // Mutation checked: the company_id filter dropped from the notes read → "Other firm view" reaches the prompt.
  const f = fixture({ fields: [{ field: 'body', value: 'Summary.' }] });
  await f.runForm(41, { parent: 900, input: SUMMARY });
  const p = prompt(f.runs[0]);
  assert.doesNotMatch(p, /Other firm view|A firm-less note of my own|OTHER FIRM FINDING|risk band red/);
  // And the other firm reads its own, never firm one's.
  await f.runForm(43, { parent: 900, input: SUMMARY });
  const other = prompt(f.runs[1]);
  assert.match(other, /Other firm view/);
  assert.match(other, /OTHER FIRM FINDING/);
  assert.doesNotMatch(other, /Met the CTO|Customer contracts unsigned/);
});

test('the summary is asked for: the note\'s own Ask reads no extra source and returns none', async () => {
  const f = fixture({ fields: [{ field: 'body', value: 'A note.' }] });
  const run = await f.runForm(41, { parent: 900 });
  assert.equal(run.done.sources, undefined);
  assert.doesNotMatch(prompt(f.runs[0]), /Instrument|Diligence case/);
  // Any other purpose is ignored.
  const odd = await f.runForm(41, { parent: 900, input: { draft: 'everything', values: { body: '' } } });
  assert.equal(odd.done.sources, undefined);
  // Nothing about the run writes a note: Save as my note is the notes route's.
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM deal_notes').get() as any).n, 3);
});

test('with no terms, no case and no notes, each source says so rather than inventing one', async () => {
  const f = fixture({ fields: [{ field: 'body', value: 'Summary.' }] });
  f.db.exec("UPDATE deals SET instrument = NULL, target_raise = NULL, amount = NULL, closing_deadline = NULL WHERE id = 900; UPDATE projects SET sector = NULL WHERE id = 801");
  const run = await f.runForm(47, { parent: 900, input: SUMMARY });
  assert.deepEqual(byKey(run.done.sources), { deal: 'used', terms: 'none', evidence: 'not_shared', diligence: 'none', notes: 'none' });
  assert.match(run.done.sources.find((s: any) => s.key === 'diligence').note, /no diligence case/);
});

// ── the NDA: the evidence read is `investorEvidence` (its audience, NDA and sharing rules are D1265's, tested there) ──

const ITEM = { uid: 'i1', area: 'Traction', kind: 'kpi-snapshot', summary: 'AFTER-NDA SUMMARY', value_num: 42000, value_unit: 'usd/month', currency: null, observed_on: '2026-10-01' };
async function sourcesWith(view: unknown) {
  const f = fixture();
  const out: any = { choices: new Map(), existing: [], context: [] };
  const read = async () => { if (view instanceof Error) throw view; return view as any; };
  await dealSummarySources({ DB: d1Over(f.db) } as any, 41, 900, 1, out, true, read as any);
  return out;
}

test('before the NDA nothing behind it is used, only coverage; once it is signed, the shared items are', async () => {
  // Mutation checked: the `nda_signed` branch dropped → the item's summary reaches the context before the NDA.
  const before = await sourcesWith({ nda_signed: false, coverage: { state: 'recorded', groups: [{ area: 'Traction', kind: 'kpi-snapshot', count: 1 }] }, items: { state: 'recorded', rows: [ITEM] } });
  const ev = before.sources.find((s: any) => s.key === 'evidence');
  assert.deepEqual([ev.state, /NDA is not signed/.test(ev.note)], ['not_shared', true]);
  assert.ok(!before.context.some((l: string) => /AFTER-NDA SUMMARY|42000/.test(l)), 'no item and no figure before the NDA');
  assert.ok(before.context.some((l: string) => /coverage only/.test(l)));
  const after = await sourcesWith({ nda_signed: true, coverage: { state: 'recorded', groups: [] }, items: { state: 'recorded', rows: [ITEM] } });
  assert.equal(after.sources.find((s: any) => s.key === 'evidence').state, 'used');
  assert.ok(after.context.some((l: string) => /AFTER-NDA SUMMARY · 42000 usd\/month/.test(l)));
  const unread = await sourcesWith({ nda_signed: true, coverage: { state: 'recorded', groups: [] }, items: { state: 'unreadable' } });
  assert.equal(unread.sources.find((s: any) => s.key === 'evidence').state, 'unreadable');
  const notShared = await sourcesWith(Object.assign(new Error('nope'), { code: 'not_found' }));
  assert.equal(notShared.sources.find((s: any) => s.key === 'evidence').state, 'not_shared');
  const broken = await sourcesWith(new Error('db down'));
  assert.equal(broken.sources.find((s: any) => s.key === 'evidence').state, 'unreadable');
});
