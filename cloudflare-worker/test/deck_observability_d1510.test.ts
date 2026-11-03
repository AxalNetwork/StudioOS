/**
 * D1510 (#3761, deck v2 A17) — the deck cost ceiling on every generation
 * route, HQ's 50% and 80% alerts, one Analytics Engine point per run, the
 * funnel events by id, and the accept rate per element and model.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deck_observability_d1510.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { D1GenRuntime, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import { admitDeckRun, admitStatus } from '../src/services/decks/genRooms.ts';
import {
  ALERT_THRESHOLDS, CEILING_REACHED, FUNNEL_EVENTS, acceptRates, ceilingState, funnelPoint, noteCeilingAlerts, structuresChanged,
} from '../src/services/decks/observability.ts';
import deckAreas from '../src/routes/deck_areas.ts';
import deckAssist from '../src/routes/deck_assist.ts';
import deckNew from '../src/routes/deck_new.ts';
import adminDeckGeneration from '../src/routes/admin_deck_generation.ts';
import { createShareLink } from '../src/routes/decks.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const PAGE = 'Founder · Raise · Pitch deck';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const IMG = '@cf/black-forest-labs/flux-1-schnell';
const FOUNDER = 10, ADMIN = 1, ADMIN2 = 2, RETIRED_ADMIN = 3, P = 1, DECK = 1;
const JWT_SECRET = 'unit-test-jwt-secret-d1510-0123456789-abcdef'; // synthetic test fixture
const CARD = {
  uid: 'card-one', title: 'Kestrel cuts audit time', notes: '',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Kestrel cuts audit time' },
    { id: 'b2', kind: 'text', grid: { c1: 1, c2: 7, r1: 2, r2: 6 }, style: 'paragraph', text: 'Audits take weeks. Kestrel reads the ledger and flags what matters.' },
  ],
};
const AREAS = { card: 'card-one', areas: [{ id: 'b2', grid: CARD.blocks[1].grid, element: 'body' }], variants: 1 };

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1, 1001);
  add.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 1, null);
  add.run(ADMIN2, 'admin', 'Abe Admin', 'abe@example.test', 1, null);
  add.run(RETIRED_ADMIN, 'admin', 'Old Admin', 'old@example.test', 0, null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, P, 'Synthetic deck', JSON.stringify([CARD]));
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(FOUNDER, 50_000_000);
  return db;
}
/** Today's deck spend, as settled usage rows on the Pitch deck page. */
const spend = (db: DatabaseSync, micro: number, page = PAGE) =>
  db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, rail_page) VALUES (?, ?, ?, ?, ?)').run(FOUNDER, 'rail_write', MODEL, micro, page);
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);
const holds = (db: DatabaseSync) => count(db, 'SELECT COUNT(*) AS n FROM ai_budget_reservations');
const batches = (db: DatabaseSync) => count(db, 'SELECT COUNT(*) AS n FROM deck_area_batches');

/** An Analytics Engine stand-in that keeps what it is given. */
function analytics() {
  const points: any[] = [];
  return { points, writeDataPoint: (p: any) => { points.push(p); } };
}
/** The deck's room, standing in for the Durable Object: it admits through the D1 core. */
function roomFor(db: DatabaseSync) {
  const env: any = { DB: d1Over(db) };
  return { idFromName: (n: string) => n, get: () => ({ fetch: async (_url: string, init: any) => {
    const a = await new D1GenRuntime(env, async () => ({ ok: false, charged_microusd: 0 })).admit(JSON.parse(init.body));
    return Response.json(a, { status: a.ok ? 200 : admitStatus(a.refusal) });
  } }) };
}
async function call(db: DatabaseSync, router: Hono<any>, base: string, who: number, role: string, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const app = new Hono<any>();
  app.route(base, router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), DECK_GEN_ROOM: roomFor(db), ...extra } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

// ---- the ceiling on every generation route ------------------------------------

