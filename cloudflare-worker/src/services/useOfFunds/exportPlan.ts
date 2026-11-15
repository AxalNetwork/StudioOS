/**
 * D6084 (#6084) — the Use of funds plan as a file a founder can hand to an
 * investor: the base scenario's raise, split and amounts, milestones, hires and
 * the runway after the raise, as of a date, as CSV or PDF.
 *
 * One table model (`planTables`) feeds both files, so the CSV and the PDF can
 * never disagree. Every figure the planning model computes (a section's
 * amount, a milestone's funding, planned spend, the runway after the raise) is
 * labelled Modelled beside it; a typed figure keeps its own source. A missing
 * value is an empty cell, never 0. Nothing here reads Mercury or any measured
 * cash: runway today is not in the file, only the modelled runway after the
 * raise, so no founder's bank figures reach anyone they are handed to.
 *
 * Bound SQL only, through `store.ts`.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Env } from '../../types';
import { toMajorString } from '../../../../frontend/src/lib/money.js';
import { csvCell } from '../capTableRegister';
import { winAnsiSafe } from '../legalDocFormat';
import { SECTION_LABELS } from './legacy';
import { base, scenario, view, PlanError, type Scope } from './store';

export type PlanTable = { title: string; header: string[]; rows: unknown[][] };

const MODELLED = 'Modelled';
const money = (minor: unknown, currency: string): string | null => (typeof minor === 'number' && Number.isSafeInteger(minor) ? toMajorString(minor, currency.toUpperCase()) : null);
const label = (key: unknown): string | null => (typeof key === 'string' && key in SECTION_LABELS ? SECTION_LABELS[key as keyof typeof SECTION_LABELS] : null);
const month = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 7) : null);
const day = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 10) : null);

/** The base scenario, read as the plan read reads it. A plan that cannot be read is refused, never half-exported. */
export async function readBasePlan(env: Env, s: Scope): Promise<any> {
  let r: any;
  try { r = await view(env, s, await scenario(env, s, await base(env, s))); }
  catch (e) {
    if (e instanceof PlanError && e.code === 'plan_not_initialized') throw e;
    throw new PlanError(503, 'plan_unreadable', 'Use of funds is Unreadable, so nothing was exported. Read the plan, then try again.');
  }
  if (r.hires?.state !== 'ok') throw new PlanError(503, 'plan_unreadable', 'The planned hires are Unreadable, so nothing was exported. Read the plan, then try again.');
  return r;
}

