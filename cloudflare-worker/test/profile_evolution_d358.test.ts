/**
 * D358 — the Profiling v2 evolution loop (migration 364,
 * services/profileEvolution.ts, PROFILING_V2.md §7; Session 13).
 *
 * On node:sqlite over the baseline, with migrations 362 (Session 8), 363
 * (Session 7) and 364 applied, and the Session 6 personas as the people:
 *   - a re-answer in the same conversation keeps the earlier answer, and the
 *     profile uses the new one (Eli's whole Missionary → Architect timeline
 *     survives being answered in ONE conversation);
 *   - a displayed-archetype change writes exactly one event and one in-app
 *     notification; a flip that does not survive hysteresis writes none;
 *   - the nightly run evaluates only people with something new, is bounded,
 *     resumes after an interruption, backfills an engine bump across batches,
 *     survives one person failing, and a second run writes nothing;
 *   - an answer past six months is offered again with its re-ask wording,
 *     only after every unanswered profiling question;
 *   - the admin trends are counts only, with small cells hidden.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/profile_evolution_d358.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  dueReason, evaluateUser, isNightlyTick, profilingTrends, reaskList, reaskOverlay, reaskPrompt,
  reaskableIds, recordChangeEvents, runProfileEvolutionTick, suppressGroup,
  REFRESH_AFTER_DAYS, SMALL_CELL_MIN,
} from '../src/services/profileEvolution.ts';
import { loadLedger } from '../src/services/profileHistory.ts';
import { ENGINE_VERSION, replayDisplayed, scoringItemsFor } from '../src/services/archetypeScoring.ts';
import { buildFitBank } from '../src/services/advisor/banks/fitShared.ts';
import { nextTurn, pickNext } from '../src/services/advisor/stateMachine.ts';
import profileRoutes from '../src/routes/profile_history.ts';
import adminProfilingRoutes from '../src/routes/admin_profiling.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const M364 = read('cloudflare-worker/sql/migrations/364_profile_evolution.sql');
const EARLIER = [
  'cloudflare-worker/sql/migrations/048_advisor_state.sql',
  'cloudflare-worker/sql/migrations/238_advisor_engagements.sql',
  'cloudflare-worker/sql/migrations/339_dd_section_signoff.sql',
  'cloudflare-worker/sql/migrations/360_partner_booking_action_items.sql',
  'cloudflare-worker/sql/migrations/361_partner_booking_ratings.sql',
  'cloudflare-worker/sql/migrations/362_skill_evidence.sql',
  'cloudflare-worker/sql/migrations/363_profile_snapshots.sql',
].map(read);
const FIXTURE = JSON.parse(read('cloudflare-worker/test/fixtures/profiling-v2-personas.json'));
const ADVISOR_ROUTE = read('cloudflare-worker/src/routes/advisor.ts');
const INDEX = read('cloudflare-worker/src/index.ts');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const DAY = 86_400_000;

const persona = (key: string) => FIXTURE.personas.find((p: any) => p.key === key);
const ELI = persona('missionary_to_architect');
const OSCAR = persona('investor_flip_flop');
const ARIA = persona('advisor_ageing');

// Session 8's evidence sources read these tables; the loop reads the rest.
const TABLES = [
  'users', 'advisor_answers', 'activity_logs', 'notifications_inbox',
  'projects', 'skills', 'user_skills', 'pitch_decks', 'brand_sites', 'discovery_interviews',
  'roadmap_okrs', 'financial_models', 'esign_envelopes', 'esign_recipients', 'cap_table_securities',
  'spinout_lab_milestones', 'dd_sections', 'deal_stage_events', 'commitments', 'partners',
  'partner_bookings', 'perks', 'perk_claims', 'advisors', 'engagements', 'engagement_milestones',
  'experts', 'expert_bookings', 'expert_ratings', 'cohort_guidance',
];

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function sqliteCall(sql: string, binds: any[]) {
  const values: any[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { values.push(binds[Number(n) - 1]); return '?'; });
  return { sql: values.length ? rewritten : sql, values: values.length ? values : binds };
}
function d1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const q = sqliteCall(sql, b); const r = db.prepare(q.sql).get(...q.values); return r ? { ...r } : null; },
        async all() { const q = sqliteCall(sql, b); return { results: db.prepare(q.sql).all(...q.values).map((r: any) => ({ ...r })) }; },
        async run() {
          const q = sqliteCall(sql, b);
          const r = db.prepare(q.sql).run(...q.values);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  for (const m of EARLIER) db.exec(m);
  db.exec(M364); // whole file: it carries triggers
  const u = db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)');
  u.run(1, 'eli.evolve@example.test', 'founder', 'Eli Evolve');
  u.run(2, 'oscar.oscillate@example.test', 'investor', 'Oscar Oscillate');
  u.run(3, 'aria.ageing@example.test', 'advisor', 'Aria Ageing');
  u.run(4, 'nia.noanswers@example.test', 'founder', 'Nia Noanswers');
  u.run(9, 'ada.admin@example.test', 'admin', 'Ada Admin');
  return db;
}

/** Answer as the /answer route does: one conversation, upserting on (conversation, question). */
function answerInOneConversation(db: InstanceType<typeof DatabaseSync>, userId: number, answers: any[], conversationId = 70 + userId) {
  const up = db.prepare(
    `INSERT INTO advisor_answers (conversation_id, user_id, question_id, raw_value, saved_status, answered_at)
     VALUES (?, ?, ?, ?, 'saved', ?)
     ON CONFLICT(conversation_id, question_id) DO UPDATE SET
       raw_value = excluded.raw_value, saved_status = excluded.saved_status, answered_at = excluded.answered_at`,
  );
  const sorted = [...answers].sort((a, b) => String(a.answered_at).localeCompare(String(b.answered_at)));
  for (const a of sorted) up.run(conversationId, userId, a.question_id, String(a.value), a.answered_at);
}

