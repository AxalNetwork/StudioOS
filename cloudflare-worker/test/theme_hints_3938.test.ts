/**
 * #3938 part 6 (D1478 task 4) — GR1 and VA11's retrieve step: each item's
 * nearest themes by meaning go to the fill's writer as a hint.
 *
 *   1. The plan's rows: both jobs retrieve with bge-m3 first; both fill tasks map to their job.
 *   2. `themeHints`: nearest first, at most two per item; a theme that cannot be
 *      embedded drops every hint; an item that cannot be embedded, or whose
 *      vector is the wrong size, gets none and never a guess.
 *   3. The press: Propose themes (GR1) and Tag ungrouped phrases (VA11) embed on
 *      the fill's page and rail, the writer reads the hint after the facts, and
 *      the parser is unchanged. A refusal at the retrieve step (assist off, a
 *      budget stop) stops the press before the writer; a model that cannot embed only drops the hint.
 * Synthetic records only; the models are stubs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/theme_hints_3938.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import founderValidate from '../src/routes/founder_validate.ts';
import { HINTS_PER_ITEM, HINT_DEPS, HintRefused, THEME_JOBS, defaultHintDeps, hintSection, retrieveModel, themeHints } from '../src/services/ai/themeHints.ts';
import { jobStep } from '../src/services/ai/modelUseCases.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { GUARD_MODEL } from './_guard_stub.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-3938-theme-hints-0123';
const FOUNDER = 1; const PID = 7;
const BGE_M3 = '@cf/baai/bge-m3';

// Two meanings: setup (x) and price (y). A text's vector says which it is near.
const vec = (t: string): number[] => /onboard|setup|sign/i.test(t) ? [1, 0.05] : /pric|cost|expens/i.test(t) ? [0.05, 1] : /reconcil|spreadsheet|manual/i.test(t) ? [0.7, 0.7] : [0.3, 0.3];
const embedOf = (map = vec) => ({ embed: async (t: string) => map(t) });

// ── 1. The plan's rows ───────────────────────────────────────────────────

test('1. GR1 and VA11 retrieve with bge-m3 before their writer; the fill tasks map to their job', () => {
  assert.equal(retrieveModel('GR1'), BGE_M3);
  assert.equal(retrieveModel('VA11'), BGE_M3);
  for (const job of ['GR1', 'VA11'] as const) {
    assert.equal(jobStep(job, 0)?.kind, 'retrieve');
    assert.equal(jobStep(job, 1)?.kind, 'synth');
  }
  assert.deepEqual({ ...THEME_JOBS }, { grow_theme_feedback: 'GR1', validate_tag_pains: 'VA11' });
});

// ── 2. themeHints ────────────────────────────────────────────────────────

test('2. nearest themes first, at most two per item, and the section the writer reads', async () => {
  // Mutation checked: sort ascending → "Onboarding" is last for the setup item.
  const hints = await themeHints(['Pricing', 'Onboarding', 'Reporting'], [
    { key: 'f1', text: 'Setup took a whole afternoon' },
    { key: 'f2', text: 'Too expensive for a team of three' },
  ], embedOf());
  assert.deepEqual(hints!.get('f1'), ['Onboarding', 'Reporting']);
  assert.deepEqual(hints!.get('f2'), ['Pricing', 'Reporting']);
  assert.equal(HINTS_PER_ITEM, 2);
  const section = hintSection(hints);
  assert.match(section, /^\nNearest themes by meaning \(a hint from the retrieval step, not an answer;/);
  assert.match(section, /\n {2}f1 → Onboarding; Reporting\n {2}f2 → Pricing; Reporting$/);
  assert.equal(hintSection(null), '');
  assert.equal(hintSection(new Map()), '');
});

test('2. a theme that cannot be embedded drops every hint; an item that cannot gets none', async () => {
  // Mutation checked: skipping a failed theme instead of returning null → f1 gets a hint from a partial list.
  assert.equal(await themeHints(['Pricing', 'Onboarding'], [{ key: 'f1', text: 'Setup' }], embedOf((t) => t === 'Onboarding' ? null as any : vec(t))), null);
  const some = await themeHints(['Pricing', 'Onboarding'], [{ key: 'f1', text: 'Setup' }, { key: 'f2', text: 'unreadable' }],
    embedOf((t) => t === 'unreadable' ? null as any : vec(t)));
  assert.deepEqual([...some!.keys()], ['f1']);
  assert.equal(await themeHints([], [{ key: 'f1', text: 'Setup' }], embedOf()), null, 'no themes, nothing embedded');
  assert.equal(await themeHints(['Pricing'], [], embedOf()), null);
});

test('2. a vector of the wrong size gives no hint, never a guess', async () => {
  // Mutation checked: keeping -Infinity scores → f1 is hinted "Onboarding; Pricing".
  const hints = await themeHints(['Pricing', 'Onboarding'], [{ key: 'f1', text: 'Setup' }], embedOf((t) => t === 'Setup' ? [1, 0, 0] : vec(t)));
  assert.equal(hints!.has('f1'), false);
});

// ── 3. The press ─────────────────────────────────────────────────────────

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  loadSchema(db);
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10);
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${FOUNDER}, 5000000);
    INSERT INTO product_feedback (uid, project_id, body, source, theme) VALUES
      ('fb-themed-1', ${PID}, 'Signing up was confusing', 'customer', 'Onboarding'),
      ('fb-themed-2', ${PID}, 'The plan costs too much', 'customer', 'Pricing'),
      ('fb-open-1', ${PID}, 'Setup took a whole afternoon', 'customer', NULL),
      ('fb-open-2', ${PID}, 'Too expensive for a team of three', 'customer', NULL);
    INSERT INTO pain_groups (id, project_id, title) VALUES (21, ${PID}, 'Manual reconciliation'), (22, ${PID}, 'Onboarding friction');
    INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${PID}, 21, 'spreadsheets', 'spreadsheets');
    INSERT INTO discovery_interviews (project_id, interviewee_name, pains_json) VALUES (${PID}, 'Ola Ops', '["spreadsheets", "reconciling by hand", "setup is slow"]');`);
  return db;
}

type Seen = { embeds: string[]; prompts: string[] };
async function propose(db: any, kind: string, opts: { embed?: (t: string) => any; headers?: Record<string, string> } = {}) {
  const seen: Seen = { embeds: [], prompts: [] };
  const reply = kind === 'feedback_theme' ? [{ uid: 'fb-open-1', theme: 'Onboarding' }] : [{ phrase: 'reconciling by hand', pain_group_id: 21 }];
  const AI = {
    run: async (model: string, input: any) => {
      if (model === GUARD_MODEL) return { response: 'safe', usage: { prompt_tokens: 10, completion_tokens: 1 } };
      if (model === BGE_M3) {
        const t = Array.isArray(input?.text) ? input.text[0] : input?.text;
        seen.embeds.push(t);
        const v = (opts.embed ?? vec)(t);
        if (v instanceof Error) throw v;
        return { data: [v], usage: { prompt_tokens: 5 } };
      }
      seen.prompts.push(String(input?.messages?.at(-1)?.content ?? ''));
      return { response: JSON.stringify(reply), usage: { prompt_tokens: 100, completion_tokens: 20 } };
    },
  };
  const app = new Hono<any>();
  app.route('/api/founder/validate', founderValidate);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/founder/validate/propose/${PID}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify({ kind }),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any, seen };
}
const rows = (db: any) => db.prepare("SELECT model, rail_page, rail_option FROM ai_usage_logs WHERE guard_for IS NULL ORDER BY id").all().map((r: any) => ({ ...r }));

test('3. Propose themes (GR1): the themes and items are embedded on the fill\'s page, and the writer reads the hint', async () => {
  // Mutation checked: the route not appending the hint → the writer's prompt has no "Nearest themes" section.
  const db = fixture();
  const r = await propose(db, 'feedback_theme');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // The gather reads unthemed feedback newest first (equal times: the later row first).
  assert.deepEqual(r.seen.embeds, ['Onboarding', 'Pricing', 'Too expensive for a team of three', 'Setup took a whole afternoon']);
  assert.equal(r.seen.prompts.length, 1);
  assert.match(r.seen.prompts[0], /Unthemed feedback:[\s\S]*Nearest themes by meaning/);
  assert.match(r.seen.prompts[0], /fb-open-2 → Pricing; Onboarding\n {2}fb-open-1 → Onboarding; Pricing$/);
  const logged = rows(db);
  assert.equal(logged.filter((x: any) => x.model === BGE_M3).length, 4, 'each embedding is its own charged run');
  for (const x of logged) assert.deepEqual([x.rail_page, x.rail_option], ['Founder · Grow · Product improvement', 'fill:feedback_theme']);
  // The parser is unchanged: only a theme the founder wrote, on an item on file.
  assert.deepEqual(r.body.proposals.map((p: any) => [p.payload?.uid, p.payload?.theme]), [['fb-open-1', 'Onboarding']]);
});

test('3. Tag ungrouped phrases (VA11): phrases are placed near the founder\'s own pain themes', async () => {
  const db = fixture();
  const r = await propose(db, 'pain_tag');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.seen.embeds.slice(0, 2), ['Manual reconciliation', 'Onboarding friction']);
  assert.match(r.seen.prompts[0], /Ungrouped phrases:[\s\S]*Nearest themes by meaning[\s\S]*reconciling by hand → Manual reconciliation; Onboarding friction/);
  assert.match(r.seen.prompts[0], /setup is slow → Onboarding friction; Manual reconciliation/);
  for (const x of rows(db)) assert.deepEqual([x.rail_page, x.rail_option], ['Founder · Validate · Problem discovery', 'fill:pain_tag']);
});

test('3. a model that cannot embed only drops the hint; the writer still runs on the facts', async () => {
  const db = fixture();
  const r = await propose(db, 'feedback_theme', { embed: () => new Error('embed down') });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.seen.embeds.length, 1, 'the first theme failed, so nothing else was embedded');
  assert.doesNotMatch(r.seen.prompts[0], /Nearest themes/);
});

test('3. a refusal at the retrieve step stops the press before the writer, in the refusal\'s words', async () => {
  // Mutation checked: HintRefused swallowed as a degrade → the writer runs and the press answers 201.
  const db = fixture();
  const real = HINT_DEPS.make;
  HINT_DEPS.make = () => ({ embed: async () => { throw new HintRefused({ ok: false, refusal: 'budget_user_month', error: 'spent' } as any); } });
  try {
    const r = await propose(db, 'feedback_theme');
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal(r.body?.error ?? r.body?.code, 'budget_user_month');
    assert.equal(r.seen.prompts.length, 0, 'no writer ran');
  } finally { HINT_DEPS.make = real; }
});

test('3. the retrieve step\'s own deps: a refusal the member must hear about throws; an unreachable model is null', async () => {
  // Mutation checked: defaultHintDeps not throwing on a refusal → assist off reads as "no vector".
  const db = fixture();
  db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES ('u-off', ?, ?, '', 'manual')").run(FOUNDER, 'founder · grow · product improvement');
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development', AI: { run: async (model: string) => {
    if (model === GUARD_MODEL) return { response: 'safe', usage: { prompt_tokens: 5, completion_tokens: 1 } };
    throw new Error('embed model down');
  } } };
  const rail = { page: 'Founder · Grow · Product improvement', option: 'fill:feedback_theme' } as any;
  const off = defaultHintDeps(env, { userId: FOUNDER, surface: '/validate', rail }, 'GR1');
  await assert.rejects(off.embed('Onboarding'), (e: any) => e instanceof HintRefused && e.result.refusal === 'assist_off');
  const on = defaultHintDeps(env, { userId: FOUNDER, surface: '/validate', rail: { page: 'Founder · Validate · Problem discovery', option: 'fill:pain_tag' } as any }, 'VA11');
  assert.equal(await on.embed('Onboarding'), null);
});
