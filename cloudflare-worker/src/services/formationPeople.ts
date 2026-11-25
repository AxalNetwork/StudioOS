/** D6705: founder case boundaries, share prerequisites and sourced requirements. */
import type { Env } from '../types';
export const ROLES = [
  'director',
  'shareholder',
  'beneficial_owner',
  'secretary',
  'resident_director',
  'contact_person',
  'legal_representative',
  'president',
  'managing_director',
  'deputy',
] as const;
export const editable = ['draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted'];
export type FounderCase = {
  id: number;
  user_id: number;
  revision: number;
  stage: string;
  hold_reason: string | null;
  partner_id: number | null;
  closed_at: string | null;
};
export function ownedCase(env: Env, uid: string, actor: number) {
  return env.DB.prepare(
    "SELECT id,user_id,revision,stage,hold_reason,partner_id,closed_at FROM formation_cases WHERE uid=? AND user_id=? AND track='v2'",
  )
    .bind(uid, actor)
    .first<FounderCase>();
}
export async function founderWrite(
  env: Env,
  row: FounderCase,
  action: string,
  statements: D1PreparedStatement[],
) {
  const db = env.DB;
  await db.batch([
    db
      .prepare(
        `UPDATE formation_cases SET revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND revision=? AND user_id=? AND (?='withdraw' OR (closed_at IS NULL AND (?='consent' OR stage IN (SELECT value FROM json_each(?)))))`,
      )
      .bind(row.id, row.revision, row.user_id, action, action, JSON.stringify(editable)),
    db.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END'),
    ...statements,
    db
      .prepare('INSERT INTO activity_logs(user_id,action,details) VALUES(?,?,?)')
      .bind(row.user_id, 'formation_people_' + action, JSON.stringify({ case_id: row.id })),
  ]);
}

/** Additional gate used after assignment/membership checks. Require a current screening and receipt for every non-owner. */
export async function sharingAllowed(
  env: Env,
  caseId: number,
  partnerId: number,
  scope: string,
  crossBorder: boolean,
) {
  const allowed = await env.DB.prepare(
    `SELECT c.id FROM formation_cases c
    WHERE c.id=? AND c.partner_id=? AND c.track='v2' AND c.closed_at IS NULL AND c.hold_reason IS NULL
    AND EXISTS(SELECT 1 FROM formation_case_consents t WHERE t.case_id=c.id AND t.partner_id=c.partner_id AND t.scope=? AND t.kind='share_with_partner' AND t.withdrawn_at IS NULL)
    AND (?=0 OR EXISTS(SELECT 1 FROM formation_case_consents t WHERE t.case_id=c.id AND t.partner_id=c.partner_id AND t.scope=? AND t.kind='cross_border_transfer' AND t.withdrawn_at IS NULL))
    AND EXISTS(SELECT 1 FROM formation_case_people p WHERE p.case_id=c.id AND p.removed_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM formation_case_people p WHERE p.case_id=c.id AND p.removed_at IS NULL AND (
      ((p.user_id IS NULL OR p.user_id<>c.user_id OR p.verification_state<>'verified') AND (p.notice_sent_at IS NULL OR p.notice_partner_id IS NOT c.partner_id))
      OR NOT EXISTS(SELECT 1 FROM formation_case_screenings s WHERE s.person_id=p.id AND s.person_revision=p.revision)
      OR EXISTS(SELECT 1 FROM formation_case_screenings s WHERE s.person_id=p.id AND s.person_revision=p.revision AND s.severity<>'none' AND coalesce(s.decision,'')<>'clear')))`,
  )
    .bind(caseId, partnerId, scope, Number(crossBorder), scope)
    .first();
  return !!allowed;
}
export async function personRequirements(env: Env, id: number) {
  const facts = await env.DB.prepare(
    `SELECT f.fact_key,f.value,f.status,f.source_id,f.checked_on,j.country,
    EXISTS(SELECT 1 FROM formation_partner_coverage v JOIN formation_partners p ON p.id=v.formation_partner_id
      WHERE v.country=j.country AND v.form_key=e.form_key AND v.service=CASE f.fact_key WHEN 'secretary' THEN 'company_secretary' ELSE f.fact_key END
      AND v.is_on=1 AND p.status='verified' AND p.dpa_signed_on IS NOT NULL AND EXISTS(SELECT 1 FROM formation_partner_credentials cr
      WHERE cr.formation_partner_id=p.id AND cr.country=v.country AND date(cr.valid_until)>=date('now'))) AS covered
    FROM formation_cases c JOIN formation_entity_forms e ON e.version_id=c.catalogue_version_id AND e.form_key=c.form_key
    JOIN formation_jurisdictions j ON j.id=e.jurisdiction_id JOIN formation_form_facts f ON f.form_id=e.id AND f.version_id=e.version_id
    WHERE c.id=? AND f.blocking=1`,
  )
    .bind(id)
    .all<{
      fact_key: string;
      value: string;
      status: string;
      source_id: number;
      checked_on: string;
      country: string;
      covered: number;
    }>();
  const members = await env.DB.prepare(
    `SELECT p.id,p.ownership_bps,p.residence_country,r.role FROM formation_case_people p
    LEFT JOIN formation_case_person_roles r ON r.person_id=p.id WHERE p.case_id=? AND p.removed_at IS NULL`,
  )
    .bind(id)
    .all<{ id: number; ownership_bps: number; residence_country: string; role: string }>();
  if (!facts.success || !members.success) throw new Error('formation_requirements_unreadable');
  const owners = new Map(members.results.map((r) => [r.id, r.ownership_bps]));
  const total = Array.from(owners.values()).reduce((a, b) => a + b, 0);
  const capital = await env.DB.prepare(
    'SELECT amount_minor,currency FROM formation_case_capital WHERE case_id=?',
  )
    .bind(id)
    .first<{ amount_minor: number; currency: string }>();
  const needs = facts.results
    .filter((f) => {
      if (f.status !== 'recorded') return true;
      if (f.fact_key === 'minimum_capital' || f.fact_key === 'capital_minimum') {
        // Compare minor units only when the recorded requirement names its currency.
        let minimum;
        try {
          minimum = JSON.parse(f.value);
        } catch {
          return true;
        }
        return (
          !capital ||
          !minimum ||
          !Number.isSafeInteger(minimum.amount_minor) ||
          minimum.amount_minor < 0 ||
          minimum.currency !== capital.currency ||
          capital.amount_minor < minimum.amount_minor
        );
      }
      if (['false', '0', 'no'].includes(f.value)) return false;
      const roles = members.results.filter((r) =>
        f.fact_key === 'resident_director'
          ? ['director', 'resident_director'].includes(r.role) && r.residence_country === f.country
          : r.role === f.fact_key,
      );
      return roles.length < (/^[1-9][0-9]*$/.test(f.value) ? Number(f.value) : 1);
    })
    .map((f) => ({
      requirement: f.fact_key,
      source_id: f.source_id,
      checked_on: f.checked_on,
      partner_covers: !!f.covered,
    }));
  return { ownership_bps: total, ownership_complete: total === 10000, needs };
}

