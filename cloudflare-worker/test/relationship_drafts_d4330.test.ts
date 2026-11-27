/**
 * D4330 (#4330, D1357 part 8b): Eadwyn's three drafts for an introduction — the reason for an ask (RI3),
 * the intro email (RI4) and a follow-up (RI6). Synthetic people on the real migrated schema; env.AI is
 * the guard stub, which records every prompt; `fetch` throws, so nothing is sent anywhere.
 *
 *   · KEY: no draft reads a hidden relationship or a contact detail — a teammate who did not share is
 *     404 before any quote or run, and no prompt carries an email, phone, profile URL or a member's notes;
 *   · each is a quoted proposal: `estimate` runs nothing; a run is held and charged like every Eadwyn run,
 *     logged against /network/introductions; nothing is stored and nothing is sent;
 *   · RI4 is the accepted teammate's alone, RI6 either person's on a made introduction.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import relationships from '../src/routes/relationships.ts';
import { __resetForTest, budgetRefusalMessage } from '../src/services/aiRouter.ts';
import { parseProposal, scrub } from '../src/services/relationshipDrafts.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d4330-only-not-a-real-credential'.repeat(2);
const ADA_URL = 'https://www.linkedin.com/in/synthetic-ada';
// What no prompt may carry: the teammates' books' emails, phones, profile URLs and notes, and the prospect's address.
const PRIVATE = ['partner@fund.invalid', '555 0142', '555 0199', 'asker@example.invalid', 'ada@example.invalid', 'synthetic-ada', 'linkedin.com', '+1 555 0100', 'Synthetic private note', 'investor@example.invalid', 'bob@example.invalid', 'Synthetic Bob'];
const REASON = JSON.stringify({ text: 'Ada leads the platform at Acme; we are raising and she would know who to talk to.' });
const EMAIL = JSON.stringify({ subject: 'Introducing Synthetic member 2', body: 'Ada, meet Synthetic member 2.' });

// 2 founder of venture 1 (asks), 4 its co-founder (shares Ada), 3 founder of venture 3 (shares Bob, another team),
// 5 venture 1's advisor (not its team).
async function fixture(answer: (prompt: string) => string = (p) => (p.includes('"text"') ? REASON : EMAIL)) {
  __resetForTest();
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300], [4, 'founder', null], [5, 'advisor', null]] as const) {
    u.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  const nc = db.prepare('INSERT INTO network_connections(id,user_id,name,email,company,title,phone,notes,source,linkedin_url,connected_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  nc.run(41, 4, 'Synthetic Ada', 'ada@example.invalid', 'Acme', 'Head of Platform', '+1 555 0100', 'Synthetic private note', 'csv', ADA_URL, '2023-05-01');
  nc.run(42, 4, 'Synthetic Hidden', null, 'Hidden Co', 'CEO', null, null, 'linkedin_api', null, null);
  nc.run(31, 3, 'Synthetic Bob', 'bob@example.invalid', 'Acme', 'CFO', null, null, 'csv', null, null);
  const src = db.prepare("INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (?,'network_connections',?,?,1)");
  src.run(4, 41, 'csv'); src.run(4, 42, 'linkedin_api'); src.run(3, 31, 'csv');
  // The warm path the founder typed names an address and a number: the record is theirs to read, but neither reaches a prompt.
  db.exec("INSERT INTO raise_prospects(id,uid,project_id,name,firm,email,warm_path,stage,updated_at) VALUES (21,'p21',1,'Synthetic Investor','Synthetic Fund','investor@example.invalid','Via partner@fund.invalid, or call +1 555 0142','talking','2026-10-03 10:00:00'),(23,'p23',3,'Other Investor','Other Fund',NULL,NULL,'talking','2026-10-03 10:00:00')");
  for (const who of [2, 4]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(who);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const prompts: string[] = [];
  const AI = withGuard({
    run: async (_model: string, input: any) => {
      const prompt = (input?.messages || []).map((m: any) => String(m.content || '')).join('\n');
      prompts.push(prompt);
      return { response: answer(prompt), usage: { prompt_tokens: 80, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted'),(1,5,'advisor','accepted')");
  const app = new Hono<any>().route('/api/relationships', relationships);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT user_id, task, surface, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'mail_draft' ORDER BY id").all() as any[];
  const untouched = () => ({
    mail_drafts: (db.prepare('SELECT COUNT(*) AS n FROM mail_drafts').get() as any).n,
    mail_sent: (db.prepare('SELECT COUNT(*) AS n FROM mail_sent').get() as any).n,
  });
  return { db, env, app, prompts, runs, untouched, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}
const R = '/api/relationships';
const shareAll = (f: F, who: number) => call(f, who, 'PUT', `${R}/sharing`, { share: true });
const noPrivate = (f: F, where: string) => { for (const p of f.prompts) for (const s of PRIVATE) assert.ok(!p.includes(s), `${where}: a prompt carries ${s}`); };

/** A request from 2 to 4 for Ada, taken to `to` (pending, accepted or made) by writing what the 8a steps write. */
async function request(f: F, to: 'pending' | 'accepted' | 'made') {
  const r = await call(f, 2, 'POST', `${R}/intro-request`, { teammate: 4, ref: 41, note: 'We are raising our seed. Reach me on +1 555 0199.', context_note: 'Synthetic venture closes books in a day. Write to asker@example.invalid.' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const uid = r.body.request.uid;
  if (to !== 'pending') assert.equal((await call(f, 4, 'POST', `${R}/intro-requests/${uid}/decide`, { decision: 'accepted' })).status, 200);
  if (to === 'made') f.db.prepare("UPDATE relationship_interactions SET status = 'made', made_at = '2026-10-14T09:00:00Z' WHERE uid = ?").run(uid);
  return uid as string;
}

test('scrub withholds anything that looks like an email, a link or a phone number; the reason is parsed as text', () => {
  assert.equal(scrub('Write to ada@example.invalid or +1 555 0100, see https://www.linkedin.com/in/x and acme.com/team'),
    'Write to [email withheld] or [number withheld], see [link withheld] and [link withheld]');
  assert.equal(scrub('Raised in 2024, 12 people'), 'Raised in 2024, 12 people', 'a year and a count are not phone numbers');
  assert.equal(scrub('Connected since 2023-05-01; call 020 7946 0958'), 'Connected since 2023-05-01; call [number withheld]', 'a date is kept, a phone is not');
  assert.deepEqual(parseProposal('ask_reason', `Sure: ${REASON}`), { text: 'Ada leads the platform at Acme; we are raising and she would know who to talk to.' });
  assert.equal(parseProposal('ask_reason', 'no json'), null);
  assert.deepEqual(parseProposal('intro', EMAIL), { subject: 'Introducing Synthetic member 2', body: 'Ada, meet Synthetic member 2.' });
});

test('KEY: no draft reads a hidden relationship — a teammate who did not share, or an API-only row, is 404 before any quote or run', async () => {
  // Mutation checked: askReasonInput reading the contact without the access statement (a hidden relationship drafted).
  const f = await fixture();
  try {
    for (const estimate of [true, false]) {
      for (const [who, teammate, ref] of [[2, 4, 41], [2, 3, 31], [2, 4, 42], [5, 4, 41], [3, 4, 41], [2, 4, 9999]] as const) {
        const r = await call(f, who, 'POST', `${R}/drafts/ask-reason`, { teammate, ref, estimate });
        assert.deepEqual([r.status, r.body.detail], [404, 'Not found.'], `${who} → ${teammate}:${ref} estimate=${estimate}`);
      }
    }
    await shareAll(f, 4);
    await shareAll(f, 3);
    for (const [who, teammate, ref] of [[2, 3, 31], [2, 4, 42], [5, 4, 41], [3, 4, 41]] as const) {
      assert.equal((await call(f, who, 'POST', `${R}/drafts/ask-reason`, { teammate, ref })).status, 404, `${who} → ${teammate}:${ref}: still not theirs to see`);
    }
    assert.deepEqual([f.prompts.length, f.runs().length], [0, 0], 'nothing was quoted into a prompt, nothing was run');
  } finally { f.close(); }
});

test('RI3: the quote runs nothing; the run is the asker\'s, charged, and carries the shared row and the record — never a contact detail', async () => {
  // Mutations checked: the estimate press running the model; scrub skipped on the record's text (the prospect's address in the prompt).
  const f = await fixture();
  try {
    await shareAll(f, 4);
    const q = await call(f, 2, 'POST', `${R}/drafts/ask-reason`, { teammate: 4, ref: 41, record: 'prospect:21', estimate: true });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.ok(q.body.estimate.hold_microusd > 0 && q.body.estimate.model);
    assert.deepEqual([f.prompts.length, f.runs().length], [0, 0], 'a quote runs nothing');
    for (const record of ['prospect:23', 'prospect:9999', 'nope']) {
      assert.equal((await call(f, 2, 'POST', `${R}/drafts/ask-reason`, { teammate: 4, ref: 41, record })).status, 404, `${record}: not a record the asker reads`);
    }
    assert.equal(f.prompts.length, 0);
    const r = await call(f, 2, 'POST', `${R}/drafts/ask-reason`, { teammate: 4, ref: 41, record: 'prospect:21' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.draft.kind, r.body.draft.proposal, r.body.draft.text], ['ask_reason', true, JSON.parse(REASON).text]);
    const prompt = f.prompts.find((p) => p.includes('THE PERSON THEY KNOW'))!;
    for (const s of ['Synthetic Ada', 'Acme', 'Head of Platform', 'Spreadsheet', '2023-05-01', 'Synthetic member 4', 'Synthetic Investor']) assert.ok(prompt.includes(s), `the prompt has ${s}`);
    assert.ok(prompt.includes('Via [email withheld], or call [number withheld]'), 'the record\'s own text is scrubbed');
    noPrivate(f, 'RI3');
    const [run] = f.runs();
    assert.deepEqual([run.user_id, run.surface], [2, '/network/introductions']);
    assert.ok(run.charged_microusd > 0, 'charged like every Eadwyn run');
    assert.deepEqual(f.untouched(), { mail_drafts: 0, mail_sent: 0 }, 'nothing stored, nothing sent');
  } finally { f.close(); }
});

test('RI4: the intro email is the accepted teammate\'s alone; it quotes the reason and the context note, and nothing else of anyone\'s book', async () => {
  // Mutation checked: introInput reading the request for either side (the asker drafting the introducer's email).
  const f = await fixture();
  try {
    await shareAll(f, 4);
    const pending = await request(f, 'pending');
    assert.equal((await call(f, 4, 'POST', `${R}/intro-requests/${pending}/drafts/intro`, {})).body.error, 'intro_not_accepted');
    const uid = await request(f, 'accepted');
    for (const who of [2, 3, 5]) {
      const r = await call(f, who, 'POST', `${R}/intro-requests/${uid}/drafts/intro`, { estimate: true });
      assert.deepEqual([r.status, r.body.detail], [404, 'Not found.'], `${who} drafts no intro for it`);
    }
    assert.equal((await call(f, 4, 'POST', `${R}/intro-requests/${'f'.repeat(32)}/drafts/intro`, {})).status, 404);
    assert.equal(f.prompts.length, 0);
    const r = await call(f, 4, 'POST', `${R}/intro-requests/${uid}/drafts/intro`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.draft.kind, r.body.draft.subject, r.body.draft.proposal], ['intro', 'Introducing Synthetic member 2', true]);
    const prompt = f.prompts.find((p) => p.includes('Reason for the ask'))!;
    for (const s of ['We are raising our seed. Reach me on [number withheld].', 'Synthetic venture closes books in a day. Write to [email withheld].', 'Synthetic member 2', 'Synthetic Ada']) assert.ok(prompt.includes(s), s);
    noPrivate(f, 'RI4');
    assert.deepEqual(f.runs().map((x) => x.user_id), [4], 'charged to the introducer who pressed');
    const status = (f.db.prepare('SELECT status FROM relationship_interactions WHERE uid = ?').get(uid) as any).status;
    assert.equal(status, 'accepted', 'a draft makes nothing: made is recorded on send');
    assert.deepEqual(f.untouched(), { mail_drafts: 0, mail_sent: 0 });
  } finally { f.close(); }
});

test('RI6: a follow-up for either person on a made introduction; what came of it is what was recorded', async () => {
  const f = await fixture();
  try {
    await shareAll(f, 4);
    const accepted = await request(f, 'accepted');
    assert.equal((await call(f, 2, 'POST', `${R}/intro-requests/${accepted}/drafts/follow-up`, {})).body.error, 'intro_not_made');
    const uid = await request(f, 'made');
    for (const who of [3, 5]) assert.equal((await call(f, who, 'POST', `${R}/intro-requests/${uid}/drafts/follow-up`, {})).status, 404, `${who}`);
    const asker = await call(f, 2, 'POST', `${R}/intro-requests/${uid}/drafts/follow-up`, {});
    assert.equal(asker.status, 200, JSON.stringify(asker.body));
    assert.ok(f.prompts.at(-1)!.includes('Outcome so far: Not recorded'), 'never an assumed "no reply"');
    assert.ok(f.prompts.at(-1)!.includes('You are the person who asked'));
    await call(f, 4, 'POST', `${R}/intro-requests/${uid}/outcome`, { outcome: 'meeting_held' });
    const introducer = await call(f, 4, 'POST', `${R}/intro-requests/${uid}/drafts/follow-up`, {});
    assert.equal(introducer.status, 200);
    assert.ok(f.prompts.at(-1)!.includes('Outcome so far: Meeting held'));
    assert.ok(f.prompts.at(-1)!.includes('You made the introduction'));
    noPrivate(f, 'RI6');
    assert.deepEqual(f.runs().map((x) => x.user_id), [2, 4]);
  } finally { f.close(); }
});

test('a short balance is 402 in the top-up sentence; an answer that is not a draft is 503; a support session drafts nothing', async () => {
  const f = await fixture(() => 'Sure, here you go.');
  try {
    await shareAll(f, 4);
    const bad = await call(f, 2, 'POST', `${R}/drafts/ask-reason`, { teammate: 4, ref: 41 });
    assert.deepEqual([bad.status, bad.body.error], [503, 'draft_unreadable']);
    f.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = 2');
    const short = await call(f, 2, 'POST', `${R}/drafts/ask-reason`, { teammate: 4, ref: 41 });
    assert.equal(short.status, 402, JSON.stringify(short.body));
    assert.equal(short.body.detail, budgetRefusalMessage(short.body.error));
    const uid = await request(f, 'accepted');
    for (const path of [`${R}/drafts/ask-reason`, `${R}/intro-requests/${uid}/drafts/intro`, `${R}/intro-requests/${uid}/drafts/follow-up`]) {
      const r = await call(f, 4, 'POST', path, { teammate: 4, ref: 41 }, { impersonated_by: 1 });
      assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused'], path);
    }
    assert.deepEqual(f.untouched(), { mail_drafts: 0, mail_sent: 0 });
  } finally { f.close(); }
});
