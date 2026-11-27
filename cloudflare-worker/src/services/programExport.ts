/**
 * D1124 (#3004) — a program page's Download (CSV): the figures that page
 * reads, as a counts-only file (D953 S-CSV, D893's rule).
 *
 * The rows come from the catalogue read (`programCatalogue`, D954), the same
 * answer the page draws, so the file never shows more than the page: the
 * program's card figures and what needs you, its joins per week where the
 * catalogue counts them, and, for Refer & Earn, the funnel (D1124). A figure
 * the read could not serve is a row reading "Unreadable" or "Not read here
 * yet", never a zero. Strings other than labels are never copied, so no name,
 * email, note or address can reach the file; `refusesCountsOnly` checks it
 * again before anything is stored.
 */
import type { Env } from '../types';
import { referralFunnel } from './referralSubmissions';

/** The program pages that draw Download (CSV) on the canvas and have figures to export. */
export const EXPORTABLE_PROGRAMS = ['mentor-cohorts', 'refer-and-earn', 'perks', 'learning'] as const;
export type ExportableProgram = typeof EXPORTABLE_PROGRAMS[number];

export interface ExportRow { section: string; figure: string; value: string }

/** The catalogue's joins per week for each program, where it counts them. */
const WEEKLY: Partial<Record<ExportableProgram, string>> = { 'refer-and-earn': 'referrals', learning: 'learning' };

const SKIP = new Set(['available', 'unreadable', 'reason', 'covers', 'left_out', 'source', 'definition']);

/** A block the read could not serve: what the page itself says in its place. */
function unread(v: any): string | null {
  if (!v || typeof v !== 'object' || v.available !== false) return null;
  return v.unreadable ? 'Unreadable' : 'Not read here yet';
}

/** Numbers only, by path; an unread block is one row with its word. Never a string value. */
export function flatten(section: string, v: any, path: string[], out: ExportRow[]): ExportRow[] {
  const word = unread(v);
  if (word) { out.push({ section, figure: path.join(' · ') || section, value: word }); return out; }
  if (typeof v === 'number' && Number.isFinite(v)) { out.push({ section, figure: path.join(' · ') || section, value: String(v) }); return out; }
  if (Array.isArray(v)) {
    v.forEach((item, i) => {
      // A row's own label names it (a week, a program's name in the registry); else its position.
      const label = typeof item?.week === 'string' ? item.week : typeof item?.label === 'string' ? item.label : typeof item?.key === 'string' ? item.key : String(i + 1);
      flatten(section, item, [...path, label], out);
    });
    return out;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (SKIP.has(k)) continue;
      flatten(section, x, [...path, k], out);
    }
  }
  return out;
}

/** The rows of one program's export, from the catalogue answer and, for Refer & Earn, the funnel. */
export async function programExportRows(env: Env, key: ExportableProgram, catalogue: any): Promise<ExportRow[] | null> {
  if (!catalogue?.programs?.available || !Array.isArray(catalogue.programs.rows)) return null;
  const row = catalogue.programs.rows.find((x: any) => x?.key === key);
  if (!row) return null;
  const rows: ExportRow[] = [];
  flatten('Figures', row.figures, [], rows);
  flatten('Needs you', row.needs_you, [], rows);
  const weekly = WEEKLY[key];
  if (weekly) flatten('Joins per week', catalogue.joins_weekly?.[weekly], [], rows);
  if (key === 'refer-and-earn') {
    try {
      const f = await referralFunnel(env);
      for (const s of f.stages) rows.push({ section: 'Referral funnel', figure: s.label, value: String(s.count) });
    } catch {
      rows.push({ section: 'Referral funnel', figure: 'Referral funnel', value: 'Unreadable' });
    }
  }
  return rows;
}

/** One CSV cell: quoted when it needs it, and a formula never starts a cell. */
export function cell(v: string): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(rows: ExportRow[], meta: { program: string; weeks: number; asOf: string; scope: string }): string {
  const head = [
    ['Axal Programs', meta.program], ['Weeks', String(meta.weeks)], ['As of', meta.asOf], ['Scope', meta.scope],
    ['Counts only', 'This file holds counts only, never names or emails.'],
    [],
    ['section', 'figure', 'value'],
  ];
  return [...head, ...rows.map((r) => [r.section, r.figure, r.value])].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n';
}
