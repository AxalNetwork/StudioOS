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
  advisor: [
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
    // Migration 243 creates this on a fresh build; it is repeated here for the
    // same reason every other table in this list is — `ensureTrustSchema` is
    // the runtime self-heal for a D1 that predates the migration, and
    // `recordAndCompareScore` must not be the thing that discovers the table
    // is missing.
    `CREATE TABLE IF NOT EXISTS trust_score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      captured_month TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_score_snapshots_month ON trust_score_snapshots(user_id, captured_month)`,
    `CREATE INDEX IF NOT EXISTS idx_trust_score_snapshots_user ON trust_score_snapshots(user_id, captured_month DESC)`,
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
    // Task #163 (migration 244) — which renewal warnings have already gone
    // out. `user_id` is in the unique key because a pairwise NDA has two
    // parties and both must be warned; `expires_at` is in it so a renewed
    // deadline re-arms all three thresholds.
    `CREATE TABLE IF NOT EXISTS renewal_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_id INTEGER NOT NULL,
      threshold_days INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      notified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_notices_once ON renewal_notices(user_id, subject_kind, subject_id, threshold_days, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_renewal_notices_user ON renewal_notices(user_id, notified_at DESC)`,
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
  const defs = obligationsForRole(role).map(d => ({ ...d }));
  // Task #3 (Y-1) — investor KYB conditional on entity status.
  // If the user has populated a corporate_profiles row (entity_type
  // set), KYB becomes a hard requirement. The kyb_v1 def above is
  // seeded as required:0 for individual investors; we flip it here
  // for entity investors. Defensive: if corporate_profiles is missing
  // (older deployments) we leave the default.
  if (role === 'investor') {
    let isEntity = false;
    try {
      const cp: any = await env.DB.prepare(
        `SELECT entity_type FROM corporate_profiles WHERE user_id = ?`,
      ).bind(userId).first().catch(() => null);
      isEntity = !!(cp && cp.entity_type && String(cp.entity_type).trim());
    } catch { /* corporate_profiles table not present yet */ }
    if (isEntity) {
      const kyb = defs.find(d => d.key === 'kyb_v1');
      if (kyb) kyb.required = 1;
    }
  }
  // Task #2 — KYC is investor-only. Any legacy `kyc_v1` row attached to
  // a non-investor user (seeded under a previous, broader role matrix or
  // via a role-change that pre-dated the policy tightening) must be
  // treated as not-applicable rather than counted as a pending /
  // outstanding obligation. Force-waive in-place so trust summaries and
  // scoring queries (which already respect `required=0` / `status='waived'`)
  // naturally exclude them. Preserves the audit row instead of deleting.
  if (role !== 'investor') {
    try {
      await env.DB.prepare(
        `UPDATE legal_obligations
            SET required = 0, status = 'waived', updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
            AND obligation_key = 'kyc_v1'
            AND status <> 'waived'`,
      ).bind(userId).run();
    } catch (e) { console.error('[trust] kyc_v1 legacy waive failed', e); }
  }
  let inserted = 0;
  for (const d of defs) {
    try {
      // Insert-or-reactivate. If a previous role-change waived this
      // obligation (status='waived', required=0), the role flip back
      // to a role that DOES need it must re-arm the row — otherwise
      // the user would silently stay non-compliant. We reactivate by
      // restoring the required flag and bumping waived/expired rows
      // back to 'pending'. Already-satisfied rows are NOT downgraded.
      const r: any = await env.DB.prepare(
        `INSERT INTO legal_obligations (user_id, obligation_key, required, status)
         VALUES (?, ?, ?, 'pending')
         ON CONFLICT(user_id, obligation_key) DO UPDATE SET
           required   = excluded.required,
           status     = CASE WHEN legal_obligations.status IN ('waived','expired')
                             THEN 'pending'
                             ELSE legal_obligations.status END,
           updated_at = CURRENT_TIMESTAMP
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
  // Fail-closed: when we can't resolve a founder user_id (legacy
  // unlinked rows, missing JOIN), mask the row instead of returning
  // it raw. Only an explicit active pairwise NDA against a known
  // founder unlocks the un-masked payload. This makes the mask
  // robust to upstream query mistakes.
  let unlocked = false;
  if (founderUserId) {
    unlocked = await hasActivePairwiseNda(env, founderUserId, ctx.viewerUserId);
  }
  if (unlocked) return row;
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    masked[k] = FOUNDER_PUBLIC_KEYS.has(k) ? v : null;
  }
  masked.__masked = true;          // UI hint: render the "Sign NDA to unlock" banner
  masked.__mask_reason = founderUserId ? 'no_pairwise_nda' : 'founder_unresolved';
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
 * KYC / KYB nightly reconciliation. Persona/Sumsub callbacks update
 * `users.kyc_status` and `corporate_profiles.kyb_status` (when the
 * provider is wired). This cron job materialises those provider
 * verdicts into the canonical `legal_obligations` rows so the Trust
 * Center / mask gate sees them.
 *
 * Algorithm (idempotent, safe to re-run):
 *   1. KYC: any pending/in_review kyc_v1 row whose user.kyc_status
 *      is 'approved' → flip to satisfied + 24mo expiry. If status
 *      is 'rejected' → flip back to pending (re-required).
 *   2. KYB: same flow against corporate_profiles.kyb_status.
 *
 * Returns counts for /api/admin diagnostics.
 */
export async function resyncKycKyb(env: Env): Promise<{ scanned: number; updated: number }> {
  await ensureTrustSchema(env);
  const now = Date.now();
  const kycExpiresAt = new Date(now + TTL_24_MO).toISOString();
  let scanned = 0;
  let updated = 0;

  // -- KYC reconciliation ---------------------------------------------------
  try {
    const pendingKyc: any = await env.DB.prepare(
      `SELECT lo.id AS oblig_id, lo.user_id, u.kyc_status
         FROM legal_obligations lo
         JOIN users u ON u.id = lo.user_id
        WHERE lo.obligation_key = 'kyc_v1'
          AND lo.status IN ('pending','in_review')`,
    ).all().catch(() => ({ results: [] as any[] }));
    const rows: any[] = pendingKyc?.results || [];
    scanned += rows.length;
    for (const r of rows) {
      if (r.kyc_status === 'approved') {
        const upd = await env.DB.prepare(
          `UPDATE legal_obligations
              SET status = 'satisfied',
                  expires_at = ?,
                  evidence_meta = COALESCE(evidence_meta, json_object('source','kyc_provider','synced_at',?)),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        ).bind(kycExpiresAt, new Date(now).toISOString(), r.oblig_id).run().catch(() => null);
        if ((upd?.meta as any)?.changes) updated += 1;
      } else if (r.kyc_status === 'rejected') {
        const upd = await env.DB.prepare(
          `UPDATE legal_obligations SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status != 'pending'`,
        ).bind(r.oblig_id).run().catch(() => null);
        if ((upd?.meta as any)?.changes) updated += 1;
      }
    }
  } catch (e) {
    console.error('[trust] resyncKycKyb KYC failed', e);
  }

  // -- KYB reconciliation (entity investors) --------------------------------
  try {
    const pendingKyb: any = await env.DB.prepare(
      `SELECT lo.id AS oblig_id, lo.user_id, cp.kyb_status
         FROM legal_obligations lo
         LEFT JOIN corporate_profiles cp ON cp.user_id = lo.user_id
        WHERE lo.obligation_key = 'kyb_v1'
          AND lo.status IN ('pending','in_review')`,
    ).all().catch(() => ({ results: [] as any[] }));
    const rows: any[] = pendingKyb?.results || [];
    scanned += rows.length;
    for (const r of rows) {
      if (r.kyb_status === 'approved') {
        const upd = await env.DB.prepare(
          `UPDATE legal_obligations
              SET status = 'satisfied',
                  expires_at = ?,
                  evidence_meta = COALESCE(evidence_meta, json_object('source','kyb_provider','synced_at',?)),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        ).bind(kycExpiresAt, new Date(now).toISOString(), r.oblig_id).run().catch(() => null);
        if ((upd?.meta as any)?.changes) updated += 1;
      } else if (r.kyb_status === 'rejected') {
        const upd = await env.DB.prepare(
          `UPDATE legal_obligations SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status != 'pending'`,
        ).bind(r.oblig_id).run().catch(() => null);
        if ((upd?.meta as any)?.changes) updated += 1;
      }
    }
  } catch (e) {
    console.error('[trust] resyncKycKyb KYB failed', e);
  }

  return { scanned, updated };
}

// ---------------------------------------------------------------------------
// Trust Center v2 — provenance, the score, and its history.
// ---------------------------------------------------------------------------

/**
 * The one-line "where this status came from" the v2 canvas draws under an
 * obligation row.
 *
 * The fact was never missing, only unexposed: `evidence_meta` has carried
 * `{"source":"kyc_provider","synced_at":…}` since the KYC sync landed, and
 * `evidence_envelope_uuid` names the signed envelope. `/me` simply never
 * returned either, so the page had nothing to render.
 *
 * Returns null rather than a filler string when there is no evidence — an
 * obligation nobody has satisfied yet HAS no provenance, and "Added manually"
 * over a row nothing touched would be an invention (D56/D68).
 */
export function obligationSource(row: any): string | null {
  const uuid = row?.evidence_envelope_uuid;
  if (uuid) return `Signed envelope ${String(uuid).slice(0, 8)}`;
  const raw = row?.evidence_meta;
  if (!raw) return null;
  let meta: any = null;
  try { meta = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const src = meta && typeof meta.source === 'string' ? meta.source.trim() : '';
  if (!src) return null;
  // The two writers in `resyncKycKyb` are the only producers today; anything
  // else is shown verbatim rather than dropped, so a new writer surfaces
  // instead of silently rendering nothing.
  const LABEL: Record<string, string> = {
    kyc_provider: 'Synced from identity verification',
    kyb_provider: 'Synced from entity verification',
  };
  return LABEL[src] || `Synced from ${src.replace(/_/g, ' ')}`;
}

/**
 * The worker's copy of the frontend's `computeTrustScore`.
 *
 * DUPLICATED ON PURPOSE, AND GUARDED. The score has to be computed here
 * because it is written to `trust_score_snapshots` and a history the caller
 * can set is not a history. Production code never imports across the
 * `frontend/src` ↔ `cloudflare-worker/src` line in this repo, so the rule
 * exists twice — and `cloudflare-worker/test/trust_score_parity.test.ts`
 * imports BOTH (this one and `frontend/src/lib/trustCenter.js`), runs them
 * over the same fixtures, and fails if they ever disagree. The frontend's
 * copy had to move out of `TrustScoreBadge.jsx` for that to be possible: a
 * rule exported from a `.jsx` drags React into any test that imports it.
 *
 * A user with no REQUIRED obligations scores 100: nothing is being asked of
 * them, so nothing is outstanding. That is the frontend's rule too, and the
 * parity test pins it.
 */
export function trustScoreOf(obligations: any[]): number {
  const required = (obligations || []).filter(o => o.required);
  if (required.length === 0) return 100;
  const satisfied = required.filter(
    o => o.status === 'satisfied' || o.status === 'waived',
  ).length;
  return Math.round((satisfied / required.length) * 100);
}

/** '2026-09' for the instant given — a calendar label, never re-parsed. */
export function monthLabel(d: Date): string {
  // UTC deliberately: the label keys a row that must be stable for a user
  // whatever timezone they read from, and a local-month boundary would give
  // two readers on the same day different months.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Record this month's score (once) and report the most recent EARLIER month
 * on file.
 *
 * The write is `INSERT OR IGNORE` against the UNIQUE (user_id, captured_month)
 * index, so the first read in a month records it and every later read that
 * month is a no-op — the stored number is the score as it stood when the month
 * was first observed, not the last.
 *
 * The comparison is against the most recent month STRICTLY BEFORE this one,
 * and the month is returned alongside the number, because a user who did not
 * open the page for a while is being compared with whenever they last did —
 * calling that "last month" when it was four months ago would be wrong. The
 * page names the month it found.
 *
 * Never throws: a missing table on a stale D1 degrades to "no history", which
 * renders as the stated absence, not as a zero delta.
 */
export async function recordAndCompareScore(
  env: Env,
  userId: number,
  score: number,
  now: Date = new Date(),
): Promise<{ previousScore: number | null; previousMonth: string | null }> {
  const month = monthLabel(now);
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO trust_score_snapshots (user_id, captured_month, score)
       VALUES (?, ?, ?)`,
    ).bind(userId, month, score).run();
  } catch (e) {
    console.error('[trust] score snapshot write failed', e);
  }
  try {
    const prev: any = await env.DB.prepare(
      `SELECT captured_month, score FROM trust_score_snapshots
        WHERE user_id = ? AND captured_month < ?
        ORDER BY captured_month DESC LIMIT 1`,
    ).bind(userId, month).first();
    if (!prev) return { previousScore: null, previousMonth: null };
    return {
      previousScore: Number(prev.score),
      previousMonth: String(prev.captured_month),
    };
  } catch (e) {
    console.error('[trust] score history read failed', e);
    return { previousScore: null, previousMonth: null };
  }
}

// ---------------------------------------------------------------------------
// Envelope history — Trust Center v2's per-agreement timeline.
// ---------------------------------------------------------------------------

/**
 * One row of the timeline the canvas draws when an agreement is expanded.
 * Deliberately narrow: a label and an instant, nothing else.
 */
export interface EnvelopeEvent { action: string; at: string }

/**
 * The audit actions `routes/esign.ts` actually appends, and nothing else.
 *
 * The canvas draws Sent / Viewed / Signed, and all three are real here —
 * `envelope_created`, `envelope_viewed` and `envelope_signed` are written by
 * `appendAudit` on the live signing flow. Nothing had to be invented, which
 * is why this is a timeline and not a derivation from two timestamps.
 *
 * An action NOT on this list is still returned, humanised, for the same
 * reason `obligationSource` shows an unknown provenance: a new writer should
 * surface on the page rather than be silently dropped by a stale list.
 */
export const ENVELOPE_EVENT_LABELS: Record<string, string> = {
  envelope_created: 'Sent',
  envelope_viewed: 'Viewed',
  envelope_signed: 'Signed',
  envelope_rejected: 'Declined',
  // Not an audit action — synthesised below from `esign_envelopes.completed_at`,
  // which the last signature sets and nothing appends an event for.
  envelope_completed: 'Completed',
  document_downloaded: 'Downloaded',
  document_downloaded_by_recipient: 'Downloaded',
  document_forwarded: 'Forwarded',
};

/**
 * The caller's own timeline for one envelope.
 *
 * AUTHORISATION, and the shape of what is NOT returned:
 *
 *   - The caller must be a recipient of the envelope. Matched on
 *     `r.user_id` OR the lowercased email, because `recipient_user_id` is not
 *     set on legacy rows — the same join `/agreements` uses to build the
 *     pending list, so a row that appears there can always be expanded.
 *   - A non-recipient gets `null`, which the route turns into a 404 rather
 *     than a 403: the existing `/my_signing_url` handler already refuses to
 *     confirm that an envelope exists, and this must not become the oracle
 *     that one isn't.
 *   - `esign_audit_events` carries `ip`, `ua`, `signer_email` and `meta`.
 *     NONE of them leave the worker. A counterparty's IP address is not part
 *     of what the canvas draws and not something this page has any reason to
 *     disclose; the full trail stays available to admins through
 *     `GET /api/legal/esign/:id`.
 *
 * Legacy rows fall back to the `audit_log` JSON column, which was the source
 * of truth before `esign_audit_events` existed and is described in
 * `routes/esign.ts` as "kept for backward compatibility but no longer written
 * to". Without the fallback every envelope created before that switch would
 * expand to an empty timeline and look as though nothing had happened to it.
 */
export async function envelopeHistory(
  env: Env,
  envelopeUuid: string,
  caller: { id: number; email?: string | null },
): Promise<EnvelopeEvent[] | null> {
  const row: any = await env.DB.prepare(
    `SELECT e.id, e.completed_at, e.audit_log
       FROM esign_envelopes e
       JOIN esign_recipients r ON r.envelope_id = e.id
      WHERE e.envelope_uuid = ?
        AND (r.user_id = ? OR LOWER(IFNULL(r.recipient_email,'')) = LOWER(?))
      LIMIT 1`,
  ).bind(envelopeUuid, caller.id, caller.email || '').first().catch(() => null);
  if (!row) return null;

  const events: EnvelopeEvent[] = [];
  try {
    const res: any = await env.DB.prepare(
      `SELECT action, ts FROM esign_audit_events
        WHERE envelope_id = ? ORDER BY ts ASC, id ASC LIMIT 200`,
    ).bind(row.id).all();
    for (const e of (res?.results || []) as any[]) {
      if (e?.action && e?.ts) events.push({ action: String(e.action), at: String(e.ts) });
    }
  } catch { /* table absent on a stale D1 — fall through to the JSON column */ }

  if (events.length === 0 && row.audit_log) {
    try {
      const legacy = JSON.parse(String(row.audit_log));
      if (Array.isArray(legacy)) {
        for (const e of legacy) {
          if (e?.action && e?.ts) events.push({ action: String(e.action), at: String(e.ts) });
        }
      }
    } catch { /* a malformed blob is no history, not a 500 */ }
  }

  // `completed_at` is set by the LAST signature and has no audit action of
  // its own, so the timeline would otherwise end on "Signed" for an envelope
  // that is finished. Appended rather than synthesised from the signatures:
  // it is a stored column, not a guess about what the events imply.
  if (row.completed_at) events.push({ action: 'envelope_completed', at: String(row.completed_at) });

  events.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  return events;
}

// ---------------------------------------------------------------------------
// Task #163 — warn people BEFORE something lapses.
// ---------------------------------------------------------------------------

/**
 * How far ahead a warning goes out, largest first.
 *
 * Three, each sent once, then silence until `expireDueArtifacts` flips the
 * row. Chosen with the user over a single 30-day notice (one miss and you
 * hear nothing again) and over a weekly drumbeat (four or five per item is
 * how a compliance notice teaches people to ignore compliance notices).
 */
export const RENEWAL_THRESHOLDS = [30, 14, 7] as const;

/** What a warning is about. Widened only by adding a table above. */
export type RenewalSubjectKind = 'obligation' | 'pairwise_nda';

export interface RenewalItem {
  userId: number;
  kind: RenewalSubjectKind;
  subjectId: number;
  /** The stored deadline, verbatim — the claim key depends on it. */
  expiresAt: string;
  /** Whole days from `now` to the deadline, rounded down. */
  daysLeft: number;
  /** Which of RENEWAL_THRESHOLDS this crossing belongs to. */
  threshold: number;
  /** What to call it in the notice. */
  label: string;
}

/**
 * Which threshold a deadline this far out belongs to, or null if none.
 *
 * THE SMALLEST CROSSED ONE, not the nearest. A sweep that misses a night —
 * a failed cron, a deploy, a D1 blip — would otherwise skip that threshold
 * forever, because the next run finds the item already past it. Taking the
 * smallest crossed threshold means a missed 14-day run still warns at 13,
 * once, under the 14-day claim.
 */
export function renewalThresholdFor(daysLeft: number): number | null {
  if (!Number.isFinite(daysLeft) || daysLeft < 0) return null;
  let hit: number | null = null;
  for (const t of RENEWAL_THRESHOLDS) if (daysLeft <= t) hit = t;
  return hit;
}

/** Whole days between two instants, floored. Negative once past. */
export function daysUntil(expiresAt: string, now: Date): number | null {
  const t = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now.getTime()) / 86_400_000);
}

