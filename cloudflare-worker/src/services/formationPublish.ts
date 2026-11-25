/** D6700 (#6700) — submit a version's canonical content to admitted counsel and atomically publish it. */
import type { Env } from '../types';
import { adminAuditStatement } from './adminAudit';
import { currentVersion } from './formationCatalogue';
import { canonicalJson, contentSha256, sha256Hex, versionContent, type VersionContent } from './formationCatalogueEdit';

type Candidate = {
  id: number; version: number; status: string; draft_base_id: number | null; content_revision: number; editor_id: number | null;
  review_round: string | null; review_base_id: number | null; review_content_sha256: string | null;
  review_rules_sha256: string | null; review_countries: string | null;
};

export function candidate(env: Env, version: number) {
  // D6699 commits each row change with its actor in the append-only audit log.
  // Submission is administrative and never makes its actor the last editor.
  return env.DB.prepare(`SELECT v.id, v.version, v.status, v.content_revision, v.review_round, v.review_base_id,
      v.review_content_sha256, v.review_rules_sha256, v.review_countries,
      COALESCE(v.draft_base_id, (SELECT prior.id FROM admin_audit_log l
        JOIN formation_catalogue_versions prior ON prior.version = json_extract(l.filters_json, '$.from_version')
        WHERE l.action = 'formation_catalogue_draft_created' AND json_extract(l.filters_json, '$.version') = v.version
        ORDER BY l.id DESC LIMIT 1)) AS draft_base_id,
      COALESCE((SELECT l.admin_user_id FROM admin_audit_log l
        WHERE l.action IN ('formation_catalogue_row_added','formation_catalogue_row_edited','formation_catalogue_row_removed')
          AND json_extract(l.filters_json, '$.version') = v.version ORDER BY l.id DESC LIMIT 1), v.created_by) AS editor_id
    FROM formation_catalogue_versions v WHERE v.version = ?`).bind(version).first<Candidate>();
}

export function reviewRuleSet(content: VersionContent) {
  return canonicalJson({ rules: content.rules, scenarios: content.scenarios });
}

export async function submissionPlan(env: Env, v: Candidate) {
  const base = await currentVersion(env);
  if (!base || v.draft_base_id !== base.id) return null;
  const [before, after] = await Promise.all([versionContent(env, base.id), versionContent(env, v.id)]);
  const rules = reviewRuleSet(after);
  const changed = rules !== reviewRuleSet(before);
  // A newly orderable form must not bypass review by being enabled a version after its rules.
  const previous = new Map(before.forms.filter(f => f.offer_mode === 'orderable').map(f => [f.form_key, f.country]));
  const required = after.forms.filter(f => f.offer_mode === 'orderable' && (changed || previous.get(f.form_key) !== f.country));
  return {
    base_id: base.id, required_countries: [...new Set(required.map(f => String(f.country)))].sort(),
    content_sha256: await contentSha256(after), review_rules_sha256: await sha256Hex(rules),
  };
}

type Plan = NonNullable<Awaited<ReturnType<typeof submissionPlan>>>;

export async function submit(env: Env, v: Candidate, plan: Plan, reviewers: Record<string, number>, actor: number, reason: string) {
  const db = env.DB;
  const round = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`UPDATE formation_catalogue_versions
        SET status = 'in_review', review_round = ?, review_base_id = ?, review_content_sha256 = ?,
            review_rules_sha256 = ?, review_countries = ?, review_editor_id = ?
      WHERE id = ? AND status = 'draft' AND content_revision = ?
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND lower(u.role) = 'admin' AND u.is_active = 1)
        AND EXISTS (SELECT 1 FROM formation_catalogue_versions WHERE id = ? AND is_current = 1)`)
      .bind(round, plan.base_id, plan.content_sha256, plan.review_rules_sha256, JSON.stringify(plan.required_countries),
        v.editor_id, v.id, v.content_revision, actor, plan.base_id),
    adminAuditStatement(env, actor, 'formation_catalogue_submitted', { version: v.version, round, reason }, { onlyIfChanged: true }),
    db.prepare(`INSERT INTO formation_reviews (version_id, review_round, object_kind, object_ref, content_sha256, jurisdiction, reviewer_id)
      SELECT v.id, v.review_round, 'rule_set', 'rules', v.review_rules_sha256, j.key, j.value
        FROM formation_catalogue_versions v, json_each(?) j WHERE v.id = ? AND v.review_round = ?`)
      .bind(JSON.stringify(reviewers), v.id, round),
  ]);
  return Number(result[0].meta.changes) === 1 ? round : null;
}

export async function publish(env: Env, v: Candidate, round: string, actor: number, reason: string) {
  // The current base, actor and every admission are checked by the same statement
  // that fires the retirement trigger. A failed audit rolls both versions back.
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE formation_catalogue_versions AS v
      SET status = 'published', is_current = 1, published_by = ?, published_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE v.id = ? AND v.status = 'in_review' AND v.review_round = ? AND v.review_editor_id <> ?
        AND EXISTS (SELECT 1 FROM super_admins sa JOIN users u ON u.id = sa.user_id
          WHERE sa.user_id = ? AND lower(u.role) = 'admin' AND u.is_active = 1)
        AND EXISTS (SELECT 1 FROM formation_catalogue_versions base WHERE base.id = v.review_base_id AND base.is_current = 1)
        AND v.review_countries IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM json_each(v.review_countries) country WHERE NOT EXISTS (
            SELECT 1 FROM formation_reviews r
              JOIN formation_counsel_admissions a ON a.user_id = r.reviewer_id AND a.country = r.jurisdiction
              JOIN counsel_members c ON c.user_id = a.user_id
            WHERE r.version_id = v.id AND r.review_round = v.review_round AND r.jurisdiction = country.value
              AND r.object_kind = 'rule_set' AND r.object_ref = 'rules'
              AND r.content_sha256 = v.review_rules_sha256 AND r.decision = 'approved'))`)
      .bind(actor, v.id, round, actor, actor),
    adminAuditStatement(env, actor, 'formation_catalogue_published', {
      version: v.version, round, content_sha256: v.review_content_sha256, reason,
    }, { onlyIfChanged: true }),
  ]);
  return Number(results[0].meta.changes) === 1;
}

export async function decide(env: Env, id: number, actor: number, hash: string, decision: string) {
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE formation_reviews AS r SET decision = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE r.id = ? AND r.reviewer_id = ? AND r.decision IS NULL AND r.content_sha256 = ?
        AND EXISTS (SELECT 1 FROM formation_catalogue_versions v WHERE v.id = r.version_id AND v.status = 'in_review'
          AND v.review_round = r.review_round AND v.review_rules_sha256 = r.content_sha256)
        AND EXISTS (SELECT 1 FROM formation_counsel_admissions a JOIN counsel_members c ON c.user_id = a.user_id
          JOIN users u ON u.id = c.user_id AND u.is_active = 1
          WHERE a.user_id = r.reviewer_id AND a.country = r.jurisdiction)`).bind(decision, id, actor, hash),
    adminAuditStatement(env, actor, 'formation_review_decided', { review_id: id, content_sha256: hash, decision }, { onlyIfChanged: true }),
  ]);
  return Number(result[0].meta.changes) === 1;
}
