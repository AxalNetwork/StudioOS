/**
 * D1540 (#3791, deck v2 B15): recourse and pricing. A founder reports a bad
 * result, HQ reads and resolves the reports, a quote settles at no more than
 * its quoted price, the markup is one figure, and the owner's daily ceiling
 * pauses deck generation before any hold. Synthetic data, the mounted Worker
 * routes and the real migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_reports_pricing_d1540.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckNew from '../src/routes/deck_new.ts';
import decks from '../src/routes/decks.ts';
import { deckReports, hqDeckReports, REPORT_REASONS } from '../src/routes/deck_reports.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { AI_MARKUP, multiplierFor, pricingVersion } from '../src/services/ai/pricing.ts';
import { CEILING_REACHED, dailyCeiling, pinQuote, takeQuote } from '../src/services/decks/runQuotes.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-d1540-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1540-only-not-a-real-credential'.repeat(2);
const PAGE = 'Founder · Raise · Pitch deck';
const FOUNDER = 2;
const OTHER = 4;
const ADMIN = 1;

/** `usage`: the tokens the stub reports for each deck run; `during`: called inside the run, before it answers. */
async function fixture(opt: { usage?: { prompt_tokens: number; completion_tokens: number }; during?: (env: any) => void } = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[ADMIN, 'admin', null, 'studio'], [FOUNDER, 'founder', 100, 'studio'], [OTHER, 'founder', 400, 'studio']] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(4,'Synthetic other venture',400)");
  db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,paying_accounts) VALUES (1,1,'2026-10-10','manual',42)");
  for (const u of [FOUNDER, OTHER]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(u);
  for (const key of ['founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const calls: string[] = [];
  env.AI = withGuard({
    run: async (model: string, input: any) => {
      calls.push(model);
      opt.during?.(env);
      const prompt = (input?.messages || []).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
      const response = /^Plan a /m.test(prompt) ? JSON.stringify({ rows: [] }) : JSON.stringify({ cards: [] });
      return { response, usage: opt.usage ?? { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckNew).route('/api/decks', deckReports).route('/api/admin/deck-reports', hqDeckReports).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT id, rail_option, charged_microusd, reservation_uid FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const hold = (uid: string) => db.prepare('SELECT status, included_microusd + topup_microusd AS held, actual_included_microusd + actual_topup_microusd AS charged_microusd FROM ai_budget_reservations WHERE uid = ?').get(uid) as any;
  return { db, env, app, calls, runs, hold, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ ...claims, user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/** The one-click's whole-deck quote and build body (OneClickBuild.jsx). */
const ONE_CLICK = { project_id: 1, step: 'build', audience: 'seed_fund', length: 'short', round_ref: null };
/** Far more input than any hold allows for, so the run's cost at today's prices passes the quote. */
const HEAVY = { prompt_tokens: 3_000_000, completion_tokens: 2_000 };

// ─────────────────────────────────────────────────────────── pinned quotes

test('a quote made before a price change settles at the quoted price: the one-click whole-deck quote is pinned with pricing_version', async () => {
  const f = await fixture({ usage: HEAVY });
  try {
    const q = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true);
    const quoted = q.body.hold_microusd;
    assert.ok(quoted > 0);
    assert.match(q.body.quote_uid, /^dq_[0-9a-f]{32}$/);
    assert.equal(q.body.pricing_version, pricingVersion(f.env));
    const row = f.db.prepare('SELECT user_id, project_id, step, hold_microusd, pricing_version, used_at FROM deck_run_quotes WHERE uid = ?').get(q.body.quote_uid) as any;
    assert.deepEqual({ ...row }, { user_id: FOUNDER, project_id: 1, step: 'build', hold_microusd: quoted, pricing_version: q.body.pricing_version, used_at: null });

    // The price changes after the quote: billing moves from cost to the 1.25× markup.
    f.env.AI_BILLING = 'charged';
    assert.notEqual(pricingVersion(f.env), q.body.pricing_version);
    const now = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    assert.ok(now.body.hold_microusd > quoted, 'the same run quotes higher at the new price');

    const g = await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    const run = f.runs().at(-1);
    const h = f.hold(run.reservation_uid);
    assert.ok(h.held <= quoted, 'the hold is no larger than the quote');
    assert.equal(h.status, 'settled', 'settled, not sent to review');
    assert.equal(h.charged_microusd, quoted, 'a run that cost more at the new price settles at the quoted price');
    assert.equal(run.charged_microusd, quoted);
    assert.equal(g.body.cost.charged_microusd, quoted);
    assert.deepEqual(g.body.cost.quote, { uid: q.body.quote_uid, quoted_microusd: quoted, pricing_version: q.body.pricing_version, pricing_version_now: pricingVersion(f.env) });

    // After the run, prices move again: the settled charge does not.
    f.env.AI_BILLING = undefined;
    assert.equal(f.hold(run.reservation_uid).charged_microusd, quoted);
  } finally { f.close(); }
});

test('without the pin, the same run after the same price change charges past the quote (the pin is what holds it)', async () => {
  const f = await fixture({ usage: HEAVY });
  try {
    const q = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    const quoted = q.body.hold_microusd;
    f.env.AI_BILLING = 'charged';
    const g = await call(f, FOUNDER, 'POST', '/api/decks/generate', ONE_CLICK);
    assert.notEqual(g.status, 201, 'unpinned, the run cost more than its own hold: the settlement is not written');
    const h = f.db.prepare('SELECT status, included_microusd + topup_microusd AS held FROM ai_budget_reservations ORDER BY rowid DESC LIMIT 1').get() as any;
    assert.ok(h.held > quoted, 'unpinned, the hold is at the new price');
    assert.equal(h.status, 'review', 'unpinned, the charge waits for review: it is not held to the quote');
  } finally { f.close(); }
});

test('a price change during the run settles at no more than the quote', async () => {
  const f = await fixture({ usage: HEAVY, during: (env) => { env.AI_BILLING = 'charged'; } });
  try {
    const q = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    const g = await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    const run = f.runs().at(-1);
    assert.ok(run.charged_microusd != null && run.charged_microusd <= q.body.hold_microusd);
    assert.ok(f.hold(run.reservation_uid).charged_microusd <= q.body.hold_microusd);
  } finally { f.close(); }
});

test('a pinned run that costs less than its quote pays what it used; the outline quote is pinned too', async () => {
  const f = await fixture();
  try {
    const q = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    const g = await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid });
    assert.equal(g.status, 201);
    assert.ok(g.body.cost.charged_microusd > 0 && g.body.cost.charged_microusd < q.body.hold_microusd);
    const o = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', { ...ONE_CLICK, step: 'outline' });
    assert.match(o.body.quote_uid, /^dq_/);
    const out = await call(f, FOUNDER, 'POST', '/api/decks/outline', { ...ONE_CLICK, quote_uid: o.body.quote_uid });
    assert.equal(out.status, 201, JSON.stringify(out.body));
    assert.equal(out.body.cost.quote.uid, o.body.quote_uid);
    const card = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', { ...ONE_CLICK, step: 'card', index: 0 });
    assert.equal(card.body.quote_uid, undefined, 'a card\'s quote is shown, not pinned');
  } finally { f.close(); }
});

test('a quote prices one run, for its member, venture and run only: anything else is quote_stale and runs nothing', async () => {
  const f = await fixture();
  try {
    const q = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    const before = f.calls.length;
    // A quote for six cards cannot cap a sixteen-card run.
    const bigger = await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, length: 'full', quote_uid: q.body.quote_uid });
    assert.equal(bigger.status, 409);
    assert.equal(bigger.body.error, 'quote_stale');
    // Another member cannot use it, even on their own venture.
    const other = await call(f, OTHER, 'POST', '/api/decks/generate', { ...ONE_CLICK, project_id: 4, quote_uid: q.body.quote_uid });
    assert.equal(other.status, 409);
    for (const bad of ['dq_nope', 42, 'x'.repeat(40)]) {
      assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: bad })).status, 409, String(bad));
    }
    assert.equal(f.calls.length, before, 'nothing ran');
    assert.deepEqual(f.runs(), []);
    const used = await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid });
    assert.equal(used.status, 201);
    const again = await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid });
    assert.equal(again.status, 409, 'a quote is used once');
    assert.equal(again.body.error, 'quote_stale');
    // A lapsed quote is refused.
    const lapsed = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    f.db.prepare("UPDATE deck_run_quotes SET expires_at = datetime('now', '-1 minute') WHERE uid = ?").run(lapsed.body.quote_uid);
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: lapsed.body.quote_uid })).status, 409);
  } finally { f.close(); }
});