const spyNotify = () => {
  const calls: any[] = [];
  return { calls, notify: async (_env: any, args: any) => { calls.push(args); return 1; } };
};
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const events = (db: InstanceType<typeof DatabaseSync>, userId?: number) =>
  db.prepare(`SELECT * FROM profile_change_events ${userId ? 'WHERE user_id = ?' : ''} ORDER BY id`).all(...(userId ? [userId] : [])).map((r: any) => ({ ...r }));

/* ------------------------------------------------------------------ *
 * 1 · migration 364                                                   *
 * ------------------------------------------------------------------ */

test('migration 364 stands alone; the revision trigger keeps a replaced fit answer, and only that', () => {
  const db = freshDb();
  assert.ok(!/\bBEGIN\s+TRANSACTION\b|\bCOMMIT\b/i.test(M364.replace(/^\s*--.*$/gm, '')), 'no transaction wrapper');
  const up = db.prepare(
    `INSERT INTO advisor_answers (conversation_id, user_id, question_id, raw_value, saved_status, answered_at)
     VALUES (1, 1, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, question_id) DO UPDATE SET
       raw_value = excluded.raw_value, saved_status = excluded.saved_status, answered_at = excluded.answered_at`,
  );
  const revs = () => db.prepare('SELECT question_id, raw_value, answered_at FROM advisor_answer_revisions ORDER BY id').all().map((r: any) => ({ ...r }));
  up.run('fit.founder.arch_builder', '2', 'saved', '2026-01-05 10:00:00');
  assert.deepEqual(revs(), [], 'a first answer is not a revision');
  up.run('fit.founder.arch_builder', '5', 'saved', '2026-07-01 10:00:00');
  assert.deepEqual(revs(), [{ question_id: 'fit.founder.arch_builder', raw_value: '2', answered_at: '2026-01-05 10:00:00' }]);
  up.run('fit.founder.arch_builder', '5', 'saved', '2026-07-01 10:00:00');
  assert.equal(revs().length, 1, 'writing the same answer again keeps nothing new');
  up.run('fit.founder.arch_builder', null, 'skipped', '2026-08-01 10:00:00');
  assert.equal(revs().length, 2, 'a skip over a saved answer keeps the saved answer');
  up.run('fit.founder.arch_builder', '4', 'saved', '2026-09-01 10:00:00');
  assert.equal(revs().length, 2, 'a skipped row replaced by an answer keeps nothing');
  up.run('founder.company_name', 'Acme', 'saved', '2026-01-05 10:00:00');
  up.run('founder.company_name', 'Acme Two', 'saved', '2026-02-05 10:00:00');
  assert.equal(revs().length, 2, 'non-profiling answers are not kept');

  assert.throws(() => db.prepare("UPDATE advisor_answer_revisions SET raw_value = '0'").run(), /append-only/);
  const ev = db.prepare(`INSERT INTO profile_change_events (user_id, persona, from_slug, to_slug, changed_on, trigger_kind, engine_version) VALUES (1, ?, 'a', 'b', '2026-07-14', ?, 'v')`);
  ev.run('founder', 'scheduled');
  assert.throws(() => ev.run('founder', 'scheduled'), /UNIQUE/, 'one event per change');
  assert.throws(() => ev.run('explorer', 'scheduled'), /CHECK/);
  assert.throws(() => db.prepare("UPDATE profile_change_events SET to_slug = 'c'").run(), /append-only/);
  assert.throws(() => db.prepare("INSERT INTO profile_evolution_state (user_id, last_evaluated_at, last_trigger, engine_version) VALUES (1, 'x', 'whenever', 'v')").run(), /CHECK/);
  assert.throws(() => db.prepare('INSERT INTO profile_evolution_cursor (id) VALUES (2)').run(), /CHECK/);
});

