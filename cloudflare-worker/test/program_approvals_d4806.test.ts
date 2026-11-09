/**
 * D4806 (#4806, Programs audit 3/7) — an approval applies to the exact revision the reviewer saw, and a
 * conflict leaves every approval-dependent record unchanged.
 *
 *   1. Playbook publish names the revision of the draft that was reviewed (`expected_hash`): a missing or
 *      malformed one is refused (400), a draft that changed since is refused (409 `draft_changed`) and nothing is
 *      published, and the published version holds exactly the reviewed content.
 *   2. An edit that lands between the publish's read and its write does not enter the version: the version holds
 *      the rows that were hashed, the edit stays in the draft, and the draft then differs from what is published.
 *   3. A proposal approval that loses to a decline, a send-back or another approval creates no registry row, no
 *      playbook sections, no draft grant, no history line and no audit line; one that wins writes each once.
 *
 * The database is built as `program_proposals_d955.test.ts` builds it. Every person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_approvals_d4806.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import adminPrograms from '../src/routes/admin_programs.ts';
import adminProgramProposals from '../src/routes/admin_program_proposals.ts';
import { keyFromName } from '../src/services/programRegistry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../../cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, LIS1 = 2, OTHER = 3;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [LIS1]: 'admin', [OTHER]: 'admin' };

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 560 });
  for (const m of ['560_program_registry.sql', '561_program_proposals.sql', '562_program_grants_draft.sql', '563_referral_partner_terms.sql', '202611031502_influencer_program.sql', '202611072010_program_approved_specs.sql', '202611082300_programs_member_access_modules_4873.sql']) {
    db.exec(readFileSync(resolve(MIGRATIONS, m), 'utf8'));
  }
  return db;
}
const BUILT = built();

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const o of objs.filter((x) => x.type === 'table')) {
    for (const r of BUILT.prepare(`SELECT * FROM "${o.name}"`).all() as any[]) {
      const cols = Object.keys(r);
      db.prepare(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]));
    }
  }
  for (const [id, name] of [[SUPER, 'Sam Super'], [LIS1, 'Lia Lisbon'], [OTHER, 'Ola Other']] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, `u-${id}`, `person${id}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (1, 'lic-lis', 'PT-001', 'Studio Lisbon Lda', 'Studio Lisbon', 'active');
    INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ${LIS1}, 'principal');
    INSERT INTO legal_templates (slug, title, is_active) VALUES ('operator-agreement', 'Operator agreement', 1);`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/programs/proposals', adminProgramProposals);
app.route('/api/admin/programs', adminPrograms);

type Race = { match: string; run: () => void };
/** The D1 binding, with a competing write that lands just before the first batch whose first statement names `match`. */
function wrap(db: DatabaseSync, race?: Race) {
  const d1: any = d1Over(db);
  let pending = race ?? null;
  return {
    ...d1,
    prepare(sql: string) { const api = d1.prepare(sql); api.sql = sql; return api; },
    batch: async (stmts: any[]) => {
      if (pending && String(stmts[0]?.sql).includes(pending.match)) { const r = pending; pending = null; r.run(); }
      return d1.batch(stmts);
    },
  };
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, race?: Race) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const tail = path === '/' ? '' : path;
    const res: Response = await app.request(`/api/admin/programs${tail}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: wrap(db, race) } as any).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json };
  } finally { [console.warn, console.error] = saved; }
}
const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const count = (db: DatabaseSync, sql: string, ...a: any[]) => Number(one(db, sql, ...a).n);

// ── 1 and 2. Playbook publish ─────────────────────────────────────────────

const KEY = 'mentor-cohorts';
const edit = (db: DatabaseSync, body: string) => call(db, SUPER, 'PUT', `/${KEY}/playbook/sections/terms`, { body });
const hashOf = async (db: DatabaseSync) => (await call(db, SUPER, 'GET', `/${KEY}`)).body.draft.hash as string;
const publish = (db: DatabaseSync, expected_hash: unknown, race?: Race) => call(db, SUPER, 'POST', `/${KEY}/playbook/publish`, expected_hash === undefined ? {} : { expected_hash }, race);
const versions = (db: DatabaseSync) => count(db, 'SELECT COUNT(*) AS n FROM program_playbook_versions WHERE program_key = ?', KEY);
const termsOf = (db: DatabaseSync, version: number) => one(db, "SELECT body FROM program_playbook_sections WHERE program_key = ? AND version = ? AND section_key = 'terms'", KEY, version)?.body;

test('1. publish names the reviewed draft: a changed draft is refused and nothing is published', async () => {
  const db = fresh();
  const base = await hashOf(db);
  assert.match(base, /^[0-9a-f]{64}$/);
  await edit(db, 'Reviewed wording.');
  const reviewed = await hashOf(db);
  assert.notEqual(reviewed, base, 'the revision moves with the draft');
  const v0 = versions(db);

  // A missing or malformed revision is refused before anything is read.
  for (const bad of [undefined, '', 'abc', 'Z'.repeat(64), 12345]) {
    const r = await publish(db, bad);
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.code, 'expected_hash_required');
  }
  // The draft changes after the reviewer read it.
  await edit(db, 'Wording nobody reviewed.');
  const stale = await publish(db, reviewed);
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.code, 'draft_changed');
  assert.match(stale.body.message, /Nothing was published/);
  assert.equal(versions(db), v0, 'no version was written');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'program.playbook.publish'"), 0, 'and none was audited');

  // Reviewed again, it publishes, and the version holds exactly what the reviewer saw.
  const second = await hashOf(db);
  const ok = await publish(db, second);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(versions(db), v0 + 1);
  assert.equal(termsOf(db, v0 + 1), 'Wording nobody reviewed.');
  assert.equal(ok.body.draft.differs, false);
  db.close();
});

test('2. an edit between the publish\'s read and its write stays in the draft and out of the version', async () => {
  const db = fresh();
  await edit(db, 'The reviewed wording.');
  const reviewed = await hashOf(db);
  const v0 = versions(db);
  const race = { match: 'INSERT INTO program_playbook_versions', run: () => {
    db.prepare("UPDATE program_playbook_sections SET body = 'Sneaked in after the review.', edited_at = '2026-11-07T10:00:00.000Z' WHERE program_key = ? AND version = 0 AND section_key = 'terms'").run(KEY);
  } };
  const done = await publish(db, reviewed, race);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(termsOf(db, v0 + 1), 'The reviewed wording.', 'the published version is the reviewed revision');
  assert.equal(termsOf(db, 0), 'Sneaked in after the review.', 'the later edit is still the draft');
  assert.equal(done.body.draft.differs, true, 'so the draft differs from what was published');
  assert.notEqual(await hashOf(db), reviewed);
  db.close();
});

// ── 3. Proposal approval ──────────────────────────────────────────────────

function seed(db: DatabaseSync, uid: string, name: string) {
  db.prepare(`INSERT INTO program_proposals (uid, created_by_user_id, licence_uid, status, name, purpose, who_json, grp, join_method, cycle, cohort_weeks, seats,
      rewards_json, template_keys, tools_json, sent_at) VALUES (?, ?, 'lic-lis', 'sent', ?, 'A purpose.', '["Founders"]', 'Access', 'By invitation', 'rolling', NULL, 20,
      '["None"]', '[]', '{"events":true}', '2026-11-05T09:00:00.000Z')`).run(uid, LIS1, name);
}
const decide = (db: DatabaseSync, uid: string, outcome: string, race?: Race) => call(db, SUPER, 'POST', `/proposals/${uid}/decision`, { outcome, note: 'Reviewed.' }, race);
/** Everything an approval would write, for a before-and-after comparison. */
const written = (db: DatabaseSync, key: string) => ({
  program: count(db, 'SELECT COUNT(*) AS n FROM programs WHERE key = ?', key),
  sections: count(db, 'SELECT COUNT(*) AS n FROM program_playbook_sections WHERE program_key = ?', key),
  draftGrants: count(db, "SELECT COUNT(*) AS n FROM program_grants WHERE program_key = ? AND state = 'draft'", key),
  history: count(db, "SELECT COUNT(*) AS n FROM licence_events WHERE detail_json LIKE '%draft_opened%'"),
  audit: count(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'program.proposal.decide'"),
});
const NONE = { program: 0, sections: 0, draftGrants: 0, history: 0, audit: 0 };

for (const [label, outcome, status, extra] of [
  ['a decline', 'declined', 'declined', ", hq_note = 'Declined by another admin'"],
  ['a send-back', 'sent_back', 'sent_back', ", hq_note = 'Sent back by another admin'"],
  ['another approval', 'approved', 'approved', ", decision = 'catalogue'"],
] as const) {
  test(`3. an approval that loses to ${label} writes no registry row, sections, draft grant, history or audit line`, async () => {
    const db = fresh();
    seed(db, 'pp-race', 'Race Program');
    const key = keyFromName('Race Program');
    const race = { match: 'UPDATE program_proposals SET status', run: () => {
      db.prepare(`UPDATE program_proposals SET status = ?, decided_by_user_id = ?, decided_at = '2026-11-07T10:00:00.000Z'${extra} WHERE uid = 'pp-race'`).run(status, OTHER);
    } };
    const lost = await decide(db, 'pp-race', 'approve_studio', race);
    assert.equal(lost.status, 409, JSON.stringify(lost.body));
    assert.equal(lost.body.code, 'not_waiting');
    assert.deepEqual(written(db, key), NONE, 'nothing the approval would have written is there');
    const p = one(db, "SELECT status, decided_by_user_id FROM program_proposals WHERE uid = 'pp-race'");
    assert.deepEqual([p.status, p.decided_by_user_id], [status, OTHER], 'the other decision stands');
    db.close();
  });
}

test('3. an approval that wins writes the registry row, its sections, the draft grant and its history once, and a repeat writes nothing', async () => {
  const db = fresh();
  seed(db, 'pp-win', 'Win Program');
  const key = keyFromName('Win Program');
  const won = await decide(db, 'pp-win', 'approve_studio');
  assert.equal(won.status, 200, JSON.stringify(won.body));
  const w = written(db, key);
  assert.equal(w.program, 1);
  assert.ok(w.sections > 0, 'the review sections are the playbook draft');
  assert.deepEqual([w.draftGrants, w.history, w.audit], [1, 1, 1]);
  const p = one(db, "SELECT status, decision, program_key FROM program_proposals WHERE uid = 'pp-win'");
  assert.deepEqual([p.status, p.decision, p.program_key], ['approved', 'studio', key]);
  assert.equal(one(db, 'SELECT licence_uid FROM programs WHERE key = ?', key).licence_uid, 'lic-lis', 'for this studio only');

  const again = await decide(db, 'pp-win', 'approve_studio');
  assert.equal(again.status, 409);
  assert.deepEqual(written(db, key), w, 'a repeat changes nothing');
  db.close();
});
