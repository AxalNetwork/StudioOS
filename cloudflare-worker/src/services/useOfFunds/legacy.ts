/** D1175: a single atomic copy; callers must use an authenticated founder id. */
import { SECTION_KEYS, type SectionKey } from './plan';
import type { Env } from '../../types';

export const SECTION_LABELS: Record<SectionKey, string> = {
  product: 'Product & engineering', 'go-to-market': 'GTM: sales and marketing',
  infrastructure: 'Infrastructure & data', operations: 'Operations, legal & compliance', reserve: 'Hiring / runway reserve',
};
type LegacyProject = { use_of_funds: string | null; funding_needed: number | null; use_of_funds_meta: string | null };
type Milestone = { key: SectionKey | null; label: string; due: string | null; cost: number | null; okrId: number | null; ref: string };
export class UofStoreError extends Error {
  code: 'not_found' | 'unreadable' | 'invalid';
  constructor(code: 'not_found' | 'unreadable' | 'invalid') {
    super(code === 'not_found' ? 'The founder plan is unavailable.' : code === 'unreadable' ? 'The stored plan is Unreadable; no copy was written.' : 'The plan inputs are invalid.');
    this.code = code;
  }
}
const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(v);
function cents(raw: unknown): number | null {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new UofStoreError('unreadable');
  const dollars = Number(raw);
  const value = Math.round(dollars * 100);
  if (!Number.isFinite(dollars) || dollars < 0 || !whole(value)) throw new UofStoreError('unreadable');
  return value;
}
function json(raw: string | null, fallback: unknown): any {
  if (raw === null || raw === '') return fallback;
  try { return JSON.parse(raw); } catch { throw new UofStoreError('unreadable'); }
}
async function ownedProject(db: Env['DB'], projectId: number, founderUserId: number): Promise<LegacyProject> {
  const project = await db.prepare(`SELECT p.use_of_funds, p.funding_needed, p.use_of_funds_meta
    FROM projects p JOIN users u ON u.founder_id = p.founder_id
    WHERE p.id = ? AND u.id = ? AND u.role = 'founder' AND u.is_active = 1 AND p.deleted_at IS NULL`)
    .bind(projectId, founderUserId).first<LegacyProject>();
  if (!project) throw new UofStoreError('not_found');
  return project;
}

/** Safe to retry/concurrently call; an existing base (including founder edits) is never overwritten. */
export async function copyLegacyBase(db: Env['DB'], projectId: number, founderUserId: number, onCreate?: (uid:string)=>D1PreparedStatement): Promise<{ scenarioId: number; copied: boolean }> {
  const p = await ownedProject(db, projectId, founderUserId);
  const existing = await db.prepare('SELECT id FROM uof_scenarios WHERE project_id = ? AND is_base = 1').bind(projectId).first<{ id: number }>();
  if (existing) return { scenarioId: existing.id, copied: false };
  const split = json(p.use_of_funds, []);
  const meta = json(p.use_of_funds_meta, {});
  if (!Array.isArray(split) || !object(meta)) throw new UofStoreError('unreadable');
  const shares = new Map<SectionKey, number>();
  for (const line of split) {
    const key = SECTION_KEYS.find(k => line?.label === SECTION_LABELS[k] || line?.key === k);
    if (!key || shares.has(key) || !whole(line.pct) || line.pct > 100) throw new UofStoreError('unreadable');
    shares.set(key, line.pct);
  }
  if (shares.size && [...shares.values()].reduce((a, b) => a + b, 0) !== 100) throw new UofStoreError('unreadable');
  const runway = meta.runway_months ?? null;
  if (runway !== null && (!whole(runway) || runway < 1 || runway > 120)) throw new UofStoreError('unreadable');
  const sectionMilestones = meta.milestones ?? {};
  const costs = meta.milestone_costs ?? {};
  if (!object(sectionMilestones) || !object(costs)) throw new UofStoreError('unreadable');
  const milestones: Milestone[] = [];
  for (const [key, value] of Object.entries(sectionMilestones)) {
    if (!SECTION_KEYS.includes(key as SectionKey) || !object(value) || typeof value.label !== 'string' || !value.label.trim() || (value.by != null && value.by !== '' && !date(value.by))) throw new UofStoreError('unreadable');
    milestones.push({ key: key as SectionKey, label: value.label, due: value.by || null, cost: null, okrId: null, ref: `milestones:${key}` });
  }
  // Read only this venture's OKRs; a foreign/deleted id cannot become a relationship.
  const okrs = await db.prepare('SELECT id, objective FROM roadmap_okrs WHERE project_id = ?').bind(projectId).all<{ id: number; objective: string }>();
  const byId = new Map((okrs.results ?? []).map(o => [String(o.id), o]));
  const bucket = new Map<string, SectionKey>([['eng', 'product'], ['gtm', 'go-to-market'], ['ops', 'operations'], ['infra', 'infrastructure'], ['hiring', 'reserve']]);
  for (const [id, value] of Object.entries(costs)) {
    if (!object(value)) throw new UofStoreError('unreadable');
    const okr = byId.get(id);
    if (!okr) throw new UofStoreError('unreadable');
    const key = value.bucket == null || value.bucket === '' ? null : bucket.get(value.bucket) ?? (SECTION_KEYS.includes(value.bucket) ? value.bucket : null);
    if (value.bucket != null && value.bucket !== '' && key === null) throw new UofStoreError('unreadable');
    milestones.push({ key, label: okr.objective, due: null, cost: cents(value.cost), okrId: okr.id, ref: `milestone_costs:${id}` });
  }
  const uid = crypto.randomUUID();
  const statements = [db.prepare(`INSERT INTO uof_scenarios
    (uid, project_id, name, is_base, model_version, amount_to_raise_cents, target_runway_months, legacy_copied_at, created_by, updated_by)
    VALUES (?, ?, 'Base', 1, 1, ?, ?, datetime('now'), ?, ?) ON CONFLICT DO NOTHING`)
    .bind(uid, projectId, cents(p.funding_needed), runway, founderUserId, founderUserId)];
  for (const key of SECTION_KEYS) statements.push(db.prepare(`INSERT INTO uof_scenario_lines
    (scenario_id, category_key, share_pct, source_kind, source_ref, source_label, updated_by)
    SELECT id, ?, ?, 'module', ?, 'recorded', ? FROM uof_scenarios WHERE uid = ? AND project_id = ?`)
    .bind(key, shares.get(key) ?? null, `projects:${projectId}:use_of_funds`, founderUserId, uid, projectId));
  for (const m of milestones) statements.push(db.prepare(`INSERT INTO uof_milestones
    (scenario_id, category_key, label, due_on, cost_cents, okr_id, legacy_ref, source_kind, source_ref, source_label, updated_by)
    SELECT id, ?, ?, ?, ?, ?, ?, 'module', ?, 'recorded', ? FROM uof_scenarios WHERE uid = ? AND project_id = ?`)
    .bind(m.key, m.label, m.due, m.cost, m.okrId, m.ref, `projects:${projectId}:use_of_funds_meta:${m.ref}`, founderUserId, uid, projectId));
  if (onCreate) statements.push(onCreate(uid));
  const written = await db.batch(statements);
  const base = await db.prepare('SELECT id FROM uof_scenarios WHERE project_id = ? AND is_base = 1').bind(projectId).first<{ id: number }>();
  if (!base) throw new UofStoreError('unreadable');
  return { scenarioId: base.id, copied: (written[0].meta.changes ?? 0) > 0 };
}

