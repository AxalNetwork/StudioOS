/**
 * D955 (#2788) — Programs part 2: migration 561, a studio's program proposals
 * (drafts, Send to HQ, Your proposals), HQ's queue, the Super Admin's
 * decision, New program, and studio-only programs in part 1's reads.
 *
 * Run on a database built from the baseline and every migration through 561,
 * as production builds it; 560 and 561 are applied whole and must apply.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_proposals_d955.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import adminPrograms from '../src/routes/admin_programs.ts';
import adminProgramProposals from '../src/routes/admin_program_proposals.ts';
import { PROPOSALS_CLOSED, likeOf, sendProposal } from '../src/services/programProposals.ts';
import { PROGRAM_KEYS, keyFromName } from '../src/services/programRegistry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, LIS1 = 2, LIS2 = 3, NAI = 4, LONE = 5, FOUNDER = 6;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [LIS1]: 'admin', [LIS2]: 'admin', [NAI]: 'admin', [LONE]: 'admin', [FOUNDER]: 'founder' };

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 560)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // Whole, as the deploy applies them: a failure here fails the file.
  db.exec(readFileSync(resolve(MIGRATIONS, '560_program_registry.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '561_program_proposals.sql'), 'utf8'));
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
  for (const [id, name] of [[SUPER, 'Sam Super'], [LIS1, 'Lia Lisbon'], [LIS2, 'Leo Lisbon'], [NAI, 'Nia Nairobi'], [LONE, 'Lou Lone'], [FOUNDER, 'Fay Founder']] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, `u-${id}`, `person${id}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES
      (1, 'lic-lis', 'PT-001', 'Studio Lisbon Lda', 'Studio Lisbon', 'active'),
      (2, 'lic-nai', 'KE-001', 'Studio Nairobi Ltd', 'Studio Nairobi', 'active');
    INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ${LIS1}, 'principal'), (1, ${LIS2}, 'delegate'), (2, ${NAI}, 'principal');
    INSERT INTO legal_templates (slug, title, is_active) VALUES ('operator-agreement', 'Operator agreement', 1), ('old-one', 'Withdrawn', 0);`);
  return db;
}

// Mounted as index.ts mounts them: proposals before the programs router.
const app = new Hono<any>();
app.route('/api/admin/programs/proposals', adminProgramProposals);
app.route('/api/admin/programs', adminPrograms);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    // `/` and `/?…` are the programs router's own root, with no trailing slash.
    const tail = path === '/' ? '' : path.startsWith('/?') ? path.slice(1) : path;
    const res: Response = await app.request(`/api/admin/programs${tail}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json };
  } finally { [console.warn, console.error] = saved; }
}
const envOf = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' }) as any;
const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const audit = (db: DatabaseSync, action: string) => db.prepare('SELECT filters_json FROM admin_audit_log WHERE action = ? ORDER BY id').all(action).map((r: any) => JSON.parse(r.filters_json));

const FULL = {
  name: 'Operator Fellowship', purpose: 'Operators spend twelve weeks embedded in a Lab venture.',
  who: ['Operating partners', 'Founders'], group: 'Network and referrals', join_method: 'By application',
  cycle: 'cohorts', cohort_weeks: 12, seats: 12, eligibility: 'Five years in a startup role.',
  rewards: ['Credits'], template_keys: ['operator-agreement'], hq_receives: 'A quarterly report.',
  tools: { application_queue: true, cohort_calendar: true, assignments: false, events: true },
};

/** A proposal at `status`, as a send that OD-PROP has not opened yet would leave it. */
function seed(db: DatabaseSync, uid: string, licence: string | null, by: number, status: string, name: string, sentAt: string | null = '2026-10-16T09:00:00.000Z') {
  db.prepare(`INSERT INTO program_proposals (uid, created_by_user_id, licence_uid, status, name, purpose, who_json, grp, join_method, cycle, cohort_weeks, seats,
      rewards_json, template_keys, tools_json, sent_at) VALUES (?, ?, ?, ?, ?, 'A purpose.', '["Founders","Operating partners"]', 'Access', 'By invitation', 'rolling', NULL, 20,
      '["None"]', '[]', '{"events":true}', ?)`).run(uid, by, licence, status, name, sentAt);
}

