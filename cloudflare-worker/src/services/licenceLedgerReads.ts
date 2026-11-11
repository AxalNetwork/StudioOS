/**
 * Bounded reads of HQ's licence ledger and of one licence's open requests
 * (#4700, Licences audit 5/7).
 *
 * WHY THIS FILE. The console used to read the whole ledger, hydrate every row
 * with one bind per licence (D1 refuses more than 100), and filter the
 * escalation board in the browser out of a list capped at 100 per kind. Three
 * things followed: the 101st licence broke the page, a branch-origin request
 * never matched because the panel had no deployment code, and a licence's
 * request past the board's cap vanished while the panel said "No open
 * requests". Everything here answers on the server, before the page is cut:
 *
 *   - `idChunks`        ids in statements of at most `ID_CHUNK` binds
 *   - `pageLicences`    one page of the ledger: search, kind, status, a keyset
 *                       cursor and the total that matched
 *   - `ledgerSummary`   coverage, renewals and counts over the WHOLE ledger,
 *                       kept apart from the page so its totals never depend on
 *                       which page is open
 *   - `licenceRequests` one licence's open requests, HQ-origin and
 *                       branch-origin, scoped before the page and counted
 *
 * Every statement is literal SQL with its values bound. No `${…}` reaches a
 * query here (`scripts/check-sql-prepare.mjs`).
 */
import type { Env } from '../types';
import { escalationSlaBand, HQ_TIER_CODE, type EscalationRow } from '../rpc/hqOps';
import { withRequestView } from './escalationRequests';

/** Ids per `IN (…)` statement. Under D1's 100-parameter ceiling with room to spare. */
export const ID_CHUNK = 90;

/** `ids` as statements' worth: each part and its `?,?,…` placeholder string. */
export function idChunks(ids: number[]): Array<{ part: number[]; placeholders: string }> {
  const out: Array<{ part: number[]; placeholders: string }> = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    out.push({ part, placeholders: part.map(() => '?').join(',') });
  }
  return out;
}

export const LEDGER_PAGE_DEFAULT = 50;
export const LEDGER_PAGE_MAX = 100;
export const REQUESTS_PAGE_DEFAULT = 25;
export const REQUESTS_PAGE_MAX = 100;
export const RENEWALS_SHOWN = 50;

/** The request kinds HQ's licence page answers (D801), the panel's own list. */
export const LICENCE_PANEL_KINDS = ['renewal', 'terms_change', 'seat_increase', 'delegate', 'non_renewal'] as const;

const KINDS = ['subsidiary', 'white_label'];
const STATUSES = ['draft', 'pending_activation', 'active', 'suspended', 'terminated'];

export function clampLimit(raw: unknown, dflt: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return dflt;
  return Math.min(max, n);
}

