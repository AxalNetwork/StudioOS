/**
 * D1020 (#2857; Cap table part 5 of #2432) — the recorded register per venture:
 * its reads, its CSV, its PDF snapshot and the audit row every export writes.
 *
 * WHAT "RECORDED" MEANS HERE. `cap_table_holders`, `cap_table_securities`,
 * `cap_table_option_pools` and `cap_table_vesting`: what a founder entered or a
 * connector (Carta) imported. Never the saved model (`cap_table_scenarios`),
 * which is Modelled (D1015 §3).
 *
 * A VENTURE READ NAMES ONE VENTURE. Every query below binds `project_id`. A
 * row whose venture is unset is account-level (migration 574) and no venture
 * read returns it.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A share count nobody recorded is null, and
 * so is any total or percentage that would need it: a sum over a partly
 * recorded column is not the total, and a percentage of it is not the share.
 *
 * Bound SQL only.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Env } from '../types';
import { winAnsiSafe } from './legalDocFormat';
import { hashEmail } from '../util/hashEmail';

/** Carta's rows, in the connector's own key (migration 574). */
export const CARTA_SOURCE = 'connector_carta';

export type HolderRow = {
  id: number; name: string; email: string | null; security_type: string | null;
  shares: number | null; ownership_pct: number | null; source: string; updated_at: string | null;
};
export type SecurityRow = {
  id: number; name: string; share_class: string | null;
  shares_authorized: number | null; shares_issued: number | null; source: string; updated_at: string | null;
};
export type PoolRow = {
  id: number; name: string; shares_authorized: number | null; shares_issued: number | null;
  shares_available: number | null; source: string | null; updated_at: string | null;
};
export type VestingRow = {
  id: number; holder_id: number | null; security_id: number | null; start_date: string | null;
  cliff_months: number | null; total_months: number | null; total_shares: number | null;
  vested_shares: number | null; source: string | null; updated_at: string | null;
};

/** A stored number, or null when nothing is recorded. */
export const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * The sum of a column, or null: with no rows nothing is recorded, and with any
 * row missing the value the sum is not the total.
 */
export function knownSum<T>(rows: T[], key: keyof T): number | null {
  if (!rows.length) return null;
  let total = 0;
  for (const r of rows) {
    const v = num(r[key]);
    if (v == null) return null;
    total += v;
  }
  return total;
}

/** Each holder's share of the recorded total, or null when the total is not known. */
export function withOwnership<T extends { shares: number | null }>(holders: T[]): { total_shares: number | null; holders: Array<T & { ownership_pct: number | null }> } {
  const total = knownSum(holders, 'shares');
  return {
    total_shares: total,
    holders: holders.map((h) => {
      const shares = num(h.shares);
      return { ...h, shares, ownership_pct: total != null && total > 0 && shares != null ? (shares / total) * 100 : null };
    }),
  };
}

export type RegisterScope = { kind: 'venture'; projectId: number } | { kind: 'account'; userId: number };

/** The holders and securities of one venture, or of one account. */
export async function readRegister(env: Env, scope: RegisterScope): Promise<{ holders: HolderRow[]; securities: SecurityRow[] }> {
  const holders = scope.kind === 'venture'
    ? await env.DB.prepare(
      `SELECT id, name, email, security_type, shares, ownership_pct, source, updated_at
         FROM cap_table_holders WHERE project_id = ? ORDER BY shares DESC, name ASC LIMIT 500`,
    ).bind(scope.projectId).all<HolderRow>()
    : await env.DB.prepare(
      `SELECT id, name, email, security_type, shares, ownership_pct, source, updated_at
         FROM cap_table_holders WHERE user_id = ? ORDER BY shares DESC, name ASC LIMIT 500`,
    ).bind(scope.userId).all<HolderRow>();
  const securities = scope.kind === 'venture'
    ? await env.DB.prepare(
      `SELECT id, name, share_class, shares_authorized, shares_issued, source, updated_at
         FROM cap_table_securities WHERE project_id = ? ORDER BY name ASC LIMIT 200`,
    ).bind(scope.projectId).all<SecurityRow>()
    : await env.DB.prepare(
      `SELECT id, name, share_class, shares_authorized, shares_issued, source, updated_at
         FROM cap_table_securities WHERE user_id = ? ORDER BY name ASC LIMIT 200`,
    ).bind(scope.userId).all<SecurityRow>();
  return { holders: holders.results || [], securities: securities.results || [] };
}

