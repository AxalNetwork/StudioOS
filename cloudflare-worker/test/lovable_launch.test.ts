/**
 * D1082 (#2947, part 2 of #2398): Build in Lovable — the two prompt
 * templates, the 4,000-character cap, the launch link, the privacy check
 * (an email, a phone, an interviewee's name), and the four routes each cycle
 * mounts, writing D1068's `build_handoffs`.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, so the handoff and activity SQL run against production's columns
 * (migration 582 among them). `fetch` is replaced by a counter that fails the
 * test if anything calls it: the Worker never calls Lovable. Every venture,
 * person and address is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lovable_launch.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleValidate from '../src/routes/cycle_validate.ts';
import cycleBuild from '../src/routes/cycle_build.ts';
import {
  LEFT_OUT, LOVABLE_PROMPT_MAX, LOVABLE_URL, NEVER_INCLUDE, aliasOf, buildWithUrl, checkLine, landingTestPrompt, lineOf, linesWords, prototypePrompt,
} from '../src/services/lovable/prompt.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'lovable-launch-test-secret-0123456789-abcdef'; // synthetic test fixture
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 1, OTHER = 2, ADMIN = 3, PARTNER = 4;

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active,is_active) VALUES
    (1,'one@example.test','Founder One','founder',100,0,1),(2,'two@example.test','Founder Two','founder',200,0,1),(3,'admin@example.test','Admin','admin',NULL,0,1),
    (4,'partner@example.test','Partner','partner',NULL,0,1);
    INSERT INTO projects(id,name,description,founder_id,company_id,mvp_target_date) VALUES(1,'Fieldnote','Booking for small clinics',100,10,'2026-12-01'),(2,'Two',NULL,200,20,NULL);
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Clinics book a demo from a landing page'),(2,2,'H1','Other venture claim');
    INSERT INTO hypothesis_experiments(id,uid,project_id,hypothesis_id,title,method,target,status) VALUES
      (1,'e1',1,1,'Demo landing page','Paid ads to clinic managers','20 demo requests in two weeks','planned'),
      (2,'e2',1,1,'Second test',NULL,NULL,'done'),
      (3,'e3',2,2,'Not this venture',NULL,NULL,'planned');
    INSERT INTO mvp_features(id,project_id,title,description,is_must_have,sort_order) VALUES
      (1,1,'Online booking','Patients pick a slot',1,1),(2,1,'Reminders',NULL,1,2),(3,1,'Nice to have',NULL,0,3);
    INSERT INTO discovery_interviews(id,project_id,interviewee_name) VALUES(1,1,'Priya Ramanathan'),(2,2,'Someone Else'),(3,1,'Ana Li');`);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: kv() } as any;
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.route('/api/cycles/build', cycleBuild);

let fetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (..._args: unknown[]) => { fetches += 1; throw new Error('no network in this test'); }) as any;
test.after(() => { globalThis.fetch = realFetch; });

async function call(env: any, user: number | null, method: string, path: string, body?: unknown, opts: { impersonated?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) {
    headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user, ...(opts.impersonated ? { impersonated_by: ADMIN } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  }
  const saved = [console.warn, console.error, console.info]; const said: unknown[][] = [];
  console.warn = () => {}; console.error = (...a: unknown[]) => { said.push(a); }; console.info = (...a: unknown[]) => { said.push(a); };
  try {
    const r = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any, said, cache: r.headers.get('Cache-Control') };
  } finally { [console.warn, console.error, console.info] = saved; }
}
const EXP = { kind: 'experiment', id: '1' };
const PROTO = { kind: 'prototype', id: '1' };
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ─────────────────────────────────────────────── the builder

test('the templates are deterministic, name only the record, and stay within 4,000 characters', () => {
  const r = { venture: 'Fieldnote', description: 'Booking for small clinics', code: 'H1', claim: 'Clinics book a demo', title: 'Demo page', method: 'Ads', target: '20 requests' };
  const a = landingTestPrompt(r);
  assert.deepEqual(a, landingTestPrompt(r), 'the same record, the same prompt');
  assert.match(a.prompt, /^Build a one-page landing page for Fieldnote that tests one claim/);
  assert.match(a.prompt, /The claim to test \(H1\): Clinics book a demo\nThe experiment: Demo page\nHow it is tested: Ads\nWhat counts as a pass: 20 requests/);
  assert.equal(a.dropped, 0);
  const p = prototypePrompt({ venture: 'Fieldnote', description: null, targetDate: '2026-12-01', mustHaves: [{ title: 'Online booking', description: 'Patients pick a slot' }, { title: 'Reminders', description: null }] });
  assert.match(p.prompt, /^Build a clickable prototype of Fieldnote\.\n\nIt should be ready to show by 1 December 2026\.\n\nMust-haves:\n\n- Online booking: Patients pick a slot\n- Reminders\n\nBuild the must-haves above first/);
  assert.match(prototypePrompt({ venture: 'X', description: null, targetDate: null, mustHaves: [] }).prompt, /No must-haves are recorded yet/);
  const many = prototypePrompt({ venture: 'X', description: null, targetDate: null, mustHaves: Array.from({ length: 400 }, (_, i) => ({ title: `Must-have number ${i} with a long title`, description: null })) });
  assert.ok(many.prompt.length <= LOVABLE_PROMPT_MAX, `capped: ${many.prompt.length}`);
  assert.ok(many.dropped > 0 && many.prompt.endsWith('Use sample data only.'), 'whole lines are left out, and the closing line kept');
  assert.equal(LOVABLE_PROMPT_MAX, 4000);
});

test('the link is lovable.dev/#prompt= and the encoded prompt, nothing else', () => {
  assert.equal(LOVABLE_URL, 'https://lovable.dev/#prompt=');
  assert.equal(buildWithUrl('Build a page & a form #1'), 'https://lovable.dev/#prompt=Build%20a%20page%20%26%20a%20form%20%231');
  assert.equal(new URL(buildWithUrl('x?y=1')).search, '', 'no query string: the prompt rides in the fragment');
  assert.equal(checkLine([]), 'No personal data found');
  assert.equal(checkLine([{ kind: 'email', words: 'an email address', lines: [] }]), 'This prompt contains an email address. Remove it to continue.');
  assert.equal(LEFT_OUT, 'Interview names, quotes and contacts are never included.');
});

test('no source calls lovable.dev, and the builder reads no interview, contact, email or phone store', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk(resolve(process.cwd(), 'cloudflare-worker/src'))) {
    if (!/\.ts$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /fetch\([^)]*lovable\.dev/, `${f} fetches Lovable`);
  }
  const launch = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/lovable/launch.ts'), 'utf8');
  const prompt = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/lovable/prompt.ts'), 'utf8');
  for (const t of NEVER_INCLUDE) assert.doesNotMatch(launch, new RegExp(`\\b${t}\\b`), `the launch reads ${t}`);
  // The one read of interviews is the names the check refuses, never a prompt's source; D8773 adds
  // the venture's members' names, read only for the advisory.
  assert.deepEqual([...prompt.matchAll(/FROM (\w+)/g)].map((m) => m[1]), ['discovery_interviews', 'users', 'project_members', 'projects']);
  assert.match(prompt, /SELECT DISTINCT interviewee_name AS name FROM discovery_interviews WHERE project_id = \?/);
  assert.doesNotMatch(prompt + launch, /\$\{[^}]*\}[^`]*\.prepare|prepare\(`[^`]*\$\{/, 'no interpolated SQL');
});

// ─────────────────────────────────────────────── the routes

test('Validate: draft, launch and LV4 — one handoff row with the hash and length, one activity line, and the link; nothing fetched', async () => {
  const { db, env } = fixture();
  const d = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { project_id: 1, record: EXP });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.cache, 'private, no-store');
  assert.match(d.body.prompt, /Fieldnote.*H1.*Clinics book a demo from a landing page.*Demo landing page.*Paid ads.*20 demo requests/s);
  assert.deepEqual([d.body.max, d.body.left_out, d.body.check.ok, d.body.check.line, d.body.check.findings, d.body.check.advisories, d.body.last_opened_at],
    [4000, LEFT_OUT, true, 'No personal data found', [], [], null]);
  assert.match(d.body.check.checked_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  assert.deepEqual([d.body.venture_name, d.body.venture_label, d.body.venture_lines, d.body.alias, d.body.support_session], ['Fieldnote', 'Fieldnote', [1], null, false]);
  assert.equal(d.body.prompt_chars, d.body.prompt.length);
  // The re-export's "What this tests": the record's own words.
  assert.deepEqual(d.body.tests, { code: 'H1', claim: 'Clinics book a demo from a landing page', title: 'Demo landing page', target: '20 demo requests in two weeks' });
  const prompt = `${d.body.prompt}\n\nKeep it calm.`;
  const l = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/launch', { project_id: 1, record: EXP, prompt });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.url, `https://lovable.dev/#prompt=${encodeURIComponent(prompt)}`);
  const row = db.prepare('SELECT * FROM build_handoffs').get() as any;
  assert.deepEqual([row.provider, row.module, row.record_table, row.record_id, row.prompt_chars, row.text_hash, row.target, row.plan_item_uids, row.marker, row.opened_by, row.uid],
    ['lovable', 'experiments', 'hypothesis_experiments', '1', prompt.length, sha(prompt), 'lovable.dev', '[]', null, FOUNDER, l.body.handoff.uid]);
  assert.equal(count(db, `SELECT COUNT(*) n FROM build_handoffs`), 1);
  const act = db.prepare(`SELECT * FROM activity_logs WHERE action = 'lovable_opened'`).all() as any[];
  assert.equal(act.length, 1);
  assert.deepEqual([act[0].entity_type, act[0].entity_id, act[0].project_id, act[0].details], ['validate.experiments', '1', 1, 'Experiment opened in Lovable']);
  assert.ok(!l.said.flat().some((x) => JSON.stringify(x ?? '').includes('Keep it calm')), 'the prompt is never logged');
  const again = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { project_id: 1, record: EXP });
  assert.equal(again.body.last_opened_at, row.opened_at);
  const ls = await call(env, PARTNER, 'GET', '/api/cycles/validate/lovable/launches?project=1');
  assert.equal(ls.status, 200, 'the board’s audience reads when it was opened');
  assert.deepEqual(ls.body.launches, [{ record: EXP, opened_at: row.opened_at, times: 1 }]);
  assert.equal(fetches, 0, 'nothing was sent to Lovable');
});

test('Build › Prototype / MVP: the must-haves only, the handoff on the venture, and the module read’s Build in Lovable part', async () => {
  const { db, env } = fixture();
  const d = await call(env, FOUNDER, 'POST', '/api/cycles/build/lovable/draft', { project_id: 1, record: PROTO });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.match(d.body.prompt, /- Online booking: Patients pick a slot\n- Reminders/);
  assert.equal(d.body.check.ok, true, 'a drafted prompt passes its own check: the ship date is in words, never digits a phone matcher reads');
  assert.doesNotMatch(d.body.prompt, /Nice to have/, 'only the must-haves');
  assert.match(d.body.tests.title, /^Prototype \/ MVP · \d+ must-haves?$/);
  assert.equal(d.body.tests.code, null);
  const l = await call(env, FOUNDER, 'POST', '/api/cycles/build/lovable/launch', { project_id: 1, record: PROTO, prompt: d.body.prompt });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  const row = db.prepare('SELECT * FROM build_handoffs').get() as any;
  assert.deepEqual([row.module, row.record_table, row.record_id], ['prototype-mvp', 'projects', '1']);
  assert.equal(count(db, `SELECT COUNT(*) n FROM activity_logs WHERE action = 'lovable_opened' AND entity_type = 'build.prototype-mvp'`), 1);
  const m = await call(env, FOUNDER, 'GET', '/api/cycles/build/modules/prototype-mvp?project=1');
  assert.equal(m.status, 200, JSON.stringify(m.body));
  // D1083's app link and this part's launch share the one `lovable` key.
  assert.deepEqual(m.body.parts.lovable.launch, { state: 'ok', project_id: 1, record: PROTO, can_launch: true, opened_at: row.opened_at });
  assert.equal(m.body.parts.lovable.state, 'ok', 'D1083\'s From Lovable part is kept');
  assert.ok(Array.isArray(m.body.parts.lovable.slots), 'D1083\'s slots are kept');
  assert.ok('vercel' in m.body.parts, 'D1098\'s From Vercel is kept');
  const p = await call(env, PARTNER, 'GET', '/api/cycles/build/modules/prototype-mvp?project=1');
  if (p.status === 200) assert.equal(p.body.parts.lovable.launch.can_launch, false, 'a reader is not offered the launch');
  const wrong = await call(env, FOUNDER, 'POST', '/api/cycles/build/lovable/draft', { project_id: 1, record: { kind: 'prototype', id: '2' } });
  assert.deepEqual([wrong.status, wrong.body.code], [400, 'invalid_record'], 'another venture’s Prototype / MVP is not this one');
  assert.equal(fetches, 0);
});

test('the privacy check: an email, a phone or an interviewee’s name is refused by the check and by the launch, and nothing is written', async () => {
  const { db, env } = fixture();
  const base = (await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { project_id: 1, record: EXP })).body.prompt;
  // D8773: each refusal names the line it is on, never the words.
  const n = base.split('\n').length + 1;
  const cases: Array<[string, string]> = [
    [`${base}\nWrite to ana@clinic.example`, `This prompt contains an email address, in line ${n}. Remove it to continue.`],
    [`${base}\nCall +1 415 555 0134`, `This prompt contains a phone number, in line ${n}. Remove it to continue.`],
    [`${base}\nAs Priya Ramanathan said, booking is slow.`, `This prompt contains an interviewee’s name, in line ${n}. Remove it to continue.`],
    [`${base}\nAs priya ramanathan said`, `This prompt contains an interviewee’s name, in line ${n}. Remove it to continue.`],
    [`${base}\nAna Li asked for reminders.`, `This prompt contains an interviewee’s name, in line ${n}. Remove it to continue.`],
  ];
  for (const [prompt, line] of cases) {
    const c = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/check', { project_id: 1, prompt });
    assert.equal(c.status, 200);
    assert.deepEqual([c.body.check.ok, c.body.check.line], [false, line]);
    const l = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/launch', { project_id: 1, record: EXP, prompt });
    assert.deepEqual([l.status, l.body.code], [422, 'pii_found']);
    assert.equal(l.body.detail, `${line} Nothing was opened.`);
    assert.ok(!JSON.stringify(l.body).match(/ana@clinic|555 0134|Priya|priya/), 'the match is never repeated');
    assert.equal(l.body.url, undefined);
  }
  const fine = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/check', { project_id: 1, prompt: `${base}\nSomeone Else is another venture’s interviewee; Priyanka is not a match, and neither is a banana lime.` });
  assert.equal(fine.body.check.ok, true, 'only this venture’s interviewees, as whole words');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);
  assert.equal(count(db, `SELECT COUNT(*) n FROM activity_logs WHERE action = 'lovable_opened'`), 0);
  const long = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/launch', { project_id: 1, record: EXP, prompt: 'x'.repeat(4001) });
  assert.deepEqual([long.status, long.body.code, long.body.prompt_chars, long.body.max], [422, 'too_long', 4001, 4000]);
  const empty = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/launch', { project_id: 1, record: EXP, prompt: '  ' });
  assert.deepEqual([empty.status, empty.body.code], [400, 'invalid_prompt']);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);
});

test('who: a support session, a non-member and a partner are refused the launch; an admin may; another venture’s experiment is 404', async () => {
  const { db, env } = fixture();
  const body = { project_id: 1, record: EXP, prompt: 'Build a page.' };
  const support = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/launch', body, { impersonated: true });
  assert.deepEqual([support.status, support.body.code], [403, 'support_session_refused']);
  const buildSupport = await call(env, FOUNDER, 'POST', '/api/cycles/build/lovable/launch', { project_id: 1, record: PROTO, prompt: 'Build a page.' }, { impersonated: true });
  assert.deepEqual([buildSupport.status, buildSupport.body.code], [403, 'support_session_refused']);
  for (const who of [OTHER, PARTNER]) {
    for (const step of ['draft', 'check', 'launch']) {
      const r = await call(env, who, 'POST', `/api/cycles/validate/lovable/${step}`, body);
      assert.equal(r.status, 403, `${who} ${step}`);
    }
  }
  assert.equal((await call(env, OTHER, 'GET', '/api/cycles/validate/lovable/launches?project=1')).status, 403);
  assert.equal((await call(env, null, 'POST', '/api/cycles/validate/lovable/launch', body)).status, 401);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);
  const admin = await call(env, ADMIN, 'POST', '/api/cycles/validate/lovable/launch', body);
  assert.equal(admin.status, 200, 'the bucket’s write gate admits an admin');
  const other = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { project_id: 1, record: { kind: 'experiment', id: '3' } });
  assert.deepEqual([other.status, other.body.code], [404, 'not_found']);
  const kind = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { project_id: 1, record: PROTO });
  assert.deepEqual([kind.status, kind.body.code], [400, 'invalid_record']);
  assert.equal((await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { record: EXP })).status, 400);
  assert.equal(fetches, 0);
});

test('LV1, LV4: the hypothesis record’s experiment rows carry Build in Lovable for a writer on a Planned row, and when it was opened', async () => {
  const { db, env } = fixture();
  const recordsApp = new Hono<any>();
  const { default: recordRoutes } = await import('../src/routes/cycle_records.ts');
  recordsApp.route('/api/cycles', recordRoutes);
  await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/launch', { project_id: 1, record: EXP, prompt: 'Build a page.' });
  const opened = (db.prepare('SELECT opened_at FROM build_handoffs').get() as any).opened_at;
  const token = await new SignJWT({ user_id: FOUNDER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await recordsApp.request('/api/cycles/validate/modules/experiments/records/1?project=1', { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  const rows = [...(body.main || []), ...(body.side || [])].find((s: any) => s.key === 'experiments').rows;
  assert.deepEqual(rows.map((x: any) => x.lovable), [
    { cycle: 'validate', project_id: 1, record: EXP, can_launch: true, opened_at: opened },
    { cycle: 'validate', project_id: 1, record: { kind: 'experiment', id: '2' }, can_launch: false, opened_at: null },
  ]);
});

// ─────────────────────────────────────────────── D8773 (#8773): what the check covered, the alias, the lines

/**
 * Two fictional ventures with the same three must-haves: [Maya Ruiz] is named
 * after its founder (account name "Maya Ruiz", no legal name on file), and
 * [Atlas Orchard] has a regular product name, with an accepted member and a
 * removed one. "Lena Park" is an interviewee of Atlas Orchard.
 */