/** base64url(JSON) — opaque to the client, checked on the way back in. */
function encodeCursor(v: unknown[]): string {
  return btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(raw: unknown): unknown[] | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** A bad filter or cursor. `sentence` is ours, written for the console, never a driver's text. */
export class LedgerReadRefusal extends Error {
  code: string;
  sentence: string;
  constructor(code: string, sentence: string) { super(sentence); this.code = code; this.sentence = sentence; }
}

/** `%`, `_` and `\` are LIKE's own; a search for "AXL_1" means the underscore. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type LedgerFilter = { q?: string; kind?: string; status?: string; limit?: unknown; cursor?: unknown };

/**
 * One page of the ledger, in the console's order: active, suspended, pending,
 * draft, then terminated, by reference, then id. The cursor is that triple, so
 * a licence created while someone pages lands in exactly one page.
 */
export async function pageLicences(env: Env, f: LedgerFilter): Promise<{
  rows: Array<Record<string, any>>; total: number; next_cursor: string | null; limit: number;
}> {
  const q = String(f.q ?? '').trim().slice(0, 80);
  const kind = String(f.kind ?? '').trim().toLowerCase();
  const status = String(f.status ?? '').trim().toLowerCase();
  if (kind && !KINDS.includes(kind)) throw new LedgerReadRefusal('bad_kind', `kind must be one of ${KINDS.join(', ')}.`);
  if (status && !STATUSES.includes(status)) throw new LedgerReadRefusal('bad_status', `status must be one of ${STATUSES.join(', ')}.`);
  const limit = clampLimit(f.limit, LEDGER_PAGE_DEFAULT, LEDGER_PAGE_MAX);
  let after: [number, string, number] | null = null;
  if (f.cursor !== undefined && f.cursor !== null && String(f.cursor) !== '') {
    const c = decodeCursor(f.cursor);
    if (!c || c.length !== 3 || !Number.isInteger(c[0]) || typeof c[1] !== 'string' || !Number.isInteger(c[2])) {
      throw new LedgerReadRefusal('bad_cursor', 'The cursor is not one this ledger issued. Start from the first page.');
    }
    after = [c[0] as number, c[1] as string, c[2] as number];
  }
  const like = q ? likePattern(q) : '';
  const country = q.toUpperCase();

  const filterBinds = [kind, kind, status, status, q, like, like, like, country];
  const rows = await env.DB.prepare(
    `SELECT * FROM (
       SELECT tl.*,
              CASE tl.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1
                             WHEN 'pending_activation' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END AS status_rank
         FROM territory_licences tl
        WHERE (? = '' OR tl.kind = ?)
          AND (? = '' OR tl.status = ?)
          AND (? = ''
               OR tl.licence_ref LIKE ? ESCAPE '\\'
               OR tl.brand_name LIKE ? ESCAPE '\\'
               OR tl.legal_entity_name LIKE ? ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM licence_territories lt
                           WHERE lt.licence_id = tl.id AND lt.country_code = ?))
     )
     WHERE (? IS NULL
            OR status_rank > ?
            OR (status_rank = ? AND (licence_ref > ? OR (licence_ref = ? AND id > ?))))
     ORDER BY status_rank, licence_ref, id
     LIMIT ?`,
  ).bind(
    ...filterBinds,
    after ? after[0] : null, after ? after[0] : null, after ? after[0] : null,
    after ? after[1] : null, after ? after[1] : null, after ? after[2] : null,
    limit + 1,
  ).all<Record<string, any>>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM territory_licences tl
      WHERE (? = '' OR tl.kind = ?)
        AND (? = '' OR tl.status = ?)
        AND (? = ''
             OR tl.licence_ref LIKE ? ESCAPE '\\'
             OR tl.brand_name LIKE ? ESCAPE '\\'
             OR tl.legal_entity_name LIKE ? ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM licence_territories lt
                         WHERE lt.licence_id = tl.id AND lt.country_code = ?))`,
  ).bind(...filterBinds).first<{ n: number }>();

  const got = rows.results || [];
  const more = got.length > limit;
  const page = more ? got.slice(0, limit) : got;
  const last = page[page.length - 1];
  return {
    rows: page.map(({ status_rank: _r, ...rest }) => rest),
    total: Number(total?.n ?? 0),
    next_cursor: more && last ? encodeCursor([Number(last.status_rank), String(last.licence_ref), Number(last.id)]) : null,
    limit,
  };
}

/**
 * What the coverage grid, the renewal pipeline and the header counts need,
 * over every licence — never the page's slice of it.
 *
 * COVERAGE IS ALREADY BOUNDED: `licence_territories.country_code` is unique,
 * so the join returns at most one row per country however large the ledger
 * grows. The renewal pipeline is not, so it is cut at `RENEWALS_SHOWN`
 * soonest and says so with its own total.
 */
export async function ledgerSummary(env: Env): Promise<{
  coverage: Array<{ uid: string; licence_ref: string; brand_name: string; status: string; territories: string[] }>;
  renewals: { items: Array<Record<string, unknown>>; total: number; complete: boolean };
  counts: { total: number; by_status: Record<string, number>; by_kind: Record<string, number> };
}> {
  const held = await env.DB.prepare(
    `SELECT l.uid, l.licence_ref, l.brand_name, l.status, lt.country_code
       FROM licence_territories lt
       JOIN territory_licences l ON l.id = lt.licence_id
      WHERE l.status <> 'terminated'
      ORDER BY l.licence_ref, l.id, lt.country_code`,
  ).all<{ uid: string; licence_ref: string; brand_name: string; status: string; country_code: string }>();
  const byUid = new Map<string, { uid: string; licence_ref: string; brand_name: string; status: string; territories: string[] }>();
  for (const r of held.results || []) {
    if (!byUid.has(r.uid)) byUid.set(r.uid, { uid: r.uid, licence_ref: r.licence_ref, brand_name: r.brand_name, status: r.status, territories: [] });
    byUid.get(r.uid)!.territories.push(r.country_code);
  }

  const renewRows = await env.DB.prepare(
    `SELECT uid, licence_ref, brand_name, status, renews_on, annual_fee_cents, currency
       FROM territory_licences
      WHERE renews_on IS NOT NULL AND status <> 'terminated'
      ORDER BY renews_on, licence_ref, id
      LIMIT ?`,
  ).bind(RENEWALS_SHOWN).all<Record<string, unknown>>();
  const renewTotal = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM territory_licences WHERE renews_on IS NOT NULL AND status <> 'terminated'`,
  ).first<{ n: number }>();

  const grouped = await env.DB.prepare(
    `SELECT status, kind, COUNT(*) AS n FROM territory_licences GROUP BY status, kind`,
  ).all<{ status: string; kind: string | null; n: number }>();
  const by_status: Record<string, number> = {};
  const by_kind: Record<string, number> = {};
  let total = 0;
  for (const g of grouped.results || []) {
    const n = Number(g.n) || 0;
    total += n;
    by_status[g.status] = (by_status[g.status] || 0) + n;
    const k = g.kind || 'subsidiary';
    by_kind[k] = (by_kind[k] || 0) + n;
  }

  const items = renewRows.results || [];
  const renewN = Number(renewTotal?.n ?? 0);
  return {
    coverage: [...byUid.values()],
    renewals: { items, total: renewN, complete: items.length >= renewN },
    counts: { total, by_status, by_kind },
  };
}

