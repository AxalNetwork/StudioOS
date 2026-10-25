/**
 * D1114 (#2994) — Story's "Ask Eadwyn ▾": `POST /api/cycles/raise/narrative/:version/sections/:section/draft`,
 * on real SQLite with the real AI router and a stubbed model, and the
 * positioning read's name for NAR4's "accepted by [Name]".
 *
 * What it proves: the run is metered under `draft:narrative-section` and
 * writes nothing (no section, binding or proposal row); no figure enters (the
 * founder's numbers are masked before the model reads them) and no figure
 * leaves (a sentence with a digit is dropped and counted); the page's switch
 * off answers 403 `assist_off` and an empty purse 402, each with no run; and
 * the positioning read names who saved a field.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_section_draft_d1114.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { maskFigures, screenSection } from '../src/services/narrative/sectionDraft.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const PAGE = 'Founder · Raise · Investor narrative';
const OPTION = 'draft:narrative-section';
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const between = (sql: string, from: string) => { const at = sql.indexOf(from); return sql.slice(at, sql.indexOf(');', at) + 2); };

const GOOD = { text: 'Small finance teams close the month by hand. Kestrel matches every account. It explains each difference before anyone asks.' };

async function fixture({ answer = GOOD as unknown, balance = 5000000 } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(mig('465_ai_rail_preferences.sql'));
  f.db.exec(mig('506_ai_rail_proposals.sql'));
  f.db.exec(`ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id = 20, subscription_tier = 'studio', name = 'Fay Founder' WHERE id = 2;
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
    ALTER TABLE activity_logs ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, name TEXT, solution TEXT);
    INSERT INTO projects VALUES (1, 20, NULL, 'Kestrel Labs', NULL);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER, role TEXT, status TEXT);`);
  // The deck's wording rows, with the columns migrations after the baseline add (version, investor_type, deck_version).
  f.db.exec(`CREATE TABLE spinout_deck_overrides (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, field_key TEXT NOT NULL, value TEXT,
    updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')), version INTEGER NOT NULL DEFAULT 0, investor_type TEXT, deck_version INTEGER,
    UNIQUE (project_id, version, field_key))`);
  f.db.exec(between(mig('463_raise_record_stores.sql'), 'CREATE TABLE IF NOT EXISTS narrative_version_meta'));
  f.db.exec(mig('544_narrative_sections.sql'));
  // Version 2, for a seed fund: its Traction words hold two figures.
  f.db.exec(`INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type) VALUES
      (1, '__version__', 'seed_fund', 2, 'seed_fund'),
      (1, 'traction.takeaway', 'MRR reached $16,950 from 42 paying customers in 6 months.', 2, 'seed_fund');
    INSERT INTO narrative_version_meta (project_id, version, start_from, created_by) VALUES (1, 2, 'blank', 2);
    INSERT INTO narrative_positioning (project_id, version, kind, position, text, source_kind, updated_by) VALUES
      (1, NULL, 'one_liner', 0, 'Close the month in a day.', 'eadwyn', 2);`);
  setFixtureAllowance(f.db, 0);
  if (balance) f.db.exec(`INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (2, ${balance})`);
  const prompts: string[] = [];
  const env: any = {
    DB: f.DB, JWT_SECRET: 'p'.repeat(64), ENVIRONMENT: 'development',
    AI: withGuard({ run: async (_model: string, input: any) => {
      prompts.push(JSON.stringify(input?.messages ?? input));
      return { response: typeof answer === 'string' ? answer : JSON.stringify(answer), usage: { prompt_tokens: 30, completion_tokens: 20 } };
    } }),
  };
  const jwt = async (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const app = new Hono(); app.route('/api/cycles/raise', cycleRaise);
  const call = async (method: string, path: string, body?: unknown, { who = 2, headers = {} as Record<string, string> } = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const r = await app.request(`/api/cycles/raise${path}${sep}project=1`, {
        method, headers: { Authorization: `Bearer ${await jwt(who)}`, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, env);
      const raw = await r.text();
      return { status: r.status, body: raw ? JSON.parse(raw) : null };
    } finally { [console.warn, console.error] = saved; }
  };
  const count = (t: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n);
  const usage = () => f.db.prepare('SELECT task, rail_option FROM ai_usage_logs ORDER BY id').all() as any[];
  const traction = () => (f.db.prepare("SELECT value FROM spinout_deck_overrides WHERE version = 2 AND field_key = 'traction.takeaway'").get() as any).value;
  return { ...f, call, prompts, count, usage, traction };
}

const DRAFT = '/narrative/2/sections/traction/draft';
const PRESS = { 'X-Rail-Option': encodeURIComponent(OPTION), 'X-Rail-Page': encodeURIComponent(PAGE) };

test('a run is metered under draft:narrative-section and writes nothing; the founder\'s figures never reach the model', async () => {
  const f = await fixture();
  try {
    const before = f.traction();
    const r = await f.call('POST', DRAFT, { mode: 'shorten' }, { headers: PRESS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.text, GOOD.text);
    assert.deepEqual([r.body.mode, r.body.section, r.body.version, r.body.removed], ['shorten', 'traction', 2, 0]);
    const prompt = f.prompts.find((p) => p.includes('Shorten the founder'))!;
    assert.ok(prompt, 'the run was made');
    assert.match(prompt, /MRR reached \[figure\] from \[figure\] paying customers in \[figure\] months/);
    assert.doesNotMatch(prompt, /16,950|42|\b6 months/, 'no recorded figure reaches the model');
    assert.match(prompt, /Audience: Seed fund/);
    assert.match(prompt, /One-liner: Close the month in a day/);
    // Writes nothing: the words, the sections, the bindings and the proposals are as they were.
    assert.equal(f.traction(), before);
    assert.deepEqual([f.count('narrative_sections'), f.count('narrative_bindings'), f.count('ai_rail_proposals')], [0, 0, 0]);
    const u = f.usage();
    assert.equal(u.length >= 1, true, 'metered');
    assert.ok(u.some((x) => x.rail_option === OPTION), 'logged under its own option');
  } finally { f.db.close(); }
});

test('the unsaved words on the page are what is asked about; Draft works from nothing', async () => {
  const f = await fixture();
  try {
    await f.call('POST', DRAFT, { mode: 'plain', words: 'Pilots convert at 30% within a month.' }, { headers: PRESS });
    assert.match(f.prompts.at(-1)!, /Pilots convert at \[figure\] within a month/);
    f.db.exec("DELETE FROM spinout_deck_overrides WHERE field_key = 'traction.takeaway'");
    const r = await f.call('POST', DRAFT, { mode: 'draft' }, { headers: PRESS });
    assert.equal(r.status, 200);
    assert.match(f.prompts.at(-1)!, /The founder's words now: none yet/);
  } finally { f.db.close(); }
});

test('no figure leaves: a sentence with a digit is dropped and counted; all of them dropped is a 422', async () => {
  let f = await fixture({ answer: { text: 'Revenue grows fast. Teams save 2 days a month. Every difference is explained.' } });
  try {
    const r = await f.call('POST', DRAFT, { mode: 'draft' }, { headers: PRESS });
    assert.equal(r.status, 200);
    assert.equal(r.body.text, 'Revenue grows fast. Every difference is explained.');
    assert.equal(r.body.removed, 1);
  } finally { f.db.close(); }
  f = await fixture({ answer: { text: 'Teams save 2 days. Up 30%.' } });
  try {
    const r = await f.call('POST', DRAFT, { mode: 'draft' }, { headers: PRESS });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'nothing_kept');
    assert.equal(r.body.removed, 2);
  } finally { f.db.close(); }
});

test('refusals: the page switched off is 403 assist_off, an empty purse is 402, each with no run; bad input says why', async () => {
  let f = await fixture();
  try {
    // The rail's switch for this page, as the rail writes it (migration 465: section lower-cased, task '').
    f.db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES ('pref-1', 2, ?, '', 'manual')").run(PAGE.toLowerCase());
    const r = await f.call('POST', DRAFT, { mode: 'draft' }, { headers: PRESS });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'assist_off');
    assert.equal(f.prompts.length, 0);
  } finally { f.db.close(); }
  f = await fixture({ balance: 0 });
  try {
    const r = await f.call('POST', DRAFT, { mode: 'draft' }, { headers: PRESS });
    assert.equal(r.status, 402);
    assert.equal(f.prompts.length, 0, 'nothing is run, nothing charged');
  } finally { f.db.close(); }
  f = await fixture();
  try {
    assert.equal((await f.call('POST', DRAFT, { mode: 'rewrite' })).status, 400);
    assert.equal((await f.call('POST', '/narrative/0/sections/traction/draft', { mode: 'draft' })).status, 409, 'version 0 is the live deck');
    assert.equal((await f.call('POST', '/narrative/2/sections/nope/draft', { mode: 'draft' })).status, 404);
    f.db.exec("DELETE FROM spinout_deck_overrides WHERE field_key = 'traction.takeaway'");
    const empty = await f.call('POST', DRAFT, { mode: 'shorten' });
    assert.equal(empty.status, 422);
    assert.equal(empty.body.code, 'nothing_to_read');
    assert.equal(f.prompts.length, 0);
    assert.equal((await f.call('POST', DRAFT, { mode: 'draft' }, { who: 3 })).status, 403, 'not the venture\'s');
  } finally { f.db.close(); }
});

test('NAR4: the positioning read names who saved a field', async () => {
  const f = await fixture();
  try {
    const r = await f.call('GET', '/narrative/positioning');
    assert.equal(r.status, 200);
    assert.equal(r.body.core[0].by, 'Fay Founder');
    f.db.exec('UPDATE narrative_positioning SET updated_by = NULL');
    assert.equal((await f.call('GET', '/narrative/positioning')).body.core[0].by, null, 'not recorded is null, never a guess');
  } finally { f.db.close(); }
});

test('the mask and the screen, alone', () => {
  assert.equal(maskFigures('MRR of $18,400 and 12% growth, 3x faster'), 'MRR of [figure] and [figure] growth, [figure] faster');
  assert.deepEqual(screenSection({ text: 'One. Two has [figure]. Three.' }, 100), { text: 'One. Three.', removed: 1 });
  assert.deepEqual(screenSection({ text: 'A long sentence that will not fit in the limit.' }, 20), { text: 'A long sentence that', removed: 0 });
  assert.deepEqual(screenSection('not json', 100), { text: '', removed: 0 });
});
