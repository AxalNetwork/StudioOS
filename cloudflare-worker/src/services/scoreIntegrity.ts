// Epic 5 — anti-cheat for the diligence & scoring engine.
// Reserved-field rejection, HMAC-SHA256 sign/verify, anomaly detection,
// and the centralized verified-read helper used by every LP/partner-facing
// score surface. Sandbox rows are deliberately exempt from rate limiting,
// anomaly detection, and LP visibility.
import type { Env } from '../types';

export const INTEGRITY_VERSION = 'v1';

// Server-computed fields a client must never supply on a /score request.
const RESERVED_INPUT_FIELDS = [
  'score',
  'tier',
  'score_breakdown',
  'total_score',
  'breakdown',
  'integrity_hash',
  'integrity_version',
  'admin_review_status',
] as const;

// Numeric rubric inputs that an OFFICIAL run must include. Names match the
// scoring engine in services/scoring.ts (and the form field names in
// frontend/src/pages/ScoringPage.jsx). Sandbox runs are permissive — official
// runs reject incomplete payloads so a founder can't submit a partial form,
// see the score, then iterate during cooldown.
export const REQUIRED_OFFICIAL_INPUTS = [
  'tam',
  'market_urgency',
  'market_trend',
  'team_expertise',
  'team_execution',
  'team_network',
  'mvp_time_days',
  'product_complexity',
  'product_dependencies',
  'cost_to_mvp',
  'time_to_revenue_months',
  'burn_risk',
  'fit_alignment',
  'fit_synergy',
  'distribution_channels',
  'distribution_virality',
] as const;

export class ReservedFieldError extends Error {
  field: string;
  constructor(field: string) {
    super(`Field "${field}" is server-computed and may not be supplied by the client.`);
    this.field = field;
  }
}