test('a quote is taken only by the member it was made for, on its venture and step', async () => {
  const f = await fixture();
  try {
    const opts: any = { task: 'rail_write', userId: FOUNDER, messages: [{ role: 'user', content: 'Synthetic' }], maxTokens: 100 };
    const pin = (await pinQuote(f.env, { userId: FOUNDER, projectId: 1, step: 'build', holdMicrousd: 500, model: null, opts }))!;
    assert.ok(pin, 'pinned');
    assert.ok('stale' in await takeQuote(f.env, pin.uid, { userId: OTHER, projectId: 1, step: 'build', opts }), 'another member');
    assert.ok('stale' in await takeQuote(f.env, pin.uid, { userId: FOUNDER, projectId: 4, step: 'build', opts }), 'another venture');
    assert.ok('stale' in await takeQuote(f.env, pin.uid, { userId: FOUNDER, projectId: 1, step: 'outline', opts }), 'another step');
    const taken = await takeQuote(f.env, pin.uid, { userId: FOUNDER, projectId: 1, step: 'build', opts });
    assert.deepEqual('quote' in taken ? taken.quote : null, { uid: pin.uid, hold_microusd: 500, pricing_version: pin.pricing_version });
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── markup and ceiling

test('the markup is one figure, 1.25×, and the admin licence pays cost', () => {
  assert.equal(AI_MARKUP, 1.25);
  assert.equal(multiplierFor('founder:studio'), AI_MARKUP);
  assert.equal(multiplierFor('admin'), 1);
  assert.match(pricingVersion({ AI_BILLING: 'charged' }), /\.billed\.x1\.25$/);
  assert.match(pricingVersion({}), /\.cost\.x1\.25$/);
});

test('the daily ceiling is off until the owner sets it, and then pauses deck generation before any hold', async () => {
  const f = await fixture();
  try {
    for (const v of [undefined, '', '0', '-5', 'abc', '1.5']) assert.equal(dailyCeiling({ DECK_DAILY_CEILING_MICROUSD: v } as any), null, String(v));
    assert.equal(dailyCeiling({ DECK_DAILY_CEILING_MICROUSD: ' 5000000 ' } as any), 5_000_000);
    // Off: builds run.
    const first = await call(f, FOUNDER, 'POST', '/api/decks/generate', ONE_CLICK);
    assert.equal(first.status, 201);
    const spent = f.runs()[0].charged_microusd;
    assert.ok(spent > 0);
    // Set, with room for no more than what ran: the next build would pass it, so it is refused up front.
    f.env.DECK_DAILY_CEILING_MICROUSD = String(spent + 1);
    const holds = (f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n;
    const calls = f.calls.length;
    for (const [path, body] of [['/api/decks/generate', ONE_CLICK], ['/api/decks/outline', ONE_CLICK]] as const) {
      const r = await call(f, OTHER, 'POST', path, { ...body, project_id: 4 });
      assert.equal(r.status, 429, path);
      assert.equal(r.body.error, 'deck_ceiling_reached');
      assert.equal(r.body.message, CEILING_REACHED);
      assert.equal(r.body.message, 'Generation is paused for today. Manual editing still works.');
    }
    assert.equal(f.calls.length, calls, 'nothing ran');
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n, holds, 'no hold was taken');
    // A pinned quote refused by the ceiling is given back, unused.
    const q = await call(f, FOUNDER, 'POST', '/api/decks/new/quote', ONE_CLICK);
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid })).status, 429);
    assert.equal((f.db.prepare('SELECT used_at FROM deck_run_quotes WHERE uid = ?').get(q.body.quote_uid) as any).used_at, null);
    // Raised: the same build runs, on that quote.
    f.env.DECK_DAILY_CEILING_MICROUSD = String(spent + q.body.hold_microusd);
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/generate', { ...ONE_CLICK, quote_uid: q.body.quote_uid })).status, 201);
    // Yesterday's spend does not count today.
    f.db.prepare("UPDATE ai_usage_logs SET created_at = datetime('now', '-1 day')").run();
    f.env.DECK_DAILY_CEILING_MICROUSD = String(q.body.hold_microusd);
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/generate', ONE_CLICK)).status, 201);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── reports

function proposal(f: F, uid: string, user = FOUNDER, page = PAGE) {
  f.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, model, usage_log_id)
    VALUES (?, ?, ?, 'deck:area', 'project:1', 'proposal', '{"text":"Synthetic words"}', '@cf/synthetic/model', NULL)`).run(uid, user, page);
}

test('a founder reports their own deck result once, with a reason and a short note', async () => {
  const f = await fixture();
  try {
    proposal(f, 'rp-own');
    proposal(f, 'rp-theirs', OTHER);
    proposal(f, 'rp-elsewhere', FOUNDER, 'Founder · Validate');
    const r = await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-own/report', { reason: 'wrong_figure', note: '  The revenue line is not ours.  ' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.report.uid, /^dr_[0-9a-f]{32}$/);
    assert.deepEqual([r.body.report.reason, r.body.report.reason_label, r.body.report.note, r.body.report.status, r.body.report.rail_option, r.body.report.model],
      ['wrong_figure', REPORT_REASONS.wrong_figure, 'The revenue line is not ours.', 'open', 'deck:area', '@cf/synthetic/model']);
    const again = await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-own/report', { reason: 'other' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_reported');
    assert.equal(again.body.report.uid, r.body.report.uid);
    for (const uid of ['rp-theirs', 'rp-elsewhere', 'rp-missing']) {
      const x = await call(f, FOUNDER, 'POST', `/api/decks/proposals/${uid}/report`, { reason: 'other' });
      assert.equal(x.status, 404, uid);
      assert.equal(x.body.message, 'That result is not one of yours.');
    }
    proposal(f, 'rp-two');
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-two/report', { reason: 'made_up' })).body.error, 'invalid_reason');
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-two/report', { reason: 'other', note: 'x'.repeat(281) })).body.error, 'note_too_long');
    assert.equal((await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-two/report', { reason: 'other', note: 7 })).body.error, 'invalid_note');
    const support = await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-two/report', { reason: 'other' }, { impersonated_by: ADMIN });
    assert.equal(support.status, 403);
    assert.equal(support.body.error, 'support_session_refused');
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM deck_proposal_reports').get() as any).n, 1, 'only the one good report was written');
    const plain = await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-two/report', { reason: 'poor_writing' });
    assert.equal(plain.body.report.note, null, 'no note is null, never an empty string');
  } finally { f.close(); }
});

test('HQ reads the queue and resolves a report; a founder or a branch cannot', async () => {
  const f = await fixture();
  try {
    proposal(f, 'rp-q');
    const made = await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-q/report', { reason: 'bad_image', note: 'Wrong person.' });
    assert.equal((await call(f, FOUNDER, 'GET', '/api/admin/deck-reports')).status, 403);
    assert.equal((await call(f, FOUNDER, 'POST', `/api/admin/deck-reports/${made.body.report.uid}/resolve`, { outcome: 'addressed' })).status, 403);
    const q = await call(f, ADMIN, 'GET', '/api/admin/deck-reports');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.reports.length, 1);
    const r = q.body.reports[0];
    assert.deepEqual([r.uid, r.reason, r.note, r.status, r.charged_microusd], [made.body.report.uid, 'bad_image', 'Wrong person.', 'open', null]);
    assert.deepEqual(r.proposal, { status: 'proposed', payload: { text: 'Synthetic words' } });
    assert.equal((await call(f, ADMIN, 'GET', '/api/admin/deck-reports?status=nope')).status, 400);
    assert.equal((await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${r.uid}/resolve`, { outcome: 'refund' })).body.error, 'invalid_outcome');
    const done = await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${r.uid}/resolve`, { outcome: 'addressed', note: 'Image model flagged.' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([done.body.report.status, done.body.report.outcome, done.body.report.resolution_note], ['resolved', 'addressed', 'Image model flagged.']);
    assert.equal((await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${r.uid}/resolve`, { outcome: 'no_fault' })).body.error, 'already_resolved');
    assert.equal((await call(f, ADMIN, 'POST', '/api/admin/deck-reports/dr_missing/resolve', { outcome: 'no_fault' })).status, 404);
    assert.deepEqual((await call(f, ADMIN, 'GET', '/api/admin/deck-reports')).body.reports, [], 'the open queue is empty');
    assert.equal((await call(f, ADMIN, 'GET', '/api/admin/deck-reports?status=resolved')).body.reports.length, 1);
    const audit = (f.db.prepare("SELECT action FROM admin_audit_log ORDER BY id").all() as any[]).map((x) => x.action);
    assert.ok(audit.includes('deck_report_resolved') && audit.includes('deck_reports_read'), JSON.stringify(audit));
    for (const table of ['admin_audit_log', 'activity_logs']) {
      assert.ok(!JSON.stringify(f.db.prepare(`SELECT * FROM ${table}`).all()).includes('Wrong person'), `the founder's note is never in ${table}`);
    }
    f.env.BRANCH_CODE = 'syn';
    assert.equal((await call(f, ADMIN, 'GET', '/api/admin/deck-reports')).status, 403, 'a branch is refused');
  } finally { f.close(); }
});

test('every statement in the new files is bound, never interpolated', () => {
  for (const file of ['../src/routes/deck_reports.ts', '../src/services/decks/runQuotes.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/prepare\(\s*`[^`]*\$\{/.test(src), file);
  }
});