test('area runs: refused 429 with the sentence before any hold; room left runs; a replay of an admitted run is still that run', async () => {
  // Mutation checked: drop the gate in admitDeckRun → the paused POST is admitted (or deck_busy), not 429.
  const db = world();
  const env = { DECK_DAILY_CEILING_MICROUSD: '10000000' };
  const areas = (key: string) => call(db, deckAreas, '/api/decks', FOUNDER, 'founder', 'POST', `/api/decks/${DECK}/areas`, AREAS, env, { 'Idempotency-Key': key });
  const first = await areas('d1510-areas-0001');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(batches(db), 1, 'a ceiling with room left runs');
  const heldBefore = holds(db);

  spend(db, 9_999_999);
  const paused = await areas('d1510-areas-0002');
  assert.deepEqual([paused.status, paused.body.error, paused.body.message], [429, 'deck_ceiling_reached', CEILING_REACHED]);
  assert.equal(paused.body.message, 'Generation is paused for today. Manual editing still works.', 'the sentence refusalOf draws as-is');
  assert.deepEqual([batches(db), holds(db)], [1, heldBefore], 'no run and no hold');

  const replay = await areas('d1510-areas-0001');
  assert.deepEqual([replay.status, replay.body.replayed, replay.body.batch_uid], [200, true, first.body.batch_uid], 'a replay holds nothing new');

  // Unset is off: the same press now meets the deck's own run (busy), not the ceiling.
  const off = await call(db, deckAreas, '/api/decks', FOUNDER, 'founder', 'POST', `/api/decks/${DECK}/areas`, AREAS, {}, { 'Idempotency-Key': 'd1510-areas-0003' });
  assert.equal(off.body.error, 'deck_busy');
});

test('admitDeckRun: the whole-deck build and a retry are refused before the runtime is even reached', async () => {
  // Mutation checked: drop the gate in admitDeckRun → no room here answers runtime_unavailable instead of 429.
  const db = world();
  spend(db, 1_000);
  const env: any = { DB: d1Over(db), DECK_DAILY_CEILING_MICROUSD: '1000' };
  const lines = [{ card_uid: 'card-one', area_id: 'b2', element: 'body', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: 1 }];
  for (const extra of [{ cls: 'deck_build' }, { cls: 'areas', parentBatchUid: '00000000-0000-4000-8000-000000000001' }]) {
    const r = await admitDeckRun(env, { deckId: DECK, projectId: P, userId: FOUNDER, idemKey: `d1510-admit-${extra.cls}`, lines, ...extra } as any);
    assert.deepEqual([r.status, r.body.ok, (r.body as any).refusal], [429, false, 'deck_ceiling_reached'], extra.cls);
  }
  assert.equal(admitStatus('deck_ceiling_reached'), 429);
  assert.equal(holds(db), 0);
  // A quote that would pass the ceiling is refused even with spend below it.
  const db2 = world();
  spend(db2, 500);
  const r = await admitDeckRun({ DB: d1Over(db2), DECK_DAILY_CEILING_MICROUSD: '1000' } as any, { deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: 'd1510-admit-big', lines: [{ ...lines[0], quote_microusd: 501 }] } as any);
  assert.equal((r.body as any).refusal, 'deck_ceiling_reached', 'spent + this run\'s quote');
});

test('card assist: refused before any model is called; images and replace-all check it before their hold', async () => {
  // Mutation checked: drop the assist gate → the model is called and the answer is not 429.
  const db = world();
  spend(db, 2_000);
  const calls: string[] = [];
  const AI = { run: async (m: string) => { calls.push(m); return { response: 'Audits, read in an afternoon.', usage: { prompt_tokens: 5, completion_tokens: 5 } }; } };
  const r = await call(db, deckAssist, '/api/decks', FOUNDER, 'founder', 'POST', `/api/decks/${DECK}/cards/card-one/assist`, { action: 'shorten', text: 'Audits take weeks.' }, { AI, DECK_DAILY_CEILING_MICROUSD: '1000' });
  assert.deepEqual([r.status, r.body.error, r.body.message], [429, 'deck_ceiling_reached', CEILING_REACHED]);
  assert.deepEqual(calls, [], 'no model ran');
  assert.equal(holds(db), 0);
  // The image routes: the gate sits after the price is known and before the balance check, storage and the hold.
  const src = readFileSync('cloudflare-worker/src/routes/deck_images.ts', 'utf8');
  const one = src.slice(src.indexOf("deckImages.post('/:id/images', async"));
  assert.ok(one.indexOf('deckCeilingRefusal(c.env, p.total)') > 0 && one.indexOf('deckCeilingRefusal(c.env, p.total)') < one.indexOf('balanceRefusal('));
  const all = src.slice(src.indexOf("deckImages.post('/:id/images/replace-all', async"));
  assert.ok(all.indexOf('deckCeilingRefusal(c.env, q.hold)') > 0 && all.indexOf('deckCeilingRefusal(c.env, q.hold)') < all.indexOf('reserveAiBudget('));
});

