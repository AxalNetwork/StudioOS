/**
 * D1193 (#3127): Capital relationships part 5, the Worker. Activity across
 * investors, Materials sent, Eadwyn's proposals from a note and its message
 * drafts, and the round's and closes' log rows.
 *
 * Real SQL on node:sqlite (the baseline and every later migration) through the
 * real routes, with a stubbed model. Every name and email is invented.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/capital_relationships_d1193.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import raise from '../src/routes/cycle_raise.ts';
import contacts from '../src/routes/contacts.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { HAS_FIGURE, screenNoteProposals, activitySource, materialsRead } from '../src/services/capRelTabs.ts';
import { withGuard } from './_guard_stub.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1193-0123456789';

// 1 admin · 4 founder of 10 · 9 founder of 20 · 61, 62 verified investors · 63 an unverified one
const ADMIN = 1, OWNER = 4, OTHER = 9;
const P = 10;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = built();

const NOTE = 'Good partner meeting. They asked for the data room and the Q3 metrics pack by Friday.';

function fresh({ answer = { proposals: [] } as unknown } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  const users: Array<[number, string, number | null, string, string]> = [
    [1, 'admin', null, 'Fixture Admin', 'admin@example.test'],
    [4, 'founder', 40, 'Fixture Founder', 'founder@example.test'],
    [9, 'founder', 90, 'Fixture Other', 'other@example.test'],
    [61, 'investor', null, 'Fixture Bluefern Partner', 'bluefern@example.test'],
    [62, 'investor', null, 'Fixture Lumen Partner', 'lumen@example.test'],
    [63, 'investor', null, 'Fixture Unverified', 'harbor@example.test'],
  ];
  for (const [id, role, founder, name, email] of users) {
    db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, is_active, kyc_status, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'studio')")
      .run(id, `u-${id}`, email, name, role, founder, id === 63 ? 'pending' : 'approved');
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Fixture Robotics', 40), (20, 'p-20', 'Fixture Other Co', 90);
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage, warm_path, next_step, updated_at) VALUES
      (1, 'pb', 10, 'Bo Partner', 'Bluefern Capital', 'bluefern@example.test', 'meeting', 'Ana at Other Co', NULL, '2026-10-20 10:00:00'),
      (2, 'pl', 10, 'Lu Partner', 'Lumen Ventures', 'lumen@example.test', 'contacted', NULL, 'Send the deck', '2026-10-19 10:00:00'),
      (3, 'ph', 10, 'Ha Partner', 'Harbor Seed Fund', 'harbor@example.test', 'identified', NULL, NULL, '2026-10-18 10:00:00'),
      (4, 'pt', 10, 'Ty Partner', 'Fund T', NULL, 'passed', NULL, NULL, '2026-10-17 10:00:00'),
      (9, 'po', 20, 'Ot Partner', 'Other Fund', 'other-fund@example.test', 'meeting', NULL, NULL, '2026-10-20 10:00:00');
    UPDATE raise_prospects SET stage = 'to_contact' WHERE id = 3;
    INSERT INTO raise_prospect_events (id, prospect_id, kind, note, created_at) VALUES
      (1, 1, 'meeting', '${NOTE}', '2026-10-16 16:30:00'),
      (2, 1, 'note', 'Short.', '2026-10-17 09:00:00'),
      (3, 9, 'meeting', 'Another venture’s note about their data room and pack.', '2026-10-16 16:30:00');
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${OWNER}, 5000000), (${OTHER}, 5000000);`);
  const prompts: string[] = [];
  let reply: unknown = answer;
  const env: any = {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development',
    AI: withGuard({
      run: async (_model: string, input: any) => {
        prompts.push(JSON.stringify(input?.messages ?? input));
        return { response: typeof reply === 'string' ? reply : JSON.stringify(reply), usage: { prompt_tokens: 40, completion_tokens: 30 } };
      },
    }),
  };
  return { db, env, prompts, answer: (a: unknown) => { reply = a; } };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/raise', raise);
  a.route('/api/contacts', contacts);
  a.onError((e, c) => c.json({ error: e.message }, e.message === 'Unauthorized' ? 401 : 500));
  return a;
})();

async function call(f: any, who: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
const cr = (path: string, project = P) => `/api/cycles/raise/capital-relationships/${path}${path.includes('?') ? '&' : '?'}project=${project}`;
const one = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const all = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).all(...args) as any[];
const logs = (f: any) => all(f, "SELECT entity_id, action, details FROM activity_logs WHERE project_id = ? AND entity_type = 'raise.capital-relationships' ORDER BY id", P)
  .map((r) => [r.entity_id, r.action, r.details]);

// ───────────────────────────────────────────────────────────── activity

test('Activity: every logged change across investors, newest first, with who, the investor and its source; filters and pages', async () => {
  const f = fresh();
  // Writes through the real routes, each logged once by its writer.
  assert.equal((await call(f, OWNER, `/api/cycles/raise/prospects?project=${P}`, 'POST', { name: 'Fixture New', firm: 'Fund N', email: 'fundn@example.test' })).status, 201);
  assert.equal((await call(f, OWNER, `/api/cycles/raise/prospects/import?project=${P}`, 'POST', { rows: [{ name: 'Fixture Imported', email: 'imp@example.test' }] })).status, 200);
  assert.equal((await call(f, OWNER, `/api/cycles/raise/prospects/1?project=${P}`, 'PATCH', { stage: 'diligence' })).status, 200);
  assert.equal((await call(f, OWNER, `/api/cycles/raise/prospects/2/next-step?project=${P}`, 'PUT', { next_step: 'Send the data room', next_step_due: '2026-11-02' })).status, 200);
  // Another venture's row never shows here.
  f.db.prepare("INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (20, 9, 'raise.capital-relationships', '9', 'prospect_updated', 'Another venture', 'user:9')").run();

  const r = await call(f, OWNER, cr('activity'));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total, 4);
  assert.deepEqual(r.body.items.map((i: any) => [i.what, i.investor?.name ?? null, i.who, i.who_role, i.source_label]), [
    ['Next step set', 'Lumen Ventures', 'Fixture Founder', 'Founder', 'Typed'],
    ['Investor edited: stage Meeting → Diligence', 'Bluefern Capital', 'Fixture Founder', 'Founder', 'Typed'],
    ['Investor imported at Identified', 'Fixture Imported', 'Fixture Founder', 'Founder', 'Document · CSV'],
    ['Investor added at Identified', 'Fund N', 'Fixture Founder', 'Founder', 'Typed'],
  ]);
  assert.ok(!JSON.stringify(r.body).includes('@example.test'), 'no email reaches the read');
  assert.match(r.body.not_here, /Commitments lists each/);

  assert.deepEqual((await call(f, OWNER, cr('activity?kind=steps'))).body.items.map((i: any) => i.what), ['Next step set']);
  assert.deepEqual((await call(f, OWNER, cr('activity?investor=1'))).body.items.map((i: any) => i.what), ['Investor edited: stage Meeting → Diligence']);
  assert.deepEqual((await call(f, OWNER, cr('activity?q=lumen'))).body.items.map((i: any) => i.investor.name), ['Lumen Ventures'], 'the investor’s name is searched');
  assert.deepEqual((await call(f, OWNER, cr('activity?q=%25'))).body.items, [], 'a % is a character, never a wildcard');
  assert.equal((await call(f, OWNER, cr('activity?kind=everything'))).status, 400);
  assert.equal((await call(f, OWNER, cr('activity?investor=abc'))).status, 400);

  // Twenty-five a page.
  for (let i = 0; i < 26; i++) f.db.prepare("INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor, created_at) VALUES (10, 4, 'raise.capital-relationships', NULL, 'round_updated', ?, 'user:4', '2026-01-01 00:00:00')").run(`Round settings changed: notes ${i}`);
  const p1 = await call(f, OWNER, cr('activity?page=1'));
  const p2 = await call(f, OWNER, cr('activity?page=2'));
  assert.deepEqual([p1.body.items.length, p2.body.items.length, p1.body.total], [25, 5, 30]);

  assert.equal((await call(f, OTHER, cr('activity'))).status, 403, 'another venture’s founder');
  assert.equal((await call(f, ADMIN, cr('activity'))).status, 403, 'staff make a reasoned support read instead');
});

test('the source of a row: an import is a document, Eadwyn’s rows are Eadwyn’s, the rest typed', () => {
  assert.equal(activitySource('prospect_created', 'Investor imported at Identified'), 'document');
  assert.equal(activitySource('prospect_created', 'Investor added at Identified'), 'typed');
  assert.equal(activitySource('eadwyn_proposed', 'Drafted one proposal'), 'eadwyn');
  assert.equal(activitySource('eadwyn_proposal_accepted', 'Accepted'), 'eadwyn');
  assert.equal(activitySource('next_step_set', 'Next step set'), 'typed');
});

// ───────────────────────────────────────────────────────────── round and closes

test('the round’s settings and a new close are logged for Activity, by field name, never a figure; a currency is three capital letters', async () => {
  const f = fresh();
  const set = await call(f, OWNER, '/api/contacts/raise-round', 'PUT', { project_id: P, name: 'Seed', target_amount: 1500000, close_date: '2026-12-14' });
  assert.equal(set.status, 201, set.text);
  assert.equal((await call(f, OWNER, '/api/contacts/raise-round', 'PUT', { project_id: P, currency: 'usd' })).status, 400);
  const changed = await call(f, OWNER, '/api/contacts/raise-round', 'PUT', { project_id: P, target_amount: 1750000, currency: 'EUR' });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(one(f, 'SELECT currency FROM raise_rounds WHERE project_id = ?', P).currency, 'EUR');
  const close = await call(f, OWNER, '/api/contacts/raise-closes', 'POST', { project_id: P, name: 'Second close', target_date: '2026-11-30', state: 'planned' });
  assert.equal(close.status, 201, close.text);
  assert.equal((await call(f, OWNER, `/api/contacts/raise-closes/${close.body.id}`, 'PUT', { state: 'open' })).status, 200);
  assert.deepEqual(logs(f), [
    [null, 'round_updated', 'Round set up'],
    [null, 'round_updated', 'Round settings changed: target, currency'],
    [null, 'close_added', 'Close added: Second close'],
    [null, 'close_updated', 'Close changed: Second close'],
  ]);
  assert.ok(!logs(f).some((l) => /\d{4,}/.test(String(l[2]))), 'no figure is logged');
  const act = await call(f, OWNER, cr('activity?kind=round'));
  assert.deepEqual(act.body.items.map((i: any) => [i.what, i.investor]), [
    ['Close changed: Second close', null], ['Close added: Second close', null], ['Round settings changed: target, currency', null], ['Round set up', null],
  ]);
});

// ───────────────────────────────────────────────────────────── materials

test('Materials sent: deck links per investor, data-room opens for the room’s owner alone, and a sent call; nothing recorded is Not sent', async () => {
  const f = fresh();
  f.db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, 10, 1, '[]'), (6, 20, 1, '[]');
    INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at, view_count, last_viewed_at, prospect_id) VALUES
      (5, 'h1', '2099-01-01', 3, '2026-10-10 09:00:00', 1),
      (5, 'h2', '2099-01-01', 0, NULL, 2),
      (5, 'h3', '2099-01-01', 9, '2026-10-11 09:00:00', NULL),
      (6, 'h4', '2099-01-01', 7, '2026-10-12 09:00:00', 9);
    INSERT INTO data_room_access_log (project_id, user_id, action, created_at) VALUES (10, 61, 'open_room', '2026-10-09 10:00:00'), (10, 61, 'download', '2026-10-10 10:00:00'), (20, 62, 'open_room', '2026-10-10 10:00:00');
    INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
      VALUES (1, 'call-1', 10, 'Seed extension', 50000000, 'safe', 'Fixture terms', 1000000, '2026-12-31', 'sent', 'h', 4),
             (2, 'call-2', 10, 'Draft call', 50000000, 'safe', 'Fixture terms', 1000000, '2026-12-31', 'draft', 'h', 4);
    INSERT INTO round_call_recipients (call_id, investor_user_id, origin, opened_at, responded_at) VALUES (1, 61, 'chosen', '2026-10-12', NULL), (2, 62, 'chosen', NULL, NULL);`);
  const r = await call(f, OWNER, cr('materials'));
  assert.equal(r.status, 200, r.text);
  const by = new Map(r.body.items.map((i: any) => [i.name, i]));
  assert.deepEqual([...by.keys()], ['Bluefern Capital', 'Lumen Ventures', 'Harbor Seed Fund'], 'passed investors are not listed');
  const cells = (n: string) => { const i: any = by.get(n); return [i.deck.text, i.data_room.text, i.call.text]; };
  assert.deepEqual(cells('Bluefern Capital'), ['Viewed 3× · last 2026-10-10', 'Opened 2× · last 2026-10-10', 'Opened Seed extension']);
  assert.deepEqual(cells('Lumen Ventures'), ['Sent · not viewed yet', 'Not opened', 'Not sent'], 'a draft call is not sent');
  assert.deepEqual(cells('Harbor Seed Fund'), ['Not sent', 'Not on Axal', 'Not on Axal'], 'an unverified account is not matched');
  assert.ok(!JSON.stringify(r.body).includes('@example.test'));
  assert.equal((await call(f, OTHER, cr('materials'))).status, 403);
  // A co-founder is not the data room's owner (D1102): the column says who sees it.
  const cofounder = await materialsRead(f.env, P, false);
  assert.deepEqual(cofounder.items.map((i: any) => i.data_room.text), ['The data room’s owner sees this', 'The data room’s owner sees this', 'The data room’s owner sees this']);
});

// ───────────────────────────────────────────────────────────── Eadwyn

const GOOD = { proposals: [
  { type: 'next_step', text: 'Send the Q3 metrics pack', due: '2999-10-23', quote: 'the Q3 metrics pack by Friday' },
  { type: 'stage_move', to: 'diligence', why: 'They asked for the data room', quote: 'They asked for the data room' },
  { type: 'next_step', text: 'Book a call', due: null, quote: 'words that are not in the note' },
  { type: 'stage_move', to: 'committed', why: 'They will invest', quote: 'Good partner meeting' },
  { type: 'next_step', text: 'Ask for $250,000', due: null, quote: 'Good partner meeting' },
] };

test('the screen keeps a proposal only with a quote from the note, a move Eadwyn may propose, and no figure', () => {
  const kept = screenNoteProposals(GOOD, NOTE, '2026-10-26');
  assert.deepEqual(kept.map((k) => [k.type, k.text ?? k.to]), [['next_step', 'Send the Q3 metrics pack'], ['stage_move', 'diligence']]);
  assert.equal(screenNoteProposals({ proposals: [{ type: 'next_step', text: 'Write back', due: '2020-01-01', quote: 'Good partner meeting' }] }, NOTE, '2026-10-26')[0].due, null, 'a past due date is dropped');
  assert.deepEqual(screenNoteProposals('not json', NOTE, '2026-10-26'), []);
  for (const fig of ['$250,000', '€5m', '250k', '2 million', 'USD 40000']) assert.ok(HAS_FIGURE.test(fig), fig);
  for (const ok of ['Send the Q3 pack', 'Meet on 23 Oct', 'Series A in 2027']) assert.ok(!HAS_FIGURE.test(ok), ok);
});

test('proposals from a note: one run, each kept proposal its own row beside its quote, accepted through the one writer and logged', async () => {
  const f = fresh({ answer: GOOD });
  const run = await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 1, event_id: 1 });
  assert.equal(run.status, 200, run.text);
  assert.deepEqual(run.body.proposals.map((p: any) => [p.payload.type, p.payload.quote]), [
    ['next_step', 'the Q3 metrics pack by Friday'], ['stage_move', 'They asked for the data room'],
  ]);
  assert.equal(all(f, "SELECT task, surface FROM ai_usage_logs WHERE guard_for IS NULL").map((r) => `${r.task}@${r.surface}`).join(), 'rail_write@/raise/capital-relationships');
  assert.ok(f.prompts.some((p) => p.includes('Q3 metrics pack')), 'the note is what is read');
  assert.equal(run.body.proposals[0].payload.note, NOTE, 'the panel shows the note beside its proposals');
  const open = await call(f, OWNER, cr('proposals'));
  assert.deepEqual(open.body.proposals.map((p: any) => p.investor), ['Bluefern Capital', 'Bluefern Capital']);
  assert.deepEqual((await call(f, OTHER, cr('proposals', 20))).body.proposals, [], 'another member reads none of them');
  // The same member's proposal on another venture's investor is not this venture's.
  f.db.prepare("INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json) VALUES (?, ?, ?, ?, ?, 'proposal', ?)")
    .run('00000000-0000-4000-8000-000000000009', OWNER, 'Founder · Raise · Capital relationships', 'propose:raise/investor-next-steps', 'raise_prospects:9', JSON.stringify({ type: 'next_step', text: 'Elsewhere', prospect_id: 9 }));
  assert.equal((await call(f, OWNER, cr('proposals'))).body.proposals.length, 2, 'only this venture’s investors');

  const [step, move] = run.body.proposals;
  const accepted = await call(f, OWNER, cr(`proposals/${step.uid}/accept`), 'POST', {});
  assert.equal(accepted.status, 200, accepted.text);
  assert.deepEqual({ ...one(f, 'SELECT next_step, next_step_due, warm_path FROM raise_prospects WHERE id = 1') },
    { next_step: 'Send the Q3 metrics pack', next_step_due: '2999-10-23', warm_path: 'Ana at Other Co' }, 'the warm path is kept');
  assert.equal((await call(f, OWNER, cr(`proposals/${step.uid}/accept`), 'POST', {})).status, 404, 'decided once');
  assert.equal((await call(f, OWNER, cr(`proposals/${move.uid}/accept`), 'POST', { edited: { to: 'committed' } })).status, 400, 'never Committed, even edited');
  assert.equal(one(f, 'SELECT stage FROM raise_prospects WHERE id = 1').stage, 'meeting');
  assert.equal((await call(f, OWNER, cr(`proposals/${move.uid}/accept`), 'POST', { edited: { to: 'diligence' } })).status, 200);
  assert.equal(one(f, 'SELECT stage FROM raise_prospects WHERE id = 1').stage, 'diligence');
  assert.equal(one(f, 'SELECT status FROM ai_rail_proposals WHERE uid = ?', move.uid).status, 'edited');
  assert.deepEqual(logs(f), [
    ['1', 'eadwyn_proposed', 'Drafted 2 proposals from your note on Bluefern Capital'],
    ['1', 'next_step_set', 'Next step set'],
    ['1', 'eadwyn_proposal_accepted', 'Accepted Eadwyn’s next step for Bluefern Capital'],
    ['1', 'prospect_updated', 'Investor edited: stage Meeting → Diligence'],
    ['1', 'eadwyn_proposal_accepted', 'Accepted Eadwyn’s move of Bluefern Capital to Diligence'],
  ]);
  const act = await call(f, OWNER, cr('activity?kind=eadwyn'));
  assert.deepEqual(act.body.items.map((i: any) => [i.who, i.who_role, i.source_label]).at(-1), ['Eadwyn', 'Proposes only', 'Proposed by Eadwyn']);
});

test('a note run refuses another investor’s note, another venture’s, a too-short note, and anyone outside the venture', async () => {
  const f = fresh({ answer: GOOD });
  assert.equal((await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 1, event_id: 3 })).status, 404, 'another venture’s note');
  assert.equal((await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 9, event_id: 3 })).status, 404, 'another venture’s investor');
  assert.equal((await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 2, event_id: 1 })).status, 404, 'a note on another investor');
  assert.equal((await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 1, event_id: 2 })).status, 422, 'too short to propose from');
  assert.equal((await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 1 })).status, 422, 'with no note named, the newest note is read: here the short one');
  assert.equal((await call(f, OWNER, cr('proposals'), 'POST', { prospect_id: 3 })).status, 404, 'an investor with no note');
  assert.equal((await call(f, OTHER, cr('proposals'), 'POST', { prospect_id: 1, event_id: 1 })).status, 403);
  assert.equal((await call(f, ADMIN, cr('proposals'), 'POST', { prospect_id: 1, event_id: 1 })).status, 403);
  assert.equal(all(f, 'SELECT 1 FROM ai_usage_logs').length, 0, 'no refused press runs the model');
  assert.equal(all(f, 'SELECT 1 FROM ai_rail_proposals').length, 0);
});

test('a message draft: one run for the founder to send; a draft naming a figure is dropped; a thank-you is for a pass; an intro names who asks', async () => {
  const f = fresh({ answer: { subject: 'Thank you for Friday', body: 'Thank you for Friday’s meeting. Here is the data-room link and our Q3 metrics pack.' } });
  const r = await call(f, OWNER, cr('drafts'), 'POST', { prospect_id: 2, purpose: 'follow_up' });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.draft.kind, r.body.draft.payload.eyebrow, r.body.draft.payload.to], ['draft', 'Follow-up', 'Lumen Ventures']);
  assert.deepEqual((await call(f, OWNER, cr('proposals'))).body.drafts.map((d: any) => d.payload.subject), ['Thank you for Friday']);
  assert.ok(!f.prompts.join().includes('lumen@example.test'), 'no email goes to the model');

  f.answer({ subject: 'Next steps', body: 'We would welcome your $250,000 in the round.' });
  const dropped = await call(f, OWNER, cr('drafts'), 'POST', { prospect_id: 2, purpose: 'follow_up' });
  assert.equal(dropped.status, 422);
  assert.equal(dropped.body.code, 'draft_dropped');
  assert.equal(all(f, "SELECT 1 FROM ai_rail_proposals WHERE kind = 'draft'").length, 1, 'nothing kept');

  assert.equal((await call(f, OWNER, cr('drafts'), 'POST', { prospect_id: 2, purpose: 'thank_you' })).status, 400, 'Lumen has not passed');
  assert.equal((await call(f, OWNER, cr('drafts'), 'POST', { prospect_id: 3, purpose: 'intro' })).status, 400, 'an intro names who to ask');
  assert.equal((await call(f, OWNER, cr('drafts'), 'POST', { prospect_id: 2, purpose: 'pitch' })).status, 400);
  assert.equal((await call(f, OWNER, cr('drafts'), 'POST', { prospect_id: 9, purpose: 'follow_up' })).status, 404);
  assert.deepEqual(logs(f).map((l) => l[2]), ['Drafted a follow-up for Lumen Ventures']);
});