/* ------------------------------------------------------------------ *
 * 2 · re-answering keeps the past                                     *
 * ------------------------------------------------------------------ */

test('Eli answers in ONE conversation: every earlier answer stays in the ledger and the timeline replays exactly', async () => {
  const db = freshDb();
  answerInOneConversation(db, 1, ELI.answers);
  const current = db.prepare('SELECT COUNT(*) AS n FROM advisor_answers WHERE user_id = 1').get() as any;
  assert.ok(current.n < ELI.answers.length, 'the upsert really did replace rows');
  const ledger = await loadLedger({ DB: d1(db) } as any, 1);
  assert.equal(ledger.length, ELI.answers.length, 'every answer Eli gave is in the ledger');
  for (const ck of ELI.checkpoints) {
    const r = replayDisplayed('founder', scoringItemsFor('founder'), ledger, ck.at);
    assert.equal(r.displayed, ck.displayed, `displayed @ ${ck.at}`);
    assert.equal(r.computed, ck.computed, `computed @ ${ck.at}`);
  }
});

/* ------------------------------------------------------------------ *
 * 3 · change events                                                   *
 * ------------------------------------------------------------------ */

test('a displayed-archetype change writes exactly one event, one in-app notice and one log line; the first classification writes none', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  answerInOneConversation(db, 1, ELI.answers);
  const spy = spyNotify();
  for (const day of days('2026-06-28', '2026-07-16')) {
    await evaluateUser(env, 1, 'scheduled', new Date(`${day}T03:30:00Z`), spy);
  }
  const ev = events(db, 1);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].from_slug, 'fo_missionary');
  assert.equal(ev[0].to_slug, 'fo_architect');
  assert.equal(ev[0].changed_on, '2026-07-14', 'the day the card switched, from the hysteresis replay');
  assert.equal(ev[0].engine_version, ENGINE_VERSION);
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].userId, 1);
  assert.equal(spy.calls[0].title, 'Your archetype is now The Architect');
  assert.equal(spy.calls[0].link, '/studio/archetype');
  assert.deepEqual(spy.calls[0].channels, ['in_app'], 'in-app only, no email (decision e)');
  const logs = db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'profile.archetype_changed'").all().map((r: any) => ({ ...r }));
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0].details, /fo_|Architect|Missionary/, 'the log does not carry the archetype');
  // Evaluating again, any number of times, changes nothing.
  await evaluateUser(env, 1, 'scheduled', new Date('2026-07-16T05:00:00Z'), spy);
  await evaluateUser(env, 1, 'answer', new Date('2026-07-17T05:00:00Z'), spy);
  assert.equal(events(db, 1).length, 1);
  assert.equal(spy.calls.length, 1);
});

test('two racing recomputes of the same change record it once and notify once', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  const spy = spyNotify();
  const r: any = {
    persona: 'founder', written: true, displayed_changed: true, previous_displayed_slug: 'fo_missionary',
    profile: { displayed_slug: 'fo_architect', engine_version: ENGINE_VERSION, hysteresis: { pending: null, displayed_since: '2026-07-14' } },
  };
  const now = new Date('2026-07-14T10:00:00Z');
  const a = await recordChangeEvents(env, 1, 'answer', [r], now, spy);
  const b = await recordChangeEvents(env, 1, 'scheduled', [r], now, spy);
  assert.equal(a.length + b.length, 1);
  assert.equal(events(db).length, 1);
  assert.equal(spy.calls.length, 1);
  // A first classification (nothing displayed before) is not a change.
  const first = await recordChangeEvents(env, 2, 'answer', [{ ...r, previous_displayed_slug: null }], now, spy);
  assert.equal(first.length, 0);
  // A computed-only change (displayed unchanged) is not a change either.
  const computedOnly = await recordChangeEvents(env, 2, 'answer', [{ ...r, displayed_changed: false }], now, spy);
  assert.equal(computedOnly.length, 0);
  assert.equal(spy.calls.length, 1);
});

test('Oscar’s seven-day flip in March writes nothing; the flip that holds writes one event, on 14 May', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  answerInOneConversation(db, 2, OSCAR.answers);
  const spy = spyNotify();
  for (const day of days('2026-03-01', '2026-03-31')) await evaluateUser(env, 2, 'scheduled', new Date(`${day}T03:30:00Z`), spy);
  assert.equal(events(db, 2).length, 0, 'the computed flip never reached the card');
  const snaps = db.prepare("SELECT computed_slug, displayed_slug FROM profile_snapshots WHERE user_id = 2 ORDER BY id").all().map((r: any) => ({ ...r }));
  assert.ok(snaps.some((s) => s.computed_slug === 'inv_hands_on_partner'), 'the computed archetype did flip');
  assert.ok(snaps.every((s) => s.displayed_slug === 'inv_network_amplifier'));
  for (const day of days('2026-04-28', '2026-05-16')) await evaluateUser(env, 2, 'scheduled', new Date(`${day}T03:30:00Z`), spy);
  const ev = events(db, 2);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].to_slug, 'inv_hands_on_partner');
  assert.equal(ev[0].changed_on, '2026-05-14');
  assert.equal(spy.calls.length, 1);
});

