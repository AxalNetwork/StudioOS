/** D6008 (#6008): the interview guide over a real migrated D1, the mounted router and a synthetic model; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { guideDeps } from '../src/routes/interview_guide.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { RAIL_OPTION_JOBS } from '../src/services/ai/textJobs.ts';
import { DEFAULT_QUESTIONS, GUIDE_OPTION, GUIDE_PAGE, mergeSave, parseDraft } from '../src/services/interviewGuide.ts';

test.after(removeMigratedDatabases);
const SECRET = 'test'.repeat(16);
const BASE = '/api/cycles/validate/interview-guide';
const realRun = guideDeps.run;
const realQuote = guideDeps.quoteRun;

type Opts = { hypotheses?: boolean; answer?: string };
function fixture(o: Opts = {}) {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (1,'Synthetic Founder','one@example.invalid','founder',100,1),
      (2,'Other Founder','two@example.invalid','founder',200,1),
      (3,'Synthetic Partner','three@example.invalid','partner',NULL,1);
    INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic Venture',100),(2,'Other Venture',200);
    INSERT INTO customer_segments(id,project_id,name,name_norm,who_they_are) VALUES (1,1,'Mid-size ops','mid-size ops','Ops leads'),(2,2,'Other','other','PRIVATE');
    INSERT INTO pain_groups(id,project_id,title) VALUES (1,1,'Matching invoices by hand');
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,pains_json,quote_consent) VALUES
      (1,1,'Synthetic One','["Matching invoices by hand"]',1),(2,2,'Other One','[]',1);`);
  if (o.hypotheses !== false) {
    db.exec(`INSERT INTO hypotheses(id,project_id,code,claim,sort_order) VALUES (1,1,'H1','Ops teams match invoices by hand',1),(2,2,'H1','PRIVATE other claim',1);`);
  }
  const prompts: string[] = [];
  const runs: any[] = [];
  guideDeps.quoteRun = (async () => ({ ok: true, hold_microusd: 40000, model: 'synthetic-model' })) as any;
  guideDeps.run = (async (_env: any, opts: any) => {
    runs.push(opts); prompts.push(String(opts.text));
    return { ok: true, output: o.answer ?? JSON.stringify({ questions: [
      { group: 'h:1', text: 'What happens when an invoice does not match?' },
      { group: 'h:2', text: 'PRIVATE question for another venture?' },
      { group: 'h:1', text: 'Would you pay for a tool that did this?' },
    ] }), usage: { model: 'synthetic-model', est_cost_usd: 0.01 } };
  }) as any;
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route(BASE, router);
  async function call(method: string, path: string, body?: unknown, who = 1, project = 1) {
    const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const sep = path.includes('?') ? '&' : '?';
    const r = await app.request(`https://unit.test${BASE}${path === '/' ? '' : path}${sep}project=${project}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  }
  const restore = () => { guideDeps.run = realRun; guideDeps.quoteRun = realQuote; };
  return { db, env, call, prompts, runs, restore };
}

test('the read lists the open hypotheses and unjudged themes of this venture only, with no defaults while one is open', async () => {
  const f = fixture();
  try {
    const r = await f.call('GET', '/');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.material.hypotheses.map((h: any) => [h.ref, h.code]), [['h:1', 'H1']]);
    assert.deepEqual(r.body.material.themes.map((t: any) => t.title), ['Matching invoices by hand']);
    assert.deepEqual(r.body.material.segments.map((s: any) => s.name), ['Mid-size ops']);
    assert.deepEqual(r.body.defaults, []);
    assert.equal(r.body.guide.version, 0);
    assert.equal(r.body.can_write, true);
    assert.equal(r.body.ai.assist, 'on');
    assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE/);
  } finally { f.restore(); }
});

test('with no open hypothesis the read offers the labelled defaults', async () => {
  const f = fixture({ hypotheses: false });
  try {
    const r = await f.call('GET', '/');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.material.hypotheses, []);
    assert.deepEqual(r.body.defaults, [...DEFAULT_QUESTIONS]);
  } finally { f.restore(); }
});

test('a retired hypothesis is not open', async () => {
  const f = fixture();
  try {
    f.db.exec(`UPDATE hypotheses SET retired_at = datetime('now') WHERE id = 1`);
    const r = await f.call('GET', '/');
    assert.deepEqual(r.body.material.hypotheses, []);
    assert.ok(r.body.defaults.length > 0);
  } finally { f.restore(); }
});

test('a hand-written guide saves with its version; a stale version is refused and changes nothing', async () => {
  const f = fixture();
  try {
    const first = await f.call('PUT', '/', { version: 0, questions: [{ text: '  Tell me about   last month?  ', group: { kind: 'hypothesis', ref: 'h:1' } }] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.guide.version, 1);
    assert.deepEqual(first.body.guide.questions.map((q: any) => [q.text, q.group.ref, q.by]), [['Tell me about last month?', 'h:1', 'me']]);
    const stale = await f.call('PUT', '/', { version: 0, questions: [] });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'guide_changed');
    const read = await f.call('GET', '/');
    assert.equal(read.body.guide.questions.length, 1);
    // Two tabs that both read version 1: the first save wins, the second is refused.
    const tabA = await f.call('PUT', '/', { version: 1, questions: [{ text: 'Tab A?', group: { kind: 'other' } }] });
    assert.equal(tabA.body.guide.version, 2);
    const tabB = await f.call('PUT', '/', { version: 1, questions: [{ text: 'Tab B?', group: { kind: 'other' } }] });
    assert.equal(tabB.status, 409);
    assert.deepEqual((await f.call('GET', '/')).body.guide.questions.map((q: any) => q.text), ['Tab A?']);
    // A question cannot claim to be Eadwyn's: a request's `by` is ignored.
    const claimed = await f.call('PUT', '/', { version: 2, questions: [{ text: 'Planted?', by: 'eadwyn', group: { kind: 'other' } }] });
    assert.equal(claimed.body.guide.questions[0].by, 'me');
  } finally { f.restore(); }
});

test('Eadwyn: the quote runs nothing, a draft without the current quote runs nothing, and a draft stores nothing', async () => {
  const f = fixture();
  try {
    const q = await f.call('POST', '/draft/quote', { segment_id: 1 });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.estimate.hold_microusd, 40000);
    assert.equal(f.runs.length, 0);
    const unquoted = await f.call('POST', '/draft', { segment_id: 1 });
    assert.equal(unquoted.status, 409);
    assert.equal(f.runs.length, 0);
    const d = await f.call('POST', '/draft', { segment_id: 1, quote: q.body.estimate });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(f.runs.length, 1);
    assert.equal(f.runs[0].pinMicrousd, 40000, 'the run is capped at the hold shown');
    assert.equal(f.runs[0].rail.option, GUIDE_OPTION);
    assert.match(f.prompts[0], /Ops teams match invoices by hand/);
    assert.match(f.prompts[0], /Mid-size ops/);
    assert.doesNotMatch(f.prompts[0], /PRIVATE/);
    // Only a question under a listed group, and never a leading one.
    assert.deepEqual(d.body.draft.questions.map((x: any) => x.text), ['What happens when an invoice does not match?']);
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM interview_guides').get() as any).n, 0, 'nothing is saved unpressed');
  } finally { f.restore(); }
});

test('Accept adds the picked questions as Eadwyn\'s; an edited one is the founder\'s; a forged receipt is refused', async () => {
  const f = fixture({ answer: JSON.stringify({ questions: [
    { group: 'h:1', text: 'What happens when an invoice does not match?' },
    { group: 't:g:1', text: 'When did you last fix one by hand?' },
  ] }) });
  try {
    const q = await f.call('POST', '/draft/quote', {});
    const d = await f.call('POST', '/draft', { quote: q.body.estimate });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    const [a, b] = d.body.draft.questions;
    const forged = { payload: d.body.receipt.payload.replace('does not match', 'is planted'), signature: d.body.receipt.signature };
    assert.equal((await f.call('POST', '/draft/accept', { receipt: forged, ids: [a.id], version: 0 })).status, 400);
    assert.equal((await f.call('POST', '/draft/accept', { receipt: d.body.receipt, ids: [a.id], version: 0 }, 2, 2)).status, 400, 'another founder\'s receipt');
    const ok = await f.call('POST', '/draft/accept', { receipt: d.body.receipt, ids: [a.id, b.id], edits: { [b.id]: 'When did you last fix an invoice?' }, version: 0 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.guide.questions.map((x: any) => x.by), ['eadwyn', 'me']);
    // Saving Eadwyn's question unchanged keeps it Eadwyn's; editing it makes it the founder's.
    const kept = await f.call('PUT', '/', { version: ok.body.guide.version, questions: ok.body.guide.questions });
    assert.equal(kept.body.guide.questions[0].by, 'eadwyn');
    const edited = await f.call('PUT', '/', { version: kept.body.guide.version, questions: [{ ...kept.body.guide.questions[0], text: 'What happens next?' }] });
    assert.equal(edited.body.guide.questions[0].by, 'me');
  } finally { f.restore(); }
});

test('AI off: the draft is refused with the switch\'s words, the guide stays writable by hand', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO ai_rail_preferences(uid, user_id, section, task, mode) VALUES ('off', 1, '${GUIDE_PAGE.toLowerCase()}', '', 'manual')`);
    guideDeps.quoteRun = realQuote; // the real quote reads the switch
    const read = await f.call('GET', '/');
    assert.equal(read.body.ai.assist, 'off');
    const q = await f.call('POST', '/draft/quote', {});
    assert.equal(q.status, 403, JSON.stringify(q.body));
    assert.equal(q.body.error, 'assist_off');
    assert.equal(f.runs.length, 0);
    const save = await f.call('PUT', '/', { version: 0, questions: [{ text: 'Still mine?', group: { kind: 'other' } }] });
    assert.equal(save.status, 200);
  } finally { f.restore(); }
});

test('a partner reads the guide with no write tools; another venture is refused', async () => {
  const f = fixture();
  try {
    const read = await f.call('GET', '/', undefined, 3);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.can_write, false);
    assert.equal((await f.call('PUT', '/', { version: 0, questions: [] }, 3)).status, 403);
    assert.equal((await f.call('POST', '/draft/quote', {}, 3)).status, 403);
    assert.equal((await f.call('POST', '/copy/1', undefined, 3)).status, 403);
    assert.equal((await f.call('GET', '/', undefined, 2)).status, 403);
  } finally { f.restore(); }
});

test('the copy is taken once onto an interview; marking asked changes the copy, never the guide', async () => {
  const f = fixture();
  try {
    const saved = await f.call('PUT', '/', { version: 0, questions: [{ text: 'One?', group: { kind: 'hypothesis', ref: 'h:1' } }] });
    const qid = saved.body.guide.questions[0].id;
    assert.equal((await f.call('POST', '/copy/2')).status, 404, 'another venture\'s interview');
    const c1 = await f.call('POST', '/copy/1');
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.deepEqual(c1.body.copy.questions.map((q: any) => q.text), ['One?']);
    await f.call('PUT', '/', { version: 1, questions: [{ text: 'Two?', group: { kind: 'other' } }] });
    const c2 = await f.call('POST', '/copy/1');
    assert.deepEqual(c2.body.copy.questions.map((q: any) => q.text), ['One?'], 'a second call answers the first copy');
    const asked = await f.call('PUT', '/copy/1/asked', { question_id: qid, asked: true });
    assert.deepEqual(asked.body.copy.asked, [qid]);
    const guide = await f.call('GET', '/');
    assert.deepEqual(guide.body.guide.questions.map((q: any) => q.text), ['Two?']);
    assert.equal((await f.call('PUT', '/copy/1/asked', { question_id: 'nope', asked: true })).status, 400);
  } finally { f.restore(); }
});

test('pure rules: a retired group falls to Other; the draft parser drops unlisted groups and leading questions', () => {
  const out = mergeSave([], [{ text: 'Q?', group: { kind: 'hypothesis', ref: 'h:9' } }], new Set(['h:1']));
  assert.deepEqual(out[0].group, { kind: 'other', ref: null });
  const m: any = { hypotheses: [{ ref: 'h:1' }], themes: [], segments: [] };
  assert.equal(parseDraft('not json', m), null);
  assert.equal(parseDraft(JSON.stringify({ questions: [{ group: 'h:1', text: 'No question mark' }] }), m), null);
  assert.equal(RAIL_OPTION_JOBS[GUIDE_OPTION], 'VA5');
});
