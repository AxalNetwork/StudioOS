/**
 * Trust Center routes — Task #3 (Y-1).
 *
 *   GET    /api/trust/me               — obligations + summary for caller
 *   GET    /api/trust/agreements       — signed + pending NDAs touching caller
 *   POST   /api/trust/intro/request    — investor → founder; auto-issues NDA
 *   GET    /api/trust/intro/status     — pair NDA status check
 *   POST   /api/trust/obligation/:key/start
 *                                      — caller asserts they're starting
 *                                        evidence-collection (e.g. clicks
 *                                        "Sign Founder NDA" → flips status
 *                                        from 'pending' to 'in_review')
 *   GET    /api/trust/sanctions        — admin-only (stub for X-1)
 *
 * The 3-way NDA flow lives in `services/trust.ts` + reuses the existing
 * `esign` envelope/recipients tables (one envelope, three recipient rows).
 */
import { Hono } from 'hono';
import { stripTrailingSlashes } from '../util/url';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import {
  ensureTrustSchema,
  seedObligations,
  obligationsForRole,
  getPairwiseNda,
  hasActivePairwiseNda,
  upsertPairwiseNda,
  type ObligationKey,
} from '../services/trust';
import { getSQL } from '../db';

const trust = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /me — caller's obligations + a derived summary.
// ---------------------------------------------------------------------------
trust.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  // Self-heal: if the user is missing rows for their role (signup
  // pre-dates the seeder), top them up before responding.
  await seedObligations(c.env, user.id, user.role);
  const rows: any = await c.env.DB.prepare(
    `SELECT obligation_key, required, status, expires_at, evidence_envelope_uuid,
            updated_at, created_at
       FROM legal_obligations WHERE user_id = ? ORDER BY required DESC, obligation_key`,
  ).bind(user.id).all();
  const obligations = (rows?.results || []) as any[];
  const requiredOpen = obligations.filter(o => o.required && o.status !== 'satisfied' && o.status !== 'waived');
  return c.json({
    role: user.role,
    obligations,
    required_open_count: requiredOpen.length,
    fully_compliant: requiredOpen.length === 0,
  });
});

// ---------------------------------------------------------------------------
// GET /agreements — every NDA / contract touching the caller, drawn from
// three sources and unioned client-side:
//   1. `pairwise_ndas`       — mutual NDA pairs (both signed → active),
//   2. `esign_envelopes`     — pending envelopes the caller is a recipient on,
//   3. `documents`           — legacy signed contracts referencing the caller.
// Each source is wrapped in try/catch so a missing/legacy table on a stale
// D1 (e.g. envelopes / documents not yet provisioned) never blocks the
// canonical pairwise list. Admins also get the pairs they don't sit on.
// ---------------------------------------------------------------------------
trust.get('/agreements', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  // Make sure pairwise_ndas has the post-035 columns before we SELECT them.
  // On a stale D1 (pre-task-AH) the SELECT below would otherwise raise
  // "no such column: signers_json" and the .catch() would silently
  // swallow every pairwise row — hiding NDAs from the UI.
  const { ensurePairwiseNdaColumns } = await import('../services/sanctions');
  await ensurePairwiseNdaColumns(c.env);

  const pairwiseRows: any = await c.env.DB.prepare(
    `SELECT id, party_a_user_id, party_b_user_id, intermediary, nda_envelope_uuid,
            status, valid_until, signers_json, voided_at, voided_reason,
            created_at, updated_at
       FROM pairwise_ndas
      WHERE party_a_user_id = ? OR party_b_user_id = ?
      ORDER BY updated_at DESC LIMIT 200`,
  ).bind(user.id, user.id).all().catch(() => ({ results: [] }));

  // Pending envelopes the caller is a recipient on (joins esign_recipients
  // by email — `recipient_user_id` is not always set on legacy rows).
  let pending: any[] = [];
  try {
    const env: any = await c.env.DB.prepare(
      // `document_type` — there is no `agreement_type` column on
      // esign_envelopes, so this whole select threw.
      `SELECT e.envelope_uuid, e.document_type, e.status, e.created_at, e.completed_at,
              r.recipient_email, r.signed_at
         FROM esign_envelopes e
         JOIN esign_recipients r ON r.envelope_id = e.id
        WHERE LOWER(r.recipient_email) = LOWER(?)
          AND e.status IN ('sent','viewed','partial')
        ORDER BY e.created_at DESC LIMIT 100`,
    ).bind(user.email).all();
    pending = env?.results || [];
  } catch { pending = []; }

  // Legacy signed contracts referencing the caller (best-effort — schema
  // varies across deploys, so a single LIKE on `signed_by` is the lowest
  // common denominator).
  let documents: any[] = [];
  try {
    const docs: any = await c.env.DB.prepare(
      `SELECT id, uid, title, doc_type, status, signed_by, signed_at, created_at
         FROM documents
        WHERE status = 'signed' AND LOWER(IFNULL(signed_by,'')) LIKE ?
        ORDER BY signed_at DESC LIMIT 100`,
    ).bind('%' + (user.email || '').toLowerCase() + '%').all();
    documents = docs?.results || [];
  } catch { documents = []; }

  return c.json({
    agreements: pairwiseRows?.results || [],
    pending_envelopes: pending,
    documents,
  });
});