function namedFixture() {
  const { db, env } = fixture();
  db.exec(`INSERT INTO users(id,email,name,display_name,role,founder_id,spinout_lab_active,is_active) VALUES
      (5,'maya@example.test','Maya Ruiz',NULL,'founder',500,0,1),
      (6,'atlas@example.test','Wren Hale','Wren','founder',600,0,1),
      (7,'noah@example.test','Noah Brandt',NULL,'founder',NULL,0,1),
      (8,'gone@example.test','Ivo Marsh',NULL,'founder',NULL,0,1);
    INSERT INTO projects(id,name,description,founder_id,company_id,mvp_target_date) VALUES
      (5,'Maya Ruiz','Yield planning for small orchards',500,50,'2026-12-18'),
      (6,'Atlas Orchard','Yield planning for small orchards',600,60,'2026-12-18');
    INSERT INTO mvp_features(id,project_id,title,description,is_must_have,sort_order) VALUES
      (51,5,'Block map','Draw each orchard block',1,1),(52,5,'Harvest log','Record a pick in under a minute',1,2),(53,5,'Yield forecast',NULL,1,3),
      (61,6,'Block map','Draw each orchard block',1,1),(62,6,'Harvest log','Record a pick in under a minute',1,2),(63,6,'Yield forecast',NULL,1,3);
    INSERT INTO project_members(project_id,user_id,role,status,removed_at) VALUES (6,7,'cofounder','accepted',NULL),(6,8,'cofounder','accepted','2026-11-01 00:00:00');
    INSERT INTO discovery_interviews(id,project_id,interviewee_name) VALUES (61,6,'Lena Park');`);
  return { db, env };
}
const MAYA = 5, ATLAS = 6;
const proto = (id: number) => ({ kind: 'prototype', id: String(id) });

