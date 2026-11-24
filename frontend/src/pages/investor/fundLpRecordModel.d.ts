/** Types for `fundLpRecordModel.js` (D6236, D6242), so the Worker's typecheck can import the drawer's formatting. */
export function lpCommitmentDollars(lp: any): number | null;
export function lpPaidDollars(lp: any): number | null;
export function registerMoney(value: unknown): string;
export function lpFigures(lp: any, totalCommitted: number | null): { commitment: string; share: string; paid: string };
export const LP_SUMMARY_WAIT: string;
export const LP_SUMMARY_UNREAD: string;
export const LP_SUMMARY_NOTHING: string;
export function lpSummaryBlocked(lp: any, ledger: any, comms: any): string | null;
export function lpParam(raw: unknown): number | null;
export function moneyText(cents: unknown): string;
export function kycOf(lp: any): { label: string; tone: string; source: string };
export function lpaOf(lp: any): { label: string; tone: string };
export interface RecordCallLine {
  id: number; call: string; due: string | null; owed: number | null; received: number | null;
  outstanding: number | null; state: string; receipts: any[];
}
export function callLines(entries: unknown): { lines: RecordCallLine[]; loose: any[] };
export function calledToDate(lines: RecordCallLine[], truncated?: boolean): number | null;
export function statementOf(report: any): any;
export function dollarsText(v: unknown): string;
export function distributionRow(d: any): any;
export function commBody(lpId: number, form: any): { body?: any; error?: string };