/* ------------------------------------------------------------------ *
 * 4 · the nightly run                                                 *
 * ------------------------------------------------------------------ */

test('dueReason: who the nightly run evaluates, and why', () => {
  const now = Date.parse('2026-07-20T03:00:00Z');
  const fresh = { last_evaluated_at: '2026-07-19T03:00:00.000Z', engine_version: ENGINE_VERSION };
  assert.equal(dueReason({ state: null, evidenceComputedAt: null, pendingHysteresis: false, nowMs: now }), 'scheduled', 'never evaluated');
  assert.equal(dueReason({ state: { ...fresh, engine_version: 'profiling-v2.0' }, evidenceComputedAt: null, pendingHysteresis: false, nowMs: now }), 'engine_bump');
  assert.equal(dueReason({ state: fresh, evidenceComputedAt: '2026-07-19T03:05:00.000Z', pendingHysteresis: false, nowMs: now }), 'evidence');
  assert.equal(dueReason({ state: fresh, evidenceComputedAt: '2026-07-18T03:05:00.000Z', pendingHysteresis: false, nowMs: now }), null, 'evidence older than the evaluation');
  assert.equal(dueReason({ state: fresh, evidenceComputedAt: null, pendingHysteresis: true, nowMs: now }), 'scheduled', 'a hysteresis clock is running');
  const old = { ...fresh, last_evaluated_at: new Date(now - REFRESH_AFTER_DAYS * DAY).toISOString() };
  assert.equal(dueReason({ state: old, evidenceComputedAt: null, pendingHysteresis: false, nowMs: now }), 'scheduled', 'monthly refresh');
  const recent = { ...fresh, last_evaluated_at: new Date(now - (REFRESH_AFTER_DAYS - 1) * DAY).toISOString() };
  assert.equal(dueReason({ state: recent, evidenceComputedAt: null, pendingHysteresis: false, nowMs: now }), null);
});

test('isNightlyTick: every minute of 03:00–03:59 UTC except :15 and :45', () => {
  assert.equal(isNightlyTick(new Date('2026-07-20T03:00:00Z')), true);
  assert.equal(isNightlyTick(new Date('2026-07-20T03:59:00Z')), true);
  assert.equal(isNightlyTick(new Date('2026-07-20T03:15:00Z')), false);
  assert.equal(isNightlyTick(new Date('2026-07-20T03:45:00Z')), false);
  assert.equal(isNightlyTick(new Date('2026-07-20T02:59:00Z')), false);
  assert.equal(isNightlyTick(new Date('2026-07-20T04:00:00Z')), false);
});

const state = (db: InstanceType<typeof DatabaseSync>) =>
  Object.fromEntries(db.prepare('SELECT user_id, last_trigger, engine_version, last_evaluated_at FROM profile_evolution_state').all().map((r: any) => [r.user_id, { ...r }]));

test('the nightly run: evidence first on even minutes, bounded batches, one pass a day, and a second run writes nothing', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  answerInOneConversation(db, 1, ELI.answers);
  answerInOneConversation(db, 2, OSCAR.answers);
  const spy = spyNotify();
  const t = (iso: string) => runProfileEvolutionTick(env, new Date(iso), { profileBatch: 1, ...spy });

  const e1 = await t('2026-10-01T03:00:00Z');
  assert.equal(e1.stage, 'evidence', 'an even minute serves the evidence pass');
  assert.equal(e1.pass_complete, true, 'five users fit in one evidence batch');
  const p1 = await t('2026-10-01T03:01:00Z');
  assert.deepEqual([p1.stage, p1.processed, p1.evaluated], ['profiles', 1, 1]);
  const p2 = await t('2026-10-01T03:02:00Z');
  assert.deepEqual([p2.stage, p2.processed, p2.evaluated], ['profiles', 1, 1], 'evidence is done: even minutes serve profiles');
  const p3 = await t('2026-10-01T03:03:00Z');
  assert.deepEqual([p3.processed, p3.pass_complete], [0, true], 'Nia has no profiling answers and is never walked');
  assert.equal((await t('2026-10-01T03:04:00Z')).stage, 'idle', 'one pass a day');
  const snaps = (db.prepare('SELECT COUNT(*) AS n FROM profile_snapshots').get() as any).n;
  assert.ok(snaps >= 2);
  assert.deepEqual(Object.keys(state(db)).map(Number).sort(), [1, 2]);

  // The next night: nothing new for anyone. Walked, not evaluated, nothing written.
  await t('2026-10-02T03:00:00Z');
  const n1 = await t('2026-10-02T03:01:00Z');
  const n2 = await t('2026-10-02T03:02:00Z');
  const n3 = await t('2026-10-02T03:03:00Z');
  assert.equal(n1.evaluated + n2.evaluated + n3.evaluated, 0);
  assert.equal(n1.failed + n2.failed + n3.failed, 0);
  assert.equal(n1.processed + n2.processed, 2, 'both were walked');
  assert.equal(state(db)[1].last_evaluated_at, '2026-10-01T03:01:00.000Z', 'and neither was re-evaluated');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM profile_snapshots').get() as any).n, snaps, 'a second run writes nothing');
  assert.equal(events(db).length, 0);
});