test('D8773 regular product name: the five checks find nothing, no member’s name, and line 1 names the venture', async () => {
  const { env } = namedFixture();
  const d = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/draft', { project_id: ATLAS, record: proto(ATLAS) });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.match(d.body.prompt, /^Build a clickable prototype of Atlas Orchard\.\n/);
  assert.deepEqual([d.body.check.ok, d.body.check.findings, d.body.check.advisories, d.body.check.advisory_line], [true, [], [], undefined]);
  assert.deepEqual([d.body.venture_name, d.body.venture_label, d.body.venture_lines, d.body.alias], ['Atlas Orchard', 'Atlas Orchard', [1], null]);
});

test('D8773 founder-named venture: it passes the five checks, so the check also says a member’s name is in line 1, as advice, never a refusal', async () => {
  const { db, env } = namedFixture();
  const d = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/draft', { project_id: MAYA, record: proto(MAYA) });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.match(d.body.prompt, /^Build a clickable prototype of Maya Ruiz\.\n/);
  // Mutation checked: drop the member scan → advisories [] and the walkthrough's case passes silently.
  assert.equal(d.body.check.ok, true, 'a display name is not a recorded legal name: the five checks pass');
  assert.deepEqual(d.body.check.advisories, [{ kind: 'member_name', words: 'a member’s name', lines: [1] }]);
  assert.equal(d.body.check.advisory_line, 'This prompt contains a member’s name, in line 1. Lovable will see it.');
  assert.ok(!JSON.stringify(d.body.check).includes('Maya'), 'the check names the line, never the words');
  // Advisory only: the launch is not refused for it.
  const l = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/launch', { project_id: MAYA, record: proto(MAYA), prompt: d.body.prompt });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs WHERE project_id = ?', MAYA), 1);
  // Members: the founder's accounts and accepted members not removed (Atlas Orchard's).
  const typed = `Build a clickable prototype of Atlas Orchard.\n\nAsk Noah Brandt.\nAsk Ivo Marsh.\nAsk wren about it.`;
  const c = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/check', { project_id: ATLAS, prompt: typed });
  // Mutation checked: drop `removed_at IS NULL` → lines [3, 4]; drop display_name → lines [3].
  assert.deepEqual(c.body.check.advisories, [{ kind: 'member_name', words: 'a member’s name', lines: [3, 5] }]);
  assert.equal(c.body.check.advisory_line, 'This prompt contains a member’s name, in lines 3 and 5. Lovable will see it.');
  assert.equal(c.body.check.ok, true);
});

