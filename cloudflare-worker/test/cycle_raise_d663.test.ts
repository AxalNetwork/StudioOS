/**
 * D663 (#1476) — `/api/cycles/raise` on real SQLite: the baseline's own
 * tables, migration 442 applied over them, the routes mounted on a bare Hono.
 *
 * What #1476 says must be tested, each below by name:
 *   · readiness with no items returns `empty` with the action that starts it;
 *   · every mismatch cites both of its figures;
 *   · per-slide time never exceeds the view's total;
 *   · a prospect's last contact comes from its stored contact, never a guess.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_raise_d663.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import decks from '../src/routes/decks.ts';
import { MODULES, parseStatedFigures, consistencyCheck, mismatchSentence, capRows, groupShares, funnelOf } from '../src/services/raiseCycle.ts';
import { capSlideSeconds, slideTotals } from '../src/services/deckSlideDwell.ts';
import { CARD_STATES } from '../src/services/cycleCards.ts';
import { loadSpinoutDeckOverrides, saveSpinoutDeckOverrides } from '../src/services/decks/spinoutDeckOverrides.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const MIG442 = sqlOf('442_raise_cycle_stores.sql');

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, INVESTOR = 50;
const P = 1, P_OTHER = 2;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens',
    'deck_share_views', 'data_room_folders', 'data_room_files', 'data_room_access_log', 'cap_table_scenarios',
    'raise_prospects', 'raise_rounds', 'contacts',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec('ALTER TABLE pitch_deck_share_tokens ADD COLUMN revoked_at TEXT');
  for (const [c, d] of [['amount', 'REAL'], ['close_id', 'INTEGER'], ['commit_status', 'TEXT'], ['instrument', 'TEXT']]) {
    if (!cols('raise_prospects').has(c)) db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${c} ${d}`);
  }
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(MIG442);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001), (${P_OTHER}, 'Beta', 1002)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.route('/api/decks', decks);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

// The Worker's vars for a request; a test switches a flag on by setting it here.
let FLAGS: Record<string, string> = {};
const env = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...FLAGS } as any);
const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor' };

async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/raise${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env(db));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const overview = (db: any, who = FOUNDER, pid = P) => call(db, who, 'GET', `/overview?project=${pid}`);
const moduleRead = (db: any, slug: string, qs = '', who = FOUNDER) => call(db, who, 'GET', `/modules/${slug}?project=${P}${qs}`);
const card = (o: any, slug: string) => o.cards.find((c: any) => c.slug === slug);
const fig = (o: any, key: string) => o.figures.find((f: any) => f.key === key);
const inApp = (h: string) => typeof h === 'string' && h.startsWith('/') && !h.startsWith('//');

// ---------------------------------------------------------------------------
// The read's shape and who may read it
// ---------------------------------------------------------------------------

test('the overview: the cycle, its question, four figures and the seven cards in tab order, each in a known state', async () => {
  const db = fixture();
  const r = await overview(db);
  assert.equal(r.status, 200);
  assert.equal(r.body.cycle, 'raise');
  assert.equal(r.body.question, 'What resources does this venture need?');
  assert.deepEqual(r.body.figures.map((f: any) => f.key), ['readiness_score', 'committed', 'investors_in_conversation', 'runway_months']);
  assert.deepEqual(r.body.cards.map((c: any) => c.slug), MODULES.map((m) => m.slug));
  assert.deepEqual(r.body.cards.map((c: any) => c.name), ['Fundraising readiness', 'Investor narrative', 'Pitch deck', 'Data room', 'Cap table', 'Use of funds', 'Capital relationships']);
  for (const c of r.body.cards) {
    assert.ok((CARD_STATES as readonly string[]).includes(c.state), `${c.slug}: ${c.state}`);
    // A new venture: every card is empty and names the one action that starts it, in the app.
    assert.equal(c.state, 'empty', c.slug);
    assert.ok(c.next && c.next.text && inApp(c.next.href), `${c.slug} starts with an in-app action`);
  }
  for (const f of r.body.figures) assert.equal(f.value, null, `${f.key} is null, never 0, with nothing recorded`);
});

test('only the venture and an admin read or write it: another founder, a partner and an investor get 403', async () => {
  const db = fixture();
  assert.equal((await overview(db, FOUNDER)).status, 200);
  assert.equal((await overview(db, ADMIN)).status, 200);
  for (const who of [OTHER, PARTNER, INVESTOR]) {
    assert.equal((await overview(db, who)).status, 403, `user ${who} reads`);
    assert.equal((await call(db, who, 'POST', `/readiness/rescore?project=${P}`)).status, 403, `user ${who} writes`);
  }
  assert.equal((await call(db, FOUNDER, 'GET', '/overview')).status, 400);
  assert.equal((await call(db, FOUNDER, 'GET', `/modules/nope?project=${P}`)).status, 404);
});

test('one failing source makes only its card unreadable, naming the source', async () => {
  const db = fixture();
  db.exec('DROP TABLE data_room_files');
  const r = await overview(db);
  assert.equal(r.status, 200);
  const dr = card(r.body, 'data-room');
  assert.equal(dr.state, 'unreadable');
  assert.equal(dr.reason, 'Data room could not be read');
  for (const c of r.body.cards.filter((x: any) => x.slug !== 'data-room')) assert.notEqual(c.state, 'unreadable', c.slug);
});

// ---------------------------------------------------------------------------
// Fundraising readiness
// ---------------------------------------------------------------------------

test('readiness with no items returns empty, with the action that starts it', async () => {
  const db = fixture();
  const r = await overview(db);
  const c = card(r.body, 'fundraising-readiness');
  assert.equal(c.state, 'empty');
  assert.equal(c.series, null);
  assert.deepEqual(c.next, { text: 'Score fundraising readiness', href: `/raise/fundraising-readiness?project=${P}` });
  assert.equal(fig(r.body, 'readiness_score').state, 'empty');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readiness_items').get().n, 0, 'reading creates no item');

  // That action — the computed rescore — creates the seven items and scores the six it can measure.
  db.exec(`UPDATE projects SET use_of_funds = '[{"label":"Product & engineering","pct":100}]', funding_needed = 500000 WHERE id = ${P}`);
  assert.equal((await call(db, FOUNDER, 'POST', `/readiness/rescore?project=${P}`)).status, 200);
  const after = card((await overview(db)).body, 'fundraising-readiness');
  assert.notEqual(after.state, 'empty');
  const bars = after.series.find((s: any) => s.kind === 'hbar');
  assert.equal(bars.items.length, 7);
  assert.equal(bars.items.find((i: any) => i.label === 'Use of funds').value, 10);
  assert.equal(bars.items.find((i: any) => i.label === 'Team').value, null, 'no check measures the team: Not recorded, never 0');
  // Mean of the six computed scores (use of funds 10, the rest 0) out of 100.
  assert.equal(fig((await overview(db)).body, 'readiness_score').value, Math.round((10 / 6) * 10));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'raise.readiness.rescored' AND user_id = ?").get(FOUNDER).n, 1);
});

test('a person scores an item; a bad score or evidence is refused', async () => {
  const db = fixture();
  assert.equal((await call(db, FOUNDER, 'PUT', `/readiness/team?project=${P}`, { score: 7, evidence: 'pattern', missing: 'A CTO' })).status, 200);
  const rec = await moduleRead(db, 'fundraising-readiness');
  const team = rec.body.records.rows.find((r: any) => r.cells.item === 'Team');
  assert.deepEqual([team.cells.score, team.cells.evidence, team.cells.missing], [7, 'pattern', 'A CTO']);
  assert.equal(db.prepare("SELECT scored_by FROM readiness_scores WHERE source = 'manual'").get().scored_by, FOUNDER);
  assert.equal((await call(db, FOUNDER, 'PUT', `/readiness/team?project=${P}`, { score: 11, evidence: 'pattern' })).status, 400);
  assert.equal((await call(db, FOUNDER, 'PUT', `/readiness/team?project=${P}`, { score: 5, evidence: 'vibes' })).status, 400);
  assert.equal((await call(db, FOUNDER, 'PUT', `/readiness/charisma?project=${P}`, { score: 5, evidence: 'pattern' })).status, 400);
});

// ---------------------------------------------------------------------------
// Investor narrative — the consistency check
// ---------------------------------------------------------------------------

test('parseStatedFigures reads figures by fixed patterns, and only stated ones', () => {
  assert.deepEqual(parseStatedFigures('traction.takeaway', 'We reached $45k MRR with 15 paying customers.').map((s) => [s.figure, s.value]), [['mrr', 45000], ['paying_customers', 15]]);
  assert.deepEqual(parseStatedFigures('ask.title', 'Raising $1.5M to reach Series A').map((s) => [s.figure, s.value]), [['raise', 1_500_000]]);
  assert.deepEqual(parseStatedFigures('traction.takeaway', 'MRR of $38,000 and growing').map((s) => [s.figure, s.value]), [['mrr', 38000]]);
  assert.deepEqual(parseStatedFigures('problem.title', 'Teams waste 12 hours a week'), []);
});

test('consistencyCheck: a figure within 2% agrees; one with no stored metric is not a mismatch', () => {
  const metrics = { mrr: { value: 38000, source: 'm' } };
  assert.equal(consistencyCheck([{ figure: 'mrr', value: 38500, source: 's' }], metrics).length, 0);
  assert.equal(consistencyCheck([{ figure: 'mrr', value: 40000, source: 's' }], metrics).length, 1);
  assert.equal(consistencyCheck([{ figure: 'raise', value: 1, source: 's' }], metrics).length, 0);
});

test('every mismatch cites both of its figures', async () => {
  const db = fixture();
  db.exec(`UPDATE projects SET mrr = 40000, paying_customers = 12, funding_needed = 1000000 WHERE id = ${P}`);
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts) VALUES (${P}, '2026-09-01', 30000, 9), (${P}, '2026-10-01', 38000, 12)`);
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, status) VALUES ('r1', ${P}, 'Seed', 1000000, 'active')`);
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES
           (${P}, 'traction.takeaway', 'We reached $45k MRR with 15 paying customers', 0),
           (${P}, 'ask.title', 'Raising $1.5M', 0)`);
  const res = await call(db, FOUNDER, 'POST', `/narrative-versions?project=${P}`, { investor_type: 'seed_fund' });
  assert.equal(res.status, 201);
  assert.equal(res.body.version, 1);
  const found = res.body.mismatches;
  // The deck's MRR (40,000 against 38,000), and the narrative's MRR, customers and raise.
  // The deck's customers (12) and raise ($1M) agree with the stores and are not listed.
  assert.deepEqual(found.map((m: any) => `${m.figure}:${m.stated_value}`).sort(), ['mrr:40000', 'mrr:45000', 'paying_customers:15', 'raise:1500000']);
  for (const m of found) {
    assert.ok(Number.isFinite(m.stated_value) && Number.isFinite(m.metric_value), 'both values');
    assert.ok(m.stated_source && m.metric_source && m.stated_source !== m.metric_source, 'both sources, and they differ');
  }
  assert.equal(found.find((m: any) => m.stated_value === 40000).metric_source, 'Metrics · project_metrics.mrr on 2026-10-01', 'the newest snapshot');
  // Stored for the version, and drawn on the card as a sentence naming both sides.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM narrative_checks WHERE project_id = ? AND version = 1').get(P).n, 4);
  const c = card((await overview(db)).body, 'investor-narrative');
  const lines = c.series.find((s: any) => s.kind === 'rows').items.filter((i: any) => i.tone === 'warn' && i.label !== 'Mismatches');
  assert.equal(lines.length, 4);
  for (const l of lines) assert.match(String(l.value), /^.+ in .+, .+ in .+$/);
  assert.ok(lines.some((l: any) => l.value === 'MRR: $40,000 in Deck · projects.mrr, $38,000 in Metrics · project_metrics.mrr on 2026-10-01'));
  // The version is the deck wording copied, plus its marker; the live wording is untouched.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM spinout_deck_overrides WHERE project_id = ? AND version = 0').get(P).n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM spinout_deck_overrides WHERE project_id = ? AND version = 1 AND investor_type = 'seed_fund'").get(P).n, 3);
  const rec = await moduleRead(db, 'investor-narrative');
  assert.deepEqual(rec.body.records.rows[0].cells.mismatches, { text: '4', tone: 'warn' });
  assert.equal(rec.body.records.rows[0].cells.investor_type, 'Seed fund');
  assert.equal((await call(db, FOUNDER, 'POST', `/narrative-versions?project=${P}`, { investor_type: 'whale' })).status, 400);
});

test('mismatchSentence names both figures and both sources', () => {
  assert.equal(
    mismatchSentence({ figure: 'paying_customers', stated_value: 15, stated_source: 'Narrative · traction.takeaway', metric_value: 12, metric_source: 'Metrics · x' }),
    'Paying customers: 15 in Narrative · traction.takeaway, 12 in Metrics · x',
  );
});

// ---------------------------------------------------------------------------
// Pitch deck — per-slide time
// ---------------------------------------------------------------------------

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** A share token minted exactly as `routes/decks.ts` mints one. */
async function shareToken(deckId: number, version = 1): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ k: `deck:${deckId}:v${version}`, exp: Math.floor(Date.now() / 1000) + 600 })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))}`;
}
async function heartbeat(db: any, token: string, body: unknown) {
  const res = await app.request(`/api/decks/share/${token}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(db));
  return res.status;
}
const slideSum = (db: any, viewId: number) => Number(db.prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM deck_view_slides WHERE view_id = ?').get(viewId).s);
const readOf = (db: any, viewId: number) => Number(db.prepare('SELECT read_seconds FROM deck_share_views WHERE id = ?').get(viewId).read_seconds);

test('capSlideSeconds bounds a slide by what the view has left', () => {
  assert.equal(capSlideSeconds(60, 50, 30), 10);
  assert.equal(capSlideSeconds(60, 0, 30), 30);
  assert.equal(capSlideSeconds(60, 70, 30), 0);
  assert.equal(capSlideSeconds(60, 10, -5), 0);
  assert.deepEqual(slideTotals({ 2: 5, 0: 3, '-1': 4, x: 9, 200: 1, 1: 0, 3: 'abc' }), [[0, 3], [2, 5]]);
  assert.deepEqual(slideTotals([1, 2]), []);
});

test('per-slide time never exceeds the view\'s total', async () => {
  const db = fixture();
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, ${P}, 1, '[]'), (6, ${P_OTHER}, 1, '[]')`);
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at) VALUES (1, 5, 'h1', '2999-01-01 00:00:00')`);
  db.exec(`INSERT INTO deck_share_views (id, share_token_id, deck_id, read_seconds) VALUES (7, 1, 5, 0), (8, 1, 6, 0)`);
  const tok = await shareToken(5);

  assert.equal(await heartbeat(db, tok, { view_id: 7, seconds: 60, slides: { 0: 50, 1: 30 } }), 200);
  assert.equal(readOf(db, 7), 60);
  assert.deepEqual(db.prepare('SELECT slide_index, seconds FROM deck_view_slides WHERE view_id = 7 ORDER BY slide_index').all().map((r: any) => [r.slide_index, r.seconds]), [[0, 50], [1, 10]]);

  // A later beat with larger totals still fits inside the larger read time.
  await heartbeat(db, tok, { view_id: 7, seconds: 120, slides: { 0: 200, 1: 90, 2: 40 } });
  assert.equal(readOf(db, 7), 120);
  assert.ok(slideSum(db, 7) <= 120, `slides ${slideSum(db, 7)} > 120`);

  // Random beats in any order: the invariant holds after every one.
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 60; i++) {
    const slides: Record<number, number> = {};
    for (let k = 0; k < 1 + rnd(4); k++) slides[rnd(12)] = rnd(400);
    await heartbeat(db, tok, { view_id: 7, seconds: rnd(300), slides });
    assert.ok(slideSum(db, 7) <= readOf(db, 7), `beat ${i}: slides ${slideSum(db, 7)} > read ${readOf(db, 7)}`);
  }

  // A view of another deck is not written through this deck's token.
  db.exec('UPDATE deck_share_views SET read_seconds = 500 WHERE id = 8');
  await heartbeat(db, tok, { view_id: 8, seconds: 600, slides: { 0: 100 } });
  assert.equal(slideSum(db, 8), 0);

  // The card draws the seconds per slide; the records name the most-read slide.
  const c = card((await overview(db)).body, 'pitch-deck');
  assert.equal(c.state, 'ok');
  const per = c.series.find((s: any) => s.kind === 'hbar');
  assert.equal(per.items.reduce((a: number, i: any) => a + i.value, 0), slideSum(db, 7));
  const rec = await moduleRead(db, 'pitch-deck');
  assert.match(rec.body.records.rows[0].cells.most_read, /^Slide \d+$/);
});