test('the ceiling reads "Not set" (null) until the owner sets it; a spend that cannot be read pauses once it is set', async () => {
  const db = world();
  spend(db, 400);
  assert.deepEqual(await ceilingState({ DB: d1Over(db) } as any), { ceiling_microusd: null, spent_today_microusd: 400, percent: null, paused: false });
  for (const v of ['', '0', '-5', 'ten', '1.5']) assert.equal((await ceilingState({ DB: d1Over(db), DECK_DAILY_CEILING_MICROUSD: v } as any)).ceiling_microusd, null, `"${v}" is not a ceiling`);
  assert.deepEqual(await ceilingState({ DB: d1Over(db), DECK_DAILY_CEILING_MICROUSD: '1000' } as any), { ceiling_microusd: 1000, spent_today_microusd: 400, percent: 40, paused: false });
  const broken: any = { DB: { prepare: () => { throw new Error('d1 down'); } }, DECK_DAILY_CEILING_MICROUSD: '1000' };
  assert.deepEqual(await ceilingState(broken), { ceiling_microusd: 1000, spent_today_microusd: null, percent: null, paused: true });
  // Mutation checked: pause on an unreadable spend with no ceiling set → this reads paused.
  assert.equal((await ceilingState({ DB: broken.DB } as any)).paused, false, 'no ceiling never pauses');
  // Yesterday's spend is not today's.
  db.exec(`UPDATE ai_usage_logs SET created_at = datetime('now', '-1 day')`);
  assert.equal((await ceilingState({ DB: d1Over(db), DECK_DAILY_CEILING_MICROUSD: '1000' } as any)).spent_today_microusd, 0);
});

// ---- HQ's alerts ---------------------------------------------------------------

test('HQ alerts: 50% then 80% once each per day, to every active HQ admin, amounts only', async () => {
  // Mutation checked: drop the once-per-day claim → the second 50% call sends again.
  const db = world();
  const env: any = { DB: d1Over(db), DECK_DAILY_CEILING_MICROUSD: '1000000' };
  const notices = () => db.prepare(`SELECT user_id, title, body, payload FROM notifications_inbox WHERE type = 'deck_ceiling_alert' ORDER BY id`).all() as any[];
  assert.deepEqual([...ALERT_THRESHOLDS], [50, 80]);
  assert.equal(await noteCeilingAlerts({ DB: d1Over(db) } as any), null, 'no ceiling, no alert');
  spend(db, 400_000);
  assert.equal(await noteCeilingAlerts(env), null, '40% says nothing');
  spend(db, 150_000);
  assert.equal(await noteCeilingAlerts(env), 50);
  assert.deepEqual([...new Set(notices().map((n) => n.user_id))].sort(), [ADMIN, ADMIN2], 'active HQ admins only; never the founder');
  assert.equal(notices().filter((n) => n.title === 'Deck generation has used 50% of today\'s ceiling').length, 2);
  assert.equal(await noteCeilingAlerts(env), null, 'once per day');
  spend(db, 300_000);
  assert.equal(await noteCeilingAlerts(env), 80);
  assert.equal(await noteCeilingAlerts(env), null);
  assert.equal(notices().length, 4, 'two thresholds × two admins');
  const last = notices().at(-1);
  assert.equal(last.body, '$0.85 of $1.00 charged today (UTC). At the ceiling, generation pauses until tomorrow; manual editing still works.');
  assert.doesNotMatch(JSON.stringify(notices()), /Fay|Kestrel|audit/i, 'no founder, venture or words');
  // A jump past both on a new day sends the higher one only.
  assert.equal(await noteCeilingAlerts(env, new Date(Date.now() + 86_400_000)), 80);
  assert.equal(notices().length, 6);
});