/** Issued by the counsel/template owner. Until approved wording exists no email is sent. */
export async function deliverPersonNotice(
  env: Env,
  caseId: number,
  personId: number,
  partnerId: number,
  approvedBody: ((partnerName: string) => string) | null,
  send?: (env: Env, to: string, body: string) => Promise<boolean>,
) {
  if (!approvedBody) return 'awaiting_counsel' as const;
  const row = await env.DB.prepare(
    `SELECT p.revision,c.revision case_revision,t.name partner_name,
    CASE WHEN p.user_id IS NULL THEN p.notice_email ELSE u.email END recipient,
    p.notice_sent_at,p.notice_partner_id
    FROM formation_case_people p JOIN formation_cases c ON c.id=p.case_id
    JOIN partners t ON t.id=c.partner_id LEFT JOIN users u ON u.id=p.user_id
    WHERE p.case_id=? AND p.removed_at IS NULL AND p.id=? AND c.partner_id=? AND c.closed_at IS NULL`,
  )
    .bind(caseId, personId, partnerId)
    .first<{
      revision: number;
      case_revision: number;
      partner_name: string;
      recipient: string | null;
      notice_sent_at: string | null;
      notice_partner_id: number | null;
    }>();
  if (!row?.recipient) return 'address_unavailable' as const;
  if (row.notice_sent_at && row.notice_partner_id === partnerId) return 'sent' as const;
  const body = approvedBody(row.partner_name);
  if (!body.trim()) return 'awaiting_counsel' as const;
  const deliver = send ?? (await import('./notify')).sendFormationNoticeEmail;
  if (!(await deliver(env, row.recipient, body))) return 'undelivered' as const;
  const [saved] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE formation_case_people SET notice_partner_id=?,notice_sent_at=CURRENT_TIMESTAMP
    WHERE case_id=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM formation_cases WHERE id=? AND partner_id=? AND revision=? AND closed_at IS NULL)`,
    ).bind(partnerId, caseId, personId, row.revision, caseId, partnerId, row.case_revision),
    env.DB.prepare(
      "INSERT INTO activity_logs(user_id,action,details) SELECT user_id,'formation_person_notice_sent',? FROM formation_cases WHERE id=? AND changes()=1",
    ).bind(JSON.stringify({ case_id: caseId, person_id: personId, partner_id: partnerId }), caseId),
  ]);
  return saved.meta.changes === 1 ? ('sent' as const) : ('case_changed' as const);
}

/** Resolve only the exact text approved by counsel for this form's jurisdiction. */
export async function caseNoticeCopy(env: Env, caseId: number) {
  const row = await env.DB.prepare(
    `SELECT t.slug,t.body_md,j.country FROM formation_cases c
    JOIN formation_entity_forms e ON e.version_id=c.catalogue_version_id AND e.form_key=c.form_key
    JOIN formation_jurisdictions j ON j.id=e.jurisdiction_id
    JOIN formation_form_facts f ON f.form_id=e.id AND f.version_id=e.version_id
    JOIN formation_sources s ON s.id=f.source_id AND s.kind='counsel'
    JOIN legal_templates t ON t.slug=f.value AND t.is_active=1 AND t.is_stub=0
    WHERE c.id=? AND f.fact_key='named_person_notice_template' AND f.status='recorded'`,
  )
    .bind(caseId)
    .first<{ slug: string; body_md: string; country: string }>();
  if (!row?.body_md?.includes('{{partner}}') || row.body_md.length > 20000) return null;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.body_md));
  const hash = Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, '0')).join('');
  const reviews = await env.DB.prepare(
    "SELECT jurisdiction FROM legal_reviews WHERE object_kind='template' AND object_ref=? AND version_sha256=? AND decision='approved'",
  )
    .bind(row.slug, hash)
    .all<{ jurisdiction: string }>();
  const { jurisdictionIsCountry } = await import('./formationGates');
  return reviews.results.some((r) => jurisdictionIsCountry(r.jurisdiction, row.country))
    ? (partnerName: string) => row.body_md.replaceAll('{{partner}}', () => partnerName)
    : null;
}