// ---------------------------------------------------------------------------
// Capital relationships — last contact
// ---------------------------------------------------------------------------

test('a prospect\'s last contact comes from its stored contact, never from a guess', async () => {
  const db = fixture();
  db.exec(`INSERT INTO contacts (id, uid, project_id, audience, email, name, last_activity_at) VALUES
           (100, 'c100', ${P}, 'investor', 'cara@example.test', 'Cara Contact', '2026-09-30 10:00:00'),
           (101, 'c101', ${P}, 'investor', 'quiet@example.test', 'Quiet Contact', NULL),
           (102, 'c102', ${P_OTHER}, 'investor', 'else@example.test', 'Elsewhere', '2026-10-05 09:00:00')`);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, contact_id, name, firm, stage, updated_at, next_step, next_step_due, warm_path) VALUES
           (1, 'a', ${P}, 100, 'Ann', 'Fund A', 'meeting', '2026-10-08 12:00:00', 'Send the model', '2000-01-01', 'Via Sam'),
           (2, 'b', ${P}, NULL, 'Ben', 'Fund B', 'contacted', '2026-10-08 12:00:00', NULL, NULL, NULL),
           (3, 'c', ${P}, 101, 'Cy', 'Fund C', 'diligence', '2026-10-08 12:00:00', NULL, NULL, NULL),
           (4, 'd', ${P}, 102, 'Di', 'Fund D', 'passed', '2026-10-08 12:00:00', NULL, NULL, NULL)`);
  const rec = await moduleRead(db, 'capital-relationships', '&sort=name');
  const by = Object.fromEntries(rec.body.records.rows.map((r: any) => [r.id, r.cells]));
  assert.equal(by[1].last_contact, '2026-09-30', 'from contacts.last_activity_at');
  assert.equal(by[2].last_contact, null, 'no contact: not recorded — not the prospect\'s own updated_at');
  assert.equal(by[3].last_contact, null, 'a contact with no activity: not recorded');
  assert.equal(by[4].last_contact, null, 'another project\'s contact is never read');
  assert.deepEqual(by[1].next_step, { text: 'Send the model · 2000-01-01', tone: 'bad' });
  assert.equal(by[1].warm_path, 'Via Sam');

  const o = (await overview(db)).body;
  const c = card(o, 'capital-relationships');
  assert.deepEqual(c.series[0].steps.map((s: any) => s.value), [3, 3, 2, 1, 0], 'reached each stage; passed excluded');
  assert.match(c.next.text, /^Follow up with 1 investor whose next step is overdue$/);
  assert.equal(fig(o, 'investors_in_conversation').value, 3);

  // The writer: a next step and warm path, recorded with its actor.
  assert.equal((await call(db, FOUNDER, 'PUT', `/prospects/2/next-step?project=${P}`, { next_step: 'Intro call', next_step_due: '2026-10-20', warm_path: 'Via Lee' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT next_step, next_step_due, warm_path FROM raise_prospects WHERE id = 2').get() }, { next_step: 'Intro call', next_step_due: '2026-10-20', warm_path: 'Via Lee' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'raise.prospect.next_step' AND user_id = ?").get(FOUNDER).n, 1);
  assert.equal((await call(db, FOUNDER, 'PUT', `/prospects/2/next-step?project=${P}`, { next_step_due: '20 Oct' })).status, 400);
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, stage) VALUES (9, 'z', ${P_OTHER}, 'Zed', 'meeting')`);
  assert.equal((await call(db, FOUNDER, 'PUT', `/prospects/9/next-step?project=${P}`, { next_step: 'x' })).status, 404, 'another project\'s prospect');
});

