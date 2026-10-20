/**
 * D765 (#2090) PR 1 — one run path for every rail option: the Worker enforces
 * the page's switch, and every member run carries its page, option and record.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/rail_run_path_d765.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { run, __resetForTest, ASSIST_OFF_MESSAGE, assistOff, railPageKey } from '../src/services/aiRouter.ts';
import { railFor, refuseAssistOff, pageFromPath } from '../src/util/railContext.ts';

const RAIL_PREFS = readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8');
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function fixture(ai: any = { run: async () => ({ response: 'answer', usage: { prompt_tokens: 10, completion_tokens: 5 } }) }, prefs = true) {
  __resetForTest();
  const f = aiBudgetFixture();
  if (prefs) f.db.exec(RAIL_PREFS);
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',0,0,1)").run();
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  const calls: string[] = [];
  const wrapped = { run: async (model: string, input: any, options: any) => { calls.push(model); return ai.run(model, input, options); } };
  return { ...f, calls, env: { DB: f.DB, ENVIRONMENT: 'development', AI: withGuard(wrapped) } as any };
}
const turnOff = (db: any, section: string, user = 2) => db.prepare(
  "INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')",
).run(`u-${section}-${user}`, user, section);
const runs = (db: any) => db.prepare("SELECT * FROM ai_usage_logs WHERE task <> 'safety' ORDER BY id").all();
const holds = (db: any) => db.prepare('SELECT * FROM ai_budget_reservations').all();

// ================================================================ the switch

test('a run with rail on a page the member turned off is refused assist_off, with no hold, no usage row and no model call', async () => {
  const f = fixture();
  try {
    turnOff(f.db, 'validate');
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', rail: { page: 'Validate', option: 'fill:pain_tag' } });
    assert.equal(r.ok, false);
    assert.equal(r.refusal, 'assist_off');
    assert.equal(r.error, ASSIST_OFF_MESSAGE);
    assert.equal(ASSIST_OFF_MESSAGE, 'AI assistance is off on this page.');
    assert.equal(holds(f.db).length, 0, 'nothing was held');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get().n, 0, 'no usage row, the guard\'s included');
    assert.deepEqual(f.calls, [], 'no model, not even the guard, was called');
  } finally { f.db.close(); }
});

test('the switch is the member\'s own and the page\'s own: another member, another page and an on row all run', async () => {
  const f = fixture();
  try {
    turnOff(f.db, 'validate', 3);
    turnOff(f.db, 'raise');
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('on',2,'build','','eadwyn')").run();
    for (const page of ['validate', 'build', 'grow']) {
      const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', rail: { page } });
      assert.equal(r.ok, true, page);
    }
    // A model row (task <> '') is a pick, not the switch.
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,model) VALUES('pick',2,'grow','advisor_turn','@cf/x')").run();
    assert.equal(await assistOff(f.env, 2, 'grow'), false);
    assert.equal(await assistOff(f.env, 2, ' RAISE '), true, 'lower-cased and trimmed as the rail stores it');
  } finally { f.db.close(); }
});

test('a run without rail context is not switched (a system call), and a database before migration 465 has no switch', async () => {
  const f = fixture();
  try {
    turnOff(f.db, 'validate');
    assert.equal((await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello' })).ok, true);
  } finally { f.db.close(); }
  const g = fixture(undefined, false);
  try {
    assert.equal((await run(g.env, { task: 'advisor_turn', userId: 2, text: 'hello', rail: { page: 'validate' } })).ok, true);
  } finally { g.db.close(); }
});

test('a switch that cannot be read refuses rather than guess, and still holds and logs nothing', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE ai_rail_preferences; CREATE VIEW ai_rail_preferences AS SELECT 1 AS nope;');
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', rail: { page: 'validate' } });
    assert.equal(r.refusal, 'misconfigured');
    assert.match(String(r.error), /could not be checked/);
    assert.equal(holds(f.db).length, 0);
    assert.equal(runs(f.db).length, 0);
  } finally { f.db.close(); }
});

test('a transcription on an off page is saved: the switch never refuses saving', async () => {
  const f = fixture({ run: async () => ({ text: 'we lose a day a month' }) });
  try {
    turnOff(f.db, 'validate');
    const r = await run(f.env, {
      task: 'transcribe', userId: 2, audio: new Uint8Array(4000), audioMinutes: 0.5,
      rail: { page: 'validate', option: 'transcribe:interview', record: 'interview:12' },
    });
    assert.equal(r.ok, true, String(r.refusal));
    const [row] = runs(f.db);
    assert.deepEqual([row.rail_page, row.rail_option, row.record_ref], ['validate', 'transcribe:interview', 'interview:12']);
  } finally { f.db.close(); }
});

test('a run on an on page writes rail_page, rail_option and record_ref beside user_id and the charge', async () => {
  const f = fixture();
  try {
    turnOff(f.db, 'raise');
    const r = await run(f.env, { task: 'advisor_turn', userId: 2, text: 'hello', rail: { page: 'Perks & Products', option: 'draft:update', record: 'project:7' } });
    assert.equal(r.ok, true);
    const [row] = runs(f.db);
    assert.equal(row.user_id, 2);
    assert.ok(row.charged_microusd > 0, 'the member was charged');
    assert.deepEqual([row.rail_page, row.rail_option, row.record_ref], ['Perks & Products', 'draft:update', 'project:7']);
    // D762's rules for option and record are unchanged; a page takes spaces, & and ·.
    assert.equal(railPageKey('Founder · Validate'), 'Founder · Validate');
    assert.equal(railPageKey("/x'; DROP TABLE"), null);
  } finally { f.db.close(); }
});

// ================================================================ the route side

test('railFor takes the browser\'s page and option, URI-decoded, else the route\'s; refuseAssistOff answers 403 assist_off', async () => {
  const app = new Hono();
  app.get('/r', (c) => c.json(railFor(c, { page: 'validate', option: 'fill:pain_tag' }, 'project:3')));
  app.get('/off', (c) => refuseAssistOff(c));
  const sent = await (await app.request('/r', { headers: { 'X-Rail-Page': encodeURIComponent('perks & products'), 'X-Rail-Option': 'ask:eadwyn' } })).json();
  assert.deepEqual(sent, { page: 'perks & products', option: 'ask:eadwyn', record: 'project:3' });
  const none = await (await app.request('/r')).json();
  assert.deepEqual(none, { page: 'validate', option: 'fill:pain_tag', record: 'project:3' });
  const bad = await (await app.request('/r', { headers: { 'X-Rail-Page': '%E0%A4%A', 'X-Rail-Option': 'has space' } })).json();
  assert.deepEqual(bad, { page: 'validate', option: 'fill:pain_tag', record: 'project:3' }, 'an undecodable page and an invalid option fall back');
  const off = await app.request('/off');
  assert.equal(off.status, 403);
  const body = await off.json() as any;
  assert.equal(body.error, 'assist_off');
  assert.equal(body.message, 'AI assistance is off on this page.');
  assert.equal(pageFromPath('/validate/customer-research', 'x'), 'validate');
  assert.equal(pageFromPath(undefined, 'eadwyn'), 'eadwyn');
});

// ================================================================ the listing

/**
 * Every call of `run()` outside the router, by the name each file imports it
 * under. A call is a MEMBER call unless it is on SYSTEM below, with its reason.
 */