test('561 applies to a fresh D1: the proposal store, and every registry row is for every studio', () => {
  const db = fresh();
  const cols = (db.prepare("SELECT name FROM pragma_table_info('program_proposals')").all() as any[]).map((r) => r.name);
  for (const c of ['uid', 'created_by_user_id', 'licence_uid', 'status', 'who_json', 'grp', 'join_method', 'cycle', 'cohort_weeks', 'seats', 'rewards_json',
    'template_keys', 'tools_json', 'sent_at', 'decision', 'hq_note', 'decided_by_user_id', 'decided_at', 'program_key']) assert.ok(cols.includes(c), c);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM programs WHERE licence_uid IS NOT NULL').n, 0);
  assert.throws(() => db.exec("INSERT INTO program_proposals (uid, created_by_user_id, status) VALUES ('x', 1, 'pending')"), /CHECK/);
});

test('drafts: a studio starts and saves one; values are checked by field; another studio, and HQ, read none of it', async () => {
  const db = fresh();
  const made = await call(db, LIS1, 'POST', '/proposals', { name: 'Operator Fellowship' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const p = made.body.proposal;
  assert.deepEqual([p.status, p.studio, p.licence_uid, p.name, p.purpose, p.who, p.tools], ['draft', 'Studio Lisbon', 'lic-lis', 'Operator Fellowship', null, null, null]);
  // The studio's other admin saves a subset; the answer's updated_at is "Draft saved".
  const saved = await call(db, LIS2, 'PATCH', `/proposals/${p.uid}`, FULL);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const s = saved.body.proposal;
  assert.deepEqual(s.who, ['Founders', 'Operating partners'], 'in the canvas\'s order');
  assert.deepEqual(s.tools, { application_queue: true, cohort_calendar: true, assignments: false, referral_codes: false, credits_perks: false, learning_content: false, events: true });
  assert.deepEqual([s.group, s.cycle, s.cohort_weeks, s.seats, s.rewards, s.template_keys], ['Network and referrals', 'cohorts', 12, 12, ['Credits'], ['operator-agreement']]);
  assert.ok(s.updated_at >= p.updated_at);
  for (const [body, code] of [
    [{ join_method: 'Walk in' }, 'bad_join_method'], [{ who: ['Founders', 'Robots'] }, 'bad_who'], [{ group: 'Network' }, 'bad_group'],
    [{ rewards: ['None', 'Cash'] }, 'bad_rewards'], [{ cohort_weeks: 53 }, 'bad_cohort_weeks'], [{ seats: 0 }, 'bad_seats'],
    [{ name: 'x'.repeat(121) }, 'bad_name'], [{ tools: { teleporter: true } }, 'bad_tools'], [{ cycle: 'monthly' }, 'bad_cycle'],
    [{ template_keys: ['old-one'] }, 'unknown_template'], [{}, 'nothing_to_change'],
  ] as const) {
    const r = await call(db, LIS1, 'PATCH', `/proposals/${p.uid}`, body);
    assert.deepEqual([r.status, r.body.code], [400, code], JSON.stringify(body));
  }
  for (const who of [NAI, LONE, SUPER]) {
    assert.equal((await call(db, who, 'GET', `/proposals/${p.uid}`)).status, 404, `user ${who} reads it`);
    assert.equal((await call(db, who, 'PATCH', `/proposals/${p.uid}`, { name: 'Mine now' })).status, 404, `user ${who} saves it`);
  }
  // An admin with no licence keeps their own; nobody else reads it.
  const lone = (await call(db, LONE, 'POST', '/proposals', {})).body.proposal;
  assert.deepEqual([lone.studio, lone.licence_uid], ['HQ-held', null]);
  assert.equal((await call(db, LONE, 'GET', `/proposals/${lone.uid}`)).status, 200);
  assert.equal((await call(db, SUPER, 'GET', `/proposals/${lone.uid}`)).status, 404, 'another unbound admin, the Super Admin included, does not read a draft');
  assert.equal((await call(db, LIS1, 'GET', `/proposals/${lone.uid}`)).status, 404);
  assert.equal((await call(db, FOUNDER, 'POST', '/proposals', {})).status, 403, 'admins only');
});

test('Send to HQ: what it needs, then OD-PROP\'s closed gate; once a sender may send, sent and audited, and no longer editable', async () => {
  const db = fresh();
  const uid = (await call(db, LIS1, 'POST', '/proposals', { name: 'Operator Fellowship', group: 'Access' })).body.proposal.uid;
  const short = await call(db, LIS1, 'POST', `/proposals/${uid}/send`);
  assert.deepEqual([short.status, short.body.code, short.body.missing], [400, 'incomplete', ['purpose', 'who', 'join_method']]);
  await call(db, LIS1, 'PATCH', `/proposals/${uid}`, FULL);
  const closed = await call(db, LIS1, 'POST', `/proposals/${uid}/send`);
  assert.deepEqual([closed.status, closed.body.code], [403, 'proposals_closed']);
  assert.equal(closed.body.detail ?? closed.body.message, PROPOSALS_CLOSED);
  assert.equal(one(db, 'SELECT status FROM program_proposals WHERE uid = ?', uid).status, 'draft', 'nothing changed');
  assert.equal(audit(db, 'program.proposal.send').length, 0);
  // When OD-PROP opens, the same send lands (sendPolicy is the one place that changes).
  const sent = await sendProposal(envOf(db), uid, { id: LIS1, email: 'person2@example.test', studio: 'lic-lis' }, () => ({ open: true, sentence: '' }));
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sent_at);
  assert.deepEqual(audit(db, 'program.proposal.send'), [{ uid, licence_uid: 'lic-lis' }]);
  assert.deepEqual([(await call(db, LIS1, 'PATCH', `/proposals/${uid}`, { name: 'Changed' })).body.code], ['not_editable']);
  assert.deepEqual([(await call(db, LIS1, 'POST', `/proposals/${uid}/send`)).status], [409]);
});

test('Your proposals: the studio\'s, searched with % and _ taken literally, filtered, sorted, with an exact total', async () => {
  const db = fresh();
  seed(db, 'pp-a', 'lic-lis', LIS1, 'sent', '100% Growth', '2026-10-12T09:00:00.000Z');
  seed(db, 'pp-b', 'lic-lis', LIS2, 'sent_back', 'Under_score Clinic', '2026-09-30T09:00:00.000Z');
  seed(db, 'pp-c', 'lic-lis', LIS1, 'draft', 'Plain Track', null);
  seed(db, 'pp-d', 'lic-nai', NAI, 'sent', '100 Days', '2026-10-16T09:00:00.000Z');
  // LIS1's own proposal from before they held a licence: HQ-held, so not the studio's.
  seed(db, 'pp-e', null, LIS1, 'draft', 'Before the licence', null);
  db.exec("UPDATE program_proposals SET hq_note = 'Say how cohorts are selected.' WHERE uid = 'pp-b'");
  const mine = async (q = '') => (await call(db, LIS1, 'GET', `/proposals/mine${q}`)).body;
  const all = await mine();
  assert.deepEqual([all.total, all.page_size], [3, 25]);
  assert.deepEqual(all.rows.map((r: any) => r.uid).sort(), ['pp-a', 'pp-b', 'pp-c'], 'not Nairobi\'s, nor an HQ-held row its admin made');
  assert.equal((await call(db, LIS1, 'GET', '/proposals/pp-e')).status, 404, 'a studio admin reads the studio\'s proposals only');
  assert.deepEqual(Object.keys(all.rows[0]).sort(), ['hq_note', 'name', 'sent_at', 'status', 'uid', 'updated_at']);
  assert.equal(all.rows.find((r: any) => r.uid === 'pp-b').hq_note, 'Say how cohorts are selected.');
  assert.deepEqual((await mine('?q=%25')).rows.map((r: any) => r.uid), ['pp-a'], '% matches only a literal %');
  assert.deepEqual((await mine('?q=_')).rows.map((r: any) => r.uid), ['pp-b'], '_ matches only a literal _');
  assert.deepEqual((await mine('?status=sent_back')).rows.map((r: any) => r.uid), ['pp-b']);
  assert.deepEqual((await mine('?sort=oldest&status=sent')).rows.map((r: any) => r.uid), ['pp-a']);
  assert.deepEqual((await mine('?q=track')).total, 1);
  assert.equal(likeOf('a%b_c\\d'), '%a\\%b\\_c\\\\d%');
  assert.equal((await call(db, LIS1, 'GET', '/proposals/mine?status=pending')).body.code, 'bad_status');
  assert.equal((await call(db, LONE, 'GET', '/proposals/mine')).body.total, 0);
});

test('HQ\'s queue: the Super Admin\'s, every studio but drafts, oldest first, with the studio and the counts', async () => {
  const db = fresh();
  seed(db, 'pp-1', 'lic-nai', NAI, 'sent', 'Founder Fitness Sprint', '2026-10-16T09:00:00.000Z');
  seed(db, 'pp-2', 'lic-lis', LIS1, 'sent', 'Climate Venture Track', '2026-10-12T09:00:00.000Z');
  seed(db, 'pp-3', 'lic-lis', LIS1, 'sent_back', 'University Clinic', '2026-09-30T09:00:00.000Z');
  seed(db, 'pp-4', null, LONE, 'declined', 'Hardware Sprint', '2026-08-12T09:00:00.000Z');
  seed(db, 'pp-5', 'lic-lis', LIS1, 'draft', 'Operator Fellowship', null);
  assert.equal((await call(db, LIS1, 'GET', '/proposals')).status, 403);
  const q = (await call(db, SUPER, 'GET', '/proposals')).body;
  assert.deepEqual(q.rows.map((r: any) => [r.uid, r.studio]), [['pp-4', 'HQ-held'], ['pp-3', 'Studio Lisbon'], ['pp-2', 'Studio Lisbon'], ['pp-1', 'Studio Nairobi']]);
  assert.equal(q.total, 4);
  assert.deepEqual(q.counts, { sent: 2, approved: 0, sent_back: 1, declined: 1 }, 'counts.sent is the Proposals tab\'s count; a draft is never HQ\'s');
  assert.deepEqual((await call(db, SUPER, 'GET', '/proposals?licence=lic-lis&sort=newest')).body.rows.map((r: any) => r.uid), ['pp-2', 'pp-3']);
  assert.deepEqual((await call(db, SUPER, 'GET', '/proposals?licence=hq-held')).body.rows.map((r: any) => r.uid), ['pp-4']);
  assert.deepEqual((await call(db, SUPER, 'GET', '/proposals?status=sent&q=climate')).body.rows.map((r: any) => r.uid), ['pp-2']);
  // The Super Admin opens any that is not a draft; never a draft.
  assert.equal((await call(db, SUPER, 'GET', '/proposals/pp-1')).body.proposal.studio, 'Studio Nairobi');
  assert.equal((await call(db, SUPER, 'GET', '/proposals/pp-5')).status, 404);
});

test('the decision: approve for the catalogue writes HQ\'s draft program, read by every studio and listed in its activity', async () => {
  const db = fresh();
  seed(db, 'pp-1', 'lic-nai', NAI, 'sent', 'Founder Fitness Sprint');
  assert.equal((await call(db, NAI, 'POST', '/proposals/pp-1/decision', { outcome: 'approve_catalogue' })).status, 403, 'only HQ decides');
  const r = await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'approve_catalogue', note: 'Listed for every studio.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.proposal.status, r.body.proposal.decision, r.body.proposal.program_key, r.body.proposal.hq_note],
    ['approved', 'catalogue', 'founder-fitness-sprint', 'Listed for every studio.']);
  const row = one(db, "SELECT * FROM programs WHERE key = 'founder-fitness-sprint'");
  assert.deepEqual([row.status, row.grp, row.who, row.join_method, row.licence_uid, row.purpose],
    ['proposed', 'Access', 'Founders, operating partners', 'By invitation', null, 'A purpose.']);
  const draft = db.prepare("SELECT section_key, title, body FROM program_playbook_sections WHERE program_key = 'founder-fitness-sprint' AND version = 0 ORDER BY position").all() as any[];
  assert.deepEqual(draft.map((s) => [s.section_key, s.body]), [
    ['purpose', 'A purpose.'], ['who', 'Founders, operating partners'], ['join', 'By invitation · rolling · 20 seats'], ['rewards', 'None'], ['tools', 'Events'],
  ]);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM program_playbook_versions WHERE program_key = 'founder-fitness-sprint'").n, 0, 'unpublished');
  for (const who of [LIS1, NAI, LONE]) {
    const cat = (await call(db, who, 'GET', '/?weeks=4')).body;
    assert.ok(cat.programs.rows.some((p: any) => p.key === 'founder-fitness-sprint'), `user ${who} sees it`);
  }
  const detail = (await call(db, LIS1, 'GET', '/founder-fitness-sprint')).body;
  assert.deepEqual([detail.program.status, detail.playbook.published, detail.draft], ['proposed', false, undefined]);
  assert.deepEqual(audit(db, 'program.proposal.decide'), [{ uid: 'pp-1', outcome: 'approve_catalogue', note: 'Listed for every studio.', program_key: 'founder-fitness-sprint' }]);
  const act = (await call(db, SUPER, 'GET', '/founder-fitness-sprint/activity')).body;
  assert.deepEqual(act.rows.map((x: any) => [x.kind, x.concerns.outcome]), [['program.proposal.decide', 'approve_catalogue']]);
  // Decided once: the next decision is not waiting.
  assert.equal((await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'decline', note: 'No.' })).body.code, 'not_waiting');
});

