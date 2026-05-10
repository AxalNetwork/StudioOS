/**
 * Trust Center service — Task #3 (Y-1).
 *
 * Owns three responsibilities:
 *
 *   1. seedObligations(env, userId, role)
 *      — Inserts per-user `legal_obligations` rows according to the
 *      role matrix. Idempotent (UNIQUE(user_id, obligation_key)).
 *      Called from /auth/register and /admin/users/:id/role.
 *
 *   2. maskFounderForInvestor(founder, investorUserId, env)
 *      — Returns a redacted copy of a founder row when the calling
 *      investor has no `active` pairwise NDA on file. Until the
 *      Founder + Investor + Axal 3-way envelope is fully signed,
 *      investor surfaces only see {name, sector, stage, headline,
 *      public deck slides flagged public}.
 *
 *   3. expireDueArtifacts(env)
 *      — Nightly housekeeping: marks `legal_obligations` whose
 *      `expires_at` is past as `expired`, and `pairwise_ndas` past
 *      `valid_until` as `expired`. Called from the worker `scheduled()`
 *      handler at 04:35 UTC.
 *
 * KYC/KYB resync is a no-op stub (Persona/Sumsub aren't wired yet — see
 * routes/kyc.ts mock fallback). The function is exported so the cron
 * gate in index.ts can call it; once a real provider lands the body
 * populates `evidence_meta` and flips status -> 'satisfied'.
 */
import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Obligation matrix
// ---------------------------------------------------------------------------

export type ObligationKey =
  | 'tos_v1'
  | 'privacy_v1'
  | 'founder_nda_v1'
  | 'investor_nda_v1'
  | 'mentor_nda_v1'
  | 'mentor_disclaimer_v1'
  | 'kyc_v1'
  | 'accreditation_v1'
  | 'kyb_v1'
  | 'partner_msa_v1';

interface ObligationDef {
  key: ObligationKey;
  required: 0 | 1;
  /** Validity window once satisfied (ms). NULL = never expires. */
  ttlMs: number | null;
}

const TTL_12_MO = 365 * 24 * 60 * 60 * 1000;
const TTL_24_MO = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Per-role obligation lists. Anything missing here is implicitly NOT
 * required for that role — e.g. a founder doesn't need an Investor NDA.
 * Partners get the bare ToS+Privacy seed here; X-1 (partner deals)
 * tops them up with deal-conditional obligations once that lands.
 */
const ROLE_MATRIX: Record<string, ObligationDef[]> = {
  founder: [
    { key: 'tos_v1',         required: 1, ttlMs: null },
    { key: 'privacy_v1',     required: 1, ttlMs: null },
    { key: 'founder_nda_v1', required: 1, ttlMs: TTL_24_MO },
  ],
  investor: [
    { key: 'tos_v1',           required: 1, ttlMs: null },
    { key: 'privacy_v1',       required: 1, ttlMs: null },
    { key: 'investor_nda_v1',  required: 1, ttlMs: TTL_24_MO },
    { key: 'kyc_v1',           required: 1, ttlMs: TTL_24_MO },
    { key: 'accreditation_v1', required: 1, ttlMs: TTL_12_MO },
    // KYB only required when the investor is an entity (corporate
    // profile populated). Seeded as `required:0` here; the corporate
    // settings PUT can flip it to `required:1` later.
    { key: 'kyb_v1',           required: 0, ttlMs: TTL_24_MO },
  ],
  mentor: [
    { key: 'tos_v1',              required: 1, ttlMs: null },
    { key: 'privacy_v1',          required: 1, ttlMs: null },
    { key: 'mentor_nda_v1',       required: 1, ttlMs: TTL_24_MO },
    { key: 'mentor_disclaimer_v1',required: 1, ttlMs: null },
  ],
  partner: [
    { key: 'tos_v1',     required: 1, ttlMs: null },
    { key: 'privacy_v1', required: 1, ttlMs: null },
    // partner_msa_v1 + deal-conditional rows are seeded by X-1.
  ],
  admin: [
    { key: 'tos_v1',     required: 1, ttlMs: null },
    { key: 'privacy_v1', required: 1, ttlMs: null },
  ],
};

export function obligationsForRole(role: string): ObligationDef[] {
  return ROLE_MATRIX[role] || ROLE_MATRIX.partner;
}

// ---------------------------------------------------------------------------
// Schema bootstrap (defensive — same lazy pattern as other routes)
// ---------------------------------------------------------------------------