/**
 * The obligation keys as a person would say them.
 *
 * Deliberately duplicated from `OBLIGATION_META` in `TrustCenterPage.jsx`
 * rather than imported: production code never crosses the
 * `frontend/src` <-> `cloudflare-worker/src` line in this repo. The guard
 * test imports both and compares them, the same treatment the trust score
 * and the envelope-event labels get.
 */
export const OBLIGATION_LABELS: Record<string, string> = {
  tos_v1: 'Terms of Service',
  privacy_v1: 'Privacy Policy',
  founder_nda_v1: 'Founder NDA',
  investor_nda_v1: 'Investor NDA',
  mentor_nda_v1: 'Advisor NDA',
  mentor_disclaimer_v1: 'Advisor disclaimer',
  partner_msa_v1: 'Partner MSA',
  kyc_v1: 'Identity verification (KYC)',
  kyb_v1: 'Entity verification (KYB)',
  accreditation_v1: 'Accreditation evidence',
};

export function obligationLabel(key: string): string {
  return OBLIGATION_LABELS[String(key || '')] || String(key || 'Obligation');
}

/**
 * One line per expiring item: what it is and how long is left.
 *
 * A STATE, NOT A DATE. `expires 3/14/2027` reads the same whether it is two
 * years out or next Tuesday, which is exactly the defect `expiryNote` was
 * written to fix on `/trust`. The notice repeats that lesson rather than
 * re-learning it.
 */
