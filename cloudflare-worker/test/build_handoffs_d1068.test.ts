/**
 * D1068 (#2938, part 5 of #2426): Send to…, the privacy check, the marker,
 * and GitHub's link proposals.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, so the handoff, plan, ledger and proposal SQL run against
 * production's columns (migration 582 among them). The plan comes from
 * D1065's preparation and D1066's Accept. GitHub is stubbed: no test reaches
 * a provider host. Every venture, person and address is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_handoffs_d1068.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import planRoutes from '../src/routes/build_plan.ts';
import { preparePlan } from '../src/services/buildPlanner.ts';
import { LOVABLE_PROMPT_MAX, MARKER_LINE, markersIn } from '../src/services/buildHandoffs.ts';
import { syncGithub } from '../src/integrations/providers/github.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'build-handoff-test-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 1, OTHER = 2, ADMIN = 3, PARTNER = 4;
const REPO = 'acme/app';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active,is_active) VALUES
    (1,'one@example.test','Founder One','founder',100,0,1),(2,'two@example.test','Founder Two','founder',200,0,1),(3,'admin@example.test','Admin','admin',NULL,0,1),
    (4,'partner@example.test','Partner','partner',NULL,0,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10),(2,'Two',200,20);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('partner-one',10,4),('founder-one',10,1);
    INSERT INTO pain_groups(id,project_id,title) VALUES(1,1,'Slow setup');
    INSERT INTO pain_group_aliases(project_id,group_id,phrase_norm,display_phrase) VALUES(1,1,'slow setup','Slow setup');
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day'),(2,1,'H2','Self service works');
    INSERT INTO hypothesis_pain_links(id,hypothesis_id,pain_group_id,direction) VALUES(1,1,1,'supports');
    INSERT INTO validation_decisions(id,project_id,decision,state,reasoning) VALUES(1,1,'proceed','given','Private reasoning');
    INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES('de1',1,'interview','pain-1-1','Snapshot','supports');
    INSERT INTO validation_decision_commitments(id,uid,decision_id,project_id,text,owner_user_id,due_date) VALUES(1,'c1',1,1,'Test the pilot',1,'2027-12-31');
    INSERT INTO demand_signals(id,project_id,kind,status,signal_date) VALUES(1,1,'would_pay','confirmed','2026-10-01');`);
  for (let id = 1; id <= 3; id++) {
    db.prepare('INSERT INTO discovery_interviews(id,project_id,interviewee_name,pains_json) VALUES(?,1,?,?)').run(id, 'Someone', '["Slow setup"]');
    db.prepare("INSERT INTO interview_pain_severities(interview_id,phrase_norm,severity) VALUES(?,'slow setup','severe')").run(id);
    db.prepare("INSERT INTO interview_findings(uid,project_id,interview_id,module,kind,key_norm,payload_json) VALUES(?,1,?,'demand-signals','objection','price',?)").run('f' + id, id, '{"about":"price"}');
  }
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: kv(), KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  const enc = await encryptCredentials(env, 'gh-1', { access_token: 'ghu_fixture' });
  db.prepare(`INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (31, 'gh-1', 1, 'github', 'oauth2', ?, ?)`)
    .run(enc, JSON.stringify({ repositories: [REPO], project_id: 1 }));
  db.exec('INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1)');
  await preparePlan(env, 1, FOUNDER);
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/build/plan', planRoutes);
const Q = '?project=1&scope=venture';

async function call(env: any, user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const r = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  } finally { [console.warn, console.error, console.info] = saved; }
}
const item = (db: DatabaseSync, kind: string) => db.prepare(`SELECT i.*, q.status FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
  WHERE i.kind = ? ORDER BY i.item_key LIMIT 1`).get(kind) as any;
/** Accepts the first item of a kind and returns it as it landed. */
async function accepted(env: any, db: DatabaseSync, kind: string, payload?: unknown) {
  const it = item(db, kind);
  const r = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/items/${it.uid}/accept`, payload === undefined ? {} : { payload });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return db.prepare('SELECT * FROM build_plan_items WHERE uid = ?').get(it.uid) as any;
}
const send = (env: any, body: unknown, who = FOUNDER) => call(env, who, 'POST', `/api/cycles/build/plan/handoffs${Q}`, body);
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('GitHub: one pre-filled issue link per item into a picked repository, each with its evidence and marker, one handoff row each', async () => {
  const { db, env } = await fixture();
  const f = await accepted(env, db, 'feature');
  const m = await accepted(env, db, 'must-have');
  const r = await send(env, { provider: 'github', items: [f.uid, m.uid], repository: REPO });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.issues.length, 2);
  const [fi, mi] = r.body.issues;
  assert.equal(fi.plan_item_uid, f.uid);
  assert.equal(fi.marker, f.marker);
  assert.match(fi.body, new RegExp(`${MARKER_LINE} ${f.marker}$`));
  assert.match(fi.body, /Why this is on the plan \(from Validate\):\n- Slow setup · Recorded/);
  assert.equal(fi.body.includes('Recorded Proceed'), false, 'the decision never leaves StudioOS');
  assert.equal(fi.url, `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(fi.title)}&body=${encodeURIComponent(fi.body)}`);
  assert.deepEqual(markersIn(mi.body), [m.marker]);
  const rows: any[] = db.prepare('SELECT * FROM build_handoffs ORDER BY id').all();
  assert.equal(rows.length, 2);
  for (const [row, it, issue] of [[rows[0], f, fi], [rows[1], m, mi]] as const) {
    assert.equal(row.provider, 'github');
    assert.equal(row.project_id, 1);
    assert.equal(row.target, REPO);
    assert.equal(row.marker, it.marker);
    assert.deepEqual(JSON.parse(row.plan_item_uids), [it.uid]);
    assert.equal(row.record_table, it.landed_table);
    assert.equal(String(row.record_id), String(it.landed_id));
    assert.equal(row.prompt_text, `${issue.title}\n\n${issue.body}`);
    assert.equal(row.prompt_chars, row.prompt_text.length);
    assert.equal(row.text_hash, sha(row.prompt_text));
    assert.equal(row.opened_by, FOUNDER);
  }
  assert.deepEqual(r.body.handoffs.map((h: any) => h.uid), rows.map((x) => x.uid));
  assert.equal(count(db, "SELECT COUNT(*) n FROM activity_logs WHERE action = 'build_plan_handoff' AND details = '2 plan items sent to GitHub'"), 1);

  // No repository: the issues as Markdown to copy, with no link, and still recorded.
  const copy = await send(env, { provider: 'github', items: [f.uid] });
  assert.equal(copy.status, 200);
  assert.equal(copy.body.issues[0].url, null);
  assert.match(copy.body.markdown, new RegExp(`^## ${copy.body.issues[0].title}\n\n`));
  assert.equal((db.prepare('SELECT target FROM build_handoffs ORDER BY id DESC LIMIT 1').get() as any).target, null);

  // A repository the founder did not pick is refused, and nothing is recorded.
  const before = count(db, 'SELECT COUNT(*) n FROM build_handoffs');
  const other = await send(env, { provider: 'github', items: [f.uid], repository: 'acme/secret' });
  assert.equal(other.status, 403);
  assert.equal(other.body.code, 'repository_not_picked');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), before);
});