test('funnelOf counts each prospect at every stage it reached', () => {
  assert.deepEqual(funnelOf([{ stage: 'committed' }, { stage: 'to_contact' }, { stage: 'passed' }]).map((s) => s.value), [2, 1, 1, 1, 1]);
});

// ---------------------------------------------------------------------------
// Data room, cap table, use of funds
// ---------------------------------------------------------------------------

test('data room: checklist coverage by area, a file matched through the writer, views by user', async () => {
  const db = fixture();
  db.exec(`INSERT INTO data_room_folders (id, uid, project_id, name) VALUES (1, 'f1', ${P}, 'Legal')`);
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, folder_id, name, r2_key, visibility) VALUES
           (1, 'x1', ${P}, 1, 'COI.pdf', 'k1', 'nda'), (2, 'x2', ${P}, NULL, 'Model.xlsx', 'k2', 'open')`);
  db.exec(`INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at) VALUES (${P}, 1, ${INVESTOR}, 'download', datetime('now'))`);
  assert.equal((await call(db, FOUNDER, 'PUT', `/data-room/files/1/checklist?project=${P}`, { item: 'incorporation' })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', `/data-room/files/2/checklist?project=${P}`, { item: 'not_a_thing' })).status, 400);
  db.exec(`INSERT INTO data_room_files (id, uid, project_id, name, r2_key) VALUES (3, 'x3', ${P_OTHER}, 'Theirs.pdf', 'k3')`);
  assert.equal((await call(db, FOUNDER, 'PUT', `/data-room/files/3/checklist?project=${P}`, { item: 'incorporation' })).status, 404, 'another project\'s file');
  assert.equal(db.prepare('SELECT checklist_item FROM data_room_files WHERE id = 3').get().checklist_item, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'raise.data_room.checklist' AND user_id = ?").get(FOUNDER).n, 1);
  const c = card((await overview(db)).body, 'data-room');
  const prog = c.series.find((s: any) => s.kind === 'progress').items;
  assert.equal(prog.find((i: any) => i.label === 'Company').pct, 50);
  assert.equal(prog.find((i: any) => i.label === 'Financials').pct, 0);
  assert.equal(c.series[1].items[0].label, 'Ivy Investor');
  assert.equal(c.next.text, 'Match 1 file to the diligence checklist');
  const rec = await moduleRead(db, 'data-room', '&sort=name');
  assert.deepEqual(rec.body.records.rows.map((r: any) => [r.cells.file, r.cells.folder, r.cells.answers, r.cells.access]),
    [['COI.pdf', 'Legal', 'Certificate of incorporation', 'NDA'], ['Model.xlsx', 'Top level', null, 'Open']]);
});

test('cap table: ownership by group before and after the first planned round', async () => {
  const before = [{ holder: 'Fay', type: 'founder', shares: 8000 }, { holder: 'Option Pool', type: 'option_pool', shares: 2000 }];
  const after = [...before, { holder: 'Seed investors', type: 'preferred', shares: 2500 }];
  const rows = capRows(before, after);
  assert.deepEqual(groupShares(rows, 'before'), [80, 20, 0]);
  assert.deepEqual(groupShares(rows, 'after'), [64, 16, 20]);
  // A holder the round removes reads 0% after, never Not recorded; with no round, after is not recorded.
  assert.deepEqual(capRows([{ holder: 'Gone', type: 'safe', shares: 10 }], [{ holder: 'New', type: 'preferred', shares: 10 }]).map((r) => [r.holder, r.before, r.after]), [['Gone', 100, 0], ['New', 0, 100]]);
  assert.deepEqual(capRows([{ holder: 'Fay', type: 'founder', shares: 1 }], null).map((r) => r.after), [null]);
  const db = fixture();
  db.exec(`INSERT INTO cap_table_scenarios (owner_user_id, project_id, name, inputs_json, result_json) VALUES
           (${FOUNDER}, ${P}, 'Main', '{}', '${JSON.stringify({ founding: before, rounds: [{ name: 'Seed', ledger: after }] })}')`);
  const c = card((await overview(db)).body, 'cap-table');
  assert.equal(c.state, 'ok');
  assert.deepEqual(c.series[0].rows.map((r: any) => [r.label, r.parts]), [['Before', [80, 20, 0]], ['After Seed', [64, 16, 20]]]);
  const rec = await moduleRead(db, 'cap-table');
  assert.deepEqual(rec.body.records.rows.find((r: any) => r.cells.holder === 'Seed investors').cells, { holder: 'Seed investors', group: 'Investors', instrument: 'Preferred', before: 0, after: 20 });
});

test('use of funds: the split, cash over 18 months, and monthly per category not recorded', async () => {
  const db = fixture();
  db.exec(`UPDATE projects SET use_of_funds = '[{"label":"Product & engineering","pct":0}]' WHERE id = ${P}`);
  assert.equal(card((await overview(db)).body, 'use-of-funds').state, 'empty', 'an allocation of nothing is no allocation');
  db.exec(`UPDATE projects SET funding_needed = 1000000,
             use_of_funds = '[{"label":"Product & engineering","pct":60},{"label":"GTM: sales and marketing","pct":40}]',
             use_of_funds_meta = '{"milestone_costs":{"7":{"bucket":"eng","cost":120000},"8":{"bucket":"eng","cost":""}}}'
           WHERE id = ${P}`);
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, cash_balance, net_burn) VALUES (${P}, '2026-10-01', 300000, 50000)`);
  const o = (await overview(db)).body;
  const c = card(o, 'use-of-funds');
  assert.deepEqual(c.series[0].rows[0].parts, [60, 40, 0, 0, 0]);
  const line = c.series.find((s: any) => s.kind === 'line');
  assert.equal(line.values.length, 19);
  assert.deepEqual([line.values[0], line.values[6], line.values[18]], [300000, 0, 0]);
  assert.equal(line.plan[0], 1300000);
  assert.equal(fig(o, 'runway_months').value, 6);
  const rec = await moduleRead(db, 'use-of-funds');
  const eng = rec.body.records.rows.find((r: any) => r.cells.category === 'Product & engineering').cells;
  assert.deepEqual(eng, { category: 'Product & engineering', share: 60, amount: 600000, monthly: null, milestone: '1 milestone · $120,000' });
});