/** The option pools and vesting grants of one venture, or of one account. */
export async function readEquityPlan(env: Env, scope: RegisterScope): Promise<{ pools: PoolRow[]; vesting: VestingRow[] }> {
  const pools = scope.kind === 'venture'
    ? await env.DB.prepare(
      `SELECT id, name, shares_authorized, shares_issued, shares_available, source, updated_at
         FROM cap_table_option_pools WHERE project_id = ? ORDER BY name`,
    ).bind(scope.projectId).all<PoolRow>()
    : await env.DB.prepare(
      `SELECT id, name, shares_authorized, shares_issued, shares_available, source, updated_at
         FROM cap_table_option_pools WHERE user_id = ? ORDER BY name`,
    ).bind(scope.userId).all<PoolRow>();
  const vesting = scope.kind === 'venture'
    ? await env.DB.prepare(
      `SELECT id, holder_id, security_id, start_date, cliff_months, total_months,
              total_shares, vested_shares, source, updated_at
         FROM cap_table_vesting WHERE project_id = ? ORDER BY start_date DESC`,
    ).bind(scope.projectId).all<VestingRow>()
    : await env.DB.prepare(
      `SELECT id, holder_id, security_id, start_date, cliff_months, total_months,
              total_shares, vested_shares, source, updated_at
         FROM cap_table_vesting WHERE user_id = ? ORDER BY start_date DESC`,
    ).bind(scope.userId).all<VestingRow>();
  return { pools: pools.results || [], vesting: vesting.results || [] };
}

/** The equity plan's answer: the rows as recorded, and totals only where every row records the figure. */
export function equityPlanBody(pools: PoolRow[], vesting: VestingRow[]) {
  const granted = knownSum(vesting, 'total_shares');
  const vested = knownSum(vesting, 'vested_shares');
  return {
    pools: pools.map((p) => ({
      id: p.id, name: p.name,
      shares_authorized: num(p.shares_authorized), shares_issued: num(p.shares_issued), shares_available: num(p.shares_available),
      source: p.source, as_of: p.updated_at,
    })),
    grants: vesting.map((v) => ({
      id: v.id, holder_id: v.holder_id, security_id: v.security_id, start_date: v.start_date,
      cliff_months: num(v.cliff_months), total_months: num(v.total_months),
      total_shares: num(v.total_shares), vested_shares: num(v.vested_shares),
      source: v.source, as_of: v.updated_at,
    })),
    summary: {
      pool_count: pools.length,
      grant_count: vesting.length,
      shares_authorized: knownSum(pools, 'shares_authorized'),
      shares_issued: knownSum(pools, 'shares_issued'),
      shares_available: knownSum(pools, 'shares_available'),
      granted_shares: granted,
      vested_shares: vested,
      unvested_shares: granted != null && vested != null ? Math.max(0, granted - vested) : null,
    },
  };
}

/** Where a row came from, in words. */
export function sourceWord(source: string | null | undefined): string {
  if (source === CARTA_SOURCE) return 'Carta';
  if (source === 'import') return 'Import';
  return 'Entered on StudioOS';
}

/**
 * One CSV cell. A value that a spreadsheet would read as a formula (it starts
 * with =, +, -, @, a tab or a carriage return) is prefixed with an apostrophe:
 * holder names come from Carta and from imports.
 */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pctText = (p: number | null) => (p == null ? null : p.toFixed(4));

/**
 * The recorded register as CSV. A missing figure is an empty cell, never 0.
 * `withEmail` is false for a reader who may not see holders' addresses.
 */
