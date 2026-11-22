/** D6713 (#6713): source-backed catalogue obligations and atomic, idempotent registration seeds. */
import type { Env } from '../types';
import { currentVersion } from './formationCatalogue';

export type PackRule = { due_month?: number; due_day?: number; offset_days?: number };
export type ObligationPackItem = {
  key: string; title: string; description: string | null; phase: string; kind: string; recurrence: string;
  rule: PackRule | null; source_id: number | null; checked_on: string | null;
  due_date: string | null; reminders: boolean;
};
const kinds = new Set(['franchise_tax', 'registered_agent', 'annual_report', 'board_meeting', 'regulatory_filing', 'other']);
const cadences = new Set(['annual', 'quarterly', 'monthly', 'one_time', 'event']);
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
/** A date requires recorded catalogue evidence; relative rules also require the registry date. */
export function packDue(rule: PackRule | null, today: string, registeredOn: string | null): string | null {
  if (!rule || !date(today)) return null;
  if (Number.isInteger(rule.due_month) && Number.isInteger(rule.due_day)) {
    const year = Number(today.slice(0, 4));
    const suffix = `-${String(rule.due_month).padStart(2, '0')}-${String(rule.due_day).padStart(2, '0')}`;
    const candidate = date(`${year}${suffix}`);
    return candidate && candidate >= today ? candidate : date(`${year + 1}${suffix}`);
  }
  if (!date(registeredOn) || !Number.isSafeInteger(rule.offset_days) || rule.offset_days! < 0 || rule.offset_days! > 36600) return null;
  return new Date(Date.parse(registeredOn! + 'T00:00:00Z') + rule.offset_days! * 86400000).toISOString().slice(0, 10);
}

/** Reads pinned versions for a case and the published current version for legacy calendar doors. */
export async function formationPack(env: Env, formKey: string, options: {
  versionId?: number | null; today: string; registeredOn?: string | null; projectId?: number | null;
}): Promise<ObligationPackItem[]> {
  const versionId = options.versionId ?? (await currentVersion(env))?.id;
  if (!versionId) return [];
  const form = await env.DB.prepare('SELECT id FROM formation_entity_forms WHERE version_id = ? AND form_key = ?')
    .bind(versionId, formKey).first<{ id: number }>();
  if (!form) return [];
  const rows = (await env.DB.prepare(`SELECT p.item_key, p.title, p.obligation_phase, p.event_kind, p.recurrence,
      p.due_rule_json, p.source_id, p.checked_on FROM formation_pack_items p
      LEFT JOIN formation_sources s ON s.id = p.source_id
      WHERE p.version_id = ? AND p.form_id = ? AND p.obligation_phase IS NOT NULL ORDER BY p.position, p.id`)
    .bind(versionId, form.id).all<any>()).results || [];
  const out: ObligationPackItem[] = rows.map(row => {
    let rule: PackRule | null = null;
    if (row.source_id != null && date(row.checked_on) && row.due_rule_json) {
      try { rule = JSON.parse(row.due_rule_json); } catch { /* Invalid rules remain undated. */ }
    }
    const due = packDue(rule, options.today, options.registeredOn ?? null);
    return { key: row.item_key, title: row.title, description: null, phase: row.obligation_phase,
      kind: kinds.has(row.event_kind) && !(row.event_kind === 'franchise_tax' && !formKey.startsWith('us_')) ? row.event_kind : 'other',
      recurrence: cadences.has(row.recurrence) ? row.recurrence : 'one_time', rule,
      source_id: row.source_id ?? null, checked_on: row.checked_on ?? null, due_date: due,
      reminders: options.projectId != null && due != null };
  });
  // v1 copied these legacy definitions as provisional facts. Expose their labels,
  // but never promote an unsourced deadline to a recorded legal obligation.
  const facts = (await env.DB.prepare(`SELECT fact_key, value, status, source_id, checked_on FROM formation_form_facts
      WHERE version_id = ? AND form_id = ? AND fact_key GLOB 'compliance_event_*' ORDER BY fact_key`)
    .bind(versionId, form.id).all<any>()).results || [];
  for (const fact of facts) {
    let spec: any;
    try { spec = JSON.parse(fact.value); } catch { continue; }
    if (!spec || typeof spec.title !== 'string') continue;
    const key = fact.fact_key;
    if (out.some(item => item.key === key)) continue;
    const rule = fact.status === 'recorded' && fact.source_id != null && date(fact.checked_on) ? spec : null;
    const due = packDue(rule, options.today, options.registeredOn ?? null);
    out.push({ key, title: spec.title, description: rule != null && typeof spec.description === 'string' ? spec.description : null,
      phase: 'ongoing', kind: kinds.has(spec.event_type) && !(spec.event_type === 'franchise_tax' && !formKey.startsWith('us_')) ? spec.event_type : 'other',
      recurrence: cadences.has(spec.recurrence) ? spec.recurrence : 'one_time', rule,
      source_id: fact.source_id ?? null, checked_on: fact.checked_on ?? null, due_date: due,
      reminders: options.projectId != null && due != null });
  }
  return out;
}

