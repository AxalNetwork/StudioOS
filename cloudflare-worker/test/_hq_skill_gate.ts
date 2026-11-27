/**
 * D4160 — what a test does where HQ's process would: a second Super Admin's
 * approval and a passing golden-case run on an Axal skill's CURRENT draft, so
 * `POST /api/teams/skills/:uid/publish` may publish it. Suites that test
 * something else about published HQ skills (D1612) call this first; the gate
 * itself is tested in `hq_skill_lifecycle_d4160.test.ts`.
 *
 * D4533: the approval and the results are recorded on the draft's release
 * evidence, with the one model `m` declared as its required set, as
 * `routes/admin_hq_skills.ts` records them. The suite needs migration
 * 202611081919 (`skill_release_evidence`).
 */
import { evidenceFrom } from '../src/services/agents/skillLifecycle.ts';

export async function passHqGate(db: any, skillUid: string, reviewerId = 2, requesterId = 1): Promise<void> {
  const s = db.prepare('SELECT * FROM agent_skills WHERE uid = ?').get(skillUid) as any;
  if (!s || s.scope !== 'hq') return;
  db.prepare(`UPDATE agent_skills SET required_models_json = '["m"]' WHERE id = ?`).run(s.id);
  const tags = db.prepare('SELECT taxonomy_skill_slug AS slug, level FROM agent_skill_tags WHERE skill_id = ? ORDER BY rowid').all(s.id) as any[];
  const roles = (db.prepare('SELECT role_key FROM agent_skill_roles WHERE skill_id = ? ORDER BY rowid').all(s.id) as any[]).map((r) => r.role_key);
  const live = () => db.prepare('SELECT id, uid, name, input_json, expect_json FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id').all(s.id) as any[];
  if (!live().length) {
    db.prepare(`INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES (lower(hex(randomblob(16))), ?, 'gate', '{"records":{"x.read":{}}}', '{"output":"brief","must_include":["x"],"must_say_not_recorded":[],"must_not_include":[]}', ?)`)
      .run(s.id, requesterId);
  }
  const e = await evidenceFrom({ name: s.name, purpose: s.purpose, steps: JSON.parse(s.steps_json), tools: JSON.parse(s.allowed_tools_json),
    output_kind: s.output_kind, tags: tags.map((t) => ({ slug: t.slug, level: t.level })), roles }, live(), { required: ['m'], source: 'declared' });
  db.prepare(`INSERT INTO agent_skill_reviews (skill_id, draft_hash, requested_by, reviewer_id, status, decided_at, evidence_hash, evidence_json) VALUES (?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP, ?, ?)`)
    .run(s.id, e.definition_hash, requesterId, reviewerId, e.evidence_hash, JSON.stringify(e));
  for (const k of live()) {
    db.prepare(`INSERT INTO agent_skill_eval_results (case_id, skill_id, draft_hash, model_id, result, run_by, evidence_hash) VALUES (?, ?, ?, 'm', 'pass', ?, ?)`).run(k.id, s.id, e.definition_hash, requesterId, e.evidence_hash);
  }
}