export type LicenceRequestsPage = {
  available: true;
  items: Array<Record<string, unknown>>;
  total: number;
  next_cursor: string | null;
  limit: number;
  /** The deployment code a branch-origin request carries; null when the licence has no deployment. */
  branch_code: string | null;
  /** False when the deployment register could not be read: branch-origin requests were not looked for. */
  branch_readable: boolean;
};

/**
 * One licence's open requests: those filed against it on HQ's tier
 * (`subject_ref` is its uid) and those its deployed branch raised (`branch_code`
 * is its deployment's code). Scoped in SQL, then counted, then paged, so a
 * licence's request is found however many other requests are open.
 */
export async function licenceRequests(
  env: Env, licenceUid: string, opts: { limit?: unknown; cursor?: unknown } = {},
): Promise<LicenceRequestsPage> {
  const limit = clampLimit(opts.limit, REQUESTS_PAGE_DEFAULT, REQUESTS_PAGE_MAX);
  let after: [string, string] | null = null;
  if (opts.cursor !== undefined && opts.cursor !== null && String(opts.cursor) !== '') {
    const c = decodeCursor(opts.cursor);
    if (!c || c.length !== 2 || typeof c[0] !== 'string' || typeof c[1] !== 'string') {
      throw new LedgerReadRefusal('bad_cursor', 'The cursor is not one this list issued. Start from the first page.');
    }
    after = [c[0], c[1]];
  }

  // The branch's code, from the deployment register. Its own try: a database
  // without migration 258 has no register, and "this licence has no branch"
  // is a different claim from "we could not look" — the panel says which.
  let branchCode: string | null = null;
  let branchReadable = true;
  try {
    const d = await env.DB.prepare('SELECT code FROM licence_deployments WHERE licence_uid = ?')
      .bind(licenceUid).first<{ code: string }>();
    branchCode = d?.code ? String(d.code) : null;
  } catch (e) {
    console.warn('[licences] licence_deployments unreadable', (e as Error).message);
    branchReadable = false;
  }
  // `hq` is HQ's own tier (D799), never a deployment's code; a register row
  // claiming it must not pull HQ's whole tier into one licence's panel.
  const code = branchCode && branchCode !== HQ_TIER_CODE ? branchCode : '';

  const scopeBinds = [licenceUid, code, code, HQ_TIER_CODE];
  const rows = await env.DB.prepare(
    `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
            status, due_at, created_at, answer, answered_at, relation
       FROM hq_escalations
      WHERE status = 'open'
        AND kind IN ('renewal', 'terms_change', 'seat_increase', 'delegate', 'non_renewal')
        AND (subject_ref = ? OR (? <> '' AND branch_code = ? AND branch_code <> ?))
        AND (? IS NULL OR created_at > ? OR (created_at = ? AND uid > ?))
      ORDER BY created_at ASC, uid ASC
      LIMIT ?`,
  ).bind(
    ...scopeBinds,
    after ? after[0] : null, after ? after[0] : null, after ? after[0] : null, after ? after[1] : null,
    limit + 1,
  ).all<EscalationRow>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM hq_escalations
      WHERE status = 'open'
        AND kind IN ('renewal', 'terms_change', 'seat_increase', 'delegate', 'non_renewal')
        AND (subject_ref = ? OR (? <> '' AND branch_code = ? AND branch_code <> ?))`,
  ).bind(...scopeBinds).first<{ n: number }>();

  const got = rows.results || [];
  const more = got.length > limit;
  const page = more ? got.slice(0, limit) : got;
  const last = page[page.length - 1];
  const now = Date.now();
  return {
    available: true,
    items: page.map((r) => withRequestView({ ...r, sla: escalationSlaBand(r, now) })),
    total: Number(total?.n ?? 0),
    next_cursor: more && last ? encodeCursor([String(last.created_at), String(last.uid)]) : null,
    limit,
    branch_code: branchCode,
    branch_readable: branchReadable,
  };
}