test('Lovable, Notion and Vercel: the prompt with the brief and every marker, Markdown pages, and the import page with no text', async () => {
  const { db, env } = await fixture();
  const f = await accepted(env, db, 'feature');
  const m = await accepted(env, db, 'must-have');
  const lv = await send(env, { provider: 'lovable', items: [f.uid, m.uid] });
  assert.equal(lv.status, 200, JSON.stringify(lv.body));
  assert.match(lv.body.text, /^Build a clickable prototype/);
  assert.match(lv.body.text, /Problem: Slow setup/);
  assert.match(lv.body.text, /Build:\n- Slow setup\n- /);
  assert.deepEqual(markersIn(lv.body.text), [f.marker, m.marker]);
  assert.equal(lv.body.link, `https://lovable.dev/?autosubmit=true#prompt=${encodeURIComponent(lv.body.text)}`);
  const row: any = db.prepare("SELECT * FROM build_handoffs WHERE provider = 'lovable'").get();
  assert.equal(row.marker, `${f.marker} ${m.marker}`);
  assert.equal(row.target, 'lovable.dev');
  assert.equal(row.prompt_text, lv.body.text);
  assert.equal(row.record_table, null, 'two items name no one record');

  // A kept Eadwyn prompt leads the text (D1071), and a prompt over Lovable's box is refused before anything is written.
  const plan: any = db.prepare('SELECT uid FROM build_plans WHERE project_id = 1').get();
  db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, status, decided_payload_json)
    VALUES ('w1', ?, 'Founder.Build.Plan', 'draft:build/plan', ?, 'draft', ?, 'accepted', ?)`)
    .run(FOUNDER, `build_plan:${plan.uid}`, JSON.stringify({ items: {}, lovable_prompt: 'Make a calm, clickable onboarding.' }), JSON.stringify({ kept: ['prompt'], discarded: [] }));
  const kept = await send(env, { provider: 'lovable', items: [f.uid] });
  assert.match(kept.body.text, /^Make a calm, clickable onboarding\./);
  db.prepare("UPDATE ai_rail_proposals SET payload_json = ? WHERE uid = 'w1'").run(JSON.stringify({ items: {}, lovable_prompt: 'x'.repeat(LOVABLE_PROMPT_MAX) }));
  const before = count(db, 'SELECT COUNT(*) n FROM build_handoffs');
  const long = await send(env, { provider: 'lovable', items: [f.uid] });
  assert.equal(long.status, 422);
  assert.equal(long.body.code, 'too_long');
  assert.equal(long.body.max, LOVABLE_PROMPT_MAX);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), before);

  const nt = await send(env, { provider: 'notion', items: [f.uid, m.uid] });
  assert.equal(nt.status, 200);
  assert.equal(nt.body.pages.length, 2);
  assert.match(nt.body.pages[0].markdown, /^# Slow setup\n\n/);
  assert.equal(nt.body.markdown, nt.body.pages.map((p: any) => p.markdown).join('\n\n---\n\n'));
  assert.equal((db.prepare("SELECT target FROM build_handoffs WHERE provider = 'notion'").get() as any).target, null);

  assert.equal((await send(env, { provider: 'vercel', items: [m.uid] })).status, 400, 'Vercel needs the repository it imports');
  const vc = await send(env, { provider: 'vercel', items: [m.uid], repository: REPO });
  assert.equal(vc.status, 200);
  assert.equal(vc.body.link, `https://vercel.com/new/import?s=${encodeURIComponent(`https://github.com/${REPO}`)}`);
  const v: any = db.prepare("SELECT * FROM build_handoffs WHERE provider = 'vercel'").get();
  assert.deepEqual([v.prompt_text, v.prompt_chars, v.text_hash, v.marker, v.target], [null, null, null, null, REPO], 'no text: unknown, never 0');
});