/** Statements run after the guarded case transition and its company-link statements, in the same batch. */
export async function registrationPackStatements(env: Env, caseId: number, revision: number, seedToken: string, registeredOn: string | null): Promise<D1PreparedStatement[]> {
  const subject = await env.DB.prepare(`SELECT form_key, catalogue_version_id, project_id, user_id, track FROM formation_cases WHERE id = ?`)
    .bind(caseId).first<{ form_key: string | null; catalogue_version_id: number | null; project_id: number | null; user_id: number; track: string }>();
  if (!subject || subject.track !== 'v2' || !subject.form_key || subject.catalogue_version_id == null) return [];
  const items = await formationPack(env, subject.form_key, { versionId: subject.catalogue_version_id,
    today: registeredOn ?? new Date().toISOString().slice(0, 10), registeredOn, projectId: subject.project_id });
  const statements: D1PreparedStatement[] = [];
  for (const item of items) {
    const key = `${caseId}:${subject.form_key}:${item.key}`;
    if (subject.project_id != null) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO formation_steps
      (project_id, title, due_date, state, created_by, pack_item_key)
      SELECT c.project_id, ?, ?, 'todo', c.user_id, ? FROM formation_cases c
      WHERE c.id = ? AND c.revision = ? AND c.stage = 'registered' AND c.closed_at IS NULL
        AND EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = c.id AND e.to_revision = c.revision AND json_extract(e.detail_json, '$.pack_seed_token') = ?)`)
      .bind(item.title, item.due_date, key, caseId, revision, seedToken));
    if (item.due_date != null) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO compliance_events
      (project_id, company_id, jurisdiction, event_type, title, description, due_date, recurrence, source, created_by_user_id, pack_item_key)
      SELECT NULL, COALESCE(c.company_id, p.company_id), ?, ?, ?, ?, ?, ?, 'auto', c.user_id, ?
      FROM formation_cases c LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.id = ? AND c.revision = ? AND c.stage = 'registered' AND c.closed_at IS NULL
        AND COALESCE(c.company_id, p.company_id) IS NOT NULL
        AND EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = c.id AND e.to_revision = c.revision AND json_extract(e.detail_json, '$.pack_seed_token') = ?)`)
      .bind(subject.form_key, item.kind, item.title, item.description, item.due_date, item.recurrence, key, caseId, revision, seedToken));
  }
  const evidence = JSON.stringify({ pack_items: items, handoff_owner_user_id: subject.user_id });
  statements.push(env.DB.prepare(`UPDATE formation_case_stages SET evidence_json = ?
    WHERE case_id = ? AND stage = 'registered'
      AND EXISTS (SELECT 1 FROM formation_cases c WHERE c.id = ? AND c.revision = ? AND c.stage = 'registered' AND c.closed_at IS NULL
        AND EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = c.id AND e.to_revision = c.revision AND json_extract(e.detail_json, '$.pack_seed_token') = ?))`)
    .bind(evidence, caseId, caseId, revision, seedToken));
  return statements;
}


/** Carry the registered pack into an actually entered stage; never pre-open workflow rows. */
export function handoffPackEvidenceStatement(env: Env, caseId: number, stage: 'activating' | 'handed_off', revision: number): D1PreparedStatement {
  return env.DB.prepare(`UPDATE formation_case_stages SET
    evidence_json = (SELECT evidence_json FROM formation_case_stages WHERE case_id = ? AND stage = 'registered'),
    owner_user_id = COALESCE(owner_user_id, (SELECT CASE WHEN ? = 'handed_off' THEN user_id ELSE hq_owner_user_id END FROM formation_cases WHERE id = ?))
    WHERE case_id = ? AND stage = ? AND evidence_json IS NULL
      AND EXISTS (SELECT 1 FROM formation_case_stages WHERE case_id = ? AND stage = 'registered'
        AND CASE WHEN json_valid(evidence_json) THEN json_type(evidence_json, '$.pack_items') END = 'array')
      AND EXISTS (SELECT 1 FROM formation_cases WHERE id = ? AND stage = ? AND revision = ? AND closed_at IS NULL)`)
    .bind(caseId, stage, caseId, caseId, stage, caseId, caseId, stage, revision);
}
