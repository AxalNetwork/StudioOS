/**
 * D1325 (#3486, #2431 part 2) — FILL_SOURCES: read-only adapters that say, for
 * one form, what each of its sources holds now. No model runs and nothing is
 * written; proposal stores are not merged, one read gathers them (#2431).
 *
 * EACH IS AUTHORISED AS ITS OWN STORE IS. The sheet route has checked that the
 * caller may read the venture; on top of that:
 *   eadwyn      the member's own `ai_rail_proposals`, waiting (`proposed`), for
 *               the form's option (`form:<form>`) and this record: nobody
 *               else's (D777);
 *   connector:  the member's own connection row for that provider: connected
 *               or not, and its last sync. Its proposals arrive with PIPE-BUILD
 *               (#2426), so it offers no value yet;
 *   module:     the venture's own records of that module: the choices a field
 *               like "Answers pain theme" picks from (Validate's pain themes,
 *               its unretired hypotheses).
 *
 * A source that cannot be read is `unreadable` on its own: the others still
 * answer, and the sheet never draws a failed read as "nothing waiting".
 * Logs carry the source key and the error's name, never a value.
 */
import type { Env } from '../../types';
import { neverFillReason } from './neverFill';
import { sourceKind, type FillField } from './fields';

export interface SourceItem { field: string; value: string | number | null; label: string; ref: string | null }
export interface SourceRead {
  key: string;
  kind: 'eadwyn' | 'connector' | 'module';
  label: string;
  state: 'ok' | 'not_connected' | 'unreadable';
  as_of: string | null;
  /** A value proposed for a field, waiting. */
  waiting: SourceItem[];
  /** The records a field picks from (a module's), offered as choices, not as a value. */
  choices: SourceItem[];
}

export interface SourceCtx {
  userId: number; projectId: number; form: string; recordRef: string | null;
  /** D1329: a record that is not a venture's (`scopes.ts`): the row, or the parent an Add form hangs under. */
  scope?: { table: string; row: Record<string, unknown> | null; parentId: number | null };
}

const CONNECTOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  github: 'GitHub', mercury: 'Mercury', stripe: 'Stripe', notion: 'Notion', google_workspace: 'Google Workspace', vercel: 'Vercel', lovable: 'Lovable',
});
const MODULE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'validate/problem-discovery': 'Validate · Problem discovery',
  'validate/experiments': 'Validate · Experiments and evidence',
  // D1329 (#3490).
  'delivery/engagement': 'The engagement record',
  'advisor/outcomes': 'Your recorded outcomes',
});

/** The newest of some timestamps, or null. */
const newest = (xs: Array<string | null | undefined>) => xs.filter(Boolean).sort().at(-1) ?? null;

async function eadwyn(env: Env, ctx: SourceCtx, fields: readonly FillField[]): Promise<Omit<SourceRead, 'key' | 'kind' | 'label'>> {
  const rows = ((await env.DB.prepare(
    `SELECT uid, payload_json, created_at FROM ai_rail_proposals
      WHERE user_id = ? AND rail_option = ? AND status = 'proposed' AND kind = 'proposal'
        AND ((? IS NULL AND record_ref IS NULL) OR record_ref = ?)
      ORDER BY id DESC LIMIT 200`,
  ).bind(ctx.userId, `form:${ctx.form}`, ctx.recordRef, ctx.recordRef).all<{ uid: string; payload_json: string; created_at: string }>()).results) || [];
  const byField = new Map(fields.map((f) => [f.field, f]));
  const waiting: SourceItem[] = [];
  const taken = new Set<string>();
  for (const r of rows) {
    let p: any = null;
    try { p = JSON.parse(r.payload_json); } catch { p = null; }
    const name = typeof p?.field === 'string' ? p.field : null;
    const f = name ? byField.get(name) : undefined;
    // Only a field this form offers to Eadwyn, never a never-fill one, the newest per field.
    if (!f || taken.has(f.field) || f.class === 'measured' || !f.sources.includes('eadwyn') || neverFillReason(`${f.table}.${f.column}`)) continue;
    taken.add(f.field);
    const v = p?.value;
    waiting.push({ field: f.field, value: typeof v === 'string' || typeof v === 'number' ? v : null, label: 'Eadwyn', ref: r.uid });
  }
  return { state: 'ok', as_of: newest(rows.map((r) => r.created_at)), waiting, choices: [] };
}