test('the privacy check: an email or a member’s name in the text refuses the send, names the item, and never repeats the words', async () => {
  const { db, env } = await fixture();
  const f = await accepted(env, db, 'feature', { title: 'Ask jane.doe@example.test about setup' });
  const r = await send(env, { provider: 'github', items: [f.uid], repository: REPO });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'pii_found');
  assert.deepEqual(r.body.findings, [{ kind: 'email', in: f.uid }]);
  assert.equal(JSON.stringify(r.body).includes('jane.doe'), false);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);

  // The marker is StudioOS's own: an all-digit one never reads as a card or a phone number.
  const r2 = await accepted(env, db, 'roadmap');
  db.prepare('UPDATE build_plan_items SET marker = ? WHERE uid = ?').run(`VB-${'1234567890'.repeat(3)}12`, r2.uid);
  const digits = await send(env, { provider: 'github', items: [r2.uid] });
  assert.equal(digits.status, 200, JSON.stringify(digits.body));
  db.exec('DELETE FROM build_handoffs');

  // #2411's fix: a member's full legal name is caught too.
  db.exec("UPDATE users SET full_legal_name = 'Morgan Fixture Lee' WHERE id = 2");
  const m = await accepted(env, db, 'must-have', { title: 'Demo for Morgan Fixture Lee' });
  const named = await send(env, { provider: 'lovable', items: [m.uid] });
  assert.equal(named.status, 422);
  assert.deepEqual(named.body.findings, [{ kind: 'private_in_public', in: 'prompt' }]);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);
});

