/**
 * D5299 (#5299, slice 1 of #5038) — the revenue ledger: append-only `financial_events`, written once per event from
 * the Stripe webhook and from HQ's refund route, with attribution stamped at write time and never guessed.
 *
 * WHAT IS RECORDED. From Stripe (`recordStripeFinancialEvent`, called by `POST /api/billing/stripe/webhook` after its
 * handlers ran and before the receipt is marked handled):
 *
 *   invoice.paid               kind `invoice`   gross = amount_paid
 *   charge.succeeded           kind `charge`    gross = amount captured
 *   payment_intent.succeeded   kind `payment`   gross = amount_received
 *   charge.refunded            kind `refund`    refund = this event's share (amount_refunded - previous_attributes'),
 *                                               NULL when the event does not carry the previous total
 *   charge.dispute.created     kind `dispute`   refund = the disputed amount withdrawn; 0 for an inquiry (`warning_*`)
 *   charge.dispute.closed      kind `dispute`   won: gross = the amount reinstated; lost / warning_closed: 0
 *
 * Every other event type writes nothing. An invoice, its charge and its PaymentIntent describe the SAME money from
 * three sides; each is its own row (its own kind) with the ids that link them, and a reader sums one kind, never
 * several. From HQ (`recordHqRefund`): a refund HQ's refund route issued, under source `hq` and the refund's `re_` id.
 * Both sides key a refund by `<charge>:<cumulative refunded>` (`refund_key`), so a refund HQ issued and Stripe then
 * reports is one row; a refund made anywhere else (the Stripe dashboard, an API call) is recorded from the webhook.
 *
 * ONE STATEMENT, OR NOTHING. A row is one `INSERT … ON CONFLICT DO NOTHING`, so a failed write leaves no partial row. It throws, and
 * the webhook then answers 503 with its receipt unfinished, so Stripe retries; a replay meets UNIQUE(source,
 * source_event_id) or the refund key and writes nothing new.
 *
 * AMOUNTS are integer minor units of the row's own currency (ISO 4217; ISK and UGX converted from Stripe's
 * hundredths, D5029). A missing or unreadable amount is NULL, never 0. Nothing here sums across currencies.
 *
 * ATTRIBUTION is what the event names: `metadata.user_id` our checkout stamped, else the one account whose Stripe
 * customer id matches exactly; `company_id` / `project_id` / `licence_uid` from metadata; the revenue stream from
 * `metadata.kind`; the product from `metadata.product_id` / `price_id`. Anything else is NULL and reported as
 * unattributed (`unattributedFields`). A read that fails throws: an immutable row is never written on a lookup that
 * could not be made.
 *
 * RECONCILIATION is the only thing that moves on a row, through `setReconciliationState` alone; the migration's
 * triggers refuse every other UPDATE and every DELETE. Coverage: `financial_event_coverage` holds when each source
 * began (`coverageStarts`); nothing before it is backfilled.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';
import { currencyCode } from './currencies';
import { fromStripe } from './refundReview';

export const FINANCIAL_EVENT_KINDS = ['invoice', 'charge', 'payment', 'refund', 'dispute', 'adjustment'] as const;
export type FinancialEventKind = (typeof FINANCIAL_EVENT_KINDS)[number];

export const RECONCILIATION_STATES = ['pending', 'matched', 'discrepancy', 'excluded'] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

/** The moves `setReconciliationState` allows. `matched` and `excluded` are final. */
export const RECONCILIATION_MOVES: Readonly<Record<ReconciliationState, readonly ReconciliationState[]>> = Object.freeze({
  pending: ['matched', 'discrepancy', 'excluded'],
  discrepancy: ['matched', 'excluded'],
  matched: [],
  excluded: [],
});

/** The attribution columns. NULL in any of them is "unattributed" for that dimension, never a default. */
export const ATTRIBUTION_FIELDS = ['user_id', 'company_id', 'project_id', 'licence_uid', 'revenue_stream', 'product_ref'] as const;

