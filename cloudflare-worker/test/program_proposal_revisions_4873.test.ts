/**
 * D4873 (#4873, part 3) — a proposal's revisions, and a decision that names the one it decides.
 *
 * Real SQLite over the real schema and the real migration (202611090830). A send freezes what it held as a new
 * revision; a send-back and an edit leave the earlier revision as it was sent; a decision must name the revision the
 * reviewer read, is refused with nothing written when the proposal was sent again, and is recorded on that revision
 * once; the backfill records only what can be known.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/program_proposal_revisions_4873.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { decide, hqQueue, proposalDetail, saveDraft, sendProposal, startDraft } from '../src/services/programProposals.ts';
import { ProgramError } from '../src/services/programRegistry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const STUDIO = { id: 2, email: 'studio@example.test', studio: 'lic-north' };
const SUPER = { id: 1, email: 'super@example.test' };
const OPEN = () => ({ open: true, sentence: '' });
const FIELDS = { name: 'Climate founders circle', purpose: 'A monthly peer circle.', who: ['Founders'], group: 'Ventures', join_method: 'By application' };

function full(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
const envOf = (db: DatabaseSync) => ({ DB: d1Over(db) } as any);
const revs = (db: DatabaseSync, uid: string) => db.prepare(
  `SELECT r.revision, r.spec_json, r.outcome, r.hq_note FROM program_proposal_revisions r
     JOIN program_proposals p ON p.id = r.proposal_id WHERE p.uid = ? ORDER BY r.revision`,
).all(uid) as any[];
const refused = (code: string) => (e: unknown) => e instanceof ProgramError && e.code === code;

/** A draft with every field Send needs, sent once: revision 1. */
async function sentOnce(db: DatabaseSync) {
  const env = envOf(db);
  const draft: any = await startDraft(env, STUDIO, FIELDS);
  await sendProposal(env, draft.uid, STUDIO, OPEN);
  return draft.uid as string;
}

test('a send is a revision: the next number, and its row freezes the fields exactly as sent', async () => {
  const db = full();
  const uid = await sentOnce(db);
  const [r1] = revs(db, uid);
  assert.equal(r1.revision, 1);
  assert.equal(JSON.parse(r1.spec_json).name, 'Climate founders circle');
  assert.equal(JSON.parse(r1.spec_json).purpose, 'A monthly peer circle.');
  assert.equal(r1.outcome, null);
  const d: any = await proposalDetail(envOf(db), uid, { ...SUPER, studio: null, superAdmin: true });
  assert.equal(d.revision, 1);
  assert.deepEqual(d.revisions.map((x: any) => [x.revision, x.spec.name, x.spec_recorded, x.outcome]), [[1, 'Climate founders circle', true, null]]);
  assert.deepEqual(d.revisions[0].spec.who, ['Founders'], 'the frozen fields read in the proposal\'s own words');
});

test('sent back, edited and sent again: revision 2 holds the edit, and revision 1 is still what HQ read the first time', async () => {
  const db = full();
  const env = envOf(db);
  const uid = await sentOnce(db);
  await decide(env, uid, { outcome: 'send_back', note: 'Add eligibility.', expected_revision: 1 }, SUPER);
  await saveDraft(env, uid, STUDIO, { purpose: 'A monthly peer circle, with one HQ session a quarter.', eligibility: 'Active founder licence.' });
  await sendProposal(env, uid, STUDIO, OPEN);
  const [r1, r2] = revs(db, uid);
  assert.equal(JSON.parse(r1.spec_json).purpose, 'A monthly peer circle.', 'the first send is unchanged by the edit');
  assert.equal(JSON.parse(r1.spec_json).eligibility, null);
  assert.deepEqual([r1.outcome, r1.hq_note], ['sent_back', 'Add eligibility.'], 'the send-back is recorded on the revision it decided');
  assert.equal(r2.revision, 2);
  assert.equal(JSON.parse(r2.spec_json).eligibility, 'Active founder licence.');
  assert.equal(r2.outcome, null);
  const queue: any = await hqQueue(env, { q: '', status: 'sent', sort: 'oldest', page: 1, licence: null });
  assert.equal(queue.rows[0].revision, 2);
});

test('a decision names the revision it decides: none is a 400, a stale one a 409, and either writes nothing', async () => {
  const db = full();
  const env = envOf(db);
  const uid = await sentOnce(db);
  await assert.rejects(decide(env, uid, { outcome: 'decline', note: 'No.' }, SUPER), refused('expected_revision_required'));
  await assert.rejects(decide(env, uid, { outcome: 'decline', note: 'No.', expected_revision: 2 }, SUPER), refused('revision_changed'));
  const p = db.prepare('SELECT status, decided_at FROM program_proposals WHERE uid = ?').get(uid) as any;
  assert.deepEqual([p.status, p.decided_at], ['sent', null], 'nothing was decided');
  assert.equal(revs(db, uid)[0].outcome, null);
});

