/**
 * D6027 (#6027) — Build Overview V2's Worker read: the stored facts behind the
 * next action, Needs attention and the Build Plan preview (BD1, BD2).
 *
 *   readPlanPreview  one statement: the venture plan's accepted and waiting
 *                    counts and its first three waiting proposals, from the
 *                    stores `buildPlanner.ts` and `buildPlanState.ts` keep.
 *   buildSignals     the five material facts, each recorded, not recorded or
 *                    unreadable, from the module reads the overview already
 *                    holds (no statement of its own).
 *   buildAttention   material blockers only, each with a link to its record.
 *
 * A failed source is named as unreadable and never reads as "nothing needs
 * attention". A write action goes only to a writer; anyone else gets the link.
 * The plan is the venture founders' and an admin's (D1065's read gate); anyone
 * else gets `restricted`, which reveals nothing about it.
 */
import type { Env } from '../types';
import type { BuildRead, BuildProject } from './cycleFocus';

export type Evidence<T> = { state: 'recorded'; value: T } | { state: 'not_recorded' | 'unreadable'; value: null };
const recorded = <T>(value: T): Evidence<T> => ({ state: 'recorded', value });
const notRecorded = <T>(): Evidence<T> => ({ state: 'not_recorded', value: null });
const unreadable = <T>(): Evidence<T> => ({ state: 'unreadable', value: null });

export const MODULE_LABEL: Record<string, string> = {
  'solution-design': 'Solution design', 'prototype-mvp': 'Prototype / MVP', 'product-roadmap': 'Product roadmap',
  'founding-team': 'Founding team', 'company-creation': 'Company creation', 'operating-systems': 'Operating systems',
};

// ---------------------------------------------------------------------------
// Plan preview
// ---------------------------------------------------------------------------

export interface PlanPreviewItem { uid: string; title: string | null; kind: string; module: string; module_label: string | null }
export interface PlanPreview {
  /** ready: read; not_recorded: no plan prepared; restricted: not this viewer's to read; unreadable: the read failed. */
  state: 'ready' | 'not_recorded' | 'restricted' | 'unreadable';
  /** draft | open | paused. A paused plan takes no decision until a new decision resumes it. */
  status: string | null;
  accepted: number | null;
  waiting: number | null;
  /** The first three waiting proposals, in the plan's own order (module, then item key). */
  items: PlanPreviewItem[];
  href: string;
}

const PREVIEW_ITEMS = 3;
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** The venture-scope plan, the one `/build/plan` opens. One statement; it throws when the stores cannot be read. */
export async function readPlanPreview(env: Env, projectId: number, mayRead: boolean): Promise<PlanPreview> {
  const href = `/build/plan?project=${projectId}`;
  if (!mayRead) return { state: 'restricted', status: null, accepted: null, waiting: null, items: [], href };
  const row = await env.DB.prepare(
    `SELECT p.status,
            (SELECT COUNT(*) FROM build_plan_items i JOIN build_plans o ON o.id = i.plan_id JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
              WHERE o.project_id = p.project_id AND o.scope = p.scope AND i.project_id = o.project_id AND q.status IN ('accepted', 'edited')) AS accepted,
            (SELECT COUNT(*) FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
              WHERE i.plan_id = p.id AND i.project_id = p.project_id AND q.status = 'proposed') AS waiting,
            (SELECT json_group_array(json_object('uid', w.uid, 'module', w.module, 'kind', w.kind, 'title', w.title)) FROM (
               SELECT i.uid, i.module, i.kind,
                      CASE WHEN json_valid(COALESCE(q.decided_payload_json, q.payload_json))
                           THEN json_extract(COALESCE(q.decided_payload_json, q.payload_json), '$.title') END AS title
                 FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
                WHERE i.plan_id = p.id AND i.project_id = p.project_id AND q.status = 'proposed'
                ORDER BY i.module, i.item_key LIMIT ?) w) AS first
       FROM build_plans p
      WHERE p.project_id = ? AND p.scope = 'venture' AND p.status IN ('draft', 'open', 'paused')
      ORDER BY p.id DESC LIMIT 1`,
  ).bind(PREVIEW_ITEMS, projectId).first<{ status: string; accepted: number; waiting: number; first: string | null }>();
  if (!row) return { state: 'not_recorded', status: null, accepted: null, waiting: null, items: [], href };
  const accepted = count(row.accepted), waiting = count(row.waiting);
  let list: unknown;
  try { list = JSON.parse(row.first ?? '[]'); } catch { list = null; }
  if (accepted == null || waiting == null || !Array.isArray(list)) throw new Error('plan preview malformed');
  const items = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as any).uid === 'string')
    .map((x) => ({
      uid: String(x.uid), kind: String(x.kind ?? ''), module: String(x.module ?? ''),
      title: typeof x.title === 'string' && x.title.trim() ? x.title.trim() : null,
      module_label: MODULE_LABEL[String(x.module)] ?? null,
    }));
  return { state: 'ready', status: row.status, accepted, waiting, items, href };
}