test('approve for this studio only: the studio and HQ read it; another studio is told no program has that key', async () => {
  const db = fresh();
  seed(db, 'pp-1', 'lic-lis', LIS1, 'sent', 'Regional Demo Night');
  seed(db, 'pp-2', null, LONE, 'sent', 'Hardware Sprint');
  const ok = await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'approve_studio' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(one(db, "SELECT licence_uid FROM programs WHERE key = 'regional-demo-night'").licence_uid, 'lic-lis');
  const sees = async (who: number) => (await call(db, who, 'GET', '/?weeks=4')).body.programs.rows.some((p: any) => p.key === 'regional-demo-night');
  assert.deepEqual([await sees(LIS1), await sees(LIS2), await sees(NAI), await sees(LONE), await sees(SUPER)], [true, true, false, false, true]);
  assert.equal((await call(db, LIS2, 'GET', '/regional-demo-night')).status, 200);
  for (const path of ['/regional-demo-night', '/regional-demo-night/activity']) {
    const r = await call(db, NAI, 'GET', path);
    assert.deepEqual([r.status, r.body.code], [404, 'unknown_program'], path);
  }
  assert.equal((await call(db, SUPER, 'GET', '/regional-demo-night')).body.program.studio_only, 'lic-lis');
  const lone = await call(db, SUPER, 'POST', '/proposals/pp-2/decision', { outcome: 'approve_studio' });
  assert.deepEqual([lone.status, lone.body.code], [409, 'no_studio']);
  assert.equal(one(db, "SELECT status FROM program_proposals WHERE uid = 'pp-2'").status, 'sent', 'still waiting');
});

