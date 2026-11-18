import type { Env } from '../types';
import { enqueueJob } from './queue';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';
import { syncIncorporationMilestoneForOrder } from './labIncorporationMilestone';
import { ensureCaseForOrder, transition } from './formationCase';

const MIGRATED = new WeakMap<object, boolean>();

export async function ensureIncorporationsSchema(env: Env): Promise<void> {
  if (MIGRATED.get(bindingKey(env))) return;
  const stmts = [
    // D6687 (#6687): the shape migration 202611161616_6687 rebuilds: project_id nullable, the
    // order's subject company, and the CHECK that one of the two is set.
    `CREATE TABLE IF NOT EXISTS incorporations (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL,
      project_id             INTEGER,
      jurisdiction_id        TEXT NOT NULL,
      company_name           TEXT NOT NULL,
      registered_agent_name  TEXT,
      registered_agent_address TEXT,
      amount_cents           INTEGER NOT NULL,
      currency               TEXT NOT NULL DEFAULT 'usd',
      stripe_session_id      TEXT UNIQUE,
      stripe_payment_intent  TEXT,
      status                 TEXT NOT NULL DEFAULT 'pending_payment',
      created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at                TIMESTAMP,
      packet_document_id     INTEGER REFERENCES documents(id),
      packet_ready_at        TEXT,
      packet_ready_by        INTEGER REFERENCES users(id),
      filed_on               TEXT,
      filed_recorded_at      TEXT,
      filed_by               INTEGER REFERENCES users(id),
      company_id             INTEGER REFERENCES company_profiles(id),
      subject_company_id     INTEGER REFERENCES company_profiles(id),
      CHECK (project_id IS NOT NULL OR subject_company_id IS NOT NULL)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_incorporations_user_status ON incorporations(user_id, status)`,
    // D6686 (#6686) — the formation case store. Declared by migration
    // 202611151733_6686_formation_cases.sql; these are the D235 safety net and
    // declare the same columns.
    `CREATE TABLE IF NOT EXISTS formation_cases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  user_id               INTEGER NOT NULL,
  intent                TEXT NOT NULL CHECK (intent IN ('convert_project', 'incorporate_company', 'new_company')),
  project_id            INTEGER,
  company_id            INTEGER,
  track                 TEXT NOT NULL CHECK (track IN ('legacy_v1', 'v2')),
  path                  TEXT CHECK (path IS NULL OR path IN ('simple', 'specialist')),
  stage                 TEXT NOT NULL CHECK (stage IN ('draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted', 'paid', 'preparing', 'ready_to_file', 'submitted', 'registry_query', 'registered', 'activating', 'handed_off')),
  stage_entered_at      TEXT NOT NULL DEFAULT (datetime('now')),
  waiting_on            TEXT NOT NULL DEFAULT 'nobody' CHECK (waiting_on IN ('founder', 'hq', 'partner', 'counsel', 'registry', 'nobody')),
  hold_reason           TEXT,
  form_key              TEXT,
  catalogue_version_id  INTEGER,
  structure_gate        TEXT,
  partner_id            INTEGER,
  hq_owner_user_id      INTEGER,
  revision              INTEGER NOT NULL DEFAULT 0,
  closed_at             TEXT,
  close_reason          TEXT CHECK (close_reason IS NULL OR close_reason IN ('cancelled', 'declined', 'rejected', 'refunded', 'handed_off', 'abandoned')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_cases_open_project
  ON formation_cases(project_id) WHERE track = 'v2' AND closed_at IS NULL AND project_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_cases_open_company
  ON formation_cases(company_id) WHERE track = 'v2' AND closed_at IS NULL AND company_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_formation_cases_user ON formation_cases(user_id, stage)`,
    `CREATE TABLE IF NOT EXISTS formation_case_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id           INTEGER NOT NULL,
  incorporation_id  INTEGER NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
)`,
    `CREATE INDEX IF NOT EXISTS idx_formation_case_orders_case ON formation_case_orders(case_id)`,
    `CREATE TABLE IF NOT EXISTS formation_case_stages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id            INTEGER NOT NULL,
  stage              TEXT NOT NULL,
  responsible_role   TEXT,
  owner_user_id      INTEGER,
  evidence_json      TEXT,
  completed_by       INTEGER,
  completed_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (case_id, stage)
)`,
    `CREATE TABLE IF NOT EXISTS formation_case_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  at              TEXT NOT NULL DEFAULT (datetime('now')),
  actor_user_id   INTEGER,
  party           TEXT NOT NULL CHECK (party IN ('founder', 'hq', 'partner', 'counsel', 'registry', 'system')),
  kind            TEXT NOT NULL,
  from_stage      TEXT,
  to_stage        TEXT,
  to_revision     INTEGER,
  visibility      TEXT NOT NULL DEFAULT 'hq_only' CHECK (visibility IN ('all', 'hq_partner', 'hq_only')),
  detail_json     TEXT
)`,
    `CREATE INDEX IF NOT EXISTS idx_formation_case_events_case ON formation_case_events(case_id, id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_case_events_revision
  ON formation_case_events(case_id, to_revision) WHERE to_revision IS NOT NULL`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  // The columns later migrations added, for a database the runner has not reached (D235). Through
  // runSchemaBootstrap (D5343): it reads the table's columns once and issues no ALTER for one that exists.
  await runSchemaBootstrap(env, [
    // Migration 411 (D601): the packet and the filing, recorded by an admin.
    'ALTER TABLE incorporations ADD COLUMN packet_document_id INTEGER',
    'ALTER TABLE incorporations ADD COLUMN packet_ready_at TEXT',
    'ALTER TABLE incorporations ADD COLUMN packet_ready_by INTEGER',
    'ALTER TABLE incorporations ADD COLUMN filed_on TEXT',
    'ALTER TABLE incorporations ADD COLUMN filed_recorded_at TEXT',
    'ALTER TABLE incorporations ADD COLUMN filed_by INTEGER',
    // Migration 685 (D1415): the company a filed incorporation created or filled.
    'ALTER TABLE incorporations ADD COLUMN company_id INTEGER',
    // D6687: the company the order is for.
    'ALTER TABLE incorporations ADD COLUMN subject_company_id INTEGER',
  ]);
  MIGRATED.set(bindingKey(env), true);
}

export interface CreatePendingArgs {
  user_id: number;
  /** D6687: the venture the order is for, or null when its subject is a company. */
  project_id: number | null;
  /** D6687: the company the order is for (`subject_company_id`), when it has no venture. */
  subject_company_id?: number | null;
  jurisdiction_id: string;
  company_name: string;
  registered_agent_name?: string | null;
  registered_agent_address?: string | null;
  amount_cents: number;
  currency: string;
  stripe_session_id: string;
}

export async function createPendingIncorporation(env: Env, args: CreatePendingArgs): Promise<number> {
  await ensureIncorporationsSchema(env);
  const res = await env.DB.prepare(
    `INSERT INTO incorporations (user_id, project_id, subject_company_id, jurisdiction_id, company_name,
      registered_agent_name, registered_agent_address, amount_cents, currency,
      stripe_session_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
  ).bind(
    args.user_id, args.project_id ?? null, args.subject_company_id ?? null, args.jurisdiction_id, args.company_name,
    args.registered_agent_name ?? null,
    args.registered_agent_address ?? null,
    args.amount_cents, args.currency, args.stripe_session_id,
  ).run();
  // D1 auto-increment primary key
  return Number(res.meta?.last_row_id ?? res.meta?.lastRowId ?? 0);
}

export async function recordPaidIncorporation(
  env: Env,
  obj: {
    id: string;
    metadata?: Record<string, string>;
    payment_status?: string;
    amount_total?: number;
    currency?: string;
    payment_intent?: string;
  },
): Promise<void> {
  const meta = obj.metadata ?? {};
  const incorporationId = Number(meta.incorporation_id ?? 0);
  if (!incorporationId) return;
  if (obj.payment_status !== 'paid') return;

  await ensureIncorporationsSchema(env);
  const amountCents = typeof obj.amount_total === 'number' ? Math.round(obj.amount_total) : 0;
  const currency = obj.currency || 'usd';

  const r = await env.DB.prepare(
    `UPDATE incorporations
     SET status = 'paid',
         stripe_payment_intent = COALESCE(?, stripe_payment_intent),
         amount_cents = COALESCE(?, amount_cents),
         currency = COALESCE(?, currency),
         paid_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status = 'pending_payment'`,
  ).bind(
    obj.payment_intent ?? null, amountCents || null, currency || null, incorporationId,
  ).run();

  // Only enqueue if the row actually transitioned from pending_payment -> paid.
  if ((r.meta?.changes ?? 0) > 0) {
    await openCaseForPaidOrder(env, incorporationId);
    await enqueueJob(env, 'incorporation_packet_start', {
      incorporation_id: incorporationId,
    }, {
      idempotency_key: `incorp_packet:${incorporationId}`,
    });
    // D585: payment is the moment a Lab founder's formation milestone is
    // recorded (the owner's answer A). Never throws; a replay records nothing.
    await syncIncorporationMilestoneForOrder(env, incorporationId);
  }
}

// ---------------------------------------------------------------------------
// Task #6 — embedded-terminal incorporation orders.
//
// The same `incorporations` table is the order/filing row for the embedded
// PaymentIntent flow (no Stripe Checkout redirect). We create a pending row
// FIRST so we have an id to stamp onto the PaymentIntent metadata, then attach
// the PI id once Stripe mints it. On `payment_intent.succeeded` the webhook
// marks the row paid (idempotently) and enqueues the same packet pipeline the
// legacy Checkout flow uses, so the filing workflow advances identically.
//
// `stripe_session_id` is left NULL for these embedded orders (SQLite/D1 allows
// multiple NULLs under a UNIQUE column); idempotency rides on the PI id and the
// `status = 'pending_payment'` guard in the paid recorder.
// ---------------------------------------------------------------------------
export interface CreateOrderArgs {
  user_id: number;
  /** D6687: the venture the order is for, or null when its subject is a company. */
  project_id: number | null;
  /** D6687: the company the order is for, when it has no venture. */
  subject_company_id?: number | null;
  jurisdiction_id: string;
  company_name: string;
  registered_agent_name?: string | null;
  registered_agent_address?: string | null;
  amount_cents: number;
  currency: string;
}

export async function createPendingIncorporationOrder(env: Env, args: CreateOrderArgs): Promise<number> {
  await ensureIncorporationsSchema(env);
  const res = await env.DB.prepare(
    `INSERT INTO incorporations (user_id, project_id, subject_company_id, jurisdiction_id, company_name,
      registered_agent_name, registered_agent_address, amount_cents, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
  ).bind(
    args.user_id, args.project_id ?? null, args.subject_company_id ?? null, args.jurisdiction_id, args.company_name,
    args.registered_agent_name ?? null,
    args.registered_agent_address ?? null,
    args.amount_cents, args.currency,
  ).run();
  return Number(res.meta?.last_row_id ?? res.meta?.lastRowId ?? 0);
}

/** Attach the Stripe PaymentIntent id to a pending order row. */
export async function attachIncorporationPaymentIntent(
  env: Env,
  incorporationId: number,
  paymentIntentId: string,
): Promise<void> {
  await ensureIncorporationsSchema(env);
  await env.DB.prepare(
    `UPDATE incorporations
     SET stripe_payment_intent = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(paymentIntentId, incorporationId).run();
}

/**
 * Mark an incorporation order paid from a `payment_intent.succeeded` event and
 * advance the filing workflow. The PI carries `metadata.incorporation_id` (set
 * when the order endpoint stamped the invoice's PaymentIntent). Idempotent: the
 * UPDATE only fires on the pending→paid transition, so a re-delivered webhook
 * is a no-op and the packet job is enqueued exactly once.
 */
export async function recordPaidIncorporationFromPaymentIntent(
  env: Env,
  obj: {
    id?: string;
    metadata?: Record<string, string>;
    amount?: number;
    amount_received?: number;
    currency?: string;
  },
): Promise<void> {
  const meta = obj.metadata ?? {};
  const incorporationId = Number(meta.incorporation_id ?? 0);
  if (!incorporationId) return;

  await ensureIncorporationsSchema(env);
  const amountCents = typeof obj.amount_received === 'number'
    ? Math.round(obj.amount_received)
    : (typeof obj.amount === 'number' ? Math.round(obj.amount) : 0);
  const currency = obj.currency || 'usd';

  const r = await env.DB.prepare(
    `UPDATE incorporations
     SET status = 'paid',
         stripe_payment_intent = COALESCE(?, stripe_payment_intent),
         amount_cents = COALESCE(?, amount_cents),
         currency = COALESCE(?, currency),
         paid_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status = 'pending_payment'`,
  ).bind(
    obj.id ?? null, amountCents || null, currency || null, incorporationId,
  ).run();

  if ((r.meta?.changes ?? 0) > 0) {
    await openCaseForPaidOrder(env, incorporationId);
    await enqueueJob(env, 'incorporation_packet_start', {
      incorporation_id: incorporationId,
    }, {
      idempotency_key: `incorp_packet:${incorporationId}`,
    });
    await syncIncorporationMilestoneForOrder(env, incorporationId);
  }
}

/**
 * D6686: the payment is on record, so the order has its case at `paid`. A
 * failure here leaves the payment recorded and the case to the next
 * ensureCaseForOrder (the packet job's, or any case read); it never fails the
 * webhook that recorded the payment.
 */
async function openCaseForPaidOrder(env: Env, incorporationId: number): Promise<void> {
  try { await ensureCaseForOrder(env, incorporationId); }
  catch (e) { console.error('formation case: could not open the case of a paid order', incorporationId, (e as Error)?.message); }
}

/**
 * The `incorporation_packet_start` job: paid → preparing, through the case
 * service (D6686), so the order's status (paid → packet_processing) and the
 * case's stage move in one batch. A case not at `paid` is left alone, as the
 * old `WHERE status = 'paid'` left the order: a replayed job changes nothing.
 */
export async function startIncorporationPacket(env: Env, incorporationId: number): Promise<void> {
  await ensureIncorporationsSchema(env);
  const c = await ensureCaseForOrder(env, incorporationId);
  if (!c || c.stage !== 'paid') return;
  await transition(env, c.id, 'preparing', { party: 'system' }, { detail: { job: 'incorporation_packet_start' } });
  // The downstream packet-build pipeline (eSign PDF assembler) will run here in a future task.
}

export async function getIncorporationForUser(
  env: Env,
  id: number,
  userId: number,
): Promise<Record<string, unknown> | null> {
  await ensureIncorporationsSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM incorporations WHERE id = ? AND user_id = ?`,
  ).bind(id, userId).first<Record<string, unknown>>();
  return row ?? null;
}

export async function getIncorporationBySessionId(
  env: Env,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  await ensureIncorporationsSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM incorporations WHERE stripe_session_id = ?`,
  ).bind(sessionId).first<Record<string, unknown>>();
  return row ?? null;
}
