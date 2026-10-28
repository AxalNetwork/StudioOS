/**
 * D1341 (#3549) — live update blocks. Each is computed when asked, from its
 * module's own read under that module's own gate, and returns text, an
 * `as_of` day and a link. A block the member cannot read, or whose module has
 * nothing recorded, is null: no block, never a guess and never a zero drawn
 * for a missing value.
 *
 *   kpis               Revenue and traction's rows (`kpiRows`), under Grow's gate; recorded values only.
 *   raise_status       Capital relationships' commitments (`commitmentsRead`), under `capitalCanWork`; never Mercury.
 *   project_progress   Build › Product roadmap's OKRs by column, under its record gate.
 *   interview_insights Customer research's card (`customerResearchCard`), under its record gate.
 *   one_liner          The Investor narrative's core one-liner (`readPositioning`), the venture's own writer only.
 */
import type { Env, User } from '../../types';
import { canWrite, type ProjectRef } from '../../routes/_founder_validate_helpers';
import { isAdmin } from '../narrative/adminRead';
import { readPositioning } from '../narrative/store';
import { capitalCanWork } from '../capRelAccess';
import { commitmentsRead } from '../capRelReads';
import { customerResearchCard } from '../cycleValidate';
import { kpiRows, type KpiRow } from '../growKpis';
import { specFor } from '../records';
import { allowed } from '../records/read';

export const BLOCK_KINDS = Object.freeze(['kpis', 'raise_status', 'project_progress', 'interview_insights', 'one_liner'] as const);
export type BlockKind = typeof BLOCK_KINDS[number];
export type Block = { kind: BlockKind; text: string; as_of: string | null; link: string };

export const isBlockKind = (v: unknown): v is BlockKind => (BLOCK_KINDS as readonly unknown[]).includes(v);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const latest = (days: Array<string | null>) => days.filter((d): d is string => !!d).sort().at(-1) ?? null;
const grouped = (n: number) => String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function money(cents: number, currency: string): string {
  const whole = grouped(cents / 100);
  return currency === 'USD' ? `$${whole}` : `${currency} ${whole}`;
}

/** A KPI's value in words, by its unit. */
export function kpiValue(r: KpiRow): string {
  const v = Number(r.value);
  switch (r.unit) {
    case 'usd_cents': return money(v, 'USD');
    case 'usd': return `$${grouped(v)}`;
    case 'pct':
    case 'monthly_churn_pct': return `${Math.round(v * 10) / 10}%`;
    case 'months': return `${Math.round(v * 10) / 10} months`;
    default: return Number.isInteger(v) ? grouped(v) : String(Math.round(v * 100) / 100);
  }
}

async function moduleGate(cycle: string, slug: string, project: ProjectRef, user: User, env: Env): Promise<boolean> {
  const spec = specFor(cycle, slug);
  return !!spec && allowed(spec.read, project, user, env);
}

async function kpis(env: Env, user: User, project: ProjectRef, now: number): Promise<Block | null> {
  if (!await moduleGate('grow', 'revenue-and-traction', project, user, env)) return null;
  const rows = (await kpiRows(env, Number(project.id), now)).filter((r) => r.value != null);
  if (!rows.length) return null;
  return { kind: 'kpis', text: rows.map((r) => `${r.kpi}: ${kpiValue(r)}${r.as_of ? ` (as of ${r.as_of})` : ''}`).join('\n'),
    as_of: latest(rows.map((r) => r.as_of)), link: `/grow/revenue-and-traction?project_id=${project.id}` };
}