export function unreadablePlan(projectId: number): PlanPreview {
  return { state: 'unreadable', status: null, accepted: null, waiting: null, items: [], href: `/build/plan?project=${projectId}` };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface MustHaveSignal { blocked: number; overdue: number; done: number; total: number }
export interface FilingSignal { title: string; due: string | null; state: 'overdue' | 'due_soon'; text: string }
export interface ToolSignal { name: string; since: string | null; href: string; failing: boolean }
export interface BuildSignals {
  mvpDate: Evidence<string>;
  mustHaves: Evidence<MustHaveSignal>;
  /** recorded null: no open filing is overdue or due within 30 days. */
  filing: Evidence<FilingSignal | null>;
  plan: PlanPreview;
  /** recorded null: no core system or tool is failing. */
  tool: Evidence<ToolSignal | null>;
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10))
  && !Number.isNaN(Date.parse(`${v.slice(0, 10)}T00:00:00Z`));
const whole = (v: unknown): number | null => { const n = Number(v); return v != null && Number.isSafeInteger(n) && n >= 0 ? n : null; };

/** The five material facts, from the six module reads (MODULES order) and the plan preview. Pure. */
export function buildSignals(project: BuildProject, reads: BuildRead[], plan: PlanPreview): BuildSignals {
  const [, prototype, , , company, systems] = reads;
  // The MVP date is the project row's, read by the overview's own access check.
  const mvpDate: Evidence<string> = isDay(project.mvp_target_date) ? recorded(project.mvp_target_date!.slice(0, 10)) : notRecorded();

  let mustHaves: Evidence<MustHaveSignal>;
  if (!prototype || prototype.card.state === 'unreadable') mustHaves = unreadable();
  else {
    const f = prototype.facts ?? {};
    const [blocked, overdue, done, total] = [f.blocked, f.overdue, f.done, f.total].map(whole);
    mustHaves = blocked == null || overdue == null || done == null || total == null ? unreadable()
      : total === 0 ? notRecorded() : recorded({ blocked, overdue, done, total });
  }

  let filing: Evidence<FilingSignal | null>;
  if (!company || company.card.state === 'unreadable') filing = unreadable();
  else {
    const n = company.facts?.next_filing as { title?: unknown; due?: unknown; state?: unknown; text?: unknown } | null | undefined;
    if (whole(company.facts?.filings) === 0) filing = notRecorded();
    else if (n === undefined) filing = unreadable();
    else filing = recorded(n && (n.state === 'overdue' || n.state === 'due_soon') && typeof n.title === 'string'
      ? { title: n.title, due: typeof n.due === 'string' ? n.due : null, state: n.state, text: String(n.text ?? '') } : null);
  }

  let tool: Evidence<ToolSignal | null>;
  if (!systems || systems.card.state === 'unreadable') tool = unreadable();
  else if (project.company_id == null) tool = notRecorded();
  else {
    const r = systems.facts?.reconnect as { name?: unknown; since?: unknown; href?: unknown; failing?: unknown } | null | undefined;
    if (r === undefined) tool = unreadable();
    else tool = recorded(r && typeof r.name === 'string' && typeof r.href === 'string' && /^\/(?!\/)/.test(r.href)
      ? { name: r.name, since: typeof r.since === 'string' ? r.since : null, href: r.href, failing: r.failing === true } : null);
  }
  return { mvpDate, mustHaves, filing, plan, tool };
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionTone = 'needs_attention' | 'blocked' | 'not_recorded' | 'processing' | 'unreadable';
export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  title: string;
  detail: string | null;
  module: string;
  /** The record it is about. Reading it is never a write. */
  href: string;
  /** The write that clears it, for a writer only. */
  action: { label: string; href: string } | null;
}
export interface BuildAttention {
  /** ready: every source read; partial: some could not be read (named in `unreadable`); unreadable: none could. */
  state: 'ready' | 'partial' | 'unreadable';
  items: AttentionItem[];
  unreadable: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Material blockers only, in the canvas's order (BD1): a failing tool, must-haves, a filing, the MVP date, the plan. */
export function buildAttention(projectId: number, writer: boolean, s: BuildSignals): BuildAttention {
  const href = (slug: string) => `/build/${slug}?project=${projectId}`;
  const items: AttentionItem[] = [];
  const failed: string[] = [];
  const add = (item: Omit<AttentionItem, 'action'>, action: AttentionItem['action']) => items.push({ ...item, action: writer ? action : null });

  if (s.tool.state === 'unreadable') failed.push('operating-systems');
  else if (s.tool.value) {
    const t = s.tool.value;
    add({ key: 'tool_failing', tone: 'needs_attention', title: t.failing ? `${t.name} connection failing` : `${t.name} needs reconnecting`,
      detail: t.failing && t.since ? `Failing since ${t.since}` : null,
      module: 'operating-systems', href: href('operating-systems') }, { label: `Reconnect ${t.name}`, href: t.href });
  }
  if (s.mustHaves.state === 'unreadable') failed.push('prototype-mvp');
  else if (s.mustHaves.value && (s.mustHaves.value.blocked > 0 || s.mustHaves.value.overdue > 0)) {
    const { blocked, overdue } = s.mustHaves.value;
    const parts = [blocked ? `${blocked} blocked` : null, overdue ? `${overdue} overdue` : null].filter(Boolean).join(' · ');
    add({ key: 'must_haves', tone: 'blocked', title: `${plural(blocked + overdue, 'must-have', 'must-haves')} need${blocked + overdue === 1 ? 's' : ''} unblocking`,
      detail: parts, module: 'prototype-mvp', href: href('prototype-mvp') }, { label: 'Open must-haves', href: href('prototype-mvp') });
  }
  if (s.filing.state === 'unreadable') failed.push('company-creation');
  else if (s.filing.value) {
    const f = s.filing.value;
    add({ key: 'filing_due', tone: 'needs_attention', title: f.title, detail: f.text || null, module: 'company-creation', href: href('company-creation') },
      { label: 'Open filing', href: href('company-creation') });
  }
  if (s.mvpDate.state === 'not_recorded') {
    add({ key: 'mvp_date', tone: 'not_recorded', title: 'MVP target date not recorded', detail: 'The overview counts days to the MVP from this date.',
      module: 'prototype-mvp', href: href('prototype-mvp') }, { label: 'Set target', href: `${href('prototype-mvp')}#mvp-target-date` });
  }
  if (s.plan.state === 'unreadable') failed.push('plan');
  else if (s.plan.state === 'ready' && s.plan.status !== 'paused' && (s.plan.waiting ?? 0) > 0) {
    const n = s.plan.waiting!;
    add({ key: 'plan_waiting', tone: 'processing', title: `${plural(n, 'Build Plan proposal', 'Build Plan proposals')} waiting for a decision`,
      detail: `${s.plan.accepted} accepted`, module: 'plan', href: s.plan.href }, { label: `Review ${plural(n, 'proposal', 'proposals')}`, href: s.plan.href });
  }
  for (const slug of failed) {
    items.push({ key: `${slug}_unreadable`, tone: 'unreadable', title: `${slug === 'plan' ? 'Build Plan' : MODULE_LABEL[slug]} could not be read`,
      detail: 'This does not mean nothing needs attention there.', module: slug, href: slug === 'plan' ? s.plan.href : href(slug), action: null });
  }
  // Four sources can fail (the MVP date is the project row, read before any part).
  return { state: failed.length === 0 ? 'ready' : failed.length >= 4 ? 'unreadable' : 'partial', items, unreadable: failed };
}

export function unreadableAttention(): BuildAttention {
  return { state: 'unreadable', items: [], unreadable: ['operating-systems', 'prototype-mvp', 'company-creation', 'plan'] };
}
