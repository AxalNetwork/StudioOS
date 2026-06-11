import type { Env } from '../types';
import { enqueueJob } from './queue';

let _migrated = false;

export async function ensureIncorporationsSchema(env: Env): Promise<void> {
  if (_migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS incorporations (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL,
      project_id             INTEGER NOT NULL,
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
      paid_at                TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_incorporations_user_status ON incorporations(user_id, status)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  _migrated = true;
}

export interface CreatePendingArgs {
  user_id: number;
  project_id: number;
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
    `INSERT INTO incorporations (user_id, project_id, jurisdiction_id, company_name,
      registered_agent_name, registered_agent_address, amount_cents, currency,
      stripe_session_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
  ).bind(
    args.user_id, args.project_id, args.jurisdiction_id, args.company_name,
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
    await enqueueJob(env, 'incorporation_packet_start', {
      incorporation_id: incorporationId,
    }, {
      idempotency_key: `incorp_packet:${incorporationId}`,
    });
  }
}

export async function startIncorporationPacket(env: Env, incorporationId: number): Promise<void> {
  await ensureIncorporationsSchema(env);
  await env.DB.prepare(
    `UPDATE incorporations
     SET status = 'packet_processing',
         updated_at = datetime('now')
     WHERE id = ? AND status = 'paid'`,
  ).bind(incorporationId).run();
  // The downstream packet-build pipeline (eSign PDF assembler) will run here in a future task.
  // For now, the status advances to 'packet_processing' so the queue can advance.
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