test('send back and decline need a note; send back is editable again, decline is final; the note is the studio\'s to read', async () => {
  const db = fresh();
  seed(db, 'pp-1', 'lic-lis', LIS1, 'sent', 'University Clinic');
  seed(db, 'pp-2', 'lic-lis', LIS1, 'sent', 'Hardware Sprint');
  for (const outcome of ['send_back', 'decline']) {
    for (const note of [undefined, '', '   ']) {
      const r = await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome, note });
      assert.deepEqual([r.status, r.body.code], [400, 'note_required'], `${outcome} ${JSON.stringify(note)}`);
    }
  }
  assert.equal((await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'send_back', note: 'x'.repeat(2001) })).body.code, 'note_too_long');
  assert.equal((await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'maybe', note: 'x' })).body.code, 'bad_outcome');
  const back = await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'send_back', note: 'Say how cohorts are selected.' });
  assert.deepEqual([back.body.proposal.status, back.body.proposal.hq_note, back.body.proposal.program_key], ['sent_back', 'Say how cohorts are selected.', null]);
  assert.equal((await call(db, LIS1, 'PATCH', '/proposals/pp-1', { eligibility: 'Nominated by a partner.' })).status, 200, 'sent back is editable');
  assert.equal((await call(db, LIS1, 'GET', '/proposals/mine')).body.rows.find((r: any) => r.uid === 'pp-1').hq_note, 'Say how cohorts are selected.');
  const no = await call(db, SUPER, 'POST', '/proposals/pp-2/decision', { outcome: 'decline', note: 'It overlaps the Spin-Out Lab.' });
  assert.equal(no.body.proposal.status, 'declined');
  assert.equal((await call(db, LIS1, 'PATCH', '/proposals/pp-2', { name: 'Again' })).body.code, 'not_editable');
  assert.equal((await call(db, LIS1, 'POST', '/proposals/pp-2/send')).status, 409);
  assert.equal((await call(db, SUPER, 'POST', '/proposals/pp-2/decision', { outcome: 'approve_catalogue' })).body.code, 'not_waiting');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM programs').n, PROGRAM_KEYS.length, 'neither wrote a program');
  assert.deepEqual(audit(db, 'program.proposal.decide').map((d: any) => [d.outcome, d.program_key ?? null]), [['send_back', null], ['decline', null]]);
});

