/**
 * D6685 (#6685) — whether a company or a venture is incorporated, in formation
 * or neither, decided once on the server so no screen works it out.
 *
 *   incorporated      the company's legal record holds an `incorporation_date`
 *                     or a `registration_number`, or a formation order
 *                     (`incorporations`) is `filed`
 *   in_formation      otherwise, an order is `paid`, `packet_processing` or
 *                     `packet_ready`; `formation_order_id` names the latest
 *   not_incorporated  otherwise, both reads answered and hold neither
 *   unreadable        otherwise: a read failed, so "not incorporated" would be
 *                     a guess
 *
 * Positive evidence wins: a recorded identity or a filed order is enough on
 * its own, even when the other read failed. Anything weaker needs both reads.
 * `pending_payment` and `failed` orders count for nothing.
 *
 * The readers below are batched: one statement per table for every row on the
 * page, never one per row. A failed read sets each row it touches to
 * `unreadable` and never fails the endpoint. The registration number is only
 * tested for presence in SQL; its value never leaves the database here.
 */
import type { Env } from '../types';

export type FormationState = 'incorporated' | 'in_formation' | 'not_incorporated' | 'unreadable';
/** The two flat fields each row gains. `formation_order_id` is null unless `in_formation`. */
export type Formation = { formation_state: FormationState; formation_order_id: number | null };
/** One order, as the readers return them: latest first. */
export type OrderFact = { order_id: number; status: string };
export type Read<T> = { ok: true; value: T } | { ok: false };

export const IN_FLIGHT_STATUSES = Object.freeze(['paid', 'packet_processing', 'packet_ready'] as const);
export const FILED_STATUS = 'filed';

/**
 * The one rule. `identity`: does the company's legal record hold an
 * incorporation date or a registration number. `orders`: the formation orders
 * that bear on the row, latest first.
 */
export function formationState(identity: Read<boolean>, orders: Read<OrderFact[]>): Formation {
  if (identity.ok && identity.value) return { formation_state: 'incorporated', formation_order_id: null };
  if (orders.ok && orders.value.some((o) => o.status === FILED_STATUS)) return { formation_state: 'incorporated', formation_order_id: null };
  if (!identity.ok || !orders.ok) return { formation_state: 'unreadable', formation_order_id: null };
  const open = orders.value.find((o) => (IN_FLIGHT_STATUSES as readonly string[]).includes(o.status));
  return open
    ? { formation_state: 'in_formation', formation_order_id: Number(open.order_id) }
    : { formation_state: 'not_incorporated', formation_order_id: null };
}

/** The companies whose legal record names them incorporated. Only ids come back. */
export const COMPANY_IDENTITY_SQL = `SELECT cp.id AS company_id FROM company_profiles cp
  WHERE cp.id IN (SELECT value FROM json_each(?))
    AND (TRIM(COALESCE(cp.incorporation_date, '')) <> '' OR TRIM(COALESCE(cp.registration_number, '')) <> '')`;

/**
 * Orders that bear on a company: linked to it, or placed for it (D6687, `subject_company_id`), or
 * else placed for a venture now in it (`account_companies.ts`'s attribution). Latest first, as its
 * `formation` block orders them.
 */
export const COMPANY_ORDERS_SQL = `SELECT COALESCE(o.company_id, o.subject_company_id, p.company_id) AS company_id, o.id AS order_id, o.status
  FROM incorporations o LEFT JOIN projects p ON p.id = o.project_id
  WHERE o.status IN ('paid', 'packet_processing', 'packet_ready', 'filed')
    AND COALESCE(o.company_id, o.subject_company_id, p.company_id) IN (SELECT value FROM json_each(?))
  ORDER BY COALESCE(o.paid_at, o.created_at) DESC, o.id DESC`;

/**
 * Orders that bear on a venture: its own, at any counted status, and a filed
 * order of the company it sits in. Latest first.
 */
export const PROJECT_ORDERS_SQL = `SELECT o.project_id, COALESCE(o.company_id, o.subject_company_id, p.company_id) AS company_id, o.id AS order_id, o.status
  FROM incorporations o LEFT JOIN projects p ON p.id = o.project_id
  WHERE o.status IN ('paid', 'packet_processing', 'packet_ready', 'filed')
    AND (o.project_id IN (SELECT value FROM json_each(?))
      OR (o.status = 'filed' AND COALESCE(o.company_id, o.subject_company_id, p.company_id) IN (SELECT value FROM json_each(?))))
  ORDER BY COALESCE(o.paid_at, o.created_at) DESC, o.id DESC`;

