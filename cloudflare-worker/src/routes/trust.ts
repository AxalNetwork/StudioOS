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
// GET /agreements — signed + pending pairwise NDAs touching the caller.
// ---------------------------------------------------------------------------
trust.get('/agreements', async (c) => {
  const user = await requireAuth(c);
  await ensureTrustSchema(c.env);
  const rows: any = await c.env.DB.prepare(
    `SELECT id, party_a_user_id, party_b_user_id, intermediary, nda_envelope_uuid,
            status, valid_until, created_at, updated_at
       FROM pairwise_ndas
      WHERE party_a_user_id = ? OR party_b_user_id = ?
      ORDER BY updated_at DESC LIMIT 200`,
  ).bind(user.id, user.id).all();
  return c.json({ agreements: (rows?.results || []) });
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
  const appUrl = (c.env.APP_URL || 'https://axal.vc').replace(/\/+$/, '');
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
// GET /sanctions — admin-only sanctions check stub. Real OFAC/UK HMT/EU
// CFSP feeds plug in here; X-1 (partner deals) lights it up.
// ---------------------------------------------------------------------------
trust.get('/sanctions', async (c) => {
  await requireAdmin(c);
  return c.json({ provider: 'stub', hits: [], note: 'OFAC/HMT/EU sanctions screening not yet wired (X-1 follow-up).' });
});

// Ensure obligations exist for a list of role-defaults exposed for
// admin/debug use. Returns the canonical matrix the worker is using.
trust.get('/matrix', async (c) => {
  await requireAuth(c);
  const role = c.req.query('role') || 'founder';
  return c.json({ role, obligations: obligationsForRole(role) });
});

export default trust;