test('a key is the name\'s slug and is refused when it is taken or is a sub-path, for an approval and for New program', async () => {
  const db = fresh();
  assert.equal(keyFromName('Refer & Earn Plus'), 'refer-and-earn-plus');
  assert.equal(keyFromName('  Café  Clinic!! '), 'cafe-clinic');
  seed(db, 'pp-1', 'lic-lis', LIS1, 'sent', 'Perks');
  assert.equal((await call(db, SUPER, 'POST', '/proposals/pp-1/decision', { outcome: 'approve_catalogue' })).body.code, 'program_key_taken');
  assert.equal(one(db, "SELECT status FROM program_proposals WHERE uid = 'pp-1'").status, 'sent', 'nothing decided');
  for (const name of ['Proposals', 'Propose', 'Learning']) {
    const r = await call(db, SUPER, 'POST', '/', { name, group: 'Learning' });
    assert.deepEqual([r.status, r.body.code], [409, 'program_key_taken'], name);
  }
});

test('New program: HQ\'s own proposed row and its draft, for every studio, audited; never a plain admin\'s', async () => {
  const db = fresh();
  assert.equal((await call(db, LIS1, 'POST', '/', { name: 'Operator Fellowship', group: 'Access' })).status, 403);
  assert.equal((await call(db, SUPER, 'POST', '/', { name: 'Operator Fellowship' })).body.code, 'incomplete');
  assert.equal((await call(db, SUPER, 'POST', '/', { name: 'X', group: 'Access', rewards: ['Cash'] })).body.code, 'bad_field', 'Terms and Tools are a proposal\'s');
  const r = await call(db, SUPER, 'POST', '/', {
    name: 'Operator Fellowship', group: 'Network and referrals', purpose: 'Operators embedded in a venture.', who: ['Founders'],
    join_method: 'By application', cycle: 'cohorts', cohort_weeks: 1, seats: 1, eligibility: 'Nominated by a partner.',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.program.key, r.body.program.status, r.body.program.studio_only, r.body.playbook.published], ['operator-fellowship', 'proposed', null, false]);
  assert.deepEqual(r.body.draft.sections.map((s: any) => [s.key, s.body]), [
    ['purpose', 'Operators embedded in a venture.'], ['who', 'Founders\nNominated by a partner.'], ['join', 'By application · cohorts of 1 week · 1 seat'],
    ['rewards', null], ['tools', null],
  ]);
  assert.equal(one(db, "SELECT position FROM programs WHERE key = 'operator-fellowship'").position, PROGRAM_KEYS.length + 1, 'at the end of the catalogue');
  assert.deepEqual(audit(db, 'program.registry.create'), [{ program_key: 'operator-fellowship' }]);
  assert.ok((await call(db, NAI, 'GET', '/?weeks=4')).body.programs.rows.some((p: any) => p.key === 'operator-fellowship'));
  assert.deepEqual((await call(db, SUPER, 'GET', '/operator-fellowship/activity')).body.rows.map((x: any) => x.kind), ['program.registry.create']);
  // Its draft is edited and published with part 1's routes.
  assert.equal((await call(db, SUPER, 'PUT', '/operator-fellowship/playbook/sections/rewards', { body: 'Credits.' })).status, 200);
  assert.equal((await call(db, SUPER, 'POST', '/operator-fellowship/playbook/publish')).body.playbook.version, 1);
  assert.equal((await call(db, SUPER, 'POST', '/', { name: 'Operator Fellowship', group: 'Access' })).body.code, 'program_key_taken');
});

test('the mount: /proposals is its own router, never a program key', async () => {
  const db = fresh();
  const r = await call(db, SUPER, 'GET', '/proposals');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.rows) && r.body.counts, 'the queue, not unknown_program');
  const index = readFileSync(resolve(ROOT, 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.ok(index.indexOf("app.route('/api/admin/programs/proposals', adminProgramProposals);") < index.indexOf("app.route('/api/admin/programs', adminPrograms);"));
  assert.ok(index.indexOf("app.route('/api/admin/programs/proposals', adminProgramProposals);") > 0);
});