/** Stripe event types the ledger records. Every other type writes nothing. */
export const LEDGER_STRIPE_EVENTS: readonly string[] = Object.freeze([
  'invoice.paid', 'charge.succeeded', 'payment_intent.succeeded', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
]);

/**
 * The migration's statements (202611100929_financial_events.sql), for the D235 safety net only: a cold isolate on a
 * database the runner has not reached. The migration is the declaration; `financial_events_d5299.test.ts` holds
 * these to it, statement for statement.
 */
export const FINANCIAL_EVENTS_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS financial_event_coverage (
  source             TEXT PRIMARY KEY CHECK (length(source) BETWEEN 1 AND 40 AND source NOT GLOB '*[^a-z_]*'),
  coverage_starts_at TEXT NOT NULL,
  note               TEXT
)`,
  `INSERT OR IGNORE INTO financial_event_coverage (source, coverage_starts_at, note)
VALUES ('stripe', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'Stripe webhook events from this migration on; no backfill (D5299).'),
       ('hq', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'HQ billing actions (the refund route) from this migration on; no backfill (D5299).')`,
  `CREATE TRIGGER IF NOT EXISTS trg_financial_event_coverage_kept
BEFORE DELETE ON financial_event_coverage
BEGIN
  SELECT RAISE(ABORT, 'financial_event_coverage rows are kept');
END`,
  `CREATE TRIGGER IF NOT EXISTS trg_financial_event_coverage_immutable
BEFORE UPDATE ON financial_event_coverage
BEGIN
  SELECT RAISE(ABORT, 'financial_event_coverage rows are immutable');