test('the nightly run evaluates only the person with new evidence, with the evidence trigger', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  answerInOneConversation(db, 1, ELI.answers);
  answerInOneConversation(db, 2, OSCAR.answers);
  const base = new Date('2026-10-01T02:00:00Z');
  await evaluateUser(env, 1, 'scheduled', base, spyNotify());
  await evaluateUser(env, 2, 'scheduled', base, spyNotify());
  db.prepare("INSERT INTO profile_evolution_cursor (id, evidence_completed_on) VALUES (1, '2026-10-01')").run();
  db.prepare(`INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at)
              VALUES (2, 'finance_ops', 'commitment_signed', 3, 3, 3, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-10-01T02:30:00.000Z')`).run();
  const r = await runProfileEvolutionTick(env, new Date('2026-10-01T03:01:00Z'), { profileBatch: 20, ...spyNotify() });
  assert.deepEqual([r.processed, r.evaluated], [2, 1]);
  const s = state(db);
  assert.equal(s[2].last_trigger, 'evidence');
  assert.equal(s[1].last_evaluated_at, base.toISOString(), 'Eli had nothing new and was left alone');
});

test('an engine bump backfills everyone across bounded batches, resumes after an interrupted night, and survives one failure', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  answerInOneConversation(db, 1, ELI.answers);
  answerInOneConversation(db, 2, OSCAR.answers);
  answerInOneConversation(db, 3, ARIA.answers);
  for (const u of [1, 2, 3]) {
    db.prepare("INSERT INTO profile_evolution_state (user_id, last_evaluated_at, last_trigger, engine_version) VALUES (?, '2026-09-30T03:00:00.000Z', 'scheduled', 'profiling-v2.0')").run(u);
  }
  db.prepare("INSERT INTO profile_evolution_cursor (id, evidence_completed_on) VALUES (1, '2026-10-01')").run();
  const seen: number[] = [];
  const evaluate = async (e: any, id: number, why: any, now: Date, deps: any) => {
    seen.push(id);
    if (id === 2 && seen.filter((x) => x === 2).length === 1) throw new Error('boom');
    return evaluateUser(e, id, why, now, deps);
  };
  // Night one: a single tick runs, then the night ends (the hour is over).
  const a = await runProfileEvolutionTick(env, new Date('2026-10-01T03:01:00Z'), { profileBatch: 2, evaluate, ...spyNotify() });
  assert.deepEqual([a.processed, a.evaluated, a.failed, a.pass_complete], [2, 1, 1, false], 'Oscar failed; the batch went on');
  assert.equal(state(db)[1].engine_version, ENGINE_VERSION);
  assert.equal(state(db)[1].last_trigger, 'engine_bump');
  assert.equal(state(db)[3].engine_version, 'profiling-v2.0', 'Aria is past the cursor');
  // Night two resumes at the cursor rather than starting over.
  db.prepare("UPDATE profile_evolution_cursor SET evidence_completed_on = '2026-10-02' WHERE id = 1").run();
  const b = await runProfileEvolutionTick(env, new Date('2026-10-02T03:01:00Z'), { profileBatch: 2, evaluate, ...spyNotify() });
  assert.deepEqual([b.processed, b.evaluated, b.pass_complete], [1, 1, true]);
  assert.deepEqual(seen, [1, 2, 3], 'Eli was not evaluated twice');
  assert.equal(state(db)[3].engine_version, ENGINE_VERSION);
  // The next pass picks Oscar up, because his failed evaluation left him behind.
  db.prepare("UPDATE profile_evolution_cursor SET evidence_completed_on = '2026-10-03' WHERE id = 1").run();
  const c = await runProfileEvolutionTick(env, new Date('2026-10-03T03:01:00Z'), { profileBatch: 5, evaluate, ...spyNotify() });
  assert.equal(c.evaluated, 1);
  assert.equal(state(db)[2].engine_version, ENGINE_VERSION);
  assert.equal(state(db)[2].last_trigger, 'engine_bump');
});