// ---------------------------------------------------------------------------
// GET /score/:userId — Task #4 (Y-2).
// Returns {score, missing[]} for any user. Readable by:
//   - the user themselves (self),
//   - admins, partners, investors (since they review founders/peers).
// Founders cannot see other founders' scores.
// ---------------------------------------------------------------------------
trust.get('/score/:userId', async (c) => {
  const caller = await requireAuth(c);
  const target = Number(c.req.param('userId'));
  if (!Number.isInteger(target) || target <= 0) return c.json({ error: 'invalid_user' }, 400);
  const isSelf = caller.id === target;
  const allowed = isSelf || caller.role === 'admin' || caller.role === 'partner' || caller.role === 'investor';
  if (!allowed) return c.json({ error: 'forbidden' }, 403);
  await ensureTrustSchema(c.env);
  // Self-heal: seed any missing rows for the target's role so a
  // legacy unseeded user doesn't return an optimistic 100. Mirrors
  // the behaviour of /trust/me.
  const targetRow: any = await c.env.DB.prepare(
    `SELECT role FROM users WHERE id = ? LIMIT 1`,
  ).bind(target).first();
  if (targetRow?.role) {
    await seedObligations(c.env, target, targetRow.role);
  }
  const rows: any = await c.env.DB.prepare(
    `SELECT obligation_key, required, status FROM legal_obligations WHERE user_id = ?`,
  ).bind(target).all();
  const obligations = (rows?.results || []) as any[];
  const required = obligations.filter(o => o.required);
  const satisfied = required.filter(o => o.status === 'satisfied' || o.status === 'waived').length;
  const score = required.length === 0 ? 100 : Math.round((satisfied / required.length) * 100);
  const missing = required
    .filter(o => o.status !== 'satisfied' && o.status !== 'waived')
    .map(o => o.obligation_key);
  return c.json({ user_id: target, score, missing, required_total: required.length });
});