// ---- one Analytics Engine point per run ---------------------------------------

test('a finished run writes one point with its class, end, hold, charge and steps; ids only; and checks the alerts', async () => {
  // Mutation checked: drop the runPoint call in finish → no deck_run point is written.
  const db = world();
  const ae = analytics();
  const env: any = { DB: d1Over(db), ANALYTICS: ae, DECK_DAILY_CEILING_MICROUSD: '10000' };
  const exec: StepExecutor = async (s) => {
    if (s.seq === 1) return { ok: false, charged_microusd: 0, error_code: 'model_failed' };
    db.prepare('INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, rail_page, record_ref) VALUES (?, ?, ?, ?, ?, ?)').run(FOUNDER, 'rail_write', s.model, 6000, PAGE, `deckstep:${s.batch_uid}:${s.seq}`);
    return { ok: true, charged_microusd: 6000, model_used: s.model, variant: { text: 'Audits, read in an afternoon.' } };
  };
  const rt = new D1GenRuntime(env, exec);
  const line = { card_uid: 'card-one', area_id: 'b2', element: 'body', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: 7000 };
  const a = await rt.admit({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: 'd1510-run-0001', lines: [line, { ...line, area_id: 'b1' }] } as any);
  assert.ok(a.ok);
  const st = await rt.startBatch((a as any).uid);
  assert.equal(st?.state, 'done');
  const runs = ae.points.filter((p) => p.indexes[0] === 'deck_run');
  assert.equal(runs.length, 1);
  const [p] = runs;
  assert.deepEqual(p.blobs.slice(0, 4), ['areas', 'done', 'do', (a as any).uid]);
  assert.deepEqual(p.blobs.slice(4), [String(DECK), String(P)]);
  assert.deepEqual(p.doubles.slice(0, 5), [14000, 6000, 2, 1, 1], 'hold, charge, steps, done, failed');
  assert.doesNotMatch(JSON.stringify(p), /Audits|Kestrel|llama/i, 'no words, no venture name');
  // Another driver reaching the end closes nothing, so writes nothing.
  await (rt as any).finish((a as any).uid);
  assert.equal(ae.points.filter((x) => x.indexes[0] === 'deck_run').length, 1);
  // 6000 of 10000 settled: the 50% alert went out from the run's end.
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'deck_ceiling_alert'`), 2);
  // Without the binding nothing is written and nothing fails.
  assert.equal(funnelPoint({ DB: d1Over(db) } as any, 'build', { projectId: P }), false);
});

// ---- the funnel ----------------------------------------------------------------

test('funnel: structure change and share; Build, Accept all, Accept all and present; ids only', async () => {
  // Mutation checked: emit accept_all on a partial keep → the partial save writes a funnel point;
  // and accept_all_present on any `present` value → an all-kept save with present: false writes it.
  assert.deepEqual([...FUNNEL_EVENTS], ['structure_change', 'share', 'build', 'accept_all', 'accept_all_present']);
  // A save that changes a kept card's structure; a new or removed card, or the same structure, is not one.
  const a = { uid: 'c1', structure: 'hero_3' }, b = { uid: 'c2', structure: 'full' };
  assert.equal(structuresChanged([a, b], [a, { ...b, structure: 'split' }]), true);
  assert.equal(structuresChanged([a, b], [b, a]), false, 'matched by uid, not place');
  assert.equal(structuresChanged([a], [a, { uid: 'c3', structure: 'full' }]), false);
  assert.equal(structuresChanged([a, b], [a]), false);
  assert.equal(structuresChanged([{ structure: 'full' }], [{ structure: 'split' }]), true, 'by place without a uid');
  assert.equal(structuresChanged([{ uid: 'c1' }], [{ uid: 'c1', structure: 'full' }]), true, 'a first structure is a change');
  const decks = readFileSync('cloudflare-worker/src/routes/decks.ts', 'utf8');
  assert.match(decks, /const structureChanged = structuresChanged\(priorSlides, slides\);/);
  assert.match(decks, /if \(structureChanged\) funnelPoint\(c\.env, 'structure_change', \{ deckId: Number\(newId\), projectId: Number\(row\.project_id\) \}\);/);
  assert.match(readFileSync('cloudflare-worker/src/routes/deck_new.ts', 'utf8'), /funnelPoint\(c\.env, 'build', \{ projectId, proposalId: id, oneClick: body\?\.one_click === true \}\);/);

  // Share: every link the one writer makes.
  const db = world();
  const ae = analytics();
  await createShareLink({ DB: d1Over(db), JWT_SECRET, ANALYTICS: ae } as any, { deckId: DECK, deckVersion: 1, userId: FOUNDER, actorEmail: null, ttlSeconds: 3600, projectId: P });
  assert.deepEqual(ae.points.map((p) => [p.indexes[0], ...p.blobs]), [['deck_funnel', 'share', String(DECK), String(P), '', '']]);

  // Accept all, and Accept all and present, on the one-click review.
  const slides = [{ ...CARD, uid: 'card-one' }, { ...CARD, uid: 'card-two' }];
  const proposal = (kept: number[] | null) => Number(db.prepare('INSERT INTO pitch_deck_proposals (project_id, base_deck_id, slides, title, created_by, kept_slides_json) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .get(P, DECK, JSON.stringify(slides), 'Pitch deck', FOUNDER, kept ? JSON.stringify(kept) : null)!.id);
  const keep = (id: number, body: unknown) => call(db, deckNew, '/api/decks', FOUNDER, 'founder', 'POST', `/api/decks/proposals/${id}/keep-slides`, body, { ANALYTICS: ae });
  ae.points.length = 0;
  const partial = await keep(proposal(null), { indexes: [0], save: true });
  assert.equal(partial.status, 200, JSON.stringify(partial.body));
  assert.deepEqual(ae.points, [], 'keeping some cards is not Accept all');
  const all = await keep(proposal(null), { indexes: [0, 1], save: true, present: false });
  assert.equal(all.status, 200);
  assert.deepEqual(ae.points.map((p) => p.blobs[0]), ['accept_all']);
  ae.points.length = 0;
  const present = await keep(proposal([1]), { indexes: [0], save: true, present: true });
  assert.equal(present.status, 200);
  assert.deepEqual(ae.points.map((p) => p.blobs[0]), ['accept_all', 'accept_all_present']);
  assert.deepEqual(ae.points[1].blobs.slice(1, 3), [String(present.body.deck.id), String(P)]);
  for (const p of ae.points) assert.ok(p.blobs.every((x: string) => x === '' || /^[a-z_]+$|^\d+$/.test(x)), 'ids and codes only');
});

// ---- the accept rate -------------------------------------------------------------

test('the accept rate per element and model, from fixture data, with the seconds to the first result', async () => {
  // Mutation checked: count superseded as accepted → body's rate reads 0.75, not 0.5.
  const db = world();
  db.exec(`INSERT INTO deck_area_batches (uid, deck_id, project_id, class, state, quote_microusd, idem_key, created_by, created_at)
           VALUES ('batch-a', ${DECK}, ${P}, 'areas', 'done', 100, 'idem-a', ${FOUNDER}, '2026-11-03 10:00:00')`);
  const step = db.prepare(`INSERT INTO deck_area_batch_steps (batch_uid, seq, card_uid, area_id, element, kind, model, model_used, state, ended_at) VALUES ('batch-a', ?, 'card-one', ?, ?, ?, ?, ?, ?, ?)`);
  const prop = db.prepare(`INSERT INTO deck_area_proposals (uid, deck_id, project_id, card_uid, area_id, batch_uid, mode, element, state, outcome, regenerated_from, created_by, created_at, expires_at)
                           VALUES (?, ${DECK}, ${P}, 'card-one', ?, ?, ?, ?, ?, ?, ?, ${FOUNDER}, datetime('now', ?), '2099-01-01 00:00:00')`);
  const body = [['b-acc', 'accepted', 'accept'], ['b-all', 'accepted', 'accept_all'], ['b-dis', 'discarded', 'discard'], ['b-sup', 'discarded', 'superseded'], ['b-open', 'ready', null]] as const;
  body.forEach(([area, state, outcome], i) => {
    step.run(i * 2, area, 'body', 'text', MODEL, MODEL, 'done', i === 0 ? '2026-11-03 10:00:12' : '2026-11-03 10:00:20');
    step.run(i * 2 + 1, area, 'body', 'text', MODEL, MODEL, 'done', '2026-11-03 10:00:40');
    prop.run(`p-${area}`, area, 'batch-a', 'variants', 'body', state, outcome, area === 'b-dis' ? 'p-b-acc' : null, '-1 day');
  });
  step.run(20, 'img', 'photo', 'image', IMG, IMG, 'failed', '2026-11-03 10:00:05');
  prop.run('p-img', 'img', 'batch-a', 'variants', 'photo', 'expired', 'expired', null, '-2 days');
  prop.run('p-rec', 'quote', null, 'records', 'interview_quote', 'ready', null, null, '-1 day');
  prop.run('p-old', 'old', 'batch-a', 'variants', 'body', 'accepted', 'accept', null, '-60 days');

  const rates = await acceptRates({ DB: d1Over(db) } as any, 30);
  const by = (el: string) => rates.find((r) => r.element === el)!;
  assert.deepEqual(by('body'), { element: 'body', model: MODEL, proposals: 5, decided: 4, accepted: 2, accepted_all: 1, discarded: 1, regenerated: 1, accept_rate: 0.5, first_result_seconds: 18.4 });
  assert.deepEqual([by('photo').model, by('photo').decided, by('photo').accept_rate, by('photo').first_result_seconds], [IMG, 1, 0, null], 'expired counts as not accepted; a failed step is no result');
  assert.deepEqual([by('interview_quote').model, by('interview_quote').accept_rate], [null, null], 'records run no model; nothing decided is null, never 0');
  assert.equal(rates.reduce((n, r) => n + r.proposals, 0), 7, 'the 60-day-old row is outside 30 days');
  assert.equal((await acceptRates({ DB: d1Over(db) } as any, 90)).reduce((n, r) => n + r.proposals, 0), 8, 'within 90 days it counts');
});

// ---- HQ's read -------------------------------------------------------------------

test('GET /api/admin/deck-generation: HQ only, the ceiling as set or "Not set", and the accept rates', async () => {
  const db = world();
  spend(db, 250_000);
  const read = (who: number, role: string, q = '', extra: Record<string, unknown> = {}) =>
    call(db, adminDeckGeneration, '/api/admin/deck-generation', who, role, 'GET', `/api/admin/deck-generation${q}`, undefined, extra);
  assert.equal((await read(FOUNDER, 'founder')).status, 403);
  const notSet = await read(ADMIN, 'admin');
  assert.equal(notSet.status, 200, JSON.stringify(notSet.body));
  assert.deepEqual(notSet.body.ceiling, { ceiling_microusd: null, spent_today_microusd: 250_000, percent: null, paused: false });
  assert.deepEqual([notSet.body.alert_thresholds, notSet.body.days, notSet.body.accept_rates], [[50, 80], 30, []]);
  const set = await read(ADMIN, 'admin', '?days=7', { DECK_DAILY_CEILING_MICROUSD: '1000000' });
  assert.deepEqual([set.body.ceiling.ceiling_microusd, set.body.ceiling.percent, set.body.days], [1_000_000, 25, 7]);
  for (const q of ['?days=0', '?days=366', '?days=2.5', '?days=x']) assert.equal((await read(ADMIN, 'admin', q)).body.error, 'invalid_days', q);
  assert.equal((await read(ADMIN, 'admin', '', { BRANCH_CODE: 'eu' })).status >= 400, true, 'a branch is refused');
});