export function renewalItemLine(item: { label: string; daysLeft: number }): string {
  const d = item.daysLeft;
  if (d <= 0) return `${item.label} — expires today`;
  return `${item.label} — expires in ${d} ${d === 1 ? 'day' : 'days'}`;
}

/**
 * The digest one person receives.
 *
 * ONE DERIVATION OF "how many", used by the title and the body both. The
 * Trust Center shipped a frame where a tally and a sentence beside it
 * disagreed about the same rows; a notice that says "2 items" over a list of
 * three would be the same defect delivered by email.
 *
 * The soonest deadline drives the title, because that is the one that
 * decides how urgently this needs reading.
 */
export function renewalDigest(items: RenewalItem[]): { title: string; body: string } {
  const sorted = [...items].sort((a, b) => a.daysLeft - b.daysLeft);
  const n = sorted.length;
  const soonest = sorted[0];
  const title = n === 1
    ? `${soonest.label} expires in ${Math.max(0, soonest.daysLeft)} ${soonest.daysLeft === 1 ? 'day' : 'days'}`
    : `${n} items expire soon — the first in ${Math.max(0, soonest.daysLeft)} ${soonest.daysLeft === 1 ? 'day' : 'days'}`;
  const lines = sorted.map(i => `• ${renewalItemLine(i)}`);
  return {
    title,
    // No instruction the platform cannot honour: the Trust Center is where
    // these are resolved, and the link goes there.
    body: `${lines.join('\n')}\n\nRenew them from your Trust Center before they lapse.`,
  };
}