test('Send refuses what is not the founder’s to send, and the text is the founders’ only', async () => {
  const { db, env } = await fixture();
  const f = await accepted(env, db, 'feature');
  const waiting = item(db, 'risk');
  const r = (body: unknown, who = FOUNDER) => send(env, body, who);
  assert.equal((await r({ provider: 'github', items: [waiting.uid] })).body.code, 'not_accepted');
  assert.equal((await r({ provider: 'fax', items: [f.uid] })).body.code, 'invalid_handoff');
  assert.equal((await r({ provider: 'github', items: [] })).body.code, 'invalid_handoff');
  assert.equal((await r({ provider: 'github', items: ['not-a-uid'] })).body.code, 'invalid_handoff');
  assert.equal((await r({ provider: 'github', items: [f.uid] }, OTHER)).status, 404);
  assert.equal((await r({ provider: 'github', items: [f.uid] }, ADMIN)).status, 404);
  assert.equal((await r({ provider: 'github', items: [f.uid] }, PARTNER)).status, 404);
  assert.equal((await call(env, null, 'POST', `/api/cycles/build/plan/handoffs${Q}`, { provider: 'github', items: [f.uid] })).status, 401);
  db.exec("UPDATE build_plans SET status = 'paused'");
  assert.equal((await r({ provider: 'github', items: [f.uid] })).body.code, 'plan_paused');
  db.exec("UPDATE build_plans SET status = 'open'");
  assert.equal(count(db, 'SELECT COUNT(*) n FROM build_handoffs'), 0);

  assert.equal((await r({ provider: 'notion', items: [f.uid] })).status, 200);
  const own = await call(env, FOUNDER, 'GET', `/api/cycles/build/plan/handoffs${Q}`);
  assert.equal(own.status, 200);
  assert.match(own.body.handoffs[0].prompt_text, /^# Slow setup/);
  assert.deepEqual(own.body.handoffs[0].markers, [f.marker]);
  for (const who of [ADMIN, PARTNER]) {
    const read = await call(env, who, 'GET', `/api/cycles/build/plan/handoffs${Q}`);
    assert.equal(read.status, 200);
    assert.equal('prompt_text' in read.body.handoffs[0], false, `${who} reads the handoff, never its text`);
  }
});

/** A GitHub that serves acme/app's issues and pull requests, and nothing else. */
function fakeGithub(repo: { issues: any[]; pulls: any[] }) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'api.github.com');
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const m = url.pathname.match(/^\/repos\/acme\/app\/(issues|pulls|releases|milestones)$/);
    if (m) {
      const page = Number(url.searchParams.get('page') || 1);
      const list = m[1] === 'issues' ? repo.issues : m[1] === 'pulls' ? repo.pulls : [];
      return j(list.slice((page - 1) * 100, page * 100));
    }
    return j({ message: 'Not Found' }, 404);
  }) as any;
  return () => { globalThis.fetch = real; };
}
const T = '2026-10-01T12:00:00Z';
const issue = (number: number, title: string, body: string | null) => ({ number, title, body, state: 'open', created_at: T, html_url: `https://github.com/${REPO}/issues/${number}` });
const pull = (number: number, title: string, body: string | null) => ({ number, title, body, state: 'open', draft: true, created_at: T, merged_at: null, closed_at: null,
  html_url: `https://github.com/${REPO}/pull/${number}`, requested_reviewers: [], requested_teams: [] });
async function sync(env: any, db: DatabaseSync, repo: { issues: any[]; pulls: any[] }) {
  const restore = fakeGithub(repo);
  const saved = [console.warn, console.info]; console.warn = () => {}; console.info = () => {};
  try { return await syncGithub(env, db.prepare('SELECT * FROM integrations WHERE id = 31').get() as any); }
  finally { restore(); [console.warn, console.info] = saved; }
}
const links = (db: DatabaseSync) => db.prepare("SELECT * FROM ai_rail_proposals WHERE rail_option = 'link:build/plan' ORDER BY id").all() as any[];
const ledger = (db: DatabaseSync, ext: string) => db.prepare('SELECT * FROM connector_fed_items WHERE external_id = ?').get(ext) as any;

