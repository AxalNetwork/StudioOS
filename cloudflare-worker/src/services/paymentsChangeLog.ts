/**
 * D1011 (#2830, part 3 of Payments #2386) — the Payments change log, PAY7.
 *
 * ONE READER FOR BOTH WRITERS. The catalogue's writes (`routes/catalog.ts`,
 * its own `writeAdminAudit`) and the Stripe settings' writes
 * (`routes/admin_stripe.ts`, through `logAdminAction`) both land in
 * `admin_audit_log`, each under its own action name. This file is the one
 * place that names those actions, sorts them into what changed, and reads
 * them back. Nothing new is written for a change: the rows already exist.
 *
 * WHAT A ROW SAYS. Its time, what changed (`what`), the action, who did it
 * (the account's id and name, never an email), and the product and price it
 * names. A price row that names only its price is matched to its product
 * through the catalogue mirror, so filtering by a product finds its prices'
 * changes too. A price the mirror no longer holds keeps its row; it just does
 * not match a product filter.
 *
 * A READ CREATES NOTHING (D204's rule for GETs). A database that has no audit
 * table, or does not answer, is a 5xx with a sentence, never an empty log.
 *
 * MONEY. A row's details are returned as they were written. Amounts stay in
 * the currency's smallest unit, and nothing here adds one row's amount to
 * another's.
 */
import type { Env } from '../types';