/* ------------------------------------------------------------------ *
 * 5 · re-asking                                                       *
 * ------------------------------------------------------------------ */

test('reaskableIds: six months old is re-askable; one put again and left unanswered rests; the question on screen does not', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const at = (d: number) => now - d * DAY;
  const answered = new Map([['a', at(181)], ['b', at(182)], ['c', at(300)], ['d', at(300)], ['e', at(300)]]);
  const asked = new Map([['c', at(10)], ['d', at(301)], ['e', at(10)]]);
  assert.deepEqual([...reaskableIds(['a', 'b', 'c', 'd', 'e', 'z'], answered, asked, now)].sort(), ['b', 'd']);
  assert.deepEqual([...reaskableIds(['c', 'e'], answered, asked, now, 'e')], ['e']);
  assert.equal(reaskPrompt({ prompt: 'How hands-on are you?', reask_prompt: 'Still hands-on?' }), 'Still hands-on?');
  assert.equal(reaskPrompt({ prompt: 'How hands-on are you?' }), 'It has been a while since you answered this. Is it still true? How hands-on are you?');
});

const BANK = buildFitBank('founder', [
  { key: 'rq_one', prompt: 'One?', measures: { archetype_trait: 'builder' }, reask_prompt: 'Is one still true?' },
  { key: 'rq_two', prompt: 'Two?', measures: { archetype_trait: 'builder' } },
]);

test('reaskOverlay: old answers come back with their wording, only once no profiling question is left unanswered', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  const now = Date.parse('2026-10-01T00:00:00Z');
  const give = db.prepare(`INSERT INTO advisor_answers (conversation_id, user_id, question_id, raw_value, saved_status, answered_at) VALUES (5, 1, ?, '4', 'saved', ?)`);
  give.run('fit.founder.rq_one', '2026-01-01 10:00:00');
  // rq_two unanswered: it comes first, and nothing is re-asked.
  const before = await reaskOverlay(env, 1, BANK, new Set(['fit.founder.rq_one']), { nowMs: now });
  assert.equal(before.reask.size, 0);
  assert.equal(before.bank, BANK, 'the bank is untouched');
  // Now both answered; rq_two recently.
  give.run('fit.founder.rq_two', '2026-09-20 10:00:00');
  const answered = new Set(['fit.founder.rq_one', 'fit.founder.rq_two']);
  const after = await reaskOverlay(env, 1, BANK, answered, { nowMs: now });
  assert.deepEqual([...after.reask], ['fit.founder.rq_one']);
  assert.equal(after.bank.find((q) => q.id === 'fit.founder.rq_one')!.prompt, 'Is one still true?');
  assert.equal(after.bank.find((q) => q.id === 'fit.founder.rq_two')!.prompt, 'Two?');
  assert.deepEqual([...after.answered], ['fit.founder.rq_two']);
  assert.deepEqual([...answered].sort(), ['fit.founder.rq_one', 'fit.founder.rq_two'], 'the caller’s set is not mutated');
  const pick = pickNext(after.bank, after.answered, { week: 1, completedMilestones: new Set(), recentlyAsked: new Map(), now });
  assert.equal(pick.next?.id, 'fit.founder.rq_one');
  assert.equal(pick.next?.prompt, 'Is one still true?');
  // Put to the person and left unanswered: it rests.
  db.prepare("INSERT INTO advisor_state (user_id, question_id, last_asked_at) VALUES (1, 'fit.founder.rq_one', '2026-09-30 10:00:00')").run();
  assert.equal((await reaskOverlay(env, 1, BANK, answered, { nowMs: now })).reask.size, 0);
  // …unless it is the question on screen.
  assert.equal((await reaskOverlay(env, 1, BANK, answered, { nowMs: now, keepId: 'fit.founder.rq_one' })).reask.size, 1);
});

test('the state machine offers a re-askable question although the answer ledger lists it as answered', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  db.prepare(`INSERT INTO advisor_answers (conversation_id, user_id, question_id, raw_value, saved_status, answered_at)
              VALUES (5, 1, 'fit.founder.rq_one', '4', 'saved', '2026-01-01 10:00:00'),
                     (5, 1, 'fit.founder.rq_two', '4', 'saved', '2026-09-20 10:00:00')`).run();
  const answered = new Set(['fit.founder.rq_one', 'fit.founder.rq_two']);
  const ctx = { week: 1, completedMilestones: new Set<string>(), dynamicFallback: false, now: Date.parse('2026-10-01T00:00:00Z') };
  const without = await nextTurn(env, 1, BANK, { ...ctx, extraAnswered: answered });
  assert.equal(without.next_question, null, 'both answered: nothing to ask');
  const overlay = await reaskOverlay(env, 1, BANK, answered, { nowMs: ctx.now });
  const withReask = await nextTurn(env, 1, overlay.bank, { ...ctx, extraAnswered: overlay.answered, reaskable: overlay.reask });
  assert.equal(withReask.next_question?.id, 'fit.founder.rq_one');
  assert.equal(withReask.next_question?.prompt, 'Is one still true?');
});