let trustSchemaReady = false;
export async function ensureTrustSchema(env: Env): Promise<void> {
  if (trustSchemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS legal_obligations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      obligation_key TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMP,
      evidence_envelope_uuid TEXT,
      evidence_meta TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, obligation_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_legal_obligations_user   ON legal_obligations(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_legal_obligations_status ON legal_obligations(status)`,
    `CREATE TABLE IF NOT EXISTS pairwise_ndas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_a_user_id INTEGER NOT NULL,
      party_b_user_id INTEGER NOT NULL,
      intermediary TEXT NOT NULL DEFAULT 'axal',
      nda_envelope_uuid TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      valid_until TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(party_a_user_id, party_b_user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_a       ON pairwise_ndas(party_a_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_b       ON pairwise_ndas(party_b_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_status  ON pairwise_ndas(status)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  trustSchemaReady = true;
}

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

/**
 * Idempotent obligation seeder. Inserts the role matrix into
 * `legal_obligations` if not already present. Never demotes existing
 * rows — a row already `satisfied` for ToS stays satisfied even after
 * a role change. To remove obsolete obligations after a role change
 * (e.g. investor -> founder loses KYC requirement), pass
 * `pruneStaleForRole=true`; obsolete rows are flipped to
 * `required=0, status='waived'` rather than deleted (audit trail).
 */
export async function seedObligations(
  env: Env,
  userId: number,
  role: string,
  opts: { pruneStaleForRole?: boolean } = {},
): Promise<{ inserted: number; pruned: number }> {
  await ensureTrustSchema(env);
  const defs = obligationsForRole(role);
  let inserted = 0;
  for (const d of defs) {
    try {
      const r: any = await env.DB.prepare(
        `INSERT INTO legal_obligations (user_id, obligation_key, required, status)
         VALUES (?, ?, ?, 'pending')
         ON CONFLICT(user_id, obligation_key) DO NOTHING
         RETURNING id`,
      ).bind(userId, d.key, d.required).first();
      if (r?.id) inserted += 1;
    } catch (e) {
      console.error('[trust] seed insert failed', d.key, e);
    }
  }
  let pruned = 0;
  if (opts.pruneStaleForRole) {
    const allowed = new Set(defs.map(d => d.key));
    try {
      const rows: any = await env.DB.prepare(
        `SELECT id, obligation_key FROM legal_obligations WHERE user_id = ?`,
      ).bind(userId).all();
      const list: any[] = (rows?.results || []) as any[];
      for (const row of list) {
        if (!allowed.has(row.obligation_key)) {
          await env.DB.prepare(
            `UPDATE legal_obligations
                SET required = 0, status = 'waived', updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
          ).bind(row.id).run();
          pruned += 1;
        }
      }
    } catch (e) { console.error('[trust] prune failed', e); }
  }
  return { inserted, pruned };
}

// ---------------------------------------------------------------------------
// Pairwise NDA helpers
// ---------------------------------------------------------------------------

export interface PairwiseNdaRow {
  id: number;
  party_a_user_id: number;
  party_b_user_id: number;
  nda_envelope_uuid: string | null;
  status: 'pending' | 'partially_signed' | 'active' | 'expired' | 'revoked';
  valid_until: string | null;
}

/** Fetch the pairwise row regardless of which side called us. */
export async function getPairwiseNda(
  env: Env, founderUserId: number, investorUserId: number,
): Promise<PairwiseNdaRow | null> {
  await ensureTrustSchema(env);
  try {
    const row: any = await env.DB.prepare(
      `SELECT id, party_a_user_id, party_b_user_id, nda_envelope_uuid, status, valid_until
         FROM pairwise_ndas
        WHERE party_a_user_id = ? AND party_b_user_id = ?
        LIMIT 1`,
    ).bind(founderUserId, investorUserId).first();
    return (row as PairwiseNdaRow) || null;
  } catch { return null; }
}

/** Truthy iff investor may receive un-masked founder data. */
export async function hasActivePairwiseNda(
  env: Env, founderUserId: number, investorUserId: number,
): Promise<boolean> {
  const row = await getPairwiseNda(env, founderUserId, investorUserId);
  if (!row) return false;
  if (row.status !== 'active') return false;
  if (row.valid_until && new Date(row.valid_until).getTime() < Date.now()) return false;
  return true;
}

/**
 * Upsert a pending pairwise NDA. Caller owns the envelope creation
 * (esign.ts) and passes the resulting envelope_uuid back in. Validity
 * window is set when the envelope reaches status='completed', NOT here.
 */
export async function upsertPairwiseNda(
  env: Env,
  founderUserId: number,
  investorUserId: number,
  envelopeUuid: string,
): Promise<void> {
  await ensureTrustSchema(env);
  try {
    await env.DB.prepare(
      `INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, intermediary, nda_envelope_uuid, status)
       VALUES (?, ?, 'axal', ?, 'pending')
       ON CONFLICT(party_a_user_id, party_b_user_id) DO UPDATE SET
         nda_envelope_uuid = excluded.nda_envelope_uuid,
         status = CASE WHEN pairwise_ndas.status IN ('expired','revoked') THEN 'pending' ELSE pairwise_ndas.status END,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(founderUserId, investorUserId, envelopeUuid).run();
  } catch (e) { console.error('[trust] upsertPairwiseNda failed', e); }
}

/** Mark a pairwise NDA as fully executed (called from esign signing flow). */
export async function activatePairwiseNda(
  env: Env, envelopeUuid: string,
): Promise<void> {
  await ensureTrustSchema(env);
  const validUntil = new Date(Date.now() + TTL_12_MO).toISOString();
  try {
    await env.DB.prepare(
      `UPDATE pairwise_ndas
          SET status = 'active', valid_until = ?, updated_at = CURRENT_TIMESTAMP
        WHERE nda_envelope_uuid = ?`,
    ).bind(validUntil, envelopeUuid).run();
  } catch (e) { console.error('[trust] activatePairwiseNda failed', e); }
}

// ---------------------------------------------------------------------------
// Founder masking
// ---------------------------------------------------------------------------

/**
 * The fields an un-NDA'd investor IS allowed to see. Anything else on
 * a founder/project row gets nulled out. Keep this list deliberately
 * small — when in doubt, mask. Public deck slides are surfaced
 * separately (they live on `decks` and have their own `is_public` flag).
 */
const FOUNDER_PUBLIC_KEYS = new Set([
  'id', 'name', 'sector', 'stage', 'headline',
  // Project mirrors carry the same name/sector/stage shape.
  'project_id', 'description_public',
]);

export interface FounderLikeRow {
  founder_user_id?: number | null;
  user_id?: number | null;
  [k: string]: unknown;
}

/**
 * Returns a copy of `row` with sensitive fields nulled when the
 * calling investor has no active pairwise NDA. Returns the original
 * reference when the caller is not an investor (founders/admins/
 * partners go through other gates).
 */
export async function maskFounderForInvestor<T extends FounderLikeRow>(
  env: Env,
  row: T,
  ctx: { viewerRole: string; viewerUserId: number },
): Promise<T> {
  if (ctx.viewerRole !== 'investor') return row;
  const founderUserId = (row.founder_user_id ?? row.user_id) as number | null | undefined;
  if (!founderUserId) return row;
  if (await hasActivePairwiseNda(env, founderUserId, ctx.viewerUserId)) return row;
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    masked[k] = FOUNDER_PUBLIC_KEYS.has(k) ? v : null;
  }
  masked.__masked = true;          // UI hint: render the "Sign NDA to unlock" banner
  masked.__mask_reason = 'no_pairwise_nda';
  return masked as T;
}

// ---------------------------------------------------------------------------
// Nightly housekeeping
// ---------------------------------------------------------------------------

/**
 * Marks past-due rows as `expired`. Called from the worker
 * `scheduled()` handler at 04:35 UTC. Idempotent — once a row reads
 * `expired` it's filtered out by the WHERE clauses.
 */
export async function expireDueArtifacts(
  env: Env,
): Promise<{ obligations_expired: number; ndas_expired: number }> {
  await ensureTrustSchema(env);
  let oblig = 0; let nda = 0;
  try {
    const r: any = await env.DB.prepare(
      `UPDATE legal_obligations
          SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE status = 'satisfied'
          AND expires_at IS NOT NULL
          AND expires_at < CURRENT_TIMESTAMP`,
    ).run();
    oblig = (r?.meta?.changes ?? r?.changes ?? 0) as number;
  } catch (e) { console.error('[trust] expire obligations failed', e); }
  try {
    const r: any = await env.DB.prepare(
      `UPDATE pairwise_ndas
          SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE status = 'active'
          AND valid_until IS NOT NULL
          AND valid_until < CURRENT_TIMESTAMP`,
    ).run();
    nda = (r?.meta?.changes ?? r?.changes ?? 0) as number;
  } catch (e) { console.error('[trust] expire NDAs failed', e); }
  return { obligations_expired: oblig, ndas_expired: nda };
}

/**
 * KYC / KYB provider resync — stub. Persona/Sumsub aren't connected in
 * production yet (see routes/kyc.ts which falls back to mock). When
 * they land, this function should:
 *   1. SELECT obligations WHERE obligation_key IN ('kyc_v1','kyb_v1')
 *      AND status IN ('in_review','pending')
 *   2. Fetch the latest provider verdict
 *   3. UPDATE status='satisfied', evidence_meta=<provider_ref>,
 *      expires_at=NOW + ttl when verdict='passed'.
 * For now it returns 0/0 so the cron gate stays harmless.
 */
export async function resyncKycKyb(_env: Env): Promise<{ scanned: number; updated: number }> {
  return { scanned: 0, updated: 0 };
}