/** The file's tables, in order: the plan, the split, milestones, hires. */
export function planTables(r: any): PlanTable[] {
  const cur = String(r.currency || 'usd');
  const m = r.model;
  const runway = m?.runway;
  const spend = m?.spend;
  const sections = Array.isArray(m?.sections) ? m.sections : [];
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const status = new Map((Array.isArray(m?.milestones?.value) ? m.milestones.value : []).map((x: any) => [String(x.id), x]));
  const runwayNote = runway?.value == null ? runway?.reason ?? null
    : runway.value.relation === 'at_least' ? 'At least this long: the cash lasts the whole plan horizon.' : null;
  return [
    {
      title: 'Plan',
      header: ['Item', 'Value', 'Source', 'Note'],
      rows: [
        ['Scenario', r.name ?? null, 'Typed', 'The base scenario'],
        ['Currency', cur.toUpperCase(), null, null],
        ['Raise', money(r.amount_to_raise_cents, cur), r.amount_to_raise_cents == null ? null : r.source ?? 'Typed', null],
        ['Raise arrives', month(r.raise_month), r.raise_month ? 'Typed' : null, null],
        ['Opening cash', money(r.cash_cents, cur), r.cash_cents == null ? null : 'Typed', null],
        ['Plan starts', month(r.start_month), r.start_month ? 'Typed' : null, null],
        ['Target runway (months)', typeof r.target_runway_months === 'number' ? r.target_runway_months : null, r.target_runway_months == null ? null : 'Typed', null],
        ['Runway after the raise (months)', runway?.value == null ? null : Math.round(runway.value.months * 10) / 10, MODELLED, runwayNote],
        ['Planned spend over the plan', money(spend?.value, cur), MODELLED, spend?.value == null ? spend?.reason ?? null : null],
      ],
    },
    {
      title: 'Split',
      header: ['Section', 'Share %', 'Share source', `Amount (${cur.toUpperCase()})`, 'Amount source'],
      rows: sections.map((sec: any) => {
        const line = lines.find((l: any) => l.category_key === sec.key);
        const share = typeof line?.share_pct === 'number' ? line.share_pct : null;
        return [label(sec.key), share, share == null ? null : line.source ?? 'Typed', money(sec.allocation?.value, cur), MODELLED];
      }),
    },
    {
      title: 'Milestones',
      header: ['Milestone', 'Section', 'Due', `Cost (${cur.toUpperCase()})`, 'Cost source', 'Funded', 'Funded source'],
      rows: (Array.isArray(r.milestones) ? r.milestones : []).map((x: any) => {
        const st: any = status.get(String(x.id));
        return [x.label ?? null, label(x.category_key), day(x.due_on), money(x.cost_cents, cur), x.cost_cents == null ? null : x.source ?? 'Typed', st?.state ?? null, MODELLED];
      }),
    },
    {
      title: 'Hires',
      header: ['Role', 'Section', 'Starts', 'Annual cost', 'Currency', 'Source'],
      rows: r.hires.items.map((h: any) => [h.role ?? null, label(h.category_key), month(h.start_month), money(h.annual_cents, String(h.currency || cur)), String(h.currency || cur).toUpperCase(), 'Typed']),
    },
  ];
}

/** The CSV: a title line, the as-of date, then each table under its name. */
export function planCsv(r: any, asOf: string, ventureName: string): string {
  const out: string[] = [];
  const w = (...cells: unknown[]) => out.push(cells.map(csvCell).join(','));
  w(`Use of funds: ${ventureName}`, `As of ${asOf}`);
  w('Modelled figures come from the plan’s inputs; they are not measured cash.');
  for (const t of planTables(r)) {
    w(''); w(t.title); w(...t.header);
    if (!t.rows.length) w(`No ${t.title.toLowerCase()} recorded`);
    for (const row of t.rows) w(...row);
  }
  return out.join('\r\n');
}

/** The PDF: the same tables, one line per row, "Not recorded" for an empty cell. */
export async function planPdf(r: any, asOf: string, ventureName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Use of funds as of ${asOf}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612; const H = 792; const M = 48;
  const ink = rgb(0.1, 0.1, 0.15); const muted = rgb(0.4, 0.4, 0.45);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const line = (text: string, f: PDFFont, size = 9, color = ink) => {
    if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(winAnsiSafe(text).slice(0, 110), { x: M, y, size, font: f, color });
    y -= size + 6;
  };
  line(`Use of funds: ${ventureName}`, bold, 16);
  line(`As of ${asOf}. Modelled figures come from the plan's inputs; they are not measured cash.`, font, 9, muted);
  for (const t of planTables(r)) {
    y -= 6;
    line(t.title, bold, 12);
    line(t.header.join(' | '), bold, 8, muted);
    if (!t.rows.length) line(`No ${t.title.toLowerCase()} recorded.`, font, 9, muted);
    for (const row of t.rows) line(row.map((c) => (c == null || c === '' ? 'Not recorded' : String(c))).join(' | '), font, 9);
  }
  return doc.save();
}

/** The audit row every export writes, in the plan's own history (D1177). Not best-effort: no audit, no file. */
export function exportAudit(env: Env, s: Scope, action: string, sentence: string, entityId: string) {
  return env.DB.prepare(`INSERT INTO activity_logs(project_id,user_id,entity_type,entity_id,action,details,actor) VALUES (?,?,'raise.use-of-funds',?,?,?,?)`)
    .bind(s.projectId, s.user.id, entityId, action, `${s.user.role === 'admin' ? 'Studio admin: ' : ''}${sentence}`, `user:${s.user.id}`);
}