test('an approval of revision N records it on that revision, in the approved spec and in the audit', async () => {
  const db = full();
  const env = envOf(db);
  const uid = await sentOnce(db);
  await decide(env, uid, { outcome: 'send_back', note: 'Add eligibility.', expected_revision: 1 }, SUPER);
  await saveDraft(env, uid, STUDIO, { eligibility: 'Active founder licence.' });
  await sendProposal(env, uid, STUDIO, OPEN);
  const out: any = await decide(env, uid, { outcome: 'approve_catalogue', note: 'Listed.', expected_revision: 2 }, SUPER);
  assert.equal(out.status, 'approved');
  assert.deepEqual(out.revisions.map((r: any) => r.outcome), ['sent_back', 'approved_catalogue']);
  const spec = JSON.parse((db.prepare('SELECT spec_json FROM program_approved_specs WHERE proposal_uid = ?').get(uid) as any).spec_json);
  assert.equal(spec.revision, 2);
  assert.equal(spec.fields.eligibility, 'Active founder licence.');
  const audit = JSON.parse((db.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'program.proposal.decide' ORDER BY id DESC LIMIT 1").get() as any).filters_json);
  assert.equal(audit.revision, 2);
});

test('a revision is append-only: its send never changes, its decision is written once, and no row is deleted', async () => {
  const db = full();
  const env = envOf(db);
  const uid = await sentOnce(db);
  assert.throws(() => db.exec("UPDATE program_proposal_revisions SET spec_json = '{}'"), /does not change/);
  assert.throws(() => db.exec('DELETE FROM program_proposal_revisions'), /append-only/);
  await decide(env, uid, { outcome: 'decline', note: 'Overlaps the Lab.', expected_revision: 1 }, SUPER);
  assert.throws(() => db.exec("UPDATE program_proposal_revisions SET outcome = 'approved_catalogue'"), /written once/);
  assert.equal(revs(db, uid)[0].outcome, 'declined');
});

test('the backfill records what can be known: an edited send-back has no recorded fields, a draft no revision', () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 560 });
  for (const m of ['560_program_registry.sql', '561_program_proposals.sql']) db.exec(readFileSync(resolve(MIGRATIONS, m), 'utf8'));
  const ins = db.prepare(`INSERT INTO program_proposals (uid, created_by_user_id, status, name, sent_at, decision, hq_note, decided_at, updated_at)
    VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('pp-sent', 'sent', 'Sent', '2026-11-01T09:00:00Z', null, null, null, '2026-11-01T09:00:00Z');
  ins.run('pp-ok', 'approved', 'Approved', '2026-11-01T09:00:00Z', 'catalogue', 'Yes.', '2026-11-02T09:00:00Z', '2026-11-02T09:00:00Z');
  ins.run('pp-back', 'sent_back', 'Back, untouched', '2026-11-01T09:00:00Z', null, 'More.', '2026-11-02T09:00:00Z', '2026-11-02T09:00:00Z');
  ins.run('pp-edited', 'sent_back', 'Back, edited', '2026-11-01T09:00:00Z', null, 'More.', '2026-11-02T09:00:00Z', '2026-11-03T09:00:00Z');
  ins.run('pp-draft', 'draft', 'Draft', null, null, null, null, '2026-11-01T09:00:00Z');
  db.exec(readFileSync(resolve(MIGRATIONS, '202611090830_program_proposal_revisions_4873.sql'), 'utf8'));
  const by = (uid: string) => revs(db, uid);
  assert.equal(JSON.parse(by('pp-sent')[0].spec_json).name, 'Sent');
  assert.equal(by('pp-sent')[0].outcome, null);
  assert.deepEqual([by('pp-ok')[0].outcome, by('pp-ok')[0].hq_note], ['approved_catalogue', 'Yes.']);
  assert.equal(JSON.parse(by('pp-back')[0].spec_json).name, 'Back, untouched', 'unedited since the send-back: what was sent');
  assert.equal(by('pp-edited')[0].spec_json, null, 'edited since: what was sent is not recorded, never the edit');
  assert.equal(by('pp-edited')[0].outcome, 'sent_back');
  assert.deepEqual(by('pp-draft'), []);
  const rev = (uid: string) => (db.prepare('SELECT revision FROM program_proposals WHERE uid = ?').get(uid) as any).revision;
  assert.deepEqual([rev('pp-sent'), rev('pp-edited'), rev('pp-draft')], [1, 1, null]);
});

test('a send that lands between the read and the decision\'s batch wins: the decision writes nothing, on either revision', async () => {
  const db = full();
  const env = envOf(db);
  const uid = await sentOnce(db);
  // The reviewer read revision 1. Before the decision's batch runs, the proposal is sent back and sent again as
  // revision 2 (as a studio's resend would leave it), so the in-batch check is the only one that can see it.
  const raced = {
    DB: new Proxy(env.DB, {
      get(target, k) {
        if (k !== 'batch') return Reflect.get(target, k);
        return async (stmts: unknown[]) => {
          db.prepare("UPDATE program_proposals SET revision = 2 WHERE uid = ?").run(uid);
          db.prepare(`INSERT INTO program_proposal_revisions (proposal_id, revision, spec_json, sent_at)
            SELECT id, 2, json_object('name', name), sent_at FROM program_proposals WHERE uid = ?`).run(uid);
          return target.batch(stmts as any);
        };
      },
    }),
  } as any;
  await assert.rejects(decide(raced, uid, { outcome: 'approve_catalogue', note: 'Yes.', expected_revision: 1 }, SUPER), refused('not_waiting'));
  const p = db.prepare('SELECT status, decided_at FROM program_proposals WHERE uid = ?').get(uid) as any;
  assert.deepEqual([p.status, p.decided_at], ['sent', null], 'revision 2 is not decided under revision 1\'s review');
  assert.deepEqual(revs(db, uid).map((r: any) => r.outcome), [null, null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM program_approved_specs').get().n, 0);
});