async function connector(env: Env, ctx: SourceCtx, provider: string): Promise<Omit<SourceRead, 'key' | 'kind' | 'label'>> {
  const row = await env.DB.prepare(
    "SELECT status, last_synced_at FROM integrations WHERE user_id = ? AND provider_key = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).bind(ctx.userId, provider).first<{ status: string; last_synced_at: string | null }>();
  if (!row) return { state: 'not_connected', as_of: null, waiting: [], choices: [] };
  return { state: 'ok', as_of: row.last_synced_at ?? null, waiting: [], choices: [] };
}

async function moduleSource(env: Env, ctx: SourceCtx, ref: string, fields: readonly FillField[]): Promise<Omit<SourceRead, 'key' | 'kind' | 'label'>> {
  const field = fields.find((f) => f.sources.includes(`module:${ref}`))?.field ?? null;
  if (ref === 'validate/problem-discovery') {
    const rows = ((await env.DB.prepare('SELECT id, title, updated_at FROM pain_groups WHERE project_id = ? ORDER BY sort_order, id LIMIT 200')
      .bind(ctx.projectId).all<{ id: number; title: string; updated_at: string | null }>()).results) || [];
    return { state: 'ok', as_of: newest(rows.map((r) => r.updated_at)), waiting: [],
      choices: field ? rows.map((r) => ({ field, value: Number(r.id), label: r.title, ref: `pain_groups:${r.id}` })) : [] };
  }
  if (ref === 'validate/experiments') {
    const rows = ((await env.DB.prepare('SELECT id, code, claim, updated_at FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY sort_order, id LIMIT 200')
      .bind(ctx.projectId).all<{ id: number; code: string; claim: string; updated_at: string | null }>()).results) || [];
    return { state: 'ok', as_of: newest(rows.map((r) => r.updated_at)), waiting: [],
      choices: field ? rows.map((r) => ({ field, value: Number(r.id), label: `${r.code}: ${r.claim}`, ref: `hypotheses:${r.id}` })) : [] };
  }
  if (ref === 'delivery/engagement') return engagementRecord(env, ctx, fields);
  if (ref === 'advisor/outcomes') return advisorOutcomes(env, ctx);
  // A module no adapter reads yet says so; it is never drawn as empty.
  return { state: 'unreadable', as_of: null, waiting: [], choices: [] };
}

/**
 * D1329 (AF19): a status report's Done and Next from the engagement record,
 * at no AI tokens: the deliverables sent in the report's month, and the
 * milestones still open, as the report's compose read lists them
 * (`partner_delivery.ts`). The period is the report's, or this month for a new one.
 */
async function engagementRecord(env: Env, ctx: SourceCtx, fields: readonly FillField[]): Promise<Omit<SourceRead, 'key' | 'kind' | 'label'>> {
  const row = ctx.scope?.row ?? null;
  const engagementId = Number(row?.engagement_id ?? ctx.scope?.parentId);
  if (!Number.isSafeInteger(engagementId) || engagementId <= 0) return { state: 'unreadable', as_of: null, waiting: [], choices: [] };
  const period = typeof row?.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.period) ? row.period : new Date().toISOString().slice(0, 7);
  const sent = ((await env.DB.prepare(
    `SELECT title, sent_at FROM engagement_deliverables WHERE engagement_id = ? AND sent_at IS NOT NULL AND substr(sent_at, 1, 7) = ? ORDER BY sent_at LIMIT 50`,
  ).bind(engagementId, period).all<{ title: string; sent_at: string }>()).results) || [];
  const open = ((await env.DB.prepare(
    `SELECT title, due_at, updated_at FROM engagement_milestones WHERE engagement_id = ? AND completed_at IS NULL ORDER BY due_at IS NULL, due_at LIMIT 20`,
  ).bind(engagementId).all<{ title: string; due_at: string | null; updated_at: string | null }>()).results) || [];
  const has = (name: string) => fields.some((f) => f.field === name && f.sources.includes('module:delivery/engagement'));
  const waiting: SourceItem[] = [];
  if (has('shipped') && sent.length) waiting.push({ field: 'shipped', value: sent.map((d) => d.title).join('\n'), label: 'From the engagement record', ref: `engagement:${engagementId}` });
  if (has('next_up') && open.length) waiting.push({ field: 'next_up', value: open.map((m) => m.title).join('\n'), label: 'From the engagement record', ref: `engagement:${engagementId}` });
  return { state: 'ok', as_of: newest([...sent.map((d) => d.sent_at), ...open.map((m) => m.updated_at)]), waiting, choices: [] };
}

/**
 * D1329 (AF18): the advisor's recorded outcomes (`advisor_proof_items` of kind
 * `outcome`, migration 204), which Eadwyn reads to draft What you deliver.
 * They are the advisor's own: a choice to cite, never a value placed.
 */
async function advisorOutcomes(env: Env, ctx: SourceCtx): Promise<Omit<SourceRead, 'key' | 'kind' | 'label'>> {
  const rows = ((await env.DB.prepare(
    `SELECT p.id, p.title, p.updated_at FROM advisor_proof_items p JOIN advisors a ON a.id = p.advisor_id
      WHERE a.user_id = ? AND p.kind = 'outcome' ORDER BY p.id DESC LIMIT 50`,
  ).bind(ctx.userId).all<{ id: number; title: string; updated_at: string | null }>()).results) || [];
  return { state: 'ok', as_of: newest(rows.map((r) => r.updated_at)), waiting: [],
    choices: rows.map((r) => ({ field: 'scope', value: Number(r.id), label: r.title, ref: `advisor_proof_items:${r.id}` })) };
}

/** One form's sources, in the order its fields first name them, each read on its own. */
export async function readSources(env: Env, ctx: SourceCtx, fields: readonly FillField[]): Promise<SourceRead[]> {
  const keys: string[] = [];
  for (const f of fields) for (const s of f.sources) if (!keys.includes(s)) keys.push(s);
  const out: SourceRead[] = [];
  for (const key of keys) {
    const kind = sourceKind(key);
    if (!kind) continue;
    const ref = key.includes(':') ? key.slice(key.indexOf(':') + 1) : null;
    const label = kind === 'eadwyn' ? 'Eadwyn' : kind === 'connector' ? (CONNECTOR_LABELS[ref!] ?? ref!) : (MODULE_LABELS[ref!] ?? ref!);
    try {
      const read = kind === 'eadwyn' ? await eadwyn(env, ctx, fields)
        : kind === 'connector' ? await connector(env, ctx, ref!)
          : await moduleSource(env, ctx, ref!, fields);
      out.push({ key, kind, label, ...read });
    } catch (e) {
      console.warn('[fills] source unreadable:', key, (e as Error)?.name);
      out.push({ key, kind, label, state: 'unreadable', as_of: null, waiting: [], choices: [] });
    }
  }
  return out;
}
