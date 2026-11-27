/**
 * D4812 (#4812) — `GET /api/fund-admin/activity`, the Overview's Recent
 * activity (board FA-01, marked "backend required" on the canvas).
 *
 * IT READS ONE STORE: the `admin_audit_log` rows `auditFundAct` writes after
 * each fund act an HQ admin takes (`fund_admin.<act key>`, D714 decision 4).
 * No new table. An act a non-admin GP of record takes on their own fund is not
 * written there, so it is not listed; the panel says so.
 *
 * ONLY THINGS THAT HAPPENED. Reads and previews are logged as acts too
 * (`fund_booklet.read`, `capital_call.preview`, `distribution.preview`,
 * `fund_notice.preview`); they changed nothing, so they are left out.
 *
 * NEVER THE RAW DETAILS. A row's `filters_json` can hold a reason, a route or
 * a booklet uid. Only the fund, an amount in cents, a call number and an LP
 * reach the response, each checked for type; the LP and the actor are named
 * by `name`, never by email.
 *
 * `?fund=<id>` keeps one fund's rows; `?before=<id>` pages back. Both are
 * digits or the route refuses them; both are bound, never interpolated.
 */
import type { Env } from '../types';
import { FUND_ACTS, type FundActKey } from './fundAdminAccess';

/** Acts that read or preview: logged, but nothing changed. */
export const NOT_ACTIVITY: readonly FundActKey[] = Object.freeze([
  'fund_booklet.read', 'capital_call.preview', 'distribution.preview', 'fund_notice.preview',
]);

export const ACTIVITY_PAGE = 25;
const ACTIVITY_MAX = 100;

export type ActivityQuery = { fund: number | null; before: number | null; limit: number };

/** The query from the address, or the name of the parameter that is not valid. */
export function parseActivityQuery(get: (k: string) => string | undefined): ActivityQuery | string {
  const id = (k: string): number | null | string => {
    const raw = get(k);
    if (raw == null || raw === '') return null;
    return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : k;
  };
  const fund = id('fund');
  if (typeof fund === 'string') return fund;
  const before = id('before');
  if (typeof before === 'string') return before;
  const rawLimit = get('limit');
  let limit = ACTIVITY_PAGE;
  if (rawLimit != null && rawLimit !== '') {
    if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > ACTIVITY_MAX) return 'limit';
    limit = Number(rawLimit);
  }
  return { fund, before, limit };
}

export type ActivityItem = {
  id: number;
  at: string;
  act: FundActKey | string;
  label: string;
  fund_id: number | null;
  fund_name: string | null;
  lp_name: string | null;
  call_number: number | null;
  amount_cents: number | null;
  actor_name: string | null;
};

const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const posIdOrNull = (v: unknown): number | null => { const n = intOrNull(v); return n != null && n > 0 ? n : null; };

function parse(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string') return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** An act's words: the act table's label, or the key itself for a row the table no longer holds. */
export function actLabel(act: string): string {
  return FUND_ACTS.find((a) => a.act === act)?.label ?? act;
}

/**
 * The page of activity, newest first, plus `next_before` when an older page
 * exists. Throws when the store cannot be read; the route answers 503.
 */
export async function fundAdminActivity(env: Env, q: ActivityQuery): Promise<{ items: ActivityItem[]; next_before: number | null }> {
  const hidden = NOT_ACTIVITY.map((k) => `fund_admin.${k}`);
  const res = await env.DB.prepare(
    `SELECT a.id, a.action, a.filters_json, a.exported_at, u.name AS actor_name
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE a.action LIKE 'fund_admin.%'
        AND a.action NOT IN (SELECT value FROM json_each(?))
        AND (? IS NULL OR json_extract(a.filters_json, '$.fund_id') = ?)
        AND (? IS NULL OR a.id < ?)
      ORDER BY a.id DESC
      LIMIT ?`,
  ).bind(JSON.stringify(hidden), q.fund, q.fund, q.before, q.before, q.limit + 1).all<any>();
  if (res && (res as any).success === false) throw new Error('read failed');
  const raw = (res?.results || []) as any[];
  const page = raw.slice(0, q.limit);

  const details = page.map((r) => parse(r.filters_json));
  const fundIds = [...new Set(details.map((d) => posIdOrNull(d.fund_id)).filter((n): n is number => n != null))];
  const lpIds = [...new Set(details.map((d) => posIdOrNull(d.lp_id) ?? posIdOrNull(d.limited_partner_id)).filter((n): n is number => n != null))];
  const lineIds = [...new Set(details.map((d) => posIdOrNull(d.line_id)).filter((n): n is number => n != null))];

  const named = async (sql: string, ids: number[]) => {
    if (ids.length === 0) return new Map<number, string>();
    const out = await env.DB.prepare(sql).bind(JSON.stringify(ids)).all<{ id: number; name: string | null }>();
    return new Map(((out?.results || []) as any[]).map((r) => [Number(r.id), r.name ?? null]));
  };
  const fundNames = await named(`SELECT id, name FROM vc_funds WHERE id IN (SELECT value FROM json_each(?))`, fundIds);
  const lpNames = await named(`SELECT id, name FROM limited_partners WHERE id IN (SELECT value FROM json_each(?))`, lpIds);
  // A receipt names its call line; the line names the LP.
  const lineLps = await named(
    `SELECT cc.id, lp.name FROM capital_calls cc JOIN limited_partners lp ON lp.id = cc.limited_partner_id
      WHERE cc.id IN (SELECT value FROM json_each(?))`, lineIds);

  const items = page.map((r, i): ActivityItem => {
    const d = details[i];
    const act = String(r.action).slice('fund_admin.'.length);
    const fundId = posIdOrNull(d.fund_id);
    const lpId = posIdOrNull(d.lp_id) ?? posIdOrNull(d.limited_partner_id);
    const lineId = posIdOrNull(d.line_id);
    return {
      id: Number(r.id),
      at: String(r.exported_at),
      act,
      label: actLabel(act),
      fund_id: fundId,
      fund_name: fundId != null ? fundNames.get(fundId) ?? null : null,
      lp_name: (lpId != null ? lpNames.get(lpId) : null) ?? (lineId != null ? lineLps.get(lineId) : null) ?? null,
      call_number: posIdOrNull(d.call_number),
      amount_cents: intOrNull(d.amount_cents) ?? intOrNull(d.proceeds_cents) ?? intOrNull(d.value_cents),
      actor_name: r.actor_name ?? null,
    };
  });
  return { items, next_before: raw.length > q.limit ? items[items.length - 1].id : null };
}