const SYSTEM: Record<string, string> = {
  'services/advisor/guardrails.ts:safety': 'The legacy advisor guard: a check of a member\'s text inside a turn whose own run already carries the page, not assistance; refusing the check would only remove a safety layer.',
  'services/market_intel/extractors/index.ts:paraphrase': 'paraphraseForSnippet has no caller; a reducer sweep that used it would be a job no member started, a system call (D720 §6).',
  // D766 (#2094): calls that reached env.AI.run directly, now through the router
  // as system calls (userId 0), logged at cost and charged to no member.
  'routes/admin_x.ts:image_screen': 'The safety screen on an image an admin uploads for HQ\'s X account: a check, not assistance, run for no member; refusing it would only remove a safety layer.',
  'routes/admin_x.ts:image_alt_text': 'Alt text for an image HQ posts to its own X account: a system call for no member\'s page, logged at cost and charged to no one. Its caption is a proposal the Super Admin keeps by Save or Approve, never written into the post (D780 part 2).',
  'routes/monitoring.ts:ops_summary': 'The site-metrics summary on HQ\'s monitoring page: about the platform, for no member\'s page, logged at cost and charged to no member.',
  'services/vectorize.ts:embed': 'The search index\'s embeddings: retrieval for a lookup or an indexing job, not assistance, run for no member and charged to no one.',
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** `{ where, task, options }` for each call: `options` is the call's text up to its closing parenthesis. */
function runCalls() {
  const calls: Array<{ where: string; task: string; options: string }> = [];
  for (const file of sources(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, '/');
    if (rel === 'services/aiRouter.ts') continue;
    const s = readFileSync(file, 'utf8');
    const names = new Set<string>();
    for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[./]*(?:services\/)?aiRouter'/g)) {
      for (const part of m[1].split(',')) {
        const mm = part.trim().match(/^run(?:\s+as\s+(\w+))?$/);
        if (mm) names.add(mm[1] || 'run');
      }
    }
    for (const m of s.matchAll(/import\s*\*\s*as\s*(\w+)\s*from\s*'[./]*(?:services\/)?aiRouter'/g)) names.add(`${m[1]}.run`);
    if (/\baiRouter\.run\(/.test(s)) names.add('aiRouter.run');
    // A dynamic import of the router's `run` would escape this listing: refuse it outright.
    assert.doesNotMatch(s, /import\(['"][./]*(?:services\/)?aiRouter['"]\)[^;]*\brun\b/, `${rel} imports run() dynamically`);
    for (const name of names) {
      const re = new RegExp(`(?<![\\w.])${name.replace('.', '\\.')}\\(`, 'g');
      for (const m of s.matchAll(re)) {
        const line = s.slice(0, m.index).split('\n').length;
        const lineText = s.split('\n')[line - 1];
        if (/^\s*(\/\/|\*)/.test(lineText)) continue;
        let depth = 0; let end = m.index! + m[0].length - 1;
        for (; end < s.length; end++) {
          if (s[end] === '(') depth++;
          else if (s[end] === ')' && --depth === 0) break;
        }
        const options = s.slice(m.index, end + 1);
        const task = options.match(/task:\s*['"]([\w]+)['"]/)?.[1] ?? options.match(/task:\s*([\w.]+)/)?.[1] ?? '?';
        calls.push({ where: `${rel}:${line}`, task, options });
      }
    }
  }
  return calls;
}

test('every member call of run() passes rail context; system callers are an explicit allow-list with reasons', () => {
  const calls = runCalls();
  assert.ok(calls.length >= 28, `the listing found ${calls.length} calls; it lost some`);
  const missing: string[] = [];
  const allowed = new Set<string>();
  for (const call of calls) {
    const key = `${call.where.replace(/:\d+$/, '')}:${call.task}`;
    if (SYSTEM[key]) { allowed.add(key); continue; }
    if (!/\brail\s*[:,]|\brail\s*\}/.test(call.options)) missing.push(`${call.where} (${call.task})`);
  }
  assert.deepEqual(missing, [], `member calls of run() with no rail context:\n${missing.join('\n')}`);
  assert.deepEqual([...allowed].sort(), Object.keys(SYSTEM).sort(), 'an allow-list entry names no call; remove it');
  for (const [key, why] of Object.entries(SYSTEM)) assert.ok(why.length > 40, `${key} needs its reason`);
});

test('every route that runs a member\'s press answers assist_off with 403, in the switch\'s words', () => {
  const routes = ['routes/ai.ts', 'routes/eadwyn.ts', 'routes/advisor.ts', 'routes/founder_validate.ts', 'routes/research.ts'];
  for (const r of routes) assert.match(readFileSync(join(SRC, r), 'utf8'), /refuseAssistOff\(c\)/, r);
  assert.match(readFileSync(join(SRC, 'routes/founder_validate_structure.ts'), 'utf8'), /if \(refusal === 'assist_off'\) return 403;/);
});