// ---------------------------------------------------------------------------
// POST /score/batch — Task #40.
// Body: { user_ids: number[] }
// Returns: { scores: [{ user_id, score, missing[], required_total }] }
//
// Collapses N sequential GET /score/:userId calls (one per visible row in
// AdminPage Users / DealsPage pipeline) into a single round-trip + two
// SQL queries. Auth mirrors the single-user route minus the founder
// self-only branch — founders never need to see other people's scores
// in batch contexts (admin/investor/partner are the only callers that
// render a list of users with trust columns), so we hard-require those
// roles here. A founder asking for their OWN score still has the
// per-user GET /score/:userId fallback.
//
// Performance notes:
//   - We deliberately SKIP the per-user `seedObligations(role)` self-heal
//     that the single-user route runs. That self-heal exists to top up
//     legacy unseeded users on profile views; in a 50-row admin table,
//     calling it 50× would burn the latency this endpoint is here to
//     save. New signups go through `seedObligations` at registration,
//     and any unseeded legacy user falls back to score=100 (correct
//     "no required obligations" semantics) here, then gets re-seeded
//     the next time their profile page calls /score/:userId.
//   - Batch is capped at 200 user_ids per call (worker request body is
//     1MB; this is well under the practical bound but stops accidental
//     "send me every user" calls).
// ---------------------------------------------------------------------------
trust.post('/score/batch', async (c) => {
  const caller = await requireAuth(c);
  if (caller.role !== 'admin' && caller.role !== 'partner' && caller.role !== 'investor') {
    return c.json({ error: 'forbidden' }, 403);
  }
  const body = await c.req.json().catch(() => ({} as any));
  const raw = Array.isArray(body?.user_ids) ? body.user_ids : [];
  const ids: number[] = Array.from(new Set(
    raw.map((v: any) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
  )).slice(0, 200) as number[];
  if (ids.length === 0) return c.json({ scores: [] });
  await ensureTrustSchema(c.env);
  const placeholders = ids.map(() => '?').join(',');
  const rows: any = await c.env.DB.prepare(
    `SELECT user_id, obligation_key, required, status
       FROM legal_obligations
      WHERE user_id IN (${placeholders})`,
  ).bind(...ids).all();
  const grouped = new Map<number, any[]>();
  for (const id of ids) grouped.set(id, []);
  for (const r of (rows?.results || []) as any[]) {
    const arr = grouped.get(Number(r.user_id));
    if (arr) arr.push(r);
  }
  const scores = ids.map((id) => {
    const obligations = grouped.get(id) || [];
    const required = obligations.filter((o: any) => o.required);
    const satisfied = required.filter(
      (o: any) => o.status === 'satisfied' || o.status === 'waived',
    ).length;
    const score = required.length === 0 ? 100 : Math.round((satisfied / required.length) * 100);
    const missing = required
      .filter((o: any) => o.status !== 'satisfied' && o.status !== 'waived')
      .map((o: any) => o.obligation_key);
    return { user_id: id, score, missing, required_total: required.length };
  });
  return c.json({ scores });
});

// ---------------------------------------------------------------------------
// GET /agreements/:envelope_uuid/my_signing_url — Task #4 (Y-2).
// Returns the CALLER's own signing URL for an esign envelope they're a
// recipient of. Used by the Trust Center "Sign" CTA so a founder/investor
// can resume a pending pairwise NDA from inside the app instead of
// hunting through email. SECURITY: only ever returns the caller's own
// token — never another recipient's — and only while the caller's
// recipient row is `pending` and the token is not expired. 404 in any
// other case (including caller-not-a-recipient) so we don't leak the
// existence of the envelope.
// ---------------------------------------------------------------------------
trust.get('/agreements/:envelope_uuid/my_signing_url', async (c) => {
  const user = await requireAuth(c);
  const envelopeUuid = c.req.param('envelope_uuid');
  if (!envelopeUuid || envelopeUuid.length > 64) {
    return c.json({ error: 'invalid_envelope' }, 400);
  }
  const row: any = await c.env.DB.prepare(
    `SELECT r.signing_token, r.token_expires_at, r.status
       FROM esign_recipients r
       JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE e.envelope_uuid = ? AND r.user_id = ?
      LIMIT 1`,
  ).bind(envelopeUuid, user.id).first();
  if (!row) return c.json({ error: 'not_a_recipient' }, 404);
  if (row.status === 'signed') return c.json({ status: 'signed' });
  const exp = Date.parse(row.token_expires_at);
  if (Number.isFinite(exp) && exp < Date.now()) return c.json({ status: 'expired' });
  const appUrl = stripTrailingSlashes(c.env.APP_URL || 'https://axal.vc');
  return c.json({
    status: 'pending',
    signing_url: `${appUrl}/esign/${row.signing_token}`,
  });
});

// ---------------------------------------------------------------------------
// POST /intro/request — investor asks for an intro to a founder.
// Body: { founder_user_id }
// Behaviour:
//   1. Caller must be an investor (admins permitted for testing).
//   2. If a valid pairwise NDA already exists -> return it.
//   3. Otherwise create a 3-way envelope (Founder + Investor + Axal
//      counter-signer) using the nda_3way_v1 template, persist a row in
//      `pairwise_ndas`, and return the envelope_uuid so the UI can
//      route to the signing pages.
//
// Task #17 — the body of this handler is extracted into the pure
// `requestIntroLogic` function below so that worker tests can drive
// every branch (founder-not-found, target-is-not-a-founder,
// cannot-intro-self, already-active short-circuit, and the
// notifications_inbox write) with a fully mocked dependency surface.
// The Hono wrapper here is the only piece that touches `requireAuth`
// + dynamic provider imports.
// ---------------------------------------------------------------------------
trust.post('/intro/request', async (c) => {
  const investor = await requireAuth(c);
  await ensureTrustSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  // Dynamic-import the heavy provider modules (envelope + notify) to
  // avoid pulling them into the cold-start graph of the trust router
  // — they are only needed by this single route. Note: these imports
  // run before validation, so a fast-fail branch (cannot_intro_self /
  // bad founder id) still pays the import cost; that's an acceptable
  // tradeoff vs. the cold-start savings on every other trust route.
  const { createThreeWayNdaEnvelope } = await import('../services/trustEnvelope');
  const { notify } = await import('../services/notify');
  const result = await requestIntroLogic(c.env, investor, body, {
    lookupFounder: async (env, id) => {
      const sql = getSQL(env);
      const rows: any = await sql`SELECT id, email, name, role FROM users WHERE id = ${id} LIMIT 1`;
      await sql.end();
      return rows.length ? rows[0] : null;
    },
    getPairwise: getPairwiseNda,
    isPairwiseActive: hasActivePairwiseNda,
    upsertPairwise: upsertPairwiseNda,
    createEnvelope: createThreeWayNdaEnvelope,
    notify,
  });
  return c.json(result.body, result.status as any);
});

/**
 * Pure logic for POST /intro/request, lifted out so the worker test
 * suite can drive every branch with mocked deps. The five branches
 * the test file exercises:
 *
 *   1. cannot_intro_self     — investor.id === founder_user_id  → 400
 *   2. founder_not_found     — lookupFounder returns null        → 404
 *   3. target_is_not_a_founder — looked-up user.role !== founder → 400
 *   4. already_active short-circuit — existing pairwise NDA + active → 200
 *   5. happy path            — envelope created + founder receives a
 *                              `contract_sign_request` notify call
 *                              (which lands in notifications_inbox).
 *
 * SECURITY: never leak founder/Axal signing tokens back to the
 * requesting investor — they would be able to sign as all three
 * parties via the public /api/legal/esign/sign/:token endpoint and
 * fraudulently activate the pairwise NDA. The investor receives
 * ONLY their own signing URL here (the others are emailed by
 * createThreeWayNdaEnvelope).
 */
export interface IntroDeps {
  lookupFounder: (env: any, id: number) => Promise<{ id: number; email: string; name: string | null; role: string } | null>;
  getPairwise: (env: any, fid: number, iid: number) => Promise<any | null>;
  isPairwiseActive: (env: any, fid: number, iid: number) => Promise<boolean>;
  upsertPairwise: (env: any, fid: number, iid: number, uuid: string) => Promise<void>;
  createEnvelope: (env: any, args: { founder: any; investor: any; appUrl: string }) => Promise<{ envelope_uuid: string; signing_urls: { investor: string; founder?: string; axal?: string } }>;
  // notify returns the inserted notifications_inbox row id (or null if
  // it was suppressed). We don't care about the value here — the test
  // file just spies on the call shape — so the contract is `Promise<any>`.
  notify: (env: any, args: any) => Promise<any>;
}

// Note: we deliberately omit the explicit return-type annotation on
// `requestIntroLogic` so the TS-source slicer in
// `cloudflare-worker/test/trust_intro.test.mjs` can isolate the
// function body via plain brace-balancing without having to track
// generic angle brackets (`Promise<{...}>` confuses naive walkers).
// TS infers the same `{ status: number; body: any }` shape from the
// return statements below.
export async function requestIntroLogic(
  env: any,
  investor: { id: number; role: string; email: string; name?: string | null },
  body: { founder_user_id?: any },
  deps: IntroDeps,
) {
  if (investor.role !== 'investor' && investor.role !== 'admin') {
    return { status: 403, body: { error: 'investor_role_required' } };
  }
  const founderUserId = Number(body?.founder_user_id);
  if (!Number.isInteger(founderUserId) || founderUserId <= 0) {
    return { status: 400, body: { error: 'founder_user_id required' } };
  }
  if (founderUserId === investor.id) {
    return { status: 400, body: { error: 'cannot_intro_self' } };
  }

  const founder = await deps.lookupFounder(env, founderUserId);
  if (!founder) return { status: 404, body: { error: 'founder_not_found' } };
  if (founder.role !== 'founder') return { status: 400, body: { error: 'target_is_not_a_founder' } };

  const existing = await deps.getPairwise(env, founderUserId, investor.id);
  if (existing && await deps.isPairwiseActive(env, founderUserId, investor.id)) {
    return {
      status: 200,
      body: {
        status: 'already_active',
        envelope_uuid: existing.nda_envelope_uuid,
        valid_until: existing.valid_until,
      },
    };
  }

  let envelope;
  try {
    envelope = await deps.createEnvelope(env, {
      founder: { user_id: founder.id, email: founder.email, name: founder.name || founder.email },
      investor: { user_id: investor.id, email: investor.email, name: investor.name || investor.email },
      appUrl: env.APP_URL || 'https://axal.vc',
    });
  } catch (e) {
    console.error('[trust] 3-way envelope creation failed', e);
    return { status: 500, body: { error: 'envelope_creation_failed', message: (e as Error).message } };
  }
  await deps.upsertPairwise(env, founderUserId, investor.id, envelope.envelope_uuid);

  // Task #4 (Y-2) — in-app notification to the founder so the
  // pending NDA appears in their bell inbox + Trust Center
  // immediately, not just via email. `contract_sign_request` is
  // listed in CRITICAL_CATEGORIES so it bypasses quiet hours.
  try {
    await deps.notify(env, {
      userId: founderUserId,
      type: 'contract_sign_request',
      title: 'New investor intro request',
      body: `${investor.name || investor.email} has requested an introduction. Please review and sign the mutual NDA in your Trust Center.`,
      link: '/trust',
      category: 'contract_sign_request',
      payload: { envelope_uuid: envelope.envelope_uuid, investor_user_id: investor.id },
    });
  } catch (e) {
    console.error('[trust] founder intro notify failed', e);
  }

  return {
    status: 200,
    body: {
      status: 'envelope_issued',
      envelope_uuid: envelope.envelope_uuid,
      signing_url: envelope.signing_urls.investor,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /intro/status?founder=<id> — pair status check (mask gate consults this).
// ---------------------------------------------------------------------------
trust.get('/intro/status', async (c) => {
  const investor = await requireAuth(c);
  if (investor.role !== 'investor' && investor.role !== 'admin') {
    return c.json({ error: 'investor_role_required' }, 403);
  }
  const founderId = Number(c.req.query('founder'));
  if (!Number.isInteger(founderId) || founderId <= 0) {
    return c.json({ error: 'founder query param required' }, 400);
  }
  const row = await getPairwiseNda(c.env, founderId, investor.id);
  const active = await hasActivePairwiseNda(c.env, founderId, investor.id);
  return c.json({
    founder_user_id: founderId,
    investor_user_id: investor.id,
    status: row?.status || 'none',
    valid_until: row?.valid_until || null,
    active,
  });
});

// ---------------------------------------------------------------------------
// POST /obligation/:key/start — caller flips an obligation pending->in_review.
// ---------------------------------------------------------------------------
const VALID_KEYS: ObligationKey[] = [
  'tos_v1','privacy_v1','founder_nda_v1','investor_nda_v1','mentor_nda_v1',
  'mentor_disclaimer_v1','kyc_v1','accreditation_v1','kyb_v1','partner_msa_v1',
];
trust.post('/obligation/:key/start', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  const key = c.req.param('key');
  if (!VALID_KEYS.includes(key as ObligationKey)) {
    return c.json({ error: 'unknown_obligation_key' }, 400);
  }
  // Only valid transitions: pending -> in_review. Don't clobber satisfied.
  await c.env.DB.prepare(
    `UPDATE legal_obligations
        SET status = 'in_review', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND obligation_key = ? AND status = 'pending'`,
  ).bind(user.id, key).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /sanctions — admin-only Trust Center sanctions tab. Returns the most
// recent screening rows from `sanctions_screenings` (newest first), with
// optional `?user_id=` and `?only_hits=true` filters. Task AH lights up the
// matcher behind POST /sanctions/screen/:user_id; this read endpoint is
// purely a history view.
// ---------------------------------------------------------------------------
trust.get('/sanctions', async (c) => {
  await requireAdmin(c);
  const { listScreenings } = await import('../services/sanctions');
  const userId = Number(c.req.query('user_id'));
  const onlyHits = c.req.query('only_hits') === 'true';
  const items = await listScreenings(c.env, {
    user_id: Number.isInteger(userId) && userId > 0 ? userId : undefined,
    only_hits: onlyHits,
    limit: Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200),
  });
  // Frontend (TrustCenterPage SanctionsTab) reads `screenings`; alias
  // `items` is preserved for backward compat with any older callers.
  return c.json({ screenings: items, items, provider: 'aggregate' });
});

// ---------------------------------------------------------------------------
// POST /sanctions/screen/:user_id — admin trigger. Body may carry overrides
// (full_legal_name, date_of_birth, nationality); otherwise we read the
// subject from the user row + corporate_profiles.
// ---------------------------------------------------------------------------
trust.post('/sanctions/screen/:user_id', async (c) => {
  const admin = await requireAdmin(c);
  const userId = Number(c.req.param('user_id'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid_user' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  // Read the canonical user row first so a missing/legacy corporate_profiles
  // row never collapses the whole lookup into a 404. The corporate join is
  // best-effort — if the table or columns are missing on the local D1
  // we fall back to the users row alone.
  const userRow: any = await c.env.DB.prepare(
    `SELECT id, email, name FROM users WHERE id = ? LIMIT 1`,
  ).bind(userId).first().catch(() => null);
  if (!userRow) return c.json({ error: 'user_not_found' }, 404);
  let corp: any = null;
  try {
    corp = await c.env.DB.prepare(
      `SELECT entity_name, registered_country
         FROM corporate_profiles WHERE user_id = ? LIMIT 1`,
    ).bind(userId).first();
  } catch { corp = null; }
  const subject = {
    full_legal_name: String(body?.full_legal_name || corp?.entity_name || userRow.name || userRow.email || '').trim(),
    date_of_birth: body?.date_of_birth || null,
    nationality: body?.nationality || corp?.registered_country || null,
  };
  if (!subject.full_legal_name) return c.json({ error: 'missing_subject_name' }, 400);
  const { screenUser } = await import('../services/sanctions');
  const result = await screenUser(c.env, userId, subject, {
    admin_user_id: admin.id,
    reason: body?.reason || 'admin_triggered',
  });
  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /summary — single-call payload for TrustCenterPage.
// Combines obligations (matrix), the caller's pairwise NDA list, and a
// compact completion-ring breakdown so the SPA doesn't have to fan out.
// ---------------------------------------------------------------------------
trust.get('/summary', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  await seedObligations(c.env, user.id, user.role);
  const obligations: any[] = ((await c.env.DB.prepare(
    `SELECT obligation_key, required, status, expires_at, evidence_envelope_uuid, updated_at
       FROM legal_obligations WHERE user_id = ? ORDER BY required DESC, obligation_key`,
  ).bind(user.id).all())?.results || []) as any[];
  const required = obligations.filter(o => o.required);
  const satisfied = required.filter(o => o.status === 'satisfied' || o.status === 'waived').length;
  const score = required.length === 0 ? 100 : Math.round((satisfied / required.length) * 100);
  const ndas: any[] = ((await c.env.DB.prepare(
    `SELECT id, party_a_user_id, party_b_user_id, intermediary, nda_envelope_uuid,
            status, valid_until, updated_at
       FROM pairwise_ndas
      WHERE party_a_user_id = ? OR party_b_user_id = ?
      ORDER BY updated_at DESC LIMIT 50`,
  ).bind(user.id, user.id).all())?.results || []) as any[];
  return c.json({
    role: user.role,
    score,
    obligations,
    required_total: required.length,
    required_satisfied: satisfied,
    fully_compliant: required.length === satisfied,
    ndas,
    // Legacy shape preserved so TrustCenterPage's `legacy.kyb` /
    // `legacy.accreditation` / `legacy.ndas` reads keep working —
    // Task AH leaves the KYB+Accred cards out of scope, so they are
    // surfaced via /api/kyc/* and the obligation matrix.
    kyb: null,
    accreditation: null,
  });
});

// ---------------------------------------------------------------------------
// GET /nda/required — the per-role NDA obligation set the caller still
// needs to sign. Drives the "Sign Founder NDA" CTA on the Trust Center.
// ---------------------------------------------------------------------------
trust.get('/nda/required', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  await seedObligations(c.env, user.id, user.role);
  const ndaKeys = new Set(['founder_nda_v1','investor_nda_v1','mentor_nda_v1']);
  const rows: any = await c.env.DB.prepare(
    `SELECT obligation_key, required, status, expires_at, evidence_envelope_uuid
       FROM legal_obligations WHERE user_id = ?`,
  ).bind(user.id).all();
  const items = ((rows?.results || []) as any[])
    .filter(r => ndaKeys.has(r.obligation_key))
    .map(r => ({
      ...r,
      open: r.required === 1 && r.status !== 'satisfied' && r.status !== 'waived',
    }));
  return c.json({ items });
});

// ---------------------------------------------------------------------------
// POST /nda/sign/:envelope_uuid — convenience: returns the caller's own
// signing URL for an outstanding NDA envelope. Same auth/security guards
// as GET /agreements/:envelope_uuid/my_signing_url.
// ---------------------------------------------------------------------------
trust.post('/nda/sign/:envelope_uuid', async (c) => {
  const user = await requireAuth(c);
  const envelopeUuid = c.req.param('envelope_uuid');
  if (!envelopeUuid || envelopeUuid.length > 64) return c.json({ error: 'invalid_envelope' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT r.signing_token, r.token_expires_at, r.status
       FROM esign_recipients r
       JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE e.envelope_uuid = ? AND r.user_id = ?
      LIMIT 1`,
  ).bind(envelopeUuid, user.id).first();
  if (!row) return c.json({ error: 'not_a_recipient' }, 404);
  if (row.status === 'signed') return c.json({ status: 'signed' });
  const exp = Date.parse(row.token_expires_at);
  if (Number.isFinite(exp) && exp < Date.now()) return c.json({ status: 'expired' });
  const appUrl = stripTrailingSlashes(c.env.APP_URL || 'https://axal.vc');
  return c.json({ status: 'pending', signing_url: `${appUrl}/esign/${row.signing_token}` });
});

// ---------------------------------------------------------------------------
// GET /pairwise-ndas — list pairwise NDAs touching the caller (or all
// rows for an admin caller). Mirrors the admin-only equivalent at
// /api/admin/contracts/pairwise-ndas but without the requireAdmin gate
// for non-admin self-views.
// ---------------------------------------------------------------------------
trust.get('/pairwise-ndas', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  const { ensurePairwiseNdaColumns } = await import('../services/sanctions');
  await ensurePairwiseNdaColumns(c.env);
  const isAdmin = user.role === 'admin';
  const rows: any = isAdmin
    ? await c.env.DB.prepare(
        `SELECT p.id, p.party_a_user_id, p.party_b_user_id, p.intermediary,
                p.nda_envelope_uuid, p.status, p.valid_until, p.created_at, p.updated_at,
                p.signers_json, p.voided_at, p.voided_reason,
                ua.email AS party_a_email, ub.email AS party_b_email,
                e.status AS envelope_status
           FROM pairwise_ndas p
           LEFT JOIN users ua ON ua.id = p.party_a_user_id
           LEFT JOIN users ub ON ub.id = p.party_b_user_id
           LEFT JOIN esign_envelopes e ON e.envelope_uuid = p.nda_envelope_uuid
          ORDER BY p.created_at DESC LIMIT 500`,
      ).all()
    : await c.env.DB.prepare(
        `SELECT p.id, p.party_a_user_id, p.party_b_user_id, p.intermediary,
                p.nda_envelope_uuid, p.status, p.valid_until, p.created_at, p.updated_at,
                p.signers_json, p.voided_at, p.voided_reason,
                ua.email AS party_a_email, ub.email AS party_b_email,
                e.status AS envelope_status
           FROM pairwise_ndas p
           LEFT JOIN users ua ON ua.id = p.party_a_user_id
           LEFT JOIN users ub ON ub.id = p.party_b_user_id
           LEFT JOIN esign_envelopes e ON e.envelope_uuid = p.nda_envelope_uuid
          WHERE p.party_a_user_id = ?1 OR p.party_b_user_id = ?1
          ORDER BY p.created_at DESC LIMIT 200`,
      ).bind(user.id).all();

  // Enrich with computed signer list. We don't trust `signers_json` to
  // be populated retroactively for envelopes that completed before this
  // task shipped, so the canonical source is `esign_recipients` joined
  // by envelope_uuid. Each item ships a fresh `signers: [{name,email,
  // signed_at}]` array that the UI renders directly; we keep
  // `signers_json` for any caller relying on the legacy field.
  const items = (rows?.results || []) as any[];
  const uuids = items.map(i => i.nda_envelope_uuid).filter(Boolean);
  if (uuids.length > 0) {
    try {
      const placeholders = uuids.map(() => '?').join(',');
      const recRows: any = await c.env.DB.prepare(
        `SELECT e.envelope_uuid, r.recipient_email, r.recipient_name,
                r.status, r.signed_at
           FROM esign_recipients r
           JOIN esign_envelopes e ON e.id = r.envelope_id
          WHERE e.envelope_uuid IN (${placeholders})
          ORDER BY r.signed_at`,
      ).bind(...uuids).all();
      const byUuid: Record<string, any[]> = {};
      for (const r of (recRows?.results || []) as any[]) {
        const k = r.envelope_uuid;
        (byUuid[k] = byUuid[k] || []).push({
          email: r.recipient_email,
          name: r.recipient_name || r.recipient_email,
          status: r.status,
          signed_at: r.signed_at || null,
        });
      }
      for (const it of items) {
        const all = byUuid[it.nda_envelope_uuid] || [];
        it.signers = all.filter(s => s.status === 'signed' || !!s.signed_at);
        it.recipients = all;
      }
    } catch { /* best-effort enrichment — UI degrades gracefully */ }
  }
  return c.json({ items });
});

// ---------------------------------------------------------------------------
// POST /pairwise-ndas/:id/resend — admin resends signing emails to any
// recipient still in `pending`. Returns the count of emails resent.
// ---------------------------------------------------------------------------
trust.post('/pairwise-ndas/:id/resend', async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const pair: any = await c.env.DB.prepare(
    `SELECT id, nda_envelope_uuid, status FROM pairwise_ndas WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!pair) return c.json({ error: 'not_found' }, 404);
  if (pair.status === 'active' || pair.status === 'revoked' || pair.status === 'expired') {
    return c.json({ error: 'not_resendable', status: pair.status }, 409);
  }
  // The canonical e-sign schema (cloudflare-worker/src/routes/esign.ts)
  // uses `recipient_email` / `recipient_name`. Earlier draft selected
  // `signer_email` / `signer_name` (audit-event columns) which broke
  // the SQL outright on real D1 — fixed here.
  const recipients: any = await c.env.DB.prepare(
    `SELECT r.id, r.recipient_email, r.recipient_name, r.signing_token, r.status
       FROM esign_recipients r
       JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE e.envelope_uuid = ? AND r.status = 'pending'`,
  ).bind(pair.nda_envelope_uuid).all();
  const pending = (recipients?.results || []) as any[];
  const appUrl = stripTrailingSlashes(c.env.APP_URL || 'https://axal.vc');
  let sent = 0;
  try {
    const { sendAgreementAssignedEmail } = await import('../services/email');
    for (const r of pending) {
      try {
        await sendAgreementAssignedEmail(
          c.env,
          r.recipient_email,
          r.recipient_name || r.recipient_email,
          '3-Way Mutual NDA — please sign',
          `${appUrl}/esign/${r.signing_token}`,
          'Axal Admin',
        );
        sent += 1;
      } catch (e) { console.warn('[trust] resend email failed', r.recipient_email, (e as Error).message); }
    }
  } catch (e) { console.warn('[trust] email module unavailable', (e as Error).message); }
  await c.env.DB.prepare(
    `UPDATE pairwise_ndas SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(id).run();
  // Return both `sent` (frontend reads this) and `resent` (legacy alias).
  return c.json({ ok: true, sent, resent: sent, pending: pending.length });
});

// ---------------------------------------------------------------------------
// POST /pairwise-ndas/:id/void — admin revokes a pairwise NDA. Flips the
// row to `revoked`, stamps `voided_at` + `voided_reason`, and (if the
// underlying envelope hasn't completed) marks the envelope `cancelled`
// so the signing tokens stop working.
// ---------------------------------------------------------------------------
trust.post('/pairwise-ndas/:id/void', async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const reason = String(body?.reason || '').slice(0, 500) || 'admin_voided';
  const pair: any = await c.env.DB.prepare(
    `SELECT id, nda_envelope_uuid, status FROM pairwise_ndas WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!pair) return c.json({ error: 'not_found' }, 404);
  if (pair.status === 'revoked') return c.json({ ok: true, already: true });
  // Defensive — schema upgrade may not have run yet on dev D1.
  try {
    await c.env.DB.prepare(
      `UPDATE pairwise_ndas SET status = 'revoked', voided_at = CURRENT_TIMESTAMP,
              voided_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
    ).bind(reason, id).run();
  } catch {
    await c.env.DB.prepare(
      `UPDATE pairwise_ndas SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(id).run();
  }
  try {
    await c.env.DB.prepare(
      `UPDATE esign_envelopes SET status = 'cancelled' WHERE envelope_uuid = ? AND status NOT IN ('completed','cancelled')`,
    ).bind(pair.nda_envelope_uuid).run();
  } catch {}
  return c.json({ ok: true, status: 'revoked', reason });
});

// ---------------------------------------------------------------------------
// POST /kyb/start — thin facade so the SPA can launch entity verification
// from the Trust Center even though the canonical KYB flow lives under
// /api/kyc. Marks the kyb_v1 obligation as `in_review` and upserts a
// minimal `corporate_profiles` row so subsequent KYC submissions have a
// row to attach to.
// ---------------------------------------------------------------------------
trust.post('/kyb/start', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const legalName = String(body?.legal_name || '').slice(0, 255).trim();
  const businessId = String(body?.business_id || '').slice(0, 120).trim();
  const country = String(body?.country || body?.country_code || '').slice(0, 8).trim().toUpperCase();
  // Best-effort upsert against the canonical corporate_profiles columns
  // (entity_name + registration_number + registered_country). Dev D1 may
  // be missing the table on a stale checkout, so we swallow + warn.
  try {
    await c.env.DB.prepare(
      `INSERT INTO corporate_profiles (user_id, entity_name, registration_number, registered_country, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         entity_name = COALESCE(excluded.entity_name, corporate_profiles.entity_name),
         registration_number = COALESCE(excluded.registration_number, corporate_profiles.registration_number),
         registered_country = COALESCE(excluded.registered_country, corporate_profiles.registered_country),
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(user.id, legalName || null, businessId || null, country || null).run();
  } catch (e) {
    console.warn('[trust] kyb_start corporate_profiles upsert failed', (e as Error).message);
  }
  await c.env.DB.prepare(
    `UPDATE legal_obligations
        SET status = 'in_review', required = 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND obligation_key = 'kyb_v1'`,
  ).bind(user.id).run();
  return c.json({ ok: true, status: 'in_review' });
});

// Ensure obligations exist for a list of role-defaults exposed for
// admin/debug use. Returns the canonical matrix the worker is using.
trust.get('/matrix', async (c) => {
  await requireAuth(c);
  const role = c.req.query('role') || 'founder';
  return c.json({ role, obligations: obligationsForRole(role) });
});

export default trust;