END`,
  `CREATE TABLE IF NOT EXISTS financial_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  source                TEXT NOT NULL,
  source_event_id       TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 255),
  source_event_type     TEXT NOT NULL CHECK (length(source_event_type) BETWEEN 1 AND 80),
  kind                  TEXT NOT NULL CHECK (kind IN ('invoice', 'charge', 'payment', 'refund', 'dispute', 'adjustment')),
  livemode              INTEGER CHECK (livemode IN (0, 1)),
  object_ref            TEXT,
  charge_ref            TEXT,
  payment_intent_ref    TEXT,
  invoice_ref           TEXT,
  customer_ref          TEXT,
  refund_key            TEXT,
  user_id               INTEGER,
  company_id            INTEGER,
  project_id            INTEGER,
  licence_uid           TEXT,
  revenue_stream        TEXT,
  product_ref           TEXT,
  actor_user_id         INTEGER,
  currency              TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')),
  gross_cents           INTEGER CHECK (gross_cents IS NULL OR gross_cents >= 0),
  refund_cents          INTEGER CHECK (refund_cents IS NULL OR refund_cents >= 0),
  net_cents             INTEGER,
  occurred_at           TEXT,
  recorded_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  reconciliation_state  TEXT NOT NULL DEFAULT 'pending'
                        CHECK (reconciliation_state IN ('pending', 'matched', 'discrepancy', 'excluded')),
  reconciled_at         TEXT,
  reconciled_by_user_id INTEGER,
  reconciliation_note   TEXT,
  UNIQUE (source, source_event_id),
  CHECK (currency IS NOT NULL OR (gross_cents IS NULL AND refund_cents IS NULL AND net_cents IS NULL)),
  CHECK (net_cents IS NULL OR (gross_cents IS NOT NULL AND refund_cents IS NOT NULL AND net_cents = gross_cents - refund_cents))
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_events_refund_key
  ON financial_events (refund_key) WHERE refund_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_financial_events_occurred
  ON financial_events (currency, kind, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_financial_events_user
  ON financial_events (user_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_financial_events_reconciliation
  ON financial_events (reconciliation_state, id)`,
  `CREATE TRIGGER IF NOT EXISTS trg_financial_events_source_covered
BEFORE INSERT ON financial_events
WHEN NOT EXISTS (SELECT 1 FROM financial_event_coverage WHERE source = NEW.source)
BEGIN
  SELECT RAISE(ABORT, 'financial_events source has no coverage row');
END`,
  `CREATE TRIGGER IF NOT EXISTS trg_financial_events_kept
BEFORE DELETE ON financial_events
BEGIN
  SELECT RAISE(ABORT, 'financial_events rows are kept');
END`,
  `CREATE TRIGGER IF NOT EXISTS trg_financial_events_immutable
BEFORE UPDATE ON financial_events
WHEN NEW.id IS NOT OLD.id OR NEW.uid IS NOT OLD.uid OR NEW.source IS NOT OLD.source
  OR NEW.source_event_id IS NOT OLD.source_event_id OR NEW.source_event_type IS NOT OLD.source_event_type
  OR NEW.kind IS NOT OLD.kind OR NEW.livemode IS NOT OLD.livemode OR NEW.object_ref IS NOT OLD.object_ref
  OR NEW.charge_ref IS NOT OLD.charge_ref OR NEW.payment_intent_ref IS NOT OLD.payment_intent_ref
  OR NEW.invoice_ref IS NOT OLD.invoice_ref OR NEW.customer_ref IS NOT OLD.customer_ref
  OR NEW.refund_key IS NOT OLD.refund_key OR NEW.user_id IS NOT OLD.user_id OR NEW.company_id IS NOT OLD.company_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.licence_uid IS NOT OLD.licence_uid
  OR NEW.revenue_stream IS NOT OLD.revenue_stream OR NEW.product_ref IS NOT OLD.product_ref
  OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.currency IS NOT OLD.currency
  OR NEW.gross_cents IS NOT OLD.gross_cents OR NEW.refund_cents IS NOT OLD.refund_cents
  OR NEW.net_cents IS NOT OLD.net_cents OR NEW.occurred_at IS NOT OLD.occurred_at
  OR NEW.recorded_at IS NOT OLD.recorded_at
BEGIN
  SELECT RAISE(ABORT, 'financial_events rows are immutable; only the reconciliation state moves');
END`,
]);

const READY = new WeakMap<object, boolean>();

/** D235 safety net: the migration's own statements, once per binding. A failure throws (the write it guards fails). */
export async function ensureFinancialEventsSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  for (const sql of FINANCIAL_EVENTS_DDL) await env.DB.prepare(sql).run();
  READY.set(bindingKey(env), true);
}

/** One ledger row, as written. Every field but the identity and kind may be NULL. */
export interface FinancialEventRow {
  source: 'stripe' | 'hq';
  source_event_id: string;
  source_event_type: string;
  kind: FinancialEventKind;
  livemode: 0 | 1 | null;
  object_ref: string | null;
  charge_ref: string | null;
  payment_intent_ref: string | null;
  invoice_ref: string | null;
  customer_ref: string | null;
  refund_key: string | null;
  user_id: number | null;
  company_id: number | null;
  project_id: number | null;
  licence_uid: string | null;
  revenue_stream: string | null;
  product_ref: string | null;
  actor_user_id: number | null;
  currency: string | null;
  gross_cents: number | null;
  refund_cents: number | null;
  net_cents: number | null;
  occurred_at: string | null;
}

/** The insert's columns after `uid`, in its order. */
const COLUMNS = [
  'source', 'source_event_id', 'source_event_type', 'kind', 'livemode', 'object_ref', 'charge_ref', 'payment_intent_ref',
  'invoice_ref', 'customer_ref', 'refund_key', 'user_id', 'company_id', 'project_id', 'licence_uid', 'revenue_stream',
  'product_ref', 'actor_user_id', 'currency', 'gross_cents', 'refund_cents', 'net_cents', 'occurred_at',
] as const satisfies readonly (keyof FinancialEventRow)[];

/** Write one row, once. True when it was written; false when it was already there (a replay). Throws on failure. */
export async function writeFinancialEvent(env: Env, row: FinancialEventRow): Promise<boolean> {
  await ensureFinancialEventsSchema(env);
  // A row with no currency carries no amount: an amount in an unknown unit is not an amount.
  const values = row.currency ? row : { ...row, gross_cents: null, refund_cents: null, net_cents: null };
  // ON CONFLICT DO NOTHING, not INSERT OR IGNORE: OR IGNORE would also drop a row a CHECK refuses, silently, and the
  // webhook would acknowledge it. Only a uniqueness conflict (a replay) is a no-op here; anything else throws.
  const res = await env.DB.prepare(
    `INSERT INTO financial_events (uid, source, source_event_id, source_event_type, kind, livemode, object_ref, charge_ref,
       payment_intent_ref, invoice_ref, customer_ref, refund_key, user_id, company_id, project_id, licence_uid,
       revenue_stream, product_ref, actor_user_id, currency, gross_cents, refund_cents, net_cents, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).bind(crypto.randomUUID(), ...COLUMNS.map((k) => values[k])).run();
  return Number(res.meta?.changes ?? 0) === 1;
}

// ── reading what an event names ───────────────────────────────────────────────

type Obj = Record<string, unknown>;
const STRIPE_ID = /^[a-z]{2,8}_[A-Za-z0-9_]{1,250}$/;
const idOf = (v: unknown, prefixes: string[]): string | null => {
  const id = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v as Obj).id : null);
  return typeof id === 'string' && STRIPE_ID.test(id) && prefixes.some((p) => id.startsWith(`${p}_`)) ? id : null;
};
const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const units = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const label = (v: unknown): string | null => (typeof v === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(v) ? v : null);
const uidLike = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const isoOf = (sec: unknown): string | null =>
  (typeof sec === 'number' && Number.isSafeInteger(sec) && sec > 0 ? new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
const currencyOf = (v: unknown): string | null => currencyCode(typeof v === 'string' ? v.toUpperCase() : null);
/** Stripe units → the currency's own minor unit; NULL when either is unreadable. */
const minor = (n: number | null, currency: string | null): number | null => (n === null || !currency ? null : fromStripe(n, currency));

function metadataOf(...objs: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o as Obj)) if (typeof v === 'string' && !(k in out)) out[k] = v;
  }
  return out;
}

