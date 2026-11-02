/**
 * D1583 (#3830, deck builder v2 F4): a teaser, a one-pager and a memo from one
 * frozen deck version. Synthetic data, the mounted Worker routes and the real
 * migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   · a blind teaser holds no venture, company or founder name, no logo or
 *     photo, no team card and no link;
 *   · memo figures equal the deck's: every figure a memo states is one the
 *     deck states, and a sentence where the model wrote a digit is dropped;
 *   · no derived output carries a binding (no provenance badge or source
 *     chip) or a speaker note;
 *   · every press is a proposal; nothing is stored until Accept, which stores
 *     the derivative and accepts the proposal together; the generic decide
 *     route can discard one but never accept it;
 *   · the memo's model is the AIRail's (`derive:memo`, `memo_write`), quoted
 *     before it runs; the teaser and the one-pager cost nothing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_derive_d1583.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckDerive from '../src/routes/deck_derive.ts';
import aiRailProposals from '../src/routes/ai_rail_proposals.ts';
import decks from '../src/routes/decks.ts';
import { ROUTE, __resetForTest } from '../src/services/aiRouter.ts';
import { TASK_LABELS } from '../src/services/aiCatalog.ts';
import { resolveRailOption } from '../src/services/ai/railMatrix.ts';
import { FIXED_JOBS } from '../src/services/ai/coverage.ts';
import {
  DERIVE_OPTIONS, blindCards, memoFacts, memoFrom, onePagerCard, redact, sourceCards, strayFigures, teaserCards,
} from '../src/services/decks/derive.ts';
import { fitsAt } from '../src/services/decks/reflow.ts';
import { figuresOf } from '../src/services/decks/variants.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-derive-d1583-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1583-only-not-a-real-credential'.repeat(2);

// Every name below is made up. Ledgerly is the venture, Ledgerly Labs Ltd its company, Ada Quill its founder, Ben Ward a cofounder.
const WHO = { venture: ['Ledgerly', 'Ledgerly Labs Ltd'], founders: ['Ada Quill', 'Ben Ward', 'Quill', 'Ward'] };
const BOUND = { source_key: 'grow.paying_customers', record_ref: 'project_metrics:1', as_of: '2026-10-10', grade: 'Stated', snapshot_hash: 'a'.repeat(24) };
const SLIDES = [
  { title: 'Ledgerly', subtitle: 'Month-end close for small finance teams, by Ada Quill', notes: 'Say hello to Ledgerly Labs Ltd.',
    blocks: [{ id: 'logo', kind: 'image', grid: { c1: 1, c2: 2, r1: 1, r2: 1 }, image_url: 'https://example.invalid/logo.png', alt: 'Ledgerly logo', tag: 'logo' }] },
  { title: 'The problem', body: 'Small finance teams spend 9 days closing the books. Ledgerly saw this first hand.', notes: 'Ada tells the story here.' },
  { title: 'Our solution', body: 'Ledgerly closes the books in 2 days.',
    blocks: [{ id: 'demo', kind: 'link', grid: { c1: 1, c2: 4, r1: 5, r2: 6 }, url: 'https://example.invalid/dataroom', label: 'Data room' }] },
  { title: 'Traction', layout: 'metric_tiles', blocks: [
    { id: 'h1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Customers on record' },
    { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 2, r2: 4 }, label: 'Paying customers', value: '42', binding: BOUND },
    { id: 'm2', kind: 'metric', grid: { c1: 4, c2: 6, r1: 2, r2: 4 }, label: 'MRR', value: '$18k' },
    { id: 'c1', kind: 'chart', grid: { c1: 7, c2: 12, r1: 2, r2: 4 }, chart_type: 'line', series: [{ label: 'Accounts', binding: BOUND }] },
  ] },
  { title: 'The team', body: 'Ada Quill and Ben Ward built finance tools for 10 years.',
    blocks: [{ id: 'ph', kind: 'image', grid: { c1: 1, c2: 3, r1: 2, r2: 4 }, image_url: 'https://example.invalid/ada.png', alt: 'Ada Quill', tag: 'photo' }] },
  { title: 'Market', body: 'There are 40,000 small finance teams in the UK.' },
  { title: 'The ask', body: 'We are raising $1.5M to reach 300 customers.' },
  { title: 'Sources', appendix: true, body: 'Interviews, October 2026.' },
];

async function fixture(answer: () => string = () => '## Summary\nA tool that closes the books in {{F3}}.') {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, name] of [[2, 'founder', 100, 'Ada Quill'], [3, 'founder', 300, 'Other Person'], [4, 'founder', null, 'Ben Ward']] as const) {
    insert.run(id, role, fid, name, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO founders(id,name,email) VALUES (100,'Ada Quill','ada@example.invalid'),(300,'Other Person','o@example.invalid')");
  db.exec("INSERT INTO company_profiles(id,uid,company_name,created_at,updated_at) VALUES (9,'co-9','Ledgerly Labs Ltd','2026-01-01','2026-01-01')");
  db.exec("INSERT INTO projects(id,name,founder_id,company_id) VALUES (1,'Ledgerly',100,9),(3,'Other venture',300,NULL)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify(SLIDES));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: Array<{ model: string; prompt: string; system: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const msgs = input?.messages || [];
      calls.push({
        model,
        prompt: msgs.filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n'),
        system: msgs.filter((m: any) => m.role === 'system').map((m: any) => String(m.content || '')).join('\n'),
      });
      return { response: answer(), usage: { prompt_tokens: 600, completion_tokens: 300 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  db.prepare("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted')").run();
  const app = new Hono<any>().route('/api/decks', deckDerive).route('/api/ai/rail/proposals', aiRailProposals).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const proposals = () => db.prepare('SELECT uid, rail_option, record_ref, status, payload_json, model FROM ai_rail_proposals ORDER BY id').all().map((r: any) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  const derivatives = () => db.prepare('SELECT * FROM deck_derivatives ORDER BY id').all().map((r: any) => ({ ...r }));
  const versions = () => JSON.stringify(db.prepare('SELECT id, version, slides, is_current, format FROM pitch_decks ORDER BY id').all());
  return { db, env, app, calls, proposals, derivatives, versions, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string, json?: unknown, method = 'POST') {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const has = (v: unknown, re: RegExp) => re.test(JSON.stringify(v));
const NAMES = /ledgerly|ada|quill|ben ward|\bward\b/i;
const PROVENANCE = /"binding"|"grade"|"source_key"|"snapshot_hash"|"record_ref"|"as_of"/;

// ─────────────────────────────────────────────────────────── migration 744

test('744: every version is a deck; a derivative is its own row, with a memo exactly when it is a memo', async () => {
  const f = await fixture();
  try {
    assert.equal((f.db.prepare('SELECT format FROM pitch_decks WHERE id = 7').get() as any).format, 'deck');
    assert.throws(() => f.db.prepare("INSERT INTO pitch_decks (project_id, version, slides, format) VALUES (1, 4, '[]', 'teaser')").run(), /CHECK/);
    const ins = f.db.prepare("INSERT INTO deck_derivatives (uid, deck_id, project_id, format, title, memo, proposal_uid, created_by) VALUES (?, 7, 1, ?, 'T', ?, ?, 2)");
    assert.throws(() => ins.run('u1', 'teaser', 'text', 'p1'), /CHECK/, 'a teaser holds no memo');
    assert.throws(() => ins.run('u2', 'memo', null, 'p2'), /CHECK/, 'a memo holds its text');
    assert.throws(() => ins.run('u3', 'slides', null, 'p3'), /CHECK/, 'the format is checked');
    ins.run('u4', 'memo', 'Text.', 'p4');
    assert.throws(() => ins.run('u5', 'memo', 'Text.', 'p4'), /UNIQUE/, 'one derivative per proposal');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── pure

test('a cleaned card carries no binding, no notes and no appendix; a bound chart series leaves, a typed one stays', () => {
  const cards = sourceCards(SLIDES, false);
  assert.equal(cards.length, SLIDES.length - 1, 'the Sources appendix is left out');
  assert.ok(!has(cards, PROVENANCE), 'no provenance badge or source chip can be drawn');
  assert.ok(!has(cards, /"notes"/));
  const traction = cards.find((c: any) => c.title === 'Traction');
  assert.deepEqual(traction.blocks.map((b: any) => b.id), ['h1', 'm1', 'm2'], 'the bound-only chart leaves');
  assert.deepEqual(traction.blocks.find((b: any) => b.id === 'm1'), { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 2, r2: 4 }, label: 'Paying customers', value: '42' });
  const typed = sourceCards([{ title: 'T', blocks: [{ id: 'c', kind: 'chart', grid: { c1: 1, c2: 6, r1: 1, r2: 3 }, chart_type: 'line', series: [{ label: 'Typed', points: [{ x: 'Sep', y: 3 }] }] }] }], false);
  assert.deepEqual(typed[0].blocks[0].series, [{ label: 'Typed', points: [{ x: 'Sep', y: 3 }] }]);
  // A named output keeps a video, but never the binding it carried.
  const video = sourceCards([{ title: 'Demo', blocks: [{ id: 'v', kind: 'video', grid: { c1: 1, c2: 6, r1: 1, r2: 3 }, url: 'https://example.invalid/v', binding: BOUND }] }], false);
  assert.equal(video[0].blocks[0].kind, 'video');
  assert.ok(!has(video, PROVENANCE));
});

test('redact replaces whole names in any case, longest first, and leaves other words', () => {
  assert.equal(redact('Ledgerly Labs Ltd and LEDGERLY, built by Ada Quill.', WHO), 'the company and the company, built by a founder.');
  assert.equal(redact('Ledgerlyish wardrobes', WHO), 'Ledgerlyish wardrobes', 'a name inside a longer word is left');
});

test('a blind teaser holds no venture name, no founder, no logo or photo, no team card and no link', () => {
  const blind = teaserCards(SLIDES, { blind: true, who: WHO });
  assert.ok(blind.length >= 3 && blind.length <= 6);
  assert.ok(!has(blind, NAMES), JSON.stringify(blind));
  assert.ok(!has(blind, /"tag":"(logo|photo)"/));
  assert.ok(!blind.some((c: any) => /team/i.test(c.title)));
  assert.ok(!has(blind, /"kind":"link"|dataroom/), 'no data room travels with it');
  assert.ok(!has(blind, PROVENANCE));
  // The named teaser keeps the order and the cover, and still drops the bindings and notes.
  const named = teaserCards(SLIDES, { blind: false, who: WHO });
  assert.equal(named[0].title, 'Ledgerly');
  assert.deepEqual(named.map((c: any) => c.title), ['Ledgerly', 'The problem', 'Our solution', 'Traction', 'Market', 'The ask']);
  assert.ok(!has(named, PROVENANCE) && !has(named, /"notes"/));
  // blindCards alone keeps the cover, even when its title is a team word.
  assert.equal(blindCards([{ title: 'Team Ledgerly' }, { title: 'The team' }], WHO).length, 1);
  // With no investor section to pick, the team card takes no place a blind teaser could fill.
  const plain = [{ title: 'Cover' }, { title: 'The team', body: 'x' }, ...['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((t) => ({ title: t, body: 'Words.' }))];
  assert.deepEqual(teaserCards(plain, { blind: true, who: WHO }).map((c: any) => c.title), ['Cover', 'One', 'Two', 'Three', 'Four', 'Five']);
});

test('every figure a teaser or a one-pager states is the deck\'s; the one-pager fits its page at 4:3', () => {
  const pager = onePagerCard(SLIDES, { blind: false, who: WHO });
  assert.equal(pager.length, 1);
  assert.ok(fitsAt(pager, '4:3'), 'nothing overflows at 4:3');
  assert.deepEqual(strayFigures(SLIDES, pager), []);
  assert.deepEqual(strayFigures(SLIDES, teaserCards(SLIDES, { blind: true, who: WHO })), []);
  assert.ok(pager[0].blocks.some((b: any) => b.kind === 'metric' && b.value === '42'));
  assert.ok(!has(onePagerCard(SLIDES, { blind: true, who: WHO }), NAMES));
  // Long sections still fit: what does not is reflowed off the page, not left to overflow.
  const long = 'Small finance teams lose whole weeks every month to reconciling bank feeds, chasing receipts and rebuilding the same spreadsheets by hand again.';
  const wordy = [{ title: 'Cover' }, ...['The problem', 'Our solution', 'Market', 'Business model', 'The ask'].map((t) => ({ title: t, body: `${long} ${long}` }))];
  const page = onePagerCard(wordy, { blind: false, who: WHO });
  assert.equal(page.length, 1);
  assert.ok(fitsAt(page, '4:3'), 'the long one-pager fits at 4:3');
});

test('memo figures equal the deck\'s: placeholders become the deck\'s values; a written digit or unknown placeholder drops its sentence', () => {
  const facts = memoFacts(sourceCards(SLIDES, false));
  assert.deepEqual(facts.figures.slice(0, 2), [{ ref: 'F1', value: '42', label: 'Paying customers' }, { ref: 'F2', value: '$18k', label: 'MRR' }]);
  assert.ok(!/\d(?![^{]*\}\})/.test(JSON.stringify(facts.cards).replace(/\{\{F\d+\}\}/g, '')), 'the model reads no bare number');
  const ref = (v: string) => facts.figures.find((x) => x.value === v)!.ref;
  const out = memoFrom([
    '## Summary', `Teams close in {{${ref('2')}}} days. They have {{${ref('42')}}} paying customers.`,
    '## Traction', 'Revenue grew 300% last year. MRR is {{F99}}. It works.',
  ].join('\n'), facts, { blind: false, who: WHO });
  assert.match(out.memo, /close in 2 days\. They have 42 paying customers\./);
  assert.ok(!/300%/.test(out.memo) && !/F99/.test(out.memo));
  assert.equal(out.dropped, 2);
  assert.deepEqual(out.figures.map((x) => x.value).sort(), ['2', '42']);
  const deck = figuresOf(sourceCards(SLIDES, false));
  for (const fig of figuresOf([out.memo])) assert.ok(deck.has(fig), `${fig} is the deck's`);
  assert.deepEqual(strayFigures(SLIDES, out.memo), []);
});

// ─────────────────────────────────────────────────────────── routes

test('the teaser and the one-pager cost nothing and are proposals; nothing is stored and no version changes', async () => {
  const f = await fixture();
  try {
    const before = f.versions();
    const q = await call(f, 2, '/api/decks/7/derive/quote', { format: 'teaser', blind: true });
    assert.deepEqual(q.body, { format: 'teaser', option: 'derive:teaser', ai: false, hold_microusd: 0, model: null });
    const r = await call(f, 2, '/api/decks/7/derive', { format: 'teaser', blind: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(!has(r.body.cards, NAMES), 'the press answers a blind teaser');
    assert.equal(r.body.title, 'Blind teaser · from v3');
    const one = await call(f, 2, '/api/decks/7/derive', { format: 'one_pager' });
    assert.equal(one.status, 200);
    assert.equal(f.calls.length, 0, 'no model ran');
    const rows = f.proposals();
    assert.deepEqual(rows.map((x: any) => [x.rail_option, x.record_ref, x.status]), [['derive:teaser', 'deck:7', 'proposed'], ['derive:one_pager', 'deck:7', 'proposed']]);
    assert.ok(!has(rows[0].payload, NAMES), 'the blind proposal names no one either');
    assert.deepEqual(f.derivatives(), []);
    assert.equal(f.versions(), before);
  } finally { f.close(); }
});

test('Accept stores the derivative and accepts the proposal together; twice is 409; the generic decide never accepts one but can discard', async () => {
  const f = await fixture();
  try {
    const a = await call(f, 2, '/api/decks/7/derive', { format: 'teaser', blind: true });
    const b = await call(f, 2, '/api/decks/7/derive', { format: 'one_pager', blind: true });
    const generic = await call(f, 2, `/api/ai/rail/proposals/${a.body.proposal.uid}/decide`, { decision: 'accept' });
    assert.equal(generic.status, 409, 'a derive proposal is never accepted without its derivative');
    assert.deepEqual(f.derivatives(), []);
    const kept = await call(f, 2, `/api/decks/7/derive/${a.body.proposal.uid}/accept`);
    assert.equal(kept.status, 201, JSON.stringify(kept.body));
    const rows = f.derivatives();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].format, rows[0].blind, rows[0].deck_id, rows[0].proposal_uid, rows[0].memo], ['teaser', 1, 7, a.body.proposal.uid, null]);
    assert.ok(!NAMES.test(rows[0].slides) && !PROVENANCE.test(rows[0].slides));
    assert.equal(f.proposals()[0].status, 'accepted');
    assert.equal((await call(f, 2, `/api/decks/7/derive/${a.body.proposal.uid}/accept`)).status, 409);
    const discard = await call(f, 2, `/api/ai/rail/proposals/${b.body.proposal.uid}/decide`, { decision: 'discard' });
    assert.equal(discard.status, 200);
    assert.equal((await call(f, 2, `/api/decks/7/derive/${b.body.proposal.uid}/accept`)).status, 409, 'a discarded proposal is not kept');
    assert.equal(f.derivatives().length, 1);
    // The reads: the list names it, the row gives its cards.
    const list = await call(f, 2, '/api/decks/7/derivatives', undefined, 'GET');
    assert.deepEqual(list.body.derivatives.map((d: any) => [d.uid, d.format, d.blind]), [[rows[0].uid, 'teaser', true]]);
    const one = await call(f, 2, `/api/decks/derivatives/${rows[0].uid}`, undefined, 'GET');
    assert.ok(Array.isArray(one.body.derivative.cards) && one.body.derivative.cards.length >= 3);
    assert.equal((await call(f, 3, `/api/decks/derivatives/${rows[0].uid}`, undefined, 'GET')).status, 404, 'another venture\'s founder reads nothing');
  } finally { f.close(); }
});

test('Accept that loses a race with Discard stores nothing: the insert waits on a still-open proposal', async () => {
  const f = await fixture();
  try {
    const a = await call(f, 2, '/api/decks/7/derive', { format: 'teaser' });
    const uid = a.body.proposal.uid;
    const batch = f.env.DB.batch.bind(f.env.DB);
    f.env.DB.batch = async (stmts: any) => { f.db.prepare("UPDATE ai_rail_proposals SET status = 'discarded' WHERE uid = ?").run(uid); return batch(stmts); };
    const r = await call(f, 2, `/api/decks/7/derive/${uid}/accept`);
    assert.deepEqual([r.status, r.body.error], [409, 'not_open']);
    assert.deepEqual(f.derivatives(), [], 'no derivative without its accepted proposal');
    assert.equal(f.proposals()[0].status, 'discarded');
  } finally { f.close(); }
});

test('a blind teaser whose venture was renamed since its proposal is not kept: 409 derivative_changed', async () => {
  const f = await fixture();
  try {
    const a = await call(f, 2, '/api/decks/7/derive', { format: 'teaser', blind: true });
    f.db.prepare("UPDATE projects SET name = 'Teaser' WHERE id = 1").run();
    const r = await call(f, 2, `/api/decks/7/derive/${a.body.proposal.uid}/accept`);
    assert.deepEqual([r.status, r.body.error], [409, 'derivative_changed']);
    assert.deepEqual(f.derivatives(), []);
    assert.equal(f.proposals()[0].status, 'proposed');
  } finally { f.close(); }
});

test('the memo: memo_write on the AIRail\'s model, quoted first; its figures are the deck\'s; a blind memo names no one', async () => {
  const f = await fixture(() => '## Summary\nLedgerly closes the books in {{F3}} days for teams. Ada Quill founded it. Revenue grew 300% last year.\n## The ask\nA raise to reach new customers.');
  try {
    const q = await call(f, 2, '/api/decks/7/derive/quote', { format: 'memo', blind: true });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true);
    assert.ok(q.body.hold_microusd > 0, 'the hold is shown before it runs');
    assert.equal(q.body.model, '@cf/openai/gpt-oss-120b', 'the AIRail row\'s default');
    assert.equal(f.calls.length, 0, 'a quote runs nothing');
    const r = await call(f, 2, '/api/decks/7/derive', { format: 'memo', blind: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const run = f.calls.find((c) => /investment memo/.test(c.system))!;
    assert.equal(run.model, '@cf/openai/gpt-oss-120b');
    assert.match(run.system, /NEVER write a digit/);
    assert.ok(!NAMES.test(run.prompt), 'a blind memo\'s model never reads a name');
    assert.ok(!NAMES.test(r.body.memo), r.body.memo);
    assert.ok(!/300%/.test(r.body.memo), 'a figure the model wrote is dropped');
    for (const fig of figuresOf([r.body.memo])) assert.ok(figuresOf(sourceCards(SLIDES, false)).has(fig), fig);
    const row = f.proposals()[0];
    assert.deepEqual([row.rail_option, row.record_ref, row.status], ['derive:memo', 'deck:7', 'proposed']);
    assert.ok(row.model);
    const kept = await call(f, 2, `/api/decks/7/derive/${row.uid}/accept`);
    assert.equal(kept.status, 201);
    assert.equal(f.derivatives()[0].memo, r.body.memo);
    // The model is the AIRail's only: a model the request names is ignored, and the member's pick for derive:memo runs.
    await call(f, 2, '/api/decks/7/derive', { format: 'memo', model: '@cf/meta/llama-3.1-8b-instruct-fp8' });
    assert.equal(f.calls.filter((c) => /investment memo/.test(c.system)).at(-1)!.model, '@cf/openai/gpt-oss-120b', 'a named model is not used');
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,model) VALUES('pick-1',2,'founder · raise · pitch deck','derive:memo','@cf/nvidia/nemotron-3-120b-a12b')").run();
    const quoted = await call(f, 2, '/api/decks/7/derive/quote', { format: 'memo' });
    assert.equal(quoted.body.model, '@cf/nvidia/nemotron-3-120b-a12b', 'the quote names the pick');
    const g = await call(f, 2, '/api/decks/7/derive', { format: 'memo' });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(f.calls.filter((c) => /investment memo/.test(c.system)).at(-1)!.model, '@cf/nvidia/nemotron-3-120b-a12b');
  } finally { f.close(); }
});

test('a memo whose placeholders fuse into a figure the deck never states is refused: 422 figure_in_output, nothing proposed', async () => {
  // Two placeholders side by side put two of the deck's own values together ("42" and "42" read "4242"). Every
  // sentence survives memoFrom, so only the route's stray-figure check stands between that number and the memo.
  const f = await fixture(() => '## Summary\nThe team serves {{F1}}{{F1}} teams today.');
  try {
    const r = await call(f, 2, '/api/decks/7/derive', { format: 'memo' });
    assert.deepEqual([r.status, r.body.error], [422, 'figure_in_output'], JSON.stringify(r.body));
    assert.deepEqual(f.proposals(), [], 'nothing waits in Ask');
    assert.deepEqual(f.derivatives(), []);
  } finally { f.close(); }
});

test('refused before anything runs: an unknown format, another venture\'s deck, an empty version', async () => {
  const f = await fixture();
  try {
    assert.deepEqual([(await call(f, 2, '/api/decks/7/derive', { format: 'brochure' })).body.error], ['unknown_format']);
    assert.equal((await call(f, 3, '/api/decks/7/derive', { format: 'teaser' })).status, 403);
    f.db.prepare("INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (8, 1, 4, '[]', 0)").run();
    const empty = await call(f, 2, '/api/decks/8/derive', { format: 'memo' });
    assert.deepEqual([empty.status, empty.body.error], [422, 'deck_empty']);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.proposals(), []);
  } finally { f.close(); }
});

test('memo_write is a router task with its label, a fixed job, and the AIRail\'s derive:memo row, the IC memo job\'s (IN1)', () => {
  assert.equal(ROUTE.memo_write.model, '@cf/openai/gpt-oss-120b');
  assert.deepEqual(ROUTE.memo_write.alternates, ['@cf/openai/gpt-oss-120b', '@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/nvidia/nemotron-3-120b-a12b']);
  assert.equal(TASK_LABELS.memo_write, 'Write a memo from a deck');
  assert.ok(FIXED_JOBS.some((j) => j.task === 'memo_write' && j.module === 'raise'));
  const row = resolveRailOption('Founder · Raise · Pitch deck', DERIVE_OPTIONS.memo)!;
  assert.deepEqual([row.kind, row.routeTask, row.models.map((m) => m.id)], ['memo', 'memo_write', ['@cf/openai/gpt-oss-120b', '@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/nvidia/nemotron-3-120b-a12b']]);
});