/** What a change was to. The page's "What" filter is these keys. */
export const CHANGE_KINDS = ['product', 'price', 'sync', 'token_pack', 'webhook', 'key'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * Every action the two writers record, and what it was to. An action missing
 * here never reaches the log, so a test reads both files and holds this list
 * equal to the actions they write.
 */
export const CHANGE_ACTIONS: Readonly<Record<string, ChangeKind>> = {
  // routes/catalog.ts
  catalog_sync: 'sync',
  catalog_sync_failed: 'sync',
  catalog_product_create: 'product',
  catalog_product_update: 'product',
  catalog_product_archive: 'product',
  catalog_price_create: 'price',
  catalog_price_update: 'price',
  catalog_price_archive: 'price',
  token_pack_create: 'token_pack',
  token_pack_adopt: 'token_pack',
  token_pack_update: 'token_pack',
  token_pack_archive: 'token_pack',
  // routes/admin_stripe.ts
  stripe_webhook_register: 'webhook',
  stripe_webhook_update: 'webhook',
  stripe_pk_update: 'key',
};

/** The action an export of this log is recorded under. Not a change, so not in the log. */
export const CHANGE_LOG_EXPORT_ACTION = 'payments_change_log_export';

/** A page holds this many rows by default, and never more than the max. */
export const CHANGE_LOG_PAGE = 50;
export const CHANGE_LOG_PAGE_MAX = 200;
/** An export holds at most this many rows, and says when it stopped there. */
export const CHANGE_LOG_EXPORT_MAX = 5000;
/** An export's reason: at least this many characters, and at most the max. */
export const EXPORT_REASON_MIN = 10;
export const EXPORT_REASON_MAX = 500;

export type ChangeLogFilters = {
  what?: ChangeKind;
  who?: number;
  product?: string;
  /** `YYYY-MM-DD`, inclusive, UTC. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive, UTC. */
  to?: string;
};

export type ChangeLogEntry = {
  id: number;
  at: string;
  what: ChangeKind;
  action: string;
  who: { id: number; name: string | null };
  product_id: string | null;
  price_id: string | null;
  details: Record<string, unknown> | null;
};

/** A filter the caller sent that cannot be read: its code and our sentence. The route answers 400 with it. */
export type FilterRefusal = { error: string; message: string };

export type ParsedFilters = { ok: true; filters: ChangeLogFilters } | { ok: false; refusal: FilterRefusal };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRODUCT_ID = /^prod_[A-Za-z0-9]+$/;

/** A day as `YYYY-MM-DD`, or false. The round trip refuses a day the calendar does not have (2026-02-30). */
function isDay(v: string): boolean {
  const t = Date.parse(`${v}T00:00:00Z`);
  return DAY.test(v) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** The filters from a query string, or the refusal naming the one that is wrong. */
export function parseChangeLogFilters(q: (name: string) => string | undefined): ParsedFilters {
  const no = (error: string, message: string): ParsedFilters => ({ ok: false, refusal: { error, message } });
  const out: ChangeLogFilters = {};
  const what = q('what');
  if (what) {
    if (!(CHANGE_KINDS as readonly string[]).includes(what)) return no('invalid_what', `"what" is one of ${CHANGE_KINDS.join(', ')}.`);
    out.what = what as ChangeKind;
  }
  const who = q('who');
  if (who) {
    const n = Number(who);
    if (!Number.isSafeInteger(n) || n < 1) return no('invalid_who', '"who" is an account id.');
    out.who = n;
  }
  const product = q('product');
  if (product) {
    if (!PRODUCT_ID.test(product)) return no('invalid_product', '"product" is a Stripe product id (prod_…).');
    out.product = product;
  }
  for (const name of ['from', 'to'] as const) {
    const v = q(name);
    if (!v) continue;
    if (!isDay(v)) return no(`invalid_${name}`, `"${name}" is a date written YYYY-MM-DD.`);
    out[name] = v;
  }
  if (out.from && out.to && out.to < out.from) return no('invalid_dates', '"to" is on or after "from".');
  return { ok: true, filters: out };
}

/** The actions a `what` filter keeps: every change action, or one kind's. */
export function actionsFor(what?: ChangeKind): string[] {
  return Object.entries(CHANGE_ACTIONS).filter(([, k]) => !what || k === what).map(([a]) => a);
}

/**
 * The filters as bindings, one per numbered parameter of the queries below.
 * An unset filter binds null, and `(?n IS NULL OR …)` lets every row through
 * it, so the SQL is one fixed text whatever is chosen.
 */
function binds(f: ChangeLogFilters): unknown[] {
  return [JSON.stringify(actionsFor(f.what)), f.who ?? null, f.product ?? null, f.from ?? null, f.to ?? null];
}

type Row = {
  id: number; exported_at: string; action: string; admin_user_id: number;
  name: string | null; filters_json: string | null; price_product: string | null;
};

function details(json: string | null): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function entryOf(r: Row): ChangeLogEntry {
  const d = details(r.filters_json);
  return {
    id: Number(r.id),
    at: String(r.exported_at),
    what: CHANGE_ACTIONS[r.action],
    action: r.action,
    who: { id: Number(r.admin_user_id), name: r.name ?? null },
    product_id: str(d?.product_id) ?? r.price_product ?? null,
    price_id: str(d?.price_id),
    details: d,
  };
}

// One text for the page and the export. A product filter keeps a row that
// names the product, or names a price the mirror files under it.
// `exported_at` is written by datetime('now'); datetime() on both sides.
const ROWS_SQL = `SELECT a.id, a.exported_at, a.action, a.admin_user_id, u.name, a.filters_json,
         (SELECT s.id FROM stripe_products s, json_each(s.prices_json) p
           WHERE json_extract(p.value, '$.id') = json_extract(a.filters_json, '$.price_id') LIMIT 1) AS price_product
    FROM admin_audit_log a
    LEFT JOIN users u ON u.id = a.admin_user_id
   WHERE a.action IN (SELECT value FROM json_each(?1))
     AND (?2 IS NULL OR a.admin_user_id = ?2)
     AND (?3 IS NULL OR json_extract(a.filters_json, '$.product_id') = ?3
          OR json_extract(a.filters_json, '$.price_id') IN (
               SELECT json_extract(p.value, '$.id') FROM stripe_products s, json_each(s.prices_json) p WHERE s.id = ?3))
     AND (?4 IS NULL OR datetime(a.exported_at) >= datetime(?4))
     AND (?5 IS NULL OR datetime(a.exported_at) < datetime(?5, '+1 day'))
   ORDER BY a.id DESC
   LIMIT ?6 OFFSET ?7`;

const COUNT_SQL = `SELECT COUNT(*) AS n FROM admin_audit_log a
   WHERE a.action IN (SELECT value FROM json_each(?1))
     AND (?2 IS NULL OR a.admin_user_id = ?2)
     AND (?3 IS NULL OR json_extract(a.filters_json, '$.product_id') = ?3
          OR json_extract(a.filters_json, '$.price_id') IN (
               SELECT json_extract(p.value, '$.id') FROM stripe_products s, json_each(s.prices_json) p WHERE s.id = ?3))
     AND (?4 IS NULL OR datetime(a.exported_at) >= datetime(?4))
     AND (?5 IS NULL OR datetime(a.exported_at) < datetime(?5, '+1 day'))`;

/** One page of the log, newest first, and how many rows the filters match. Throws when the database does not answer. */
export async function readChangeLog(
  env: Env,
  f: ChangeLogFilters,
  page: { limit: number; offset: number },
): Promise<{ entries: ChangeLogEntry[]; total: number }> {
  const rows = (await env.DB.prepare(ROWS_SQL).bind(...binds(f), page.limit, page.offset).all<Row>()).results ?? [];
  const count = await env.DB.prepare(COUNT_SQL).bind(...binds(f)).first<{ n: number }>();
  return { entries: rows.map(entryOf), total: Number(count?.n ?? 0) };
}

/** Every matching row up to the export cap, newest first, and whether it stopped at the cap. */
export async function readChangeLogForExport(
  env: Env,
  f: ChangeLogFilters,
): Promise<{ entries: ChangeLogEntry[]; capped: boolean }> {
  const rows = (await env.DB.prepare(ROWS_SQL).bind(...binds(f), CHANGE_LOG_EXPORT_MAX + 1, 0).all<Row>()).results ?? [];
  const capped = rows.length > CHANGE_LOG_EXPORT_MAX;
  return { entries: rows.slice(0, CHANGE_LOG_EXPORT_MAX).map(entryOf), capped };
}

export const CHANGE_LOG_CSV_HEADER = ['at', 'what', 'action', 'who_id', 'who_name', 'product_id', 'price_id', 'details'] as const;

export function changeLogCsvRows(entries: ChangeLogEntry[]): unknown[][] {
  return entries.map((e) => [
    e.at, e.what, e.action, e.who.id, e.who.name, e.product_id, e.price_id,
    e.details ? JSON.stringify(e.details) : null,
  ]);
}