/**
 * Nightly: find what is about to lapse, claim each warning exactly once, and
 * send one digest per person.
 *
 * COVERS EXACTLY THE ROWS `expireDueArtifacts` FLIPS — `legal_obligations`
 * that are `satisfied` with a deadline, and `pairwise_ndas` that are
 * `active` with one. That predicate is copied on purpose rather than
 * reinvented: if the warning and the expiry disagreed about what expires,
 * someone would be warned about an item that never lapses, or lapse without
 * a warning. It also gives the "never warn about an already-settled row"
 * rule for free — a `waived`, `revoked` or already-`expired` row is not
 * `satisfied`/`active` and never matches.
 *
 * Every D1 call is wrapped: one unreadable row must not cost everyone else
 * their warning, the same posture `expireDueArtifacts` and `resyncKycKyb`
 * already take.
 */
export async function renewalSweep(
  env: Env,
  now: Date = new Date(),
  deps: { notify?: (env: Env, args: any) => Promise<unknown> } = {},
): Promise<{ scanned: number; claimed: number; notified: number }> {
  await ensureTrustSchema(env);
  const horizon = new Date(now.getTime() + RENEWAL_THRESHOLDS[0] * 86_400_000).toISOString();
  const nowIso = now.toISOString();
  const candidates: RenewalItem[] = [];
  let scanned = 0;

  // -- obligations ----------------------------------------------------------
  try {
    const res: any = await env.DB.prepare(
      `SELECT id, user_id, obligation_key, expires_at
         FROM legal_obligations
        WHERE status = 'satisfied'
          AND expires_at IS NOT NULL
          AND expires_at > ?
          AND expires_at <= ?`,
    ).bind(nowIso, horizon).all();
    for (const r of ((res?.results || []) as any[])) {
      scanned += 1;
      const daysLeft = daysUntil(r.expires_at, now);
      if (daysLeft === null) continue;
      const threshold = renewalThresholdFor(daysLeft);
      if (threshold === null) continue;
      candidates.push({
        userId: Number(r.user_id), kind: 'obligation', subjectId: Number(r.id),
        expiresAt: String(r.expires_at), daysLeft, threshold,
        label: obligationLabel(r.obligation_key),
      });
    }
  } catch (e) { console.error('[trust] renewal scan (obligations) failed', e); }

  // -- pairwise NDAs --------------------------------------------------------
  // BOTH PARTIES. One row, two people who lose cover when it lapses — and
  // the claim key carries user_id precisely so the first party's warning
  // does not swallow the second's.
  try {
    const res: any = await env.DB.prepare(
      `SELECT id, party_a_user_id, party_b_user_id, valid_until
         FROM pairwise_ndas
        WHERE status = 'active'
          AND valid_until IS NOT NULL
          AND valid_until > ?
          AND valid_until <= ?`,
    ).bind(nowIso, horizon).all();
    for (const r of ((res?.results || []) as any[])) {
      scanned += 1;
      const daysLeft = daysUntil(r.valid_until, now);
      if (daysLeft === null) continue;
      const threshold = renewalThresholdFor(daysLeft);
      if (threshold === null) continue;
      for (const uid of [r.party_a_user_id, r.party_b_user_id]) {
        if (!Number.isFinite(Number(uid)) || Number(uid) <= 0) continue;
        candidates.push({
          userId: Number(uid), kind: 'pairwise_nda', subjectId: Number(r.id),
          expiresAt: String(r.valid_until), daysLeft, threshold,
          label: 'Mutual NDA',
        });
      }
    }
  } catch (e) { console.error('[trust] renewal scan (NDAs) failed', e); }

  // -- claim, then group ----------------------------------------------------
  // THE INSERT IS THE DECISION. `INSERT OR IGNORE` succeeds exactly once per
  // (person, item, threshold, deadline); a second run the same night claims
  // nothing and therefore sends nothing. Two overlapping runs cannot
  // double-send for the same reason.
  const byUser = new Map<number, RenewalItem[]>();
  let claimed = 0;
  for (const c of candidates) {
    let won = false;
    try {
      const ins: any = await env.DB.prepare(
        `INSERT OR IGNORE INTO renewal_notices
           (user_id, subject_kind, subject_id, threshold_days, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(c.userId, c.kind, c.subjectId, c.threshold, c.expiresAt).run();
      won = Number((ins?.meta as any)?.changes ?? 0) === 1;
    } catch (e) { console.error('[trust] renewal claim failed', e); }
    if (!won) continue;
    claimed += 1;
    const list = byUser.get(c.userId) || [];
    list.push(c);
    byUser.set(c.userId, list);
  }

  // -- one notice per person ------------------------------------------------
  const send = deps.notify
    || (async (e: Env, a: any) => (await import('./notify')).notify(e, a));
  let notified = 0;
  for (const [userId, items] of byUser) {
    const { title, body } = renewalDigest(items);
    try {
      await send(env, {
        userId,
        type: 'renewal_due',
        // NOT critical, deliberately. An omitted or critical category
        // bypasses quiet hours AND the digest buffer (notify.ts), which is
        // the opposite of what a batched renewal notice is for.
        category: 'compliance',
        title,
        body,
        link: '/trust',
        channels: ['in_app', 'email'],
        payload: {
          items: items.map(i => ({
            kind: i.kind, subject_id: i.subjectId, label: i.label,
            expires_at: i.expiresAt, days_left: i.daysLeft, threshold: i.threshold,
          })),
        },
      });
      notified += 1;
    } catch (e) {
      // The claim already succeeded, so a failed send costs this person this
      // warning rather than repeating it nightly. That is the safe direction:
      // the next threshold still fires, and the alternative — rolling the
      // claim back — turns a flaky notifier into a nightly spammer.
      console.error('[trust] renewal notify failed', userId, e);
    }
  }

  return { scanned, claimed, notified };
}
