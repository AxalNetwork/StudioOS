/**
 * D8256 (#8256) — the Raise overview's next actions beyond readiness: follow-ups due this week and the
 * objections no narrative section answers yet, each with its reason's facts and its link, each part
 * failing on its own. Synthetic facts only.
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/raise_next_actions_8256.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { DUE_WITHIN_DAYS, followUpsDue, openObjections } from '../src/services/raiseNextActions.ts';
import { objectionKey } from '../src/services/narrative/objections.ts';

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => `${r.sql};`).join('\n');
  db.close(); return out;
})();
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Synthetic founder','founder@example.test',11,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11), (2,'synthetic-two','Other venture',22);`);
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development' };
  return { db, ctx: { env, projectId: 1, today: '2026-11-22' } as any };
}
let pid = 0;
const prospect = (db: any, o: { project?: number; name?: string | null; firm?: string | null; stage?: string; step?: string | null; due?: string | null }) => {
  pid += 1;
  db.prepare(`INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, next_step, next_step_due) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(pid, `p${pid}`, o.project ?? 1, o.name ?? null, o.firm ?? null, o.stage ?? 'meeting', o.step ?? null, o.due ?? null);
  return pid;
};
const feedback = (db: any, prospectId: number, objection: string, at: string) =>
  db.prepare(`INSERT INTO raise_prospect_feedback (prospect_id, objection, created_at) VALUES (?, ?, ?)`).run(prospectId, objection, at);

test('follow-ups due: still in the raise, with a next step due on or before this week, earliest first; overdue said', async () => {
  const { db, ctx } = fixture();
  assert.equal(DUE_WITHIN_DAYS, 6);
  prospect(db, { name: 'Ada', firm: 'North Fund', step: 'Send the data room', due: '2026-11-20' });
  prospect(db, { name: 'Ben', step: 'Book the partner call', due: '2026-11-28' });
  prospect(db, { firm: 'Edge', step: 'Reply', due: '2026-11-22' });
  prospect(db, { name: 'Later', step: 'Check in', due: '2026-11-29' });
  prospect(db, { name: 'Passed', stage: 'passed', step: 'Thank them', due: '2026-11-21' });
  prospect(db, { name: 'No step', step: '  ', due: '2026-11-21' });
  prospect(db, { name: 'No day', step: 'Something' });
  prospect(db, { name: 'Bad day', step: 'Something', due: 'soon' });
  prospect(db, { project: 2, name: 'Other venture', step: 'Not ours', due: '2026-11-21' });
  const r: any = await followUpsDue(ctx, { names: true });
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.items.map((f: any) => [f.investor, f.step, f.due_on, f.overdue]), [
    ['Ada · North Fund', 'Send the data room', '2026-11-20', true],
    ['Edge', 'Reply', '2026-11-22', false],
    ['Ben', 'Book the partner call', '2026-11-28', false],
  ], 'today + 6 is in; today + 7, passed, no step, no day, a bad day and another venture are out');
  assert.equal(r.href, '/raise/capital-relationships/outreach?project=1');
  assert.equal(r.capped, false);
  assert.ok(r.items.every((f: any) => Number.isInteger(f.prospect_id)), 'each names its source record');
  const staff: any = await followUpsDue(ctx, { names: false });
  assert.deepEqual(staff.items.map((f: any) => f.investor), [null, null, null], 'a staff read names no investor');
  assert.doesNotMatch(JSON.stringify(staff), /Ada|North Fund|Edge|Ben/);
  db.close();
});

test('open objections: grouped by their words, unanswered by any section, most investors first, with who raised them', async () => {
  const { db, ctx } = fixture();
  const a = prospect(db, { name: 'Ada', firm: 'North Fund' });
  const b = prospect(db, { name: 'Ben' });
  const c = prospect(db, { firm: 'Edge' });
  feedback(db, a, 'Customer concentration', '2026-11-01');
  feedback(db, b, '  customer   CONCENTRATION ', '2026-11-03');
  feedback(db, a, 'Customer concentration', '2026-11-04');
  feedback(db, c, 'Pricing is unproven', '2026-11-05');
  feedback(db, c, 'Team is small', '2026-11-06');
  feedback(db, c, '   ', '2026-11-07');
  const other = prospect(db, { project: 2, name: 'Other' });
  feedback(db, other, 'Not ours', '2026-11-08');
  db.prepare(`INSERT INTO narrative_objection_answers (project_id, objection_key, version, section_key, how) VALUES (1, ?, 1, 'team', 'picked')`).run(await objectionKey('Team is small'));
  const r: any = await openObjections(ctx, { names: true });
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.items.map((o: any) => [o.text, o.prospects, o.count, o.investors]), [
    ['Customer concentration', 2, 3, ['Ada · North Fund', 'Ben']],
    ['Pricing is unproven', 1, 1, ['Edge']],
  ], 'answered, blank and another venture\'s are out; the newest words are shown');
  assert.equal(r.items[0].key, await objectionKey('Customer concentration'), 'the Investor narrative\'s key (D913)');
  assert.equal(r.items[0].href, `/raise/investor-narrative/story?project=1&objection=${r.items[0].key}`);
  const staff: any = await openObjections(ctx, { names: false });
  assert.deepEqual(staff.items.map((o: any) => o.investors), [null, null]);
  assert.deepEqual(staff.items.map((o: any) => o.prospects), [2, 1], 'the counts stay');
  db.close();
});

test('each part fails on its own, and an unreadable answer store never reads as an open objection', async () => {
  const { db, ctx } = fixture();
  const a = prospect(db, { name: 'Ada', step: 'Call', due: '2026-11-21' });
  feedback(db, a, 'Customer concentration', '2026-11-01');
  db.exec('ALTER TABLE narrative_objection_answers RENAME TO answers_gone');
  assert.deepEqual(await openObjections(ctx, { names: true }), { state: 'unreadable' });
  assert.equal(((await followUpsDue(ctx, { names: true })) as any).items.length, 1, 'follow-ups still read');
  db.exec('ALTER TABLE raise_prospects RENAME TO prospects_gone');
  assert.deepEqual(await followUpsDue(ctx, { names: true }), { state: 'unreadable' });
  db.close();
});

test('the overview read carries both parts, and a staff read gets them without names', () => {
  const src = readFileSync(new URL('../src/routes/cycle_raise.ts', import.meta.url), 'utf8');
  assert.match(src, /followUpsDue\(ctx, \{ names: !staff \}\), openObjections\(ctx, \{ names: !staff \}\)/);
  assert.equal((src.match(/investor_activity: j\.investor_activity, follow_ups_due, open_objections \}/g) || []).length, 2, 'both the staff and the founder read');
});

test('this file is the one D8256 names', () => {
  assert.match(readFileSync(new URL('../../documentation/architecture/decisions/D8256.md', import.meta.url), 'utf8'), /raise_next_actions_8256\.test\.ts/);
});