test('every question-picking path of the advisor applies the re-ask overlay, and the answer path goes through evaluateUser', () => {
  assert.equal((ADVISOR_ROUTE.match(/await reaskOverlay\(c\.env, /g) || []).length, 6);
  assert.equal((ADVISOR_ROUTE.match(/reaskable: reask\.reask,/g) || []).length, 3, 'the three state-machine paths');
  assert.match(ADVISOR_ROUTE, /pickNext\(rankVisible, reask\.answered,/, '/queue');
  assert.equal((ADVISOR_ROUTE.match(/pickNextQuestion\(c\.env, user\.id, conv\.id, rankBank, reask\.answered,/g) || []).length, 2);
  assert.match(ADVISOR_ROUTE, /await evaluateUser\(c\.env, user\.id, 'answer'\);/);
  const at = INDEX.indexOf('if (now.getUTCHours() === 3) {', INDEX.indexOf('D358 — the Profiling v2 evolution loop'));
  assert.ok(at > 0, 'the nightly block is wired into the cron');
  const block = INDEX.slice(at, at + 700);
  assert.match(block, /if \(isNightlyTick\(now\)\) \{/);
  assert.match(block, /await runProfileEvolutionTick\(env, now\)/);
  assert.doesNotMatch(block, /hqCadences/, 'profiles live in every deployment');
  assert.match(INDEX, /app\.route\('\/api\/admin\/profiling', adminProfilingRoutes\);/);
});

/* ------------------------------------------------------------------ *
 * 6 · routes                                                          *
 * ------------------------------------------------------------------ */

async function call(db: InstanceType<typeof DatabaseSync>, as: number, role: string, path: string) {
  const app = new Hono<any>();
  app.route('/api/profile', profileRoutes);
  app.route('/api/admin/profiling', adminProfilingRoutes);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { DB: d1(db), JWT_SECRET } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* status says it */ }
  return { status: res.status, body, text };
}

test('GET /api/profile/reask: the caller’s own old answers with their wording, nobody else’s', async () => {
  const db = freshDb();
  answerInOneConversation(db, 3, ARIA.answers); // all given 2025-09-01
  const recent = new Date(Date.now() - 10 * DAY).toISOString();
  answerInOneConversation(db, 1, ELI.answers.slice(0, 5).map((a: any) => ({ ...a, answered_at: recent })));
  const aria = await call(db, 3, 'advisor', '/api/profile/reask');
  assert.equal(aria.status, 200);
  assert.equal(aria.body.reask_after_days, 182);
  assert.equal(aria.body.count, new Set(ARIA.answers.map((a: any) => a.question_id)).size);
  assert.equal(aria.body.items.length, aria.body.count);
  assert.ok(aria.body.items.every((i: any) => i.question_id.startsWith('fit.advisor.') && i.prompt && i.age_days >= 182));
  const eli = await call(db, 1, 'founder', '/api/profile/reask?user_id=3');
  assert.deepEqual([eli.body.count, eli.body.items.length], [0, 0], 'fresh answers only, and user_id is ignored');
  assert.ok(!eli.text.includes('fit.advisor.'));
});

test('reaskList marks a question put again and left unanswered as resting, with the date it can return', async () => {
  const db = freshDb();
  answerInOneConversation(db, 3, ARIA.answers.slice(0, 2));
  const q = ARIA.answers[0].question_id;
  db.prepare("INSERT INTO advisor_state (user_id, question_id, last_asked_at) VALUES (3, ?, '2026-09-01 10:00:00')").run(q);
  const r = await reaskList({ DB: d1(db) } as any, 3, Date.parse('2026-10-01T00:00:00Z'));
  const item = r.items.find((i: any) => i.question_id === q)!;
  assert.equal(item.resting_until, new Date(Date.parse('2026-09-01T10:00:00Z') + 182 * DAY).toISOString());
  assert.equal(r.items.filter((i: any) => i.resting_until === null).length, r.items.length - 1);
});

test('suppressGroup hides small counts and one more where a total would reveal them', () => {
  const show = (xs: number[]) => { const g = suppressGroup(xs, 5); return [g.cells.map((c) => c.count), g.totalShown]; };
  assert.deepEqual(show([7, 2, 0, 0]), [[null, null, 0, 0], true]);
  assert.deepEqual(show([7, 6, 2, 0]), [[7, null, null, 0], true]);
  assert.deepEqual(show([3, 0, 0, 0]), [[null, 0, 0, 0], false]);
  assert.deepEqual(show([8, 9, 0, 0]), [[8, 9, 0, 0], true]);
  assert.deepEqual(show([1, 1, 9]), [[null, null, 9], true]);
  assert.equal(SMALL_CELL_MIN, 5);
});

test('GET /api/admin/profiling/trends: admins only, counts only, small cells hidden', async () => {
  const db = freshDb();
  const snap = db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, displayed_slug, computed_slug,
      traits_json, skills_json, values_json, axal_values_json, computed_at) VALUES (?, ?, ?, 'answer', ?, ?, '{}', ?, '{}', '{}', ?)`);
  const skills = JSON.stringify({ finance_ops: { self: 3, evidence: null, blended: 3, state: 'self_rated_only' } });
  let uid = 100;
  for (let i = 0; i < 8; i += 1) snap.run(uid += 1, 'founder', ENGINE_VERSION, 'fo_missionary', 'fo_missionary', skills, '2026-07-10T03:00:00.000Z');
  for (let i = 0; i < 7; i += 1) snap.run(uid += 1, 'founder', ENGINE_VERSION, 'fo_architect', 'fo_architect', skills, '2026-07-10T03:00:00.000Z');
  for (let i = 0; i < 2; i += 1) snap.run(uid += 1, 'founder', ENGINE_VERSION, 'fo_maverick', 'fo_maverick', skills, '2026-07-10T03:00:00.000Z');
  for (let i = 0; i < 3; i += 1) snap.run(uid += 1, 'investor', ENGINE_VERSION, 'inv_thesis_backer', 'inv_thesis_backer', '{}', '2026-07-10T03:00:00.000Z');
  for (let i = 0; i < 6; i += 1) snap.run(uid += 1, 'partner', ENGINE_VERSION, 'pt_systems_builder', 'pt_systems_builder', '{}', '2026-07-10T03:00:00.000Z');
  const ev = db.prepare(`INSERT INTO profile_change_events (user_id, persona, from_slug, to_slug, changed_on, trigger_kind, engine_version) VALUES (?, ?, 'a', 'b', '2026-07-14', 'scheduled', 'v')`);
  for (let i = 101; i <= 106; i += 1) ev.run(i, 'founder');
  ev.run(118, 'investor');
  ev.run(121, 'partner');
  ev.run(122, 'partner');

  const denied = await call(db, 1, 'founder', '/api/admin/profiling/trends');
  assert.equal(denied.status, 403);
  assert.equal((await call(db, 9, 'admin', '/api/admin/profiling/trends?months=99')).status, 400);

  const admin = { DB: d1(db) } as any;
  const t = await profilingTrends(admin, { now: new Date('2026-07-31T12:00:00Z'), months: 2 });
  assert.deepEqual(t.months, ['2026-06', '2026-07']);
  const july = t.distribution.find((d: any) => d.month === '2026-07' && d.persona === 'founder')!;
  const count = (slug: string) => july.archetypes.find((a: any) => a.slug === slug)!.count;
  assert.equal(count('fo_missionary'), 8);
  assert.equal(count('fo_maverick'), null, '2 is below 5');
  assert.equal(count('fo_architect'), null, 'and the next smallest goes too, so 17 − 8 − 0 does not reveal it');
  assert.equal(count('fo_rocketeer'), 0);
  assert.deepEqual(july.profiles, { count: 17, suppressed: false });
  const inv = t.distribution.find((d: any) => d.month === '2026-07' && d.persona === 'investor')!;
  assert.deepEqual(inv.profiles, { count: null, suppressed: true });
  assert.ok(!t.distribution.some((d: any) => d.month === '2026-06'), 'nothing before the first snapshot');
  const fc = t.changes.find((c: any) => c.persona === 'founder')!;
  assert.deepEqual([fc.count, fc.share], [6, Math.round((6 / 17) * 1000) / 1000]);
  const ic = t.changes.find((c: any) => c.persona === 'investor')!;
  assert.deepEqual([ic.count, ic.suppressed, ic.share], [null, true, null]);
  // 6 partner profiles are shown, so a share of 2 changes would give the hidden 2 away.
  assert.deepEqual(t.distribution.find((d: any) => d.month === '2026-07' && d.persona === 'partner')!.profiles, { count: 6, suppressed: false });
  const pc = t.changes.find((c: any) => c.persona === 'partner')!;
  assert.deepEqual([pc.count, pc.suppressed, pc.share], [null, true, null], 'no share for a hidden count');
  const fin = t.skills.find((s: any) => s.axis === 'finance_ops')!;
  assert.equal(fin.states.find((s: any) => s.state === 'self_rated_only')!.count, 17);

  const res = await call(db, 9, 'admin', '/api/admin/profiling/trends?months=3');
  assert.equal(res.status, 200);
  for (const leak of ['user_id', '@example.test', 'Eli', 'email', '"name"']) assert.ok(!res.text.includes(leak), `no ${leak} in the trends`);
});