/** The account an event names: our checkout's `metadata.user_id`, else the one user whose Stripe customer id it is. */
async function userOf(env: Env, meta: Record<string, string>, customer: string | null): Promise<number | null> {
  const stamped = posInt(meta.user_id);
  if (stamped) return stamped;
  if (!customer) return null;
  const rows = await env.DB.prepare(
    'SELECT id FROM users WHERE stripe_customer_id = ? OR investor_stripe_customer_id = ? LIMIT 2',
  ).bind(customer, customer).all<{ id: number }>();
  const found = rows.results ?? [];
  return found.length === 1 ? posInt(found[0].id) : null;
}

async function attribution(env: Env, meta: Record<string, string>, customer: string | null) {
  const product = idOf(meta.product_id, ['prod']) ?? idOf(meta.price_id, ['price']);
  return {
    user_id: await userOf(env, meta, customer),
    company_id: posInt(meta.company_id),
    project_id: posInt(meta.project_id),
    licence_uid: uidLike(meta.licence_uid),
    revenue_stream: label(meta.kind),
    product_ref: product,
  };
}

const sale = (gross: number | null) => ({ gross_cents: gross, refund_cents: gross === null ? null : 0, net_cents: gross });
const outflow = (refund: number | null) => ({ gross_cents: 0, refund_cents: refund, net_cents: refund === null ? null : -refund });
const none = { gross_cents: null, refund_cents: null, net_cents: null };

export interface StripeEventLike {
  id: string; type: string; livemode?: boolean; created?: number;
  data: { object: Obj; previous_attributes?: Obj };
}