test('committed against target: the pair when a round has a target', async () => {
  const db = fixture();
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, status) VALUES ('r1', ${P}, 'Seed', 1000000, 'active')`);
  db.exec(`INSERT INTO raise_prospects (uid, project_id, name, stage, amount) VALUES ('a', ${P}, 'A', 'committed', 250000), ('b', ${P}, 'B', 'meeting', 400000)`);
  const f = fig((await overview(db)).body, 'committed');
  assert.deepEqual([f.unit, f.value], ['of', [250000, 1000000]]);
});

// ---------------------------------------------------------------------------
// Narrative versions live on the deck wording overrides
// ---------------------------------------------------------------------------

test('the live deck wording is version 0 only: a saved version neither shows in the deck nor blocks an edit', async () => {
  const db = fixture();
  const e = env(db);
  await saveSpinoutDeckOverrides(e, P, FOUNDER, { 'cover.thesis': 'First thesis' });
  assert.equal((await call(db, FOUNDER, 'POST', `/narrative-versions?project=${P}`, { investor_type: 'angel' })).status, 201);
  // The same field again at version 0: the unique key includes the version, so this upserts.
  await saveSpinoutDeckOverrides(e, P, FOUNDER, { 'cover.thesis': 'Second thesis' });
  assert.deepEqual(await loadSpinoutDeckOverrides(e, P), { 'cover.thesis': 'Second thesis' });
  assert.equal(db.prepare("SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = 1 AND field_key = 'cover.thesis'").get(P).value, 'First thesis', 'the version keeps its wording');
  // A revert clears the live field and leaves the version.
  await saveSpinoutDeckOverrides(e, P, FOUNDER, { 'cover.thesis': '' });
  assert.deepEqual(await loadSpinoutDeckOverrides(e, P), {});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM spinout_deck_overrides WHERE version = 1 AND field_key = 'cover.thesis'").get().n, 1);
});

test('a database migrated before 442 gets the version columns and loses the two-column key on first use', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(sqlOf('164_spinout_deck_overrides.sql'));
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value) VALUES (1, 'cover.thesis', 'Old')`);
  const e = { DB: d1Over(db) } as any;
  assert.deepEqual(await loadSpinoutDeckOverrides(e, 1), { 'cover.thesis': 'Old' }, 'existing rows read as version 0');
  const cols = (db.prepare(`SELECT name FROM pragma_table_info('spinout_deck_overrides')`).all() as any[]).map((r) => r.name);
  for (const c of ['version', 'investor_type', 'deck_version']) assert.ok(cols.includes(c), c);
  const idx = (db.prepare(`SELECT name FROM pragma_index_list('spinout_deck_overrides')`).all() as any[]).map((r) => r.name);
  assert.ok(!idx.includes('idx_spinout_deck_overrides_project_key'));
  assert.ok(idx.includes('idx_spinout_deck_overrides_project_key_version'));
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (1, 'cover.thesis', 'Saved', 1)`);
  assert.deepEqual(await loadSpinoutDeckOverrides(e, 1), { 'cover.thesis': 'Old' });
});

// ---------------------------------------------------------------------------
// Capital relationships — a round call's responders (D653), behind the flag
// ---------------------------------------------------------------------------

function callFixture() {
  const db = fixture();
  db.exec(sqlOf('436_round_calls.sql'));
  db.exec(sqlOf('456_round_call_counsel_terms.sql'));
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active, kyc_status) VALUES (?, 'investor', ?, ?, 1, 'approved')");
  u.run(71, 'Rhea Responder', 'rhea@example.test');
  u.run(72, 'Quinn Quiet', 'quinn@example.test');
  u.run(73, 'Elsa Elsewhere', 'elsa@example.test');
  u.run(74, 'Vera Verified', 'vera@example.test');
  db.exec(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
           VALUES (1, 'call-1', ${P}, 'Seed call', 100000000, 'safe', 'Post-money SAFE', 2500000, '2999-01-01', 'sent', 'h', ${FOUNDER}),
                  (2, 'call-2', ${P_OTHER}, 'Their call', 100000000, 'safe', 'Post-money SAFE', 2500000, '2999-01-01', 'sent', 'h', ${OTHER})`);
  db.exec(`INSERT INTO round_call_recipients (call_id, investor_user_id, origin, commitment_cents, responded_at) VALUES
           (1, 71, 'chosen', 5000000, '2026-10-09T10:00:00Z'),
           (1, 72, 'match', NULL, NULL),
           (2, 73, 'chosen', NULL, '2026-10-09T10:00:00Z'),
           (1, 74, 'chosen', 4000000, '2026-10-08T10:00:00Z')`);
  // The pipeline rows respond() writes: Rhea committed soft through the call.
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, email, stage, amount, commit_status, updated_at) VALUES
           (1, 'p1', ${P}, 'Rhea Responder', 'RHEA@example.test', 'committed', 50000, 'soft', '2026-10-09 10:00:00'),
           (2, 'p2', ${P}, 'Quinn Quiet', 'quinn@example.test', 'contacted', NULL, NULL, '2026-10-08 10:00:00'),
           (3, 'p3', ${P}, 'Elsa Elsewhere', 'elsa@example.test', 'meeting', NULL, NULL, '2026-10-07 10:00:00'),
           (4, 'p4', ${P}, 'Sam Signed', 'sam@example.test', 'committed', 80000, 'signed', '2026-10-06 10:00:00'),
           (5, 'p5', ${P}, 'Vera Verified', 'vera@example.test', 'committed', 40000, 'signed', '2026-10-05 10:00:00')`);
  return db;
}

test('a round call\'s responders are marked in Capital relationships, with their soft commitments, only while the flag is on', async () => {
  const db = callFixture();
  FLAGS = { ROUND_CALLS_ENABLED: 'true' };
  try {
    const rec = await moduleRead(db, 'capital-relationships', '&sort=name');
    const by = Object.fromEntries(rec.body.records.rows.map((r: any) => [r.id, r.cells.stage]));
    assert.deepEqual(by[1], { text: 'Committed · soft · via call', tone: 'warn' }, 'responded, and committed soft through the call');
    assert.equal(by[2], 'Contacted', 'a recipient who never responded is not marked');
    assert.equal(by[3], 'Meeting', 'a response to another venture\'s call does not count here');
    assert.equal(by[4], 'Committed', 'a signed commitment is not soft');
    assert.deepEqual(by[5], { text: 'Committed · via call' }, 'a responder whose commitment was signed since');
    assert.ok(rec.body.records.filters.some((f: any) => f.key === 'source'));
    const only = await moduleRead(db, 'capital-relationships', '&filter=source:call');
    assert.deepEqual(only.body.records.rows.map((r: any) => r.id).sort(), [1, 5]);
    const c = card((await overview(db)).body, 'capital-relationships');
    const rows = c.series.find((s: any) => s.kind === 'rows' && s.items.some((i: any) => i.label === 'Responded to a round call'));
    assert.deepEqual(rows.items.map((i: any) => [i.label, i.value]), [['Responded to a round call', 2], ['Soft commitments through a call', 1]]);
  } finally { FLAGS = {}; }

  // Flag off: nothing about calls is read or drawn, and the filter is not offered.
  const off = await moduleRead(db, 'capital-relationships', '&sort=name&filter=source:call');
  assert.equal(off.body.records.rows.length, 5, 'the source filter is ignored with the flag off');
  assert.equal(off.body.records.rows.find((r: any) => r.id === 1).cells.stage.text, 'Committed · soft', 'still soft, never "via call"');
  assert.ok(!off.body.records.filters.some((f: any) => f.key === 'source'));
  const c = card((await overview(db)).body, 'capital-relationships');
  assert.ok(!c.series.some((s: any) => s.kind === 'rows' && s.items.some((i: any) => /round call/.test(i.label))));
});

test('with the flag off the call tables are not read: a database without them still draws the card', async () => {
  const db = fixture(); // no migration 436
  db.exec(`INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES ('p', ${P}, 'A', 'a@example.test', 'contacted')`);
  const c = card((await overview(db)).body, 'capital-relationships');
  assert.equal(c.state, 'ok');
  FLAGS = { ROUND_CALLS_ENABLED: 'true' };
  try {
    assert.equal(card((await overview(db)).body, 'capital-relationships').state, 'unreadable', 'the flag on reads them, so the missing table is said, not hidden');
  } finally { FLAGS = {}; }
});


test('D686 #1594: Calls history is scoped, newest first, with independent recipient/question counts and UTC effective states',async()=>{
  const db=callFixture();FLAGS={ROUND_CALLS_ENABLED:'true'};
  try {
    db.exec("UPDATE round_calls SET created_at='2020-01-01T00:00:00Z'; UPDATE round_call_recipients SET opened_at='2026-10-10',data_room_requested_at='2026-10-11' WHERE call_id=1 AND investor_user_id=71");
    const ins=db.prepare("INSERT INTO round_calls(uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by,created_at) VALUES(?,1,?,100000000,'safe','Cap',2500000,?,?, 'h',?,?)");
    for(const [uid,state,close,at] of [
      ['draft','draft','2999-01-01','2020-01-02'],['paused','awaiting_counsel','2999-01-01','2020-01-03'],
      ['expired','sent','2000-01-01','2020-01-04'],['closed','closed','2000-01-01','2020-01-05'],
    ])ins.run(uid,uid,close,state,FOUNDER,at);
    db.exec("INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,answer) VALUES('q1',1,71,'One?',NULL),('q2',1,71,'Two?','Answered'),('q3',1,72,'Three?',NULL)");
    const res=await moduleRead(db,'capital-relationships','',ADMIN);
    const calls=res.body.parts.calls;
    assert.deepEqual([res.status,calls.enabled,calls.items.map((i:any)=>[i.uid,i.effective_state])],
      [200,true,[['closed','closed'],['expired','expired'],['paused','awaiting_counsel'],['draft','draft'],['call-1','open']]]);
    const sent=calls.items.find((r:any)=>r.uid==='call-1');
    assert.deepEqual([sent.recipients,sent.opened,sent.data_room_requests,sent.commitments,sent.committed_cents,sent.responded,sent.unanswered_questions],
      [3,1,1,2,9000000,2,2]);
    assert.deepEqual([calls.items[0].recipients,calls.items[0].committed_cents,calls.items[0].unanswered_questions],[0,0,0]);
    assert.equal(JSON.stringify(calls).includes('rhea@example.test')||JSON.stringify(calls).includes('Quinn Quiet'),false);
    assert.equal((await moduleRead(db,'capital-relationships','',OTHER)).status,403);
    assert.equal(Object.hasOwn((await moduleRead(db,'use-of-funds')).body,'parts'),false,'only Capital relationships gains Calls');
  } finally {FLAGS={};}
  assert.deepEqual((await moduleRead(db,'capital-relationships')).body.parts.calls,{enabled:false});
});

test('D686 #1594: unreadable Calls stays an explicit part, and the flag off never reads the call tables',async()=>{
  const db=fixture();
  assert.deepEqual((await moduleRead(db,'capital-relationships')).body.parts.calls,{enabled:false});
  FLAGS={ROUND_CALLS_ENABLED:'true'};
  try {
    const res=await moduleRead(db,'capital-relationships');
    assert.equal(res.status,200);
    assert.deepEqual(res.body.parts.calls,{state:'unreadable'});
  } finally {FLAGS={};}
});

test('D686 #1594 Calls history mutations: flag, project scope, date, counts and source failure are observable',async()=>{
  const {stripTypeScriptTypes}=await import('node:module');
  const file=new URL('../src/services/raiseCycle.ts',import.meta.url),source=readFileSync(file,'utf8');
  const real=await import('../src/services/raiseCycle.ts');
  const cases=[
    ["if (!roundCallsEnabled(ctx.env)) return {enabled:false};","if (false) return {enabled:false};",'flag'],
    ['FROM round_calls c WHERE c.project_id=? ORDER BY c.created_at DESC,c.id DESC','FROM round_calls c WHERE ? IS NOT NULL ORDER BY c.created_at DESC,c.id DESC','scope'],
    ["row.target_close>=ctx.today?'open':'expired'","true?'open':'expired'",'date'],
    ['COALESCE(SUM(r.commitment_cents),0)','COUNT(*)','sum'],
    ["return {state:'unreadable'};","return {enabled:true,items:[]};",'unreadable'],
    ["(SELECT COUNT(*) FROM round_call_recipients r WHERE r.call_id=c.id) AS recipients","0 AS recipients","metrics"],
    ["r.call_id=c.id AND r.opened_at IS NOT NULL","r.call_id=c.id","metrics"],
    ["r.call_id=c.id AND r.data_room_requested_at IS NOT NULL","r.call_id=c.id","metrics"],
    ["r.call_id=c.id AND r.commitment_cents IS NOT NULL","r.call_id=c.id","metrics"],
    ["r.call_id=c.id AND r.responded_at IS NOT NULL","r.call_id=c.id","metrics"],
    ["q.call_id=c.id AND q.answer IS NULL","q.call_id=c.id","metrics"],
    ["ORDER BY c.created_at DESC,c.id DESC","ORDER BY c.created_at ASC,c.id DESC","order"],
    ["ORDER BY c.created_at DESC,c.id DESC","ORDER BY c.created_at DESC,c.id ASC","order"],
    ["row.target_close>=ctx.today?'open':'expired'","row.target_close>ctx.today?'open':'expired'","boundary"],
  ];
  const check=async(api:any,which:string)=>{
    if(which==='flag'){assert.deepEqual(await api.callsHistory({env:env(fixture()),projectId:P,today:'2026-10-14'}),{enabled:false});return;}
    const db=which==='unreadable'?fixture():callFixture();
    if(which==='date')db.exec("UPDATE round_calls SET target_close='2000-01-01' WHERE id=1");
    if(which==='boundary')db.exec("UPDATE round_calls SET target_close='2026-10-14' WHERE id=1");
    if(which==='metrics')db.exec("UPDATE round_call_recipients SET opened_at='2026-10-10',data_room_requested_at='2026-10-11' WHERE call_id=1 AND investor_user_id=71; INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,answer) VALUES('qm1',1,71,'One?',NULL),('qm2',1,71,'Two?','Answered'),('qm3',1,72,'Three?',NULL)");
    if(which==='order')db.exec("UPDATE round_calls SET created_at='2020-01-01'; INSERT INTO round_calls(uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by,created_at) SELECT 'tie',project_id,'Tie',amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by,'2020-01-01' FROM round_calls WHERE id=1; INSERT INTO round_calls(uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by,created_at) SELECT 'newer',project_id,'Newer',amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by,'2020-01-02' FROM round_calls WHERE id=1");
    const c:any=await api.callsHistory({env:{...env(db),ROUND_CALLS_ENABLED:'true'},projectId:P,today:'2026-10-14'});
    if(which==='unreadable'){assert.deepEqual(c,{state:'unreadable'});return;}
    if(which==='scope')assert.deepEqual(c.items.map((i:any)=>i.uid),['call-1']);
    if(which==='date')assert.equal(c.items[0].effective_state,'expired');
    if(which==='sum')assert.equal(c.items[0].committed_cents,9000000);
    if(which==='boundary')assert.equal(c.items[0].effective_state,'open');
    if(which==='order')assert.deepEqual(c.items.map((i:any)=>i.uid),['newer','tie','call-1']);
    if(which==='metrics'){
      const r=c.items[0];
      assert.deepEqual([r.recipients,r.opened,r.data_room_requests,r.commitments,r.responded,r.unanswered_questions],[3,1,1,2,2,2]);
    }
  };
  for(const [index,[before,after,which]] of cases.entries()) {
    assert.ok(source.includes(before),'mutation target exists');
    let js=stripTypeScriptTypes(source.replace(before,after),{mode:'strip'});
    js=js.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
      (_all,prefix,spec,quote)=>prefix+(spec.startsWith('.')?new URL(/\.[mc]?[jt]s$/.test(spec)?spec:spec+'.ts',file).href:import.meta.resolve(spec))+quote);
    const bad=await import('data:text/javascript;base64,'+Buffer.from(js+'\n// calls history '+index).toString('base64'));
    await check(real,which);
    await assert.rejects(()=>check(bad,which),{name:'AssertionError'});
  }
});