test('D8773 alias: the draft is rebuilt with it, checked again, the venture keeps its name, and nothing is saved', async () => {
  const { db, env } = namedFixture();
  const plain = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/draft', { project_id: MAYA, record: proto(MAYA) });
  const a = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/draft', { project_id: MAYA, record: proto(MAYA), alias: '  Project   Kestrel ' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.prompt, /^Build a clickable prototype of Project Kestrel\.\n/);
  assert.doesNotMatch(a.body.prompt, /Maya|Ruiz/, 'the alias replaces the venture’s name wherever the template put it');
  // Mutation checked: string-replace only line 1 in the client → the rest differs; here the rest is byte for byte the plain draft.
  assert.equal(a.body.prompt.split('\n').slice(1).join('\n'), plain.body.prompt.split('\n').slice(1).join('\n'));
  assert.deepEqual([a.body.venture_name, a.body.venture_label, a.body.venture_lines, a.body.alias], ['Maya Ruiz', 'Project Kestrel', [1], 'Project Kestrel']);
  assert.deepEqual([a.body.check.ok, a.body.check.advisories], [true, []], 'checked again: the member’s name is gone');
  assert.equal(a.body.tests.claim, 'Maya Ruiz', 'What this tests names the venture as it is');
  assert.equal((db.prepare('SELECT name FROM projects WHERE id = ?').get(MAYA) as any).name, 'Maya Ruiz', 'the venture is not renamed');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0, 'a draft records nothing');
  for (const bad of ['x', 'Line\u0000break', 'a'.repeat(61), 'mail@me.example', 42]) {
    const r = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/draft', { project_id: MAYA, record: proto(MAYA), alias: bad });
    assert.deepEqual([r.status, r.body.code], [400, 'invalid_alias'], String(bad));
  }
  assert.deepEqual([aliasOf(undefined), aliasOf(''), aliasOf('Project\nKestrel'), aliasOf('Ab'), aliasOf('A')], [null, null, 'Project Kestrel', 'Ab', false]);
  // The Validate template takes the alias too.
  const v = await call(env, FOUNDER, 'POST', '/api/cycles/validate/lovable/draft', { project_id: 1, record: EXP, alias: 'Project Kestrel' });
  assert.match(v.body.prompt, /^Build a one-page landing page for Project Kestrel that tests one claim/);
  assert.deepEqual([v.body.venture_name, v.body.venture_label], ['Fieldnote', 'Project Kestrel']);
});