test('back in: a fed issue or pull request naming a known marker is a link proposal, never a second row; Link follows the plan’s row', async () => {
  const { db, env } = await fixture();
  const road = await accepted(env, db, 'roadmap');
  const must = await accepted(env, db, 'must-have');
  const feat = await accepted(env, db, 'feature');
  assert.equal(road.landed_table, 'roadmap_okrs');
  const repo = {
    issues: [
      issue(10, 'Pilot plan', `Notes\n\n${MARKER_LINE} ${road.marker}`),
      issue(11, 'Spec for setup', `${MARKER_LINE} ${feat.marker}`), // a feature landed in mvp_features: an issue never re-points to it
      issue(12, 'Unrelated', 'No marker here'),
      issue(13, 'Stray marker', `${MARKER_LINE} VB-${'A'.repeat(32)}`),
    ],
    pulls: [pull(20, 'Setup wizard', `Closes the plan item.\n\n${MARKER_LINE} ${must.marker}`), pull(21, 'Tidy', null)],
  };
  const roadmapBefore = count(db, 'SELECT COUNT(*) n FROM roadmap_okrs');
  const featuresBefore = count(db, 'SELECT COUNT(*) n FROM mvp_features');
  const out = await sync(env, db, repo);
  assert.equal(out.counts.link_proposals, 3);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM roadmap_okrs'), roadmapBefore + 2, 'only the unmarked and unknown-marker issues land as rows');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), featuresBefore + 1, 'only the unmarked pull request lands');
  const proposed = links(db);
  assert.deepEqual(proposed.map((l) => [l.source_ref, l.status, l.source_kind, l.source_label, l.user_id, l.record_ref]), [
    [`issue:${REPO}#10`, 'proposed', 'connector', 'Connector', FOUNDER, 'project:1'],
    [`issue:${REPO}#11`, 'proposed', 'connector', 'Connector', FOUNDER, 'project:1'],
    [`pull:${REPO}#20`, 'proposed', 'connector', 'Connector', FOUNDER, 'project:1'],
  ]);
  assert.deepEqual(JSON.parse(proposed[0].payload_json), { plan_item_uid: road.uid, marker: road.marker, provider: 'github', fed: `issue:${REPO}#10`, fed_kind: 'issue',
    title: 'Pilot plan', landed_table: 'roadmap_okrs', landed_id: String(road.landed_id) });
  for (const ext of [`issue:${REPO}#10`, `issue:${REPO}#11`, `pull:${REPO}#20`]) assert.equal(ledger(db, ext).local_id, null);

  // A second sync proposes nothing again and lands nothing.
  await sync(env, db, repo);
  assert.equal(links(db).length, 3);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM roadmap_okrs'), roadmapBefore + 2);

  const list = await call(env, FOUNDER, 'GET', `/api/cycles/build/plan/links${Q}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.links.length, 3);
  assert.deepEqual((await call(env, PARTNER, 'GET', `/api/cycles/build/plan/links${Q}`)).body.links, [], 'a partner never sees a pending proposal');

  const accept = (uid: string, who = FOUNDER) => call(env, who, 'POST', `/api/cycles/build/plan/links/${uid}/accept${Q}`, {});
  assert.equal((await accept(proposed[0].uid, OTHER)).status, 404);
  const linked = await accept(proposed[0].uid);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.status, 'accepted');
  assert.deepEqual([ledger(db, `issue:${REPO}#10`).local_table, ledger(db, `issue:${REPO}#10`).local_id], ['roadmap_okrs', Number(road.landed_id)]);
  assert.equal((await accept(proposed[0].uid)).body.code, 'decided');
  assert.equal(count(db, "SELECT COUNT(*) n FROM activity_logs WHERE action = 'build_plan_linked'"), 1);
  assert.equal((await accept(proposed[2].uid)).status, 200);
  assert.deepEqual([ledger(db, `pull:${REPO}#20`).local_table, ledger(db, `pull:${REPO}#20`).local_id], ['mvp_features', Number(must.landed_id)], 'the must-have now follows its pull request');
  // An issue linked to a feature is recorded, but the ledger never points an issue at another table.
  assert.equal((await accept(proposed[1].uid)).status, 200);
  assert.equal(ledger(db, `issue:${REPO}#11`).local_id, null);
  assert.deepEqual((await call(env, PARTNER, 'GET', `/api/cycles/build/plan/links${Q}`)).body.links.map((l: any) => l.fed).sort(),
    [`issue:${REPO}#10`, `issue:${REPO}#11`, `pull:${REPO}#20`]);

  // GitHub's next sync updates the linked row, not a new one.
  repo.issues[0].title = 'Pilot plan, week 2';
  await sync(env, db, repo);
  assert.equal((db.prepare('SELECT objective FROM roadmap_okrs WHERE id = ?').get(Number(road.landed_id)) as any).objective, 'Pilot plan, week 2');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM roadmap_okrs'), roadmapBefore + 2);
});

test('back in: Not this one lands the item as its own row on the next sync; a plan item no longer accepted is marker_unknown', async () => {
  const { db, env } = await fixture();
  const road = await accepted(env, db, 'roadmap');
  const must = await accepted(env, db, 'must-have');
  const repo = { issues: [issue(30, 'Roadmap pilot', `${MARKER_LINE} ${road.marker}`)], pulls: [pull(40, 'Must-have work', `${MARKER_LINE} ${must.marker}`)] };
  await sync(env, db, repo);
  const [forIssue, forPull] = links(db);
  const before = count(db, 'SELECT COUNT(*) n FROM roadmap_okrs');
  const dismissed = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/links/${forIssue.uid}/dismiss${Q}`, {});
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.status, 'discarded');
  assert.equal(ledger(db, `issue:${REPO}#30`), undefined);
  await sync(env, db, repo);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM roadmap_okrs'), before + 1, 'it lands as its own row');
  assert.equal(links(db).length, 2, 'and is never proposed again');
  assert.equal(ledger(db, `issue:${REPO}#30`).local_table, 'roadmap_okrs');

  db.prepare('UPDATE build_plan_items SET landed_id = NULL WHERE uid = ?').run(must.uid);
  const gone = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/links/${forPull.uid}/accept${Q}`, {});
  assert.equal(gone.status, 409);
  assert.equal(gone.body.code, 'marker_unknown');
  assert.equal((db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(forPull.uid) as any).status, 'proposed');
});

test('a link by hand: an accepted item and a fed item with no marker; a row the feed made stays as it is', async () => {
  const { db, env } = await fixture();
  const must = await accepted(env, db, 'must-have');
  const waiting = item(db, 'risk');
  await sync(env, db, { issues: [], pulls: [pull(50, 'Hand work', 'no marker')] });
  const fedRow = ledger(db, `pull:${REPO}#50`);
  assert.equal(fedRow.local_table, 'mvp_features');
  const link = (uid: string, fed: unknown, who = FOUNDER) => call(env, who, 'POST', `/api/cycles/build/plan/items/${uid}/link`, { fed });
  assert.equal((await link(waiting.uid, `pull:${REPO}#50`)).body.code, 'not_accepted');
  assert.equal((await link(must.uid, 'pull:acme/app#x')).body.code, 'invalid_handoff');
  assert.equal((await link(must.uid, `pull:${REPO}#99`)).status, 404);
  assert.equal((await link(must.uid, `pull:${REPO}#50`, OTHER)).status, 404);
  const r = await link(must.uid, `pull:${REPO}#50`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.status, r.body.by, r.body.plan_item_uid, r.body.fed], ['accepted', 'hand', must.uid, `pull:${REPO}#50`]);
  assert.equal(ledger(db, `pull:${REPO}#50`).local_id, fedRow.local_id, 'the feed’s own row keeps its ledger');
  assert.equal((await link(must.uid, `pull:${REPO}#50`)).body.code, 'already_linked');
  assert.equal(links(db).length, 1);
});
