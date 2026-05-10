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
// POST /intro/request — investor asks for an intro to a founder.
// Body: { founder_user_id }
// Behaviour:
//   1. Caller must be an investor (admins permitted for testing).
//   2. If a valid pairwise NDA already exists -> return it.
//   3. Otherwise create a 3-way envelope (Founder + Investor + Axal
//      counter-signer) using the nda_3way_v1 template, persist a row in
//      `pairwise_ndas`, and return the envelope_uuid so the UI can
//      route to the signing pages.
// ---------------------------------------------------------------------------
trust.post('/intro/request', async (c) => {
  const investor = await requireAuth(c);
  if (investor.role !== 'investor' && investor.role !== 'admin') {
    return c.json({ error: 'investor_role_required' }, 403);
  }
  await ensureTrustSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const founderUserId = Number(body?.founder_user_id);
  if (!Number.isInteger(founderUserId) || founderUserId <= 0) {
    return c.json({ error: 'founder_user_id required' }, 400);
  }
  if (founderUserId === investor.id) {
    return c.json({ error: 'cannot_intro_self' }, 400);
  }

  const sql = getSQL(c.env);
  const founderRows: any = await sql`SELECT id, email, name, role FROM users WHERE id = ${founderUserId} LIMIT 1`;
  await sql.end();
  if (!founderRows.length) return c.json({ error: 'founder_not_found' }, 404);
  const founder = founderRows[0];
  if (founder.role !== 'founder') return c.json({ error: 'target_is_not_a_founder' }, 400);

  // Already-active short-circuit.
  const existing = await getPairwiseNda(c.env, founderUserId, investor.id);
  if (existing && await hasActivePairwiseNda(c.env, founderUserId, investor.id)) {
    return c.json({
      status: 'already_active',
      envelope_uuid: existing.nda_envelope_uuid,
      valid_until: existing.valid_until,
    });
  }

  // Issue a fresh 3-way envelope. We reuse the eSign infrastructure
  // (one envelope, three recipient rows) so the audit trail and
  // signing-token expiry mechanics are identical to single-signer flows.
  const { createThreeWayNdaEnvelope } = await import('../services/trustEnvelope');
  let env;
  try {
    env = await createThreeWayNdaEnvelope(c.env, {
      founder: { user_id: founder.id, email: founder.email, name: founder.name || founder.email },
      investor: { user_id: investor.id, email: investor.email, name: investor.name || investor.email },
      appUrl: c.env.APP_URL || 'https://axal.vc',
    });
  } catch (e) {
    console.error('[trust] 3-way envelope creation failed', e);
    return c.json({ error: 'envelope_creation_failed', message: (e as Error).message }, 500);
  }
  await upsertPairwiseNda(c.env, founderUserId, investor.id, env.envelope_uuid);
  // SECURITY: never leak founder/Axal signing tokens back to the
  // requesting investor — they would be able to sign as all three
  // parties via the public /api/legal/esign/sign/:token endpoint and
  // fraudulently activate the pairwise NDA. The founder + Axal links
  // are delivered only via email (sendAgreementAssignedEmail) inside
  // createThreeWayNdaEnvelope. The investor receives ONLY their own
  // signing URL here (also separately emailed).
  return c.json({
    status: 'envelope_issued',
    envelope_uuid: env.envelope_uuid,
    signing_url: env.signing_urls.investor,
  });
});

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