export class MissingOfficialInputsError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Official run requires: ${missing.join(', ')}.`);
    this.missing = missing;
  }
}

export function assertNoReservedFields(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  for (const f of RESERVED_INPUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      throw new ReservedFieldError(f);
    }
  }
}

// Strict required-field validation for OFFICIAL runs. Throws with the list
// of missing/non-numeric inputs so the route can return a structured 400.
export function assertOfficialInputsComplete(body: Record<string, unknown>): void {
  const missing: string[] = [];
  for (const k of REQUIRED_OFFICIAL_INPUTS) {
    const v = body[k];
    if (v === undefined || v === null || v === '') {
      missing.push(k);
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) missing.push(k);
  }
  if (missing.length) throw new MissingOfficialInputsError(missing);
}

// HMAC keying with domain separation.
//
//   • SCORING_HMAC_SECRET set → use it VERBATIM. It is a dedicated key
//     (production hard-requires it at ≥32 bytes — see auth.ts), so there is
//     no key-reuse concern and every stored hash keeps verifying.
//   • otherwise (dev/preview only) → DERIVE an independent subkey from
//     JWT_SECRET via HKDF-SHA256 rather than reusing JWT_SECRET verbatim.
//     Reusing the auth-signing key verbatim to also sign scores is textbook
//     key reuse across two protocols: one leaked secret would forge BOTH
//     JWTs and scores. HKDF with a fixed salt+info yields a cryptographically
//     separate key with NO new secret to provision.
//
// In ALL environments we FAIL FAST if no usable key (≥16 chars) is present.
// A previous version returned a hardcoded fallback string in non-production
// environments, which is unsafe: if a deploy ever ran without
// ENVIRONMENT=production by mistake, score signatures could be forged by
// anyone reading the public source. Local devs and tests must set JWT_SECRET
// (or SCORING_HMAC_SECRET) explicitly — see .env.example.
//
// NOTE: the HKDF fallback changes derived hashes vs. the old verbatim path,
// but ONLY in dev/preview (prod always has the explicit secret), so prod
// hashes are unaffected. INTEGRITY_VERSION is intentionally NOT bumped — the
// prod canonical message + key are unchanged.
const HKDF_SALT = 'axal:score-integrity';
const HKDF_INFO = 'scoring-hmac:v1';

async function deriveScoringKey(env: Env): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const explicit = env.SCORING_HMAC_SECRET || '';
  if (explicit) {
    if (explicit.length < 16) {
      throw new Error('SCORING_HMAC_SECRET is shorter than 16 chars. Refusing to sign with an insecure key.');
    }
    return crypto.subtle.importKey('raw', enc.encode(explicit), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  const jwt = env.JWT_SECRET || '';
  if (!jwt || jwt.length < 16) {
    throw new Error(
      'SCORING_HMAC_SECRET (or JWT_SECRET) is missing or shorter than 16 chars. ' +
      'Set SCORING_HMAC_SECRET via `wrangler secret put` in production, ' +
      'or JWT_SECRET in your local .env for dev. Refusing to sign with an insecure key.',
    );
  }
  // Domain-separate the auth key into an independent score-signing subkey.
  const ikm = await crypto.subtle.importKey('raw', enc.encode(jwt), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(HKDF_INFO) },
    ikm,
    256,
  );
  return crypto.subtle.importKey('raw', new Uint8Array(bits), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function hmacSha256(key: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Stable canonical form fed into the HMAC. Bumping it is a breaking change
// to every stored hash — bump INTEGRITY_VERSION in lock-step.
function canonicalMessage(projectId: number, score: number, version: string, timestamp: string): string {
  return `pid=${projectId}|score=${Number(score).toFixed(2)}|ver=${version}|ts=${timestamp}`;
}

export async function signScore(
  env: Env,
  projectId: number,
  score: number,
  timestamp: string,
  version: string = INTEGRITY_VERSION,
): Promise<string> {
  const key = await deriveScoringKey(env);
  return hmacSha256(key, canonicalMessage(projectId, score, version, timestamp));
}

// Generic HMAC over an already-canonicalized message, reusing the exact same
// domain-separated keying (deriveScoringKey) and SHA-256 algorithm as
// signScore. Used by the assessment engine (services/assessmentScoring.ts) so
// result signing shares one source of truth for the key derivation + algorithm
// rather than re-implementing crypto.subtle.
export async function signHmac(env: Env, message: string): Promise<string> {
  const key = await deriveScoringKey(env);
  return hmacSha256(key, message);
}

// Minimal shape a score snapshot row exposes for verification + visibility.
// Matches the columns added by `score_anti_cheat.sql`.
export interface ScoreSnapshotRow {
  id: number;
  project_id: number;
  total_score: number;
  tier: string | null;
  is_sandbox: number | boolean | null;
  admin_review_status: string | null;
  integrity_hash: string | null;
  integrity_version: string | null;
  created_at: string;
}

export async function verifyScoreHash(
  env: Env,
  snapshot: Pick<ScoreSnapshotRow, 'project_id' | 'total_score' | 'integrity_hash' | 'integrity_version' | 'created_at'>,
): Promise<{ valid: boolean; reason?: string }> {
  if (!snapshot.integrity_hash) return { valid: false, reason: 'missing_hash' };
  const ver = snapshot.integrity_version || INTEGRITY_VERSION;
  const expected = await signScore(env, snapshot.project_id, Number(snapshot.total_score), snapshot.created_at, ver);
  if (expected.length !== snapshot.integrity_hash.length) {
    return { valid: false, reason: 'length_mismatch' };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ snapshot.integrity_hash.charCodeAt(i);
  }
  return diff === 0 ? { valid: true } : { valid: false, reason: 'hash_mismatch' };
}

// Roles whose reads we audit. LP/investor are wire-only roles (not in the
// narrow User.role union) so we accept a string here and check by value.
const AUDITABLE_ROLES = new Set(['admin', 'partner', 'lp', 'investor']);
export function isAuditableRole(role: string | null | undefined): boolean {
  return !!role && AUDITABLE_ROLES.has(role);
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

export interface AnomalyFlag {
  type: 'input_jump' | 'duplicate_text' | 'practice_jump' | 'rapid_iteration';
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

interface DetectInput {
  projectId: number;
  totalScore: number;
  isSandbox: boolean;
  inputs: Record<string, unknown>;
  qualitativeText?: string | null;
}

export async function detectAnomalies(env: Env, snap: DetectInput): Promise<AnomalyFlag[]> {
  const flags: AnomalyFlag[] = [];
  const db = env.DB;

  // Input jump >50% within 14 days (official only).
  if (!snap.isSandbox) {
    try {
      const last = await db.prepare(
        `SELECT inputs_json, total_score, created_at FROM score_snapshots
          WHERE project_id = ? AND is_sandbox = 0
            AND created_at >= datetime('now', '-14 days')
          ORDER BY id DESC LIMIT 1`,
      ).bind(snap.projectId).first<{ inputs_json: string | null; total_score: number; created_at: string }>();
      if (last?.inputs_json) {
        try {
          const prev = JSON.parse(last.inputs_json) as Record<string, number>;
          for (const [k, v] of Object.entries(snap.inputs)) {
            const oldVal = Number(prev[k] ?? 0);
            const newVal = Number(v ?? 0);
            if (oldVal > 0 && newVal > 0) {
              const delta = Math.abs(newVal - oldVal) / Math.max(Math.abs(oldVal), 1);
              if (delta > 0.5) {
                flags.push({
                  type: 'input_jump',
                  severity: delta > 2 ? 'high' : 'medium',
                  detail: `Input "${k}" jumped from ${oldVal} → ${newVal} (${Math.round(delta * 100)}%) within 14 days.`,
                });
                break;
              }
            }
          }
        } catch { /* malformed JSON, skip */ }
      }
    } catch { /* table without inputs_json on first deploy */ }
  }

  // Identical qualitative text across projects.
  if (snap.qualitativeText && snap.qualitativeText.trim().length >= 80) {
    try {
      const dupes = await db.prepare(
        `SELECT project_id, created_at FROM score_snapshots
          WHERE qualitative_text = ? AND project_id != ?
          ORDER BY id DESC LIMIT 1`,
      ).bind(snap.qualitativeText, snap.projectId).first<{ project_id: number; created_at: string }>();
      if (dupes) {
        flags.push({
          type: 'duplicate_text',
          severity: 'high',
          detail: `Identical qualitative text found on project #${dupes.project_id}.`,
        });
      }
    } catch { /* column missing on stale env */ }
  }

  // Practice-jump: any single run more than 25 pts above the latest practice
  // run within 14 days (spec). Catches both "ramp practice scores" and
  // "submit official higher than practice" exploits.
  const practice = await env.DB.prepare(
    `SELECT total_score FROM score_snapshots
      WHERE project_id = ? AND is_sandbox = 1
        AND created_at >= datetime('now', '-14 days')
      ORDER BY id DESC LIMIT 1`,
  ).bind(snap.projectId).first<{ total_score: number }>();
  if (practice?.total_score != null) {
    const delta = Math.abs(Number(snap.totalScore) - Number(practice.total_score));
    if (delta > 25) {
      flags.push({
        type: 'practice_jump',
        severity: delta > 40 ? 'high' : 'medium',
        detail: `${snap.isSandbox ? 'Practice→practice' : 'Practice→official'} jump of ${delta.toFixed(1)} pts (>25, 14d window).`,
      });
    }
  }

  // Rapid sandbox iteration (>10 in 1h).
  if (snap.isSandbox) {
    const cnt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM score_snapshots
        WHERE project_id = ? AND is_sandbox = 1
          AND created_at >= datetime('now', '-1 hour')`,
    ).bind(snap.projectId).first<{ n: number }>();
    if (cnt && Number(cnt.n) > 10) {
      flags.push({
        type: 'rapid_iteration',
        severity: 'low',
        detail: `${cnt.n} sandbox runs in the last hour.`,
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Activity-log helper for LP/partner read auditing
// ---------------------------------------------------------------------------

// Log an LP/partner read so admin can replay disputes. Best-effort — never
// throw out of here; failing to log a read must not break the read.
export async function logScoreRead(
  env: Env,
  args: {
    snapshotId: number;
    projectId: number;
    userId: number | null;
    role: string;
    integrityHash: string | null;
    integrityValid: boolean | null;
  },
): Promise<void> {
  if (!isAuditableRole(args.role)) return;
  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (project_id, user_id, action, details, actor)
       VALUES (?, ?, 'score_read', ?, ?)`,
    ).bind(
      args.projectId,
      args.userId,
      JSON.stringify({
        snapshot_id: args.snapshotId,
        integrity_hash: args.integrityHash,
        integrity_valid: args.integrityValid,
        role: args.role,
      }),
      args.role,
    ).run();
  } catch { /* never crash a read because logging failed */ }
}

