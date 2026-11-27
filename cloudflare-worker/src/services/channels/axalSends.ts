/**
 * D855 §5 question 4 (#3733 part 3) — Axal's own WhatsApp number's sends this
 * month, against Meta's 1,000 free service messages.
 *
 * From 2026-10-01, service messages are free only up to 1,000 per business
 * number per month (D855 §3.8). Axal's own number (`WHATSAPP_AXAL_*`, D754 way
 * B) sends only replies inside the window the member just opened: the link's
 * two answers, STOP's answer, and the capture's question and answers. Each one
 * goes through the outbound ledger (`channel_outbound`) under a client key with
 * one of `AXAL_NUMBER_KEY_PREFIXES`, so this count needs no new table.
 *
 * WHAT IS COUNTED. A send Meta accepted (`submitted`, `delivered`, `read`) or
 * may have accepted (`pending`, a lost answer) is counted: Meta bills what it
 * accepted, and a lost answer may have been. A `failed` send is not. The
 * month is the calendar month in UTC, as the ledger's `created_at` is UTC.
 *
 * WHAT IT DOES. It reads; it never stops a send. A Super Admin reads it at
 * `GET /api/admin/channels/whatsapp/axal-sends` before anything new is sent on
 * Axal's number. Counts only: no number, no member, no text.
 */
import type { Env } from '../../types';

/** Meta's free service messages per business number per month, from 2026-10-01 (D855 §3.8). */
export const AXAL_FREE_SERVICE_MESSAGES = 1000;

/**
 * The client-key prefixes of every send from Axal's own number
 * (`routes/channels.ts` `axalReply` and `axalAsk`). A send from a member's own
 * number never uses one.
 */
export const AXAL_NUMBER_KEY_PREFIXES = Object.freeze(['wblink:', 'wbstop:', 'wbcapture:', 'wbcapture-', 'wbunsupported:'] as const);

export const isAxalNumberKey = (key: string) => AXAL_NUMBER_KEY_PREFIXES.some((p) => key.startsWith(p));

/** The calendar month in UTC holding `now`, as the ledger's `datetime('now')` text. */
export function monthWindow(now: Date): { month: string; from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const text = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00`;
  return { month: `${y}-${pad(m + 1)}`, from: text(start), to: text(end) };
}

export type AllowanceState = 'within' | 'used_up' | 'over';

export interface AxalSends {
  month: string;
  sent: number;
  free: number;
  /** Free service messages left this month; 0 once used up. */
  remaining: number;
  /** `within` below 1,000; `used_up` at exactly 1,000 (the next send is paid); `over` past it. */
  state: AllowanceState;
}

/** The month's count against the free allowance. */
export function allowanceOf(month: string, sent: number): AxalSends {
  const n = Math.max(0, Math.trunc(sent));
  const state: AllowanceState = n < AXAL_FREE_SERVICE_MESSAGES ? 'within' : n === AXAL_FREE_SERVICE_MESSAGES ? 'used_up' : 'over';
  return { month, sent: n, free: AXAL_FREE_SERVICE_MESSAGES, remaining: Math.max(0, AXAL_FREE_SERVICE_MESSAGES - n), state };
}

/** This month's sends from Axal's own number, counted from the outbound ledger. */
export async function readAxalSends(env: Env, now: Date = new Date()): Promise<AxalSends> {
  const w = monthWindow(now);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM channel_outbound
      WHERE provider = 'whatsapp' AND status != 'failed' AND created_at >= ? AND created_at < ?
        AND (client_key LIKE 'wblink:%' OR client_key LIKE 'wbstop:%' OR client_key LIKE 'wbcapture:%' OR client_key LIKE 'wbcapture-%' OR client_key LIKE 'wbunsupported:%')`,
  ).bind(w.from, w.to).first<{ n: number }>();
  return allowanceOf(w.month, Number(row?.n ?? 0));
}