export function registerCsv(register: { holders: HolderRow[]; securities: SecurityRow[] }, asOf: string, withEmail: boolean): string {
  const out: string[] = [];
  const w = (...cells: unknown[]) => out.push(cells.map(csvCell).join(','));
  const owned = withOwnership(register.holders);
  w('Cap table, as recorded', `As of ${asOf}`);
  w('');
  w('Holders');
  w('Holder', ...(withEmail ? ['Email'] : []), 'Security type', 'Shares', 'Ownership %', 'Source');
  for (const h of owned.holders) {
    w(h.name, ...(withEmail ? [h.email] : []), h.security_type, h.shares, pctText(h.ownership_pct), sourceWord(h.source));
  }
  w('Total shares', ...(withEmail ? [''] : []), '', owned.total_shares);
  w('');
  w('Securities');
  w('Security', 'Class', 'Authorized', 'Issued', 'Source');
  for (const s of register.securities) w(s.name, s.share_class, num(s.shares_authorized), num(s.shares_issued), sourceWord(s.source));
  return out.join('\r\n') + '\r\n';
}

const NOT_RECORDED = 'Not recorded';
const fmtShares = (v: number | null) => (v == null ? NOT_RECORDED : Math.round(v).toLocaleString('en-US'));
const fmtPct = (v: number | null) => (v == null ? NOT_RECORDED : `${v.toFixed(2)}%`);

/**
 * The PDF snapshot: the venture's name, "As of [date]", the holders with their
 * share of the recorded total, and the securities. Letter size, Helvetica, the
 * text made WinAnsi-safe. No email reaches the paper.
 */
export async function snapshotPdf(ventureName: string, asOf: string, register: { holders: HolderRow[]; securities: SecurityRow[] }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612; const H = 792; const M = 54;
  const ink = rgb(0.1, 0.1, 0.15); const muted = rgb(0.4, 0.4, 0.45);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const line = (cells: Array<[string, number]>, f: PDFFont, size = 10, color = ink) => {
    if (y < M + 24) { page = doc.addPage([W, H]); y = H - M; }
    for (const [text, x] of cells) page.drawText(winAnsiSafe(text).slice(0, 60), { x, y, size, font: f, color });
    y -= size + 6;
  };
  const owned = withOwnership(register.holders);
  line([[`Cap table, as recorded: ${ventureName}`, M]], bold, 16);
  line([[`As of ${asOf}`, M]], font, 11, muted);
  y -= 8;
  line([['Holders', M]], bold, 12);
  line([['Holder', M], ['Security type', 260], ['Shares', 380], ['Ownership', 470]], bold, 9, muted);
  if (!owned.holders.length) line([['No holder is recorded.', M]], font, 10, muted);
  for (const h of owned.holders) {
    line([[h.name, M], [h.security_type || NOT_RECORDED, 260], [fmtShares(h.shares), 380], [fmtPct(h.ownership_pct), 470]], font, 10);
  }
  line([['Total shares', M], [fmtShares(owned.total_shares), 380]], bold, 10);
  y -= 8;
  line([['Securities', M]], bold, 12);
  line([['Security', M], ['Class', 260], ['Authorized', 380], ['Issued', 470]], bold, 9, muted);
  if (!register.securities.length) line([['No security is recorded.', M]], font, 10, muted);
  for (const s of register.securities) {
    line([[s.name, M], [s.share_class || NOT_RECORDED, 260], [fmtShares(num(s.shares_authorized)), 380], [fmtShares(num(s.shares_issued)), 470]], font, 10);
  }
  y -= 12;
  line([['A snapshot of the recorded cap table. It is not a 409A valuation and models nothing.', M]], font, 8, muted);
  return doc.save();
}

/**
 * The audit row an export writes (D1020 §5). It is not best-effort: the caller
 * runs it before answering, and a failure refuses the export.
 */
export function auditStatement(env: Env, actor: { id: number }, actorHash: string, projectId: number | null, action: string, details: Record<string, unknown>) {
  return env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)')
    .bind(projectId, actor.id, action, JSON.stringify(details), actorHash);
}

export async function actorHash(user: { email?: string | null }): Promise<string> {
  return hashEmail(String(user.email || ''));
}