// ---------------------------------------------------------------------------
// Visibility filter + centralized verified-read helper
// ---------------------------------------------------------------------------

export interface VisibilityCtx {
  role: string;
  founderId?: number | null;
  ownerFounderId?: number | null;
}

// Should this snapshot be returned to the requester?
//  - sandbox rows: only the founder owner (and admin) ever see them
//  - flagged/rejected rows: only admin sees them
//  - tampered rows (hash mismatch): only admin sees them
export function snapshotIsVisible(
  snap: Pick<ScoreSnapshotRow, 'is_sandbox' | 'admin_review_status'>,
  hashValid: boolean | null,
  ctx: VisibilityCtx,
): boolean {
  const isSandbox = !!snap.is_sandbox;
  const status = snap.admin_review_status || 'auto_approved';

  if (ctx.role === 'admin') return true;

  if (isSandbox) {
    return ctx.role === 'founder' && !!ctx.founderId && ctx.founderId === ctx.ownerFounderId;
  }

  if (status === 'flagged' || status === 'rejected') return false;
  // Non-admins must NEVER see an official row whose hash is unverified.
  // `null` (= verification was skipped because integrity_hash was missing)
  // is treated as failure here, matching the spec that LP/partner reads
  // surface only signed, verified, approved snapshots.
  if (hashValid !== true) return false;

  return true;
}