/** The ledger row a Stripe event makes, or null for a type the ledger does not record. Reads users; never writes. */
export async function stripeFinancialEvent(env: Env, event: StripeEventLike): Promise<FinancialEventRow | null> {
  if (!LEDGER_STRIPE_EVENTS.includes(event.type)) return null;
  const o = event.data.object;
  const currency = currencyOf(o.currency);
  const base = {
    source: 'stripe' as const, source_event_id: event.id, source_event_type: event.type,
    livemode: typeof event.livemode === 'boolean' ? (event.livemode ? 1 as const : 0 as const) : null,
    occurred_at: isoOf(event.created), actor_user_id: null, refund_key: null, currency,
  };
  if (event.type === 'invoice.paid') {
    const customer = idOf(o.customer, ['cus']);
    const meta = metadataOf(o.metadata, (o.subscription_details as Obj | undefined)?.metadata);
    return {
      ...base, kind: 'invoice', object_ref: idOf(o.id, ['in']), invoice_ref: idOf(o.id, ['in']),
      charge_ref: idOf(o.charge, ['ch', 'py']), payment_intent_ref: idOf(o.payment_intent, ['pi']), customer_ref: customer,
      ...(await attribution(env, meta, customer)), ...sale(minor(units(o.amount_paid), currency)),
    };
  }
  if (event.type === 'charge.succeeded' || event.type === 'charge.refunded') {
    const customer = idOf(o.customer, ['cus']);
    const chargeId = idOf(o.id, ['ch', 'py']);
    const refs = {
      object_ref: chargeId, charge_ref: chargeId, payment_intent_ref: idOf(o.payment_intent, ['pi']),
      invoice_ref: idOf(o.invoice, ['in']), customer_ref: customer,
    };
    const who = await attribution(env, metadataOf(o.metadata), customer);
    if (event.type === 'charge.succeeded') {
      const captured = o.captured === false ? null : (units(o.amount_captured) ?? units(o.amount));
      return { ...base, kind: 'charge', ...refs, ...who, ...sale(minor(captured, currency)) };
    }
    const total = units(o.amount_refunded);
    const before = units(event.data.previous_attributes?.amount_refunded);
    const share = total !== null && before !== null && total >= before ? total - before : null;
    return {
      ...base, kind: 'refund', ...refs, ...who, ...outflow(minor(share, currency)),
      refund_key: chargeId && total !== null && total > 0 ? `${chargeId}:${total}` : null,
    };
  }
  if (event.type === 'payment_intent.succeeded') {
    const customer = idOf(o.customer, ['cus']);
    return {
      ...base, kind: 'payment', object_ref: idOf(o.id, ['pi']), payment_intent_ref: idOf(o.id, ['pi']),
      charge_ref: idOf(o.latest_charge, ['ch', 'py']), invoice_ref: idOf(o.invoice, ['in']), customer_ref: customer,
      ...(await attribution(env, metadataOf(o.metadata), customer)), ...sale(minor(units(o.amount_received), currency)),
    };
  }
  // charge.dispute.created / charge.dispute.closed. A dispute names its charge; the charge's metadata only when
  // Stripe expanded it, so its attribution is what the dispute itself carries.
  const charge = o.charge && typeof o.charge === 'object' ? (o.charge as Obj) : null;
  const customer = idOf(charge?.customer, ['cus']);
  const status = typeof o.status === 'string' ? o.status : '';
  const amount = minor(units(o.amount), currency);
  const amounts = event.type === 'charge.dispute.created'
    ? (status.startsWith('warning_') ? outflow(amount === null ? null : 0) : outflow(amount))
    : status === 'won' ? sale(amount)
      : (status === 'lost' || status === 'warning_closed') ? sale(amount === null ? null : 0) : none;
  return {
    ...base, kind: 'dispute', object_ref: idOf(o.id, ['dp', 'du']), charge_ref: idOf(o.charge, ['ch', 'py']),
    payment_intent_ref: idOf(o.payment_intent, ['pi']), invoice_ref: idOf(charge?.invoice, ['in']), customer_ref: customer,
    ...(await attribution(env, metadataOf(o.metadata, charge?.metadata), customer)), ...amounts,
  };
}