async function raiseStatus(env: Env, user: User, project: ProjectRef): Promise<Block | null> {
  if (!await capitalCanWork(env, project, user)) return null;
  // Mercury is never read for a draft: only the stores the member typed or recorded.
  const r = await commitmentsRead(env, Number(project.id), null);
  const counted = r.investors.filter((i: any) => i.lines?.some((l: any) => l.counted));
  if (!counted.length) return null;
  // A commitment whose amount is not recorded counts the investor, never a $0.
  const total = r.totals.counted_cents > 0 ? money(r.totals.counted_cents, r.currency) : null;
  const target = r.round?.target_cents ? money(r.round.target_cents, r.currency) : null;
  const lines = [!total ? 'Committed amount: not recorded' : target ? `Committed: ${total} of a ${target} target` : `Committed: ${total}`,
    `${counted.length} ${counted.length === 1 ? 'investor' : 'investors'} committed`];
  if (r.round?.name) lines.unshift(`Round: ${r.round.name}`);
  if (r.round?.close_date) lines.push(`Target close: ${r.round.close_date}`);
  return { kind: 'raise_status', text: lines.join('\n'),
    as_of: latest(counted.flatMap((i: any) => i.lines.map((l: any) => day(l.on)))), link: `/raise/capital-relationships?project_id=${project.id}` };
}

async function projectProgress(env: Env, user: User, project: ProjectRef): Promise<Block | null> {
  if (!await moduleGate('build', 'product-roadmap', project, user, env)) return null;
  const rows = (await env.DB.prepare(
    'SELECT objective, kanban_status, updated_at FROM roadmap_okrs WHERE project_id = ? ORDER BY sort_order, id LIMIT 200',
  ).bind(project.id).all<{ objective: string; kanban_status: string; updated_at: string | null }>()).results || [];
  if (!rows.length) return null;
  const count = (s: string) => rows.filter((r) => r.kanban_status === s).length;
  const lines = [`Roadmap: ${count('done')} done, ${count('now')} now, ${count('next')} next, ${count('later')} later`];
  const now = rows.filter((r) => r.kanban_status === 'now').slice(0, 3);
  if (now.length) lines.push(...now.map((r) => `Now: ${r.objective}`));
  return { kind: 'project_progress', text: lines.join('\n'), as_of: latest(rows.map((r) => day(r.updated_at))), link: `/build/product-roadmap?project=${project.id}` };
}

async function interviewInsights(env: Env, user: User, project: ProjectRef, now: number): Promise<Block | null> {
  if (!await moduleGate('validate', 'customer-research', project, user, env)) return null;
  const card = await customerResearchCard({ env, projectId: Number(project.id), today: new Date(now).toISOString().slice(0, 10) });
  const series: any = card.series;
  if (card.state === 'empty' || card.state === 'unreadable' || !series?.funnel) return null;
  const f = series.funnel;
  const lines = [`Interviews held: ${f.done}`, `Booked or held: ${f.booked}`];
  for (const step of series.lab?.funnel ?? []) {
    if (step.label === 'Pain confirmed' || step.label === 'Solution-fit') lines.push(`${step.label}: ${step.n} (${step.sub.toLowerCase()})`);
  }
  return { kind: 'interview_insights', text: lines.join('\n'), as_of: card.as_of ?? null, link: `/validate/customer-research?project=${project.id}` };
}

async function oneLiner(env: Env, user: User, project: ProjectRef): Promise<Block | null> {
  // The narrative's own writer: an admin reads it only with a reason on its page, never through a draft.
  if (isAdmin(user) || !canWrite(project, user)) return null;
  const { core } = await readPositioning(env, Number(project.id), null);
  const line = core.find((p) => p.kind === 'one_liner' && p.text.trim());
  if (!line) return null;
  return { kind: 'one_liner', text: line.text.trim(), as_of: day(line.updated_at), link: `/raise/investor-narrative?project_id=${project.id}` };
}

/** The block now, or null. A read that fails is no block: a draft never quotes a figure it could not read. */
export async function computeBlock(env: Env, user: User, kind: BlockKind, project: ProjectRef, now = Date.now()): Promise<Block | null> {
  try {
    switch (kind) {
      case 'kpis': return await kpis(env, user, project, now);
      case 'raise_status': return await raiseStatus(env, user, project);
      case 'project_progress': return await projectProgress(env, user, project);
      case 'interview_insights': return await interviewInsights(env, user, project, now);
      case 'one_liner': return await oneLiner(env, user, project);
    }
  } catch (e) {
    console.warn('[mail] block unreadable:', kind, (e as Error)?.name || 'error');
  }
  return null;
}