// Centralized verified-read for every LP/partner-facing score surface.
// Returns the latest official snapshot for a project, ALWAYS:
//   1. recomputes the HMAC and discards the row on mismatch (non-admin)
//   2. enforces the visibility filter (sandbox/flagged/rejected hidden)
//   3. logs the read into activity_logs with the integrity hash
// `null` means "no LP-visible score". Use this from pipeline/portfolio/etc.
export async function getVerifiedLatestSnapshot(
  env: Env,
  projectId: number,
  ctx: VisibilityCtx & { userId: number | null },
): Promise<{ row: ScoreSnapshotRow; hashValid: boolean } | null> {
  const isAdmin = ctx.role === 'admin';
  // Non-admins only ever see auto_approved or admin-approved official rows.
  // Admins see the latest official row regardless so they can spot tampering.
  const sql = isAdmin
    ? `SELECT id, project_id, total_score, tier, is_sandbox, admin_review_status,
              integrity_hash, integrity_version, created_at
         FROM score_snapshots
        WHERE project_id = ? AND is_sandbox = 0
        ORDER BY id DESC LIMIT 1`
    : `SELECT id, project_id, total_score, tier, is_sandbox, admin_review_status,
              integrity_hash, integrity_version, created_at
         FROM score_snapshots
        WHERE project_id = ? AND is_sandbox = 0
          AND admin_review_status IN ('auto_approved','approved')
        ORDER BY id DESC LIMIT 1`;
  const row = await env.DB.prepare(sql).bind(projectId).first<ScoreSnapshotRow>();
  if (!row) return null;

  const verify = await verifyScoreHash(env, row);
  const hashValid = verify.valid;

  if (!snapshotIsVisible(row, hashValid, ctx)) {
    await logScoreRead(env, {
      snapshotId: row.id,
      projectId,
      userId: ctx.userId,
      role: ctx.role,
      integrityHash: row.integrity_hash,
      integrityValid: hashValid,
    });
    return null;
  }

  await logScoreRead(env, {
    snapshotId: row.id,
    projectId,
    userId: ctx.userId,
    role: ctx.role,
    integrityHash: row.integrity_hash,
    integrityValid: hashValid,
  });

  return { row, hashValid };
}