test('D8773 changed prompt: the edited text is checked again, the refusal names its kind and line, and the launch refuses it too', async () => {
  const { db, env } = namedFixture();
  const d = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/draft', { project_id: ATLAS, record: proto(ATLAS) });
  const lines = d.body.prompt.split('\n');
  assert.match(lines[9], /^- Harvest log:/);
  lines.splice(9, 1, '- Harvest log: Record a pick for a block in two taps.');
  const clean = lines.join('\n');
  const c1 = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/check', { project_id: ATLAS, prompt: clean });
  assert.deepEqual([c1.body.check.ok, c1.body.check.line], [true, 'No personal data found']);
  const withName = [...lines.slice(0, 12), 'Open with a quote from Lena Park about losing harvest notes.', '', ...lines.slice(12)].join('\n');
  assert.equal(withName.split('\n')[12], 'Open with a quote from Lena Park about losing harvest notes.');
  const c2 = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/check', { project_id: ATLAS, prompt: withName });
  // Mutation checked: count lines from 0 → "in line 12".
  assert.deepEqual(c2.body.check.findings, [{ kind: 'interviewee_name', words: 'an interviewee’s name', lines: [13] }]);
  assert.equal(c2.body.check.line, 'This prompt contains an interviewee’s name, in line 13. Remove it to continue.');
  const both = `${withName}\nWrite to lena@orchard.example`;
  const c3 = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/check', { project_id: ATLAS, prompt: both });
  const last = both.split('\n').length;
  assert.equal(c3.body.check.line, `This prompt contains an email address (line ${last}) and an interviewee’s name (line 13). Remove it to continue.`);
  const l = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/launch', { project_id: ATLAS, record: proto(ATLAS), prompt: withName });
  assert.deepEqual([l.status, l.body.code, l.body.detail], [422, 'pii_found', 'This prompt contains an interviewee’s name, in line 13. Remove it to continue. Nothing was opened.']);
  assert.deepEqual(l.body.findings, [{ kind: 'interviewee_name', words: 'an interviewee’s name', lines: [13] }]);
  assert.ok(!JSON.stringify(l.body).match(/Lena|lena/), 'the match is never repeated');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);
  const ok = await call(env, ATLAS, 'POST', '/api/cycles/build/lovable/launch', { project_id: ATLAS, record: proto(ATLAS), prompt: clean });
  assert.equal(ok.status, 200);
  assert.equal((db.prepare('SELECT prompt_text FROM build_handoffs').get() as any).prompt_text, clean, 'the record keeps the edited text byte for byte');
});

test('D8773 a support session is told at the draft, before any press; the launch still refuses it', async () => {
  const { env } = namedFixture();
  const s = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/draft', { project_id: MAYA, record: proto(MAYA) }, { impersonated: true });
  assert.deepEqual([s.status, s.body.support_session], [200, true]);
  const f = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/draft', { project_id: MAYA, record: proto(MAYA) });
  assert.equal(f.body.support_session, false);
  const l = await call(env, MAYA, 'POST', '/api/cycles/build/lovable/launch', { project_id: MAYA, record: proto(MAYA), prompt: s.body.prompt }, { impersonated: true });
  assert.deepEqual([l.status, l.body.code], [403, 'support_session_refused']);
});

test('D8773 lines in words', () => {
  assert.deepEqual([linesWords([]), linesWords([3]), linesWords([5, 3]), linesWords([7, 1, 2, 2])], ['', 'in line 3', 'in lines 3 and 5', 'in lines 1, 2 and 7']);
  assert.deepEqual([lineOf('a\nb\nc', 0), lineOf('a\nb\nc', 2), lineOf('a\nb\nc', 4)], [1, 2, 3]);
});