/** Part 3 calls this writer for Base. Alternatives never mutate the legacy deck inputs. */
export async function saveBaseSplit(db: Env['DB'], a: {
  projectId: number; founderUserId: number;
  amountToRaiseCents: number | null; targetRunwayMonths: number | null;
  lines: { key: SectionKey; sharePct: number; sublabel?: string | null }[];
}): Promise<void> {
  const p = await ownedProject(db, a.projectId, a.founderUserId);
  if (a.amountToRaiseCents !== null && !whole(a.amountToRaiseCents)) throw new UofStoreError('invalid');
  if (a.targetRunwayMonths !== null && (!whole(a.targetRunwayMonths) || a.targetRunwayMonths < 1 || a.targetRunwayMonths > 120)) throw new UofStoreError('invalid');
  if (a.lines.length !== 5 || new Set(a.lines.map(l => l.key)).size !== 5 || a.lines.some(l => !SECTION_KEYS.includes(l.key) || !whole(l.sharePct) || l.sharePct > 100 || (l.sublabel != null && (typeof l.sublabel !== 'string' || l.sublabel.length > 200))) || a.lines.reduce((sum, l) => sum + l.sharePct, 0) !== 100) throw new UofStoreError('invalid');
  const meta = json(p.use_of_funds_meta, {});
  if (!object(meta)) throw new UofStoreError('unreadable');
  if (a.targetRunwayMonths === null) delete meta.runway_months; else meta.runway_months = a.targetRunwayMonths;
  meta.deck_synced_at = null;
  const { scenarioId } = await copyLegacyBase(db, a.projectId, a.founderUserId);
  const split = SECTION_KEYS.map(key => ({ label: SECTION_LABELS[key], pct: a.lines.find(l => l.key === key)!.sharePct }));
  await db.batch([
    db.prepare(`UPDATE uof_scenarios SET amount_to_raise_cents = ?, target_runway_months = ?, updated_by = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND is_base = 1`).bind(a.amountToRaiseCents, a.targetRunwayMonths, a.founderUserId, scenarioId, a.projectId),
    ...a.lines.map(line => db.prepare(`UPDATE uof_scenario_lines SET share_pct = ?, sublabel = ?, source_kind = NULL, source_ref = NULL,
      source_label = 'typed', prior_value = CAST(share_pct AS TEXT), undone_at = NULL, undone_by = NULL, updated_by = ?, updated_at = datetime('now')
      WHERE scenario_id = ? AND category_key = ?`).bind(line.sharePct, line.sublabel ?? null, a.founderUserId, scenarioId, line.key)),
    db.prepare(`UPDATE projects SET use_of_funds = ?, funding_needed = ?, use_of_funds_meta = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(JSON.stringify(split), a.amountToRaiseCents === null ? null : a.amountToRaiseCents / 100, JSON.stringify(meta), a.projectId),
  ]);
}