/** The webhook's ledger write. True when a row was written, false for a replay or a type not recorded. Throws on failure. */
export async function recordStripeFinancialEvent(env: Env, event: StripeEventLike): Promise<boolean> {
  const row = await stripeFinancialEvent(env, event);
  return row ? writeFinancialEvent(env, row) : false;
}

/**
 * A refund HQ's refund route issued (`POST /api/admin/billing/refund`). `refundedBefore` is the charge's refunded
 * total, in Stripe units, that the confirmed review checked just before the refund, so the refund key is the one
 * Stripe's `charge.refunded` for this refund will carry. Throws on failure; the caller decides what that means.
 */
export async function recordHqRefund(env: Env, input: {
  refund: { id: string; amount: number; currency: string; charge: string | null; payment_intent: string | null };
  refundedBefore: number;
  customer: string | null;
  metadata: Record<string, string>;
  adminUserId: number;
  livemode: boolean | null;
  occurredAt?: string;
}): Promise<boolean> {
  const currency = currencyOf(input.refund.currency);
  const chargeId = idOf(input.refund.charge, ['ch', 'py']);
  const amount = units(input.refund.amount);
  const customer = idOf(input.customer, ['cus']);
  return writeFinancialEvent(env, {
    source: 'hq', source_event_id: input.refund.id, source_event_type: 'hq.refund', kind: 'refund',
    livemode: input.livemode === null ? null : (input.livemode ? 1 : 0),
    object_ref: idOf(input.refund.id, ['re', 'pyr']) ?? input.refund.id, charge_ref: chargeId,
    payment_intent_ref: idOf(input.refund.payment_intent, ['pi']), invoice_ref: null, customer_ref: customer,
    refund_key: chargeId && amount !== null && amount > 0 ? `${chargeId}:${input.refundedBefore + amount}` : null,
    ...(await attribution(env, input.metadata, customer)),
    actor_user_id: input.adminUserId, currency, ...outflow(minor(amount, currency)),
    occurred_at: input.occurredAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

/** The attribution dimensions a row leaves unresolved. Reported as unattributed; never filled in. */
export function unattributedFields(row: Partial<Record<(typeof ATTRIBUTION_FIELDS)[number], unknown>>): string[] {
  return ATTRIBUTION_FIELDS.filter((k) => row[k] === null || row[k] === undefined);
}

/** When each source began to be recorded. Before it the ledger knows nothing: a gap, not a zero. */
export async function coverageStarts(env: Env): Promise<Record<string, string>> {
  await ensureFinancialEventsSchema(env);
  const rows = await env.DB.prepare('SELECT source, coverage_starts_at FROM financial_event_coverage ORDER BY source')
    .all<{ source: string; coverage_starts_at: string }>();
  return Object.fromEntries((rows.results ?? []).map((r) => [r.source, r.coverage_starts_at]));
}

/**
 * THE ONE GUARDED PATH that changes a row: its reconciliation. The move must be one `RECONCILIATION_MOVES` allows,
 * from the state the caller read (compare-and-set), so two reconcilers cannot both move a row. Nothing else on the
 * row can change: the migration's trigger refuses it.
 */
export async function setReconciliationState(env: Env, input: {
  uid: string; from: ReconciliationState; to: ReconciliationState; actorUserId: number | null; note?: string | null;
}): Promise<{ ok: true } | { ok: false; code: 'move_not_allowed' | 'state_changed' }> {
  if (!RECONCILIATION_MOVES[input.from]?.includes(input.to)) return { ok: false, code: 'move_not_allowed' };
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const res = await env.DB.prepare(
    `UPDATE financial_events
        SET reconciliation_state = ?, reconciled_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            reconciled_by_user_id = ?, reconciliation_note = ?
      WHERE uid = ? AND reconciliation_state = ?`,
  ).bind(input.to, input.actorUserId, note, input.uid, input.from).run();
  return Number(res.meta?.changes ?? 0) === 1 ? { ok: true } : { ok: false, code: 'state_changed' };
}