type Row = Record<string, any>;

async function read(env: Env, what: string, sql: string, binds: unknown[]): Promise<Read<Row[]>> {
  try {
    const r: any = await env.DB.prepare(sql).bind(...binds).all();
    if ((r && 'success' in r && !r.success) || !Array.isArray(r?.results)) throw new Error('rows were not returned');
    return { ok: true, value: r.results };
  } catch (e) {
    console.warn('[formationState] unreadable', what, (e as Error)?.message);
    return { ok: false };
  }
}

const distinct = (ids: number[]) => [...new Set(ids.filter((id) => Number.isFinite(id)))];
const fact = (r: Row): OrderFact => ({ order_id: Number(r.order_id), status: String(r.status) });

/** Every company's formation, in two statements. Ask for an id that was not passed and the answer is `unreadable`. */
export async function companyFormations(env: Env, companyIds: number[]): Promise<(id: number) => Formation> {
  const ids = distinct(companyIds.map(Number));
  if (ids.length === 0) return () => ({ formation_state: 'unreadable', formation_order_id: null });
  const json = JSON.stringify(ids);
  const [identity, orders] = await Promise.all([
    read(env, 'The legal identity', COMPANY_IDENTITY_SQL, [json]),
    read(env, 'The formation orders', COMPANY_ORDERS_SQL, [json]),
  ]);
  const named = identity.ok ? new Set(identity.value.map((r) => Number(r.company_id))) : null;
  const byCompany = new Map<number, OrderFact[]>();
  if (orders.ok) for (const r of orders.value) byCompany.set(Number(r.company_id), [...(byCompany.get(Number(r.company_id)) ?? []), fact(r)]);
  const known = new Set(ids);
  return (id: number) => (known.has(Number(id))
    ? formationState(
      named ? { ok: true, value: named.has(Number(id)) } : { ok: false },
      orders.ok ? { ok: true, value: byCompany.get(Number(id)) ?? [] } : { ok: false },
    )
    : { formation_state: 'unreadable', formation_order_id: null });
}

/**
 * Every venture's formation, in at most two statements: its own orders and its
 * company's filed ones, and its company's legal identity. A venture with no
 * company has no legal record to read, so that read cannot make it unreadable.
 */
export async function projectFormations(env: Env, projects: { id: number; company_id: number | null }[]): Promise<(id: number) => Formation> {
  const ids = distinct(projects.map((p) => Number(p.id)));
  if (ids.length === 0) return () => ({ formation_state: 'unreadable', formation_order_id: null });
  const companyOf = new Map<number, number | null>(projects.map((p) => [Number(p.id), p.company_id == null ? null : Number(p.company_id)]));
  const companyIds = distinct([...companyOf.values()].filter((c): c is number => c != null));
  const [identity, orders] = await Promise.all([
    companyIds.length
      ? read(env, 'The legal identity', COMPANY_IDENTITY_SQL, [JSON.stringify(companyIds)])
      : Promise.resolve<Read<Row[]>>({ ok: true, value: [] }),
    read(env, 'The formation orders', PROJECT_ORDERS_SQL, [JSON.stringify(ids), JSON.stringify(companyIds)]),
  ]);
  const named = identity.ok ? new Set(identity.value.map((r) => Number(r.company_id))) : null;
  return (id: number) => {
    if (!companyOf.has(Number(id))) return { formation_state: 'unreadable', formation_order_id: null };
    const company = companyOf.get(Number(id)) ?? null;
    const idRead: Read<boolean> = company == null ? { ok: true, value: false }
      : named ? { ok: true, value: named.has(company) } : { ok: false };
    const mine: Read<OrderFact[]> = orders.ok
      ? {
        ok: true,
        value: orders.value
          .filter((r) => Number(r.project_id) === Number(id) || (company != null && r.status === FILED_STATUS && Number(r.company_id) === company))
          .map(fact),
      }
      : { ok: false };
    return formationState(idRead, mine);
  };
}
