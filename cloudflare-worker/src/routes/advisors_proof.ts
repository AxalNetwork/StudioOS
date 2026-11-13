/**
 * #4715 (D4715) — Proof: what an advisor claims and who has confirmed it (migration 204).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getCurrentUser, requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { CODE_MAX_ATTEMPTS, CODE_TTL_MS, CODES_PER_HOUR, attestationMailer, claimJson, claimSha256, codeHash, consentState, emailOf, maskEmail, newCode, sha256Hex } from '../services/advisorProofAttestation';
import { mapError, nowIso, newUid, trimOrNull } from './_t13t14t15_helpers';
import { pageFacts, pageWindow } from '../services/listPage';
import {
  PROOF_PAGE, requireMyAdvisor,
} from '../services/advisorPractice';

const advisors = new Hono<{ Bindings: Env }>();


// ---------------------------------------------------------------------------
// 204 — Proof. What an advisor claims, and who has confirmed it.
// ---------------------------------------------------------------------------
type ProofRow = {
  id: number; uid: string; advisor_id: number; kind: string; title: string;
  detail: string | null; organization: string | null; period_note: string | null;
  is_public: number; published_consent_id: number | null; created_at: string; updated_at: string;
};
type ConsentRow = {
  id: number; uid: string; proof_item_id: number;
  attester_name: string; attester_email: string | null; attester_role: string | null;
  relationship: string | null; requested_at: string | null; requested_by: number | null;
  request_token: string | null; consent_given: number; consent_given_at: string | null;
  consent_text: string | null; consent_captured_by: number | null;
  statement: string | null; withdrawn_at: string | null; cancelled_at?: string | null;
  claim_sha256: string | null; claim_json: string | null;
  created_at: string; updated_at: string;
};

const PROOF_KINDS = ['engagement', 'outcome', 'role', 'credential'];

/**
 * The consent as the ADVISOR may see it (D4670). `invite_token` is the link the
 * advisor hands over, readable again so a refresh never loses it: since D4670
 * the link only shows the claim, and answering needs a code mailed to the
 * named address, so holding it is not being able to answer.
 */
function consentDto(r: ConsentRow, currentClaimSha: string): any {
  const state = consentState(r, currentClaimSha);
  return {
    id: r.id, uid: r.uid, proof_item_id: r.proof_item_id,
    attester_name: r.attester_name, attester_email: r.attester_email,
    attester_role: r.attester_role, relationship: r.relationship,
    requested_at: r.requested_at,
    state,
    consent_given: state === 'confirmed',
    consent_given_at: r.consent_given_at,
    statement: r.statement,
    withdrawn_at: r.withdrawn_at,
    cancelled_at: r.cancelled_at ?? null,
    invite_token: state === 'pending' ? r.request_token : null,
    created_at: r.created_at,
  };
}

/**
 * Attested is DERIVED from the consent rows, never stored on the item — see
 * migration 204's header. Since D4670 a row counts only while it is confirmed
 * about the claim as it now reads (`consentState`): a withdrawal, a claim that
 * changed, or a confirmation recorded before D4670 does not.
 */
function proofDto(r: ProofRow, consents: ConsentRow[], currentClaimSha: string): any {
  const views = consents.map((x) => consentDto(x, currentClaimSha));
  const live = views.filter((x) => x.state === 'confirmed');
  return {
    id: r.id, uid: r.uid, advisor_id: r.advisor_id,
    kind: r.kind, title: r.title, detail: r.detail,
    organization: r.organization, period_note: r.period_note,
    is_public: !!r.is_public,
    published: live.some((consent) => consent.id === r.published_consent_id),
    attested: live.length > 0,
    // "Self-stated" is a claim with no confirmation behind it. Saying so is the
    // point of the zone: the advisor's own word and someone else's word are
    // different evidence and must never render identically.
    status: live.length > 0 ? 'attested' : 'self_stated',
    consents: views,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * The consents behind a page of proof items, in ONE read (#4697). It was one
 * statement per item, so a 200-row page cost 201 round trips. The ids travel
 * as one bound JSON array (`json_each(?)`): no interpolated IN list, which
 * `check-sql-prepare` rightly refuses. The join re-checks the owner, so a
 * caller can only ever read consents on its own advisor's items. Rows are
 * grouped here, in each item's own order (oldest first).
 */
async function loadProofConsents(env: Env, advisorId: number, itemIds: number[]): Promise<Map<number, ConsentRow[]>> {
  const out = new Map<number, ConsentRow[]>();
  if (!itemIds.length) return out;
  for (const id of itemIds) out.set(id, []);
  const rows = await env.DB.prepare(
    `SELECT c.*, a.cancelled_at FROM advisor_proof_consents c
       JOIN advisor_proof_items p ON p.id = c.proof_item_id
       LEFT JOIN advisor_proof_consent_cancellations a ON a.consent_id = c.id
      WHERE p.advisor_id = ? AND c.proof_item_id IN (SELECT value FROM json_each(?))
      ORDER BY c.proof_item_id, c.created_at ASC, c.id ASC`
  ).bind(advisorId, JSON.stringify(itemIds)).all<ConsentRow>();
  for (const r of rows.results || []) out.get(Number(r.proof_item_id))?.push(r);
  return out;
}

async function proofWithConsents(env: Env, advisorId: number, items: ProofRow[]): Promise<any[]> {
  const consents = await loadProofConsents(env, advisorId, items.map((r) => r.id));
  const out = [];
  for (const r of items) out.push(proofDto(r, consents.get(r.id) || [], await claimSha256(r)));
  return out;
}

advisors.get('/me/proof', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    // #4689: a page of the list and, over the whole list, how many claims are
    // confirmed. "Confirmed" is the rule `proofDto` applies: a consent given
    // and not withdrawn.
    const w = pageWindow(c.req.query(), PROOF_PAGE);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM advisor_proof_items WHERE advisor_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
    ).bind(m.id, w.limit, w.offset).all<ProofRow>();
    const whole = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM advisor_proof_consents x
                 WHERE x.proof_item_id = p.id AND x.consent_given = 1
                   AND (x.withdrawn_at IS NULL OR x.withdrawn_at = '')
                   -- D4670: confirmed about the claim as it now reads (consentState).
                   AND x.claim_json IS NOT NULL
                   AND json_extract(x.claim_json, '$.kind') IS p.kind
                   AND json_extract(x.claim_json, '$.title') IS p.title
                   AND json_extract(x.claim_json, '$.organization') IS p.organization
                   AND json_extract(x.claim_json, '$.period_note') IS p.period_note
                   AND json_extract(x.claim_json, '$.detail') IS p.detail
              ) THEN 1 ELSE 0 END), 0) AS attested,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM advisor_proof_consents x
                 WHERE x.proof_item_id = p.id AND COALESCE(x.consent_given, 0) <> 1
                   AND (x.withdrawn_at IS NULL OR x.withdrawn_at = '')
                   AND NOT EXISTS (SELECT 1 FROM advisor_proof_consent_cancellations a WHERE a.consent_id = x.id)
              ) THEN 1 ELSE 0 END), 0) AS awaiting
         FROM advisor_proof_items p WHERE p.advisor_id = ?`
    ).bind(m.id).first<{ total: number; attested: number; awaiting: number }>();
    const items = rows.results || [];
    const total = Number(whole?.total) || 0;
    const attested = Number(whole?.attested) || 0;
    return c.json({
      items: await proofWithConsents(c.env, m.id, items),
      page: pageFacts(w, total, items.length),
      // `awaiting`: a claim with an ask no one has answered or withdrawn.
      counts: { total, attested, self_stated: total - attested, awaiting: Number(whole?.awaiting) || 0 },
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/proof', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const title = String(body.title || '').trim().slice(0, 300);
    if (!title) return c.json({ detail: 'A proof item needs a title' }, 400);
    const kind = String(body.kind || 'engagement').trim();
    if (!PROOF_KINDS.includes(kind)) {
      return c.json({ detail: 'kind must be one of: engagement, outcome, role, credential' }, 400);
    }
    const now = nowIso();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_proof_items
         (uid, advisor_id, kind, title, detail, organization, period_note,
          is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newUid(), m.id, kind, title,
           trimOrNull(body.detail, 4000), trimOrNull(body.organization, 200),
           trimOrNull(body.period_note, 100),
           body.is_public ? 1 : 0, now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<ProofRow>();
    return c.json(proofDto(fresh!, [], await claimSha256(fresh!)));
  } catch (e) { return mapError(c, e); }
});

/** Public proof exposes the explicitly published claim, never the consent record. */
export async function publishedAdvisorProof(env: Env, advisorId: number) {
  const { results = [] } = await env.DB.prepare(
    `SELECT p.uid, p.kind, p.title, p.detail, p.organization, p.period_note, x.claim_sha256
       FROM advisor_proof_items p
       JOIN advisor_proof_consents x ON x.id = p.published_consent_id AND x.proof_item_id = p.id
      WHERE p.advisor_id = ? AND x.consent_given = 1
        AND COALESCE(x.withdrawn_at, '') = '' AND x.claim_sha256 IS NOT NULL
      ORDER BY p.created_at DESC, p.id DESC`
  ).bind(advisorId).all<Pick<ProofRow, 'uid' | 'kind' | 'title' | 'detail' | 'organization' | 'period_note'> & { claim_sha256: string }>();
  const checked = await Promise.all(results.map(async ({ claim_sha256, ...proof }) =>
    await claimSha256(proof) === claim_sha256 ? proof : null));
  return checked.filter((proof) => proof !== null);
}

advisors.patch('/me/proof/:id/publication', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => null);
    if (typeof body?.published !== 'boolean') {
      return refuse(c, 400, { code: 'published_required', message: 'Choose whether to publish this proof.' });
    }
    const item = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ? AND advisor_id = ?')
      .bind(id, m.id).first<ProofRow>();
    if (!item) return refuse(c, 404, { code: 'proof_not_found', message: 'This proof item does not exist.' });
    if (!body.published) {
      await c.env.DB.prepare('UPDATE advisor_proof_items SET published_consent_id = NULL WHERE id = ? AND advisor_id = ?')
        .bind(id, m.id).run();
      return c.json({ id, published: false });
    }
    const sha = await claimSha256(item);
    // Select a live confirmation in the same write that publishes the claim.
    // Withdrawal and publication therefore observe each other in write order.
    const updated = await c.env.DB.prepare(
      `UPDATE advisor_proof_items SET published_consent_id = (
         SELECT x.id FROM advisor_proof_consents x
          WHERE x.proof_item_id = advisor_proof_items.id AND x.consent_given = 1
            AND COALESCE(x.withdrawn_at, '') = '' AND x.claim_sha256 = ?
          ORDER BY x.consent_given_at DESC, x.id DESC LIMIT 1
       ) WHERE id = ? AND advisor_id = ? AND kind IS ? AND title IS ?
           AND detail IS ? AND organization IS ? AND period_note IS ?
       RETURNING published_consent_id`
    ).bind(sha, id, m.id, item.kind, item.title, item.detail, item.organization, item.period_note)
      .first<{ published_consent_id: number | null }>();
    if (!updated?.published_consent_id) {
      return refuse(c, 409, { code: 'proof_confirmation_required', message: 'Only proof with a current confirmation can be published.' });
    }
    return c.json({ id, published: true });
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/proof/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ProofRow>();
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Proof item not found' }, 404);
    // The consents go with the item they attest to. A consent row whose subject
    // no longer exists attests to nothing, and leaving it would leave a
    // stranger's name and email in the database with no claim attached to it.
    //
    // D4681 (#4681): ONE BATCH, so both go or neither does. These were two
    // awaited statements, and a failure between them left the claim standing
    // with every consent behind it gone: an attested item turned self-stated
    // with nothing to say why. D1 runs a batch as one transaction. The item's
    // DELETE re-checks the owner, and the consent DELETE names only that item.
    const consents = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM advisor_proof_consents WHERE proof_item_id = ?')
      .bind(row.id).first<{ n: number }>();
    // D4670: the consents' one-time codes go first (they reference the rows);
    // the answer history stays, and holds no name or address.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM advisor_proof_consent_codes WHERE consent_id IN (SELECT id FROM advisor_proof_consents WHERE proof_item_id = ?)').bind(row.id),
      c.env.DB.prepare('DELETE FROM advisor_proof_consents WHERE proof_item_id = ?').bind(row.id),
      c.env.DB.prepare('DELETE FROM advisor_proof_items WHERE id = ? AND advisor_id = ?').bind(row.id, m.id),
    ]);
    return c.json({ ok: true, id: row.id, consents_removed: Number(consents?.n ?? 0) });
  } catch (e) { return mapError(c, e); }
});

async function proofEvent(env: Env, consentId: number, kind: string, claimSha: string | null, at: string) {
  await env.DB.prepare(
    'INSERT INTO advisor_proof_consent_events (consent_id, kind, claim_sha256, created_at) VALUES (?, ?, ?, ?)'
  ).bind(consentId, kind, claimSha, at).run();
}

/**
 * Ask a named person to confirm a claim (D4670).
 *
 * This RECORDS the request and pins the claim as it now reads; it sends
 * nothing. The advisor hands over the link by whatever channel they already
 * have with the person, and may read it back from the list. The person's
 * email is required, because answering needs a code mailed there on their own
 * request, and it cannot be the advisor's own address.
 */
advisors.post('/me/proof/:id/consent-request', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const item = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ProofRow>();
    if (!item || item.advisor_id !== m.id) return c.json({ detail: 'Proof item not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const attester_name = String(body.attester_name || '').trim().slice(0, 200);
    if (!attester_name) return refuse(c, 400, { code: 'attester_name_required', message: 'Name the person being asked to confirm.' });
    const attester_email = emailOf(body.attester_email);
    if (!attester_email) return refuse(c, 400, { code: 'attester_email_required', message: 'Give the email address of the person being asked; their code is sent there.' });
    const own = [user.email, m.email].map(emailOf).filter(Boolean);
    if (own.includes(attester_email)) {
      return refuse(c, 422, { code: 'attester_is_requester', message: 'Someone else confirms your claim: that address is your own.' });
    }
    const token = newUid();
    const now = nowIso();
    const pinned = claimJson(item);
    const sha = await sha256Hex(pinned);
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_proof_consents
         (uid, proof_item_id, attester_name, attester_email, attester_role,
          relationship, requested_at, requested_by, request_token,
          consent_given, claim_sha256, claim_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).bind(newUid(), item.id, attester_name, attester_email,
           trimOrNull(body.attester_role, 200), trimOrNull(body.relationship, 200),
           now, user.id, token, sha, pinned, now, now).run();
    const id = Number((r as any).meta?.last_row_id);
    await proofEvent(c.env, id, 'asked', sha, now);
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_proof_consents WHERE id = ?').bind(id).first<ConsentRow>();
    return c.json({ ...consentDto(fresh!, sha), delivered: false });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/proof/:id/consents/:consentId/cancel', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const itemId = Number(c.req.param('id'));
    const consentId = Number(c.req.param('consentId'));
    const now = nowIso();
    // The insert and its revocation trigger commit together. The same write
    // checks ownership and the pending state against concurrent answers.
    await c.env.DB.prepare(
      `INSERT INTO advisor_proof_consent_cancellations (consent_id, cancelled_by, cancelled_at)
       SELECT x.id, ?, ? FROM advisor_proof_consents x
       JOIN advisor_proof_items p ON p.id = x.proof_item_id
       WHERE p.advisor_id = ? AND p.id = ? AND x.id = ?
         AND x.request_token IS NOT NULL AND x.requested_at IS NOT NULL
         AND COALESCE(x.consent_given, 0) = 0
         AND (x.withdrawn_at IS NULL OR x.withdrawn_at = '')
       ON CONFLICT(consent_id) DO NOTHING`
    ).bind(user.id, now, m.id, itemId, consentId).run();
    const row = await c.env.DB.prepare(
      `SELECT x.id, a.cancelled_at FROM advisor_proof_consents x
       JOIN advisor_proof_items p ON p.id = x.proof_item_id
       LEFT JOIN advisor_proof_consent_cancellations a ON a.consent_id = x.id
       WHERE p.advisor_id = ? AND p.id = ? AND x.id = ?`
    ).bind(m.id, itemId, consentId).first<{ id: number; cancelled_at: string | null }>();
    if (!row) return refuse(c, 404, { code: 'consent_not_found', message: 'This proof request does not exist.' });
    if (!row.cancelled_at) return refuse(c, 409, { code: 'consent_not_pending', message: 'Only a pending proof request can be cancelled.' });
    return c.json({ id: row.id, state: 'cancelled', cancelled_at: row.cancelled_at });
  } catch (e) { return mapError(c, e); }
});

/** The consent a link names, its claim, and whether the claim still reads as pinned. */
async function consentByToken(env: Env, token: string) {
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare('SELECT * FROM advisor_proof_consents WHERE request_token = ?').bind(token).first<ConsentRow>();
  if (!row) return null;
  const item = await env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?').bind(row.proof_item_id).first<ProofRow>();
  if (!item) return null;
  const advisor = await env.DB.prepare('SELECT id, user_id, display_name, email FROM advisors WHERE id = ?').bind(item.advisor_id).first<{ id: number; user_id: number | null; display_name: string; email: string | null }>();
  const currentSha = await claimSha256(item);
  return { row, item, advisor, currentSha };
}

const NO_REQUEST = { code: 'consent_not_found', message: 'This request does not exist, or the claim it was about was removed.' } as const;

/**
 * The attester's view (D4670): the claim exactly as they are asked to confirm
 * it, who asked, and the history of their answers. No account, and no code:
 * reading is what the link is for. A link answers nothing about any other
 * claim, and never the attester's address in full.
 */
// Three segments, first one literal: `/:uid/book` two segments up cannot
// shadow these, and neither can any future single-segment route.
advisors.get('/proof-consents/:token/claim', async (c) => {
  try {
    const found = await consentByToken(c.env, String(c.req.param('token') || ''));
    if (!found) return refuse(c, 404, NO_REQUEST);
    const { row, item, advisor, currentSha } = found;
    const pinned = row.claim_json ? JSON.parse(row.claim_json) : JSON.parse(claimJson(item));
    const events = (await c.env.DB.prepare(
      'SELECT kind, created_at FROM advisor_proof_consent_events WHERE consent_id = ? ORDER BY id ASC'
    ).bind(row.id).all<{ kind: string; created_at: string }>()).results || [];
    c.header('Cache-Control', 'private, no-store');
    return c.json({
      advisor_name: advisor?.display_name || null,
      attester_name: row.attester_name,
      email_hint: maskEmail(row.attester_email),
      claim: pinned,
      claim_sha256: row.claim_sha256 || currentSha,
      // The advisor changed the claim after asking: what was asked about is no longer what it says.
      claim_changed: !!row.claim_sha256 && row.claim_sha256 !== currentSha,
      state: consentState(row, currentSha),
      statement: row.statement,
      history: events,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Mail the attester a one-time code (D4670), on their own request, to the
 * address the advisor named. Five an hour per request; the code lasts 15
 * minutes. The address is never echoed in full and never logged.
 */
advisors.post('/proof-consents/:token/code', async (c) => {
  try {
    const found = await consentByToken(c.env, String(c.req.param('token') || ''));
    if (!found) return refuse(c, 404, NO_REQUEST);
    const { row, advisor } = found;
    const to = emailOf(row.attester_email);
    if (!to) return refuse(c, 409, { code: 'attester_email_missing', message: 'This request names no email address, so no code can be sent. Ask the advisor to send a new request.' });
    const now = Date.now();
    const recent = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM advisor_proof_consent_codes WHERE consent_id = ? AND datetime(created_at) > datetime(?)'
    ).bind(row.id, new Date(now - 3600_000).toISOString()).first<{ n: number }>();
    if (Number(recent?.n || 0) >= CODES_PER_HOUR) {
      return refuse(c, 429, { code: 'code_rate_limited', message: 'Several codes were sent in the last hour. Use the latest one, or try again later.' });
    }
    const code = newCode();
    const issued = await c.env.DB.prepare(
      `INSERT INTO advisor_proof_consent_codes (consent_id, code_hash, expires_at, attempts, created_at)
       SELECT id, ?, ?, 0, ? FROM advisor_proof_consents WHERE id = ? AND request_token = ?`
    ).bind(await codeHash(row.id, code), new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString(), row.id, row.request_token).run();
    if (!issued.meta.changes) return refuse(c, 404, NO_REQUEST);
    const sent = await attestationMailer.send(c.env, to, advisor?.display_name || 'An advisor', code);
    if (!sent) return refuse(c, 503, { code: 'code_unsent', message: 'The code could not be emailed just now. Try again in a few minutes.' });
    return c.json({ sent: true, email_hint: maskEmail(to), expires_in_seconds: CODE_TTL_MS / 1000 });
  } catch (e) { return mapError(c, e); }
});

/**
 * The attester answers (D4670). The link names the request; the code proves
 * the person answering reads the address the advisor named. `claim_sha256`
 * is the claim the attester was shown: an answer about another reading of it
 * is refused. The advisor themselves is refused even with a code.
 *
 * `requireAuth` is deliberately absent: an attester is usually not a user of
 * this product, and requiring an account would mean the only confirmable claims
 * are the ones a colleague already inside Axal can vouch for.
 */
advisors.post('/proof-consents/:token/respond', async (c) => {
  try {
    const found = await consentByToken(c.env, String(c.req.param('token') || ''));
    if (!found) return refuse(c, 404, NO_REQUEST);
    const { row, item, advisor, currentSha } = found;
    const body = await c.req.json().catch(() => ({} as any));
    // A signed-in caller who is the advisor is refused outright: the subject of a claim never answers it.
    const caller = await getCurrentUser(c).catch(() => null);
    if (caller && advisor?.user_id != null && Number(caller.id) === Number(advisor.user_id)) {
      return refuse(c, 403, { code: 'requester_cannot_attest', message: 'You cannot answer a request about your own claim.' });
    }
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) return refuse(c, 400, { code: 'code_required', message: 'Enter the six-digit code emailed to you.' });
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const latest = await c.env.DB.prepare(
      'SELECT id, code_hash, expires_at, attempts, used_at FROM advisor_proof_consent_codes WHERE consent_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(row.id).first<{ id: number; code_hash: string; expires_at: string; attempts: number; used_at: string | null }>();
    if (!latest || latest.used_at || Date.parse(latest.expires_at) <= nowMs || Number(latest.attempts) >= CODE_MAX_ATTEMPTS) {
      return refuse(c, 401, { code: 'code_expired', message: 'That code has expired or was already used. Ask for a new one.' });
    }
    if (latest.code_hash !== await codeHash(row.id, code)) {
      await c.env.DB.prepare('UPDATE advisor_proof_consent_codes SET attempts = attempts + 1 WHERE id = ?').bind(latest.id).run();
      return refuse(c, 401, { code: 'code_wrong', message: 'That code is not right. Check the latest email and try again.' });
    }
    // The code is spent before anything is written, so it answers once.
    const spent = await c.env.DB.prepare('UPDATE advisor_proof_consent_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now, latest.id).run();
    if (!Number((spent as any)?.meta?.changes ?? 1)) return refuse(c, 401, { code: 'code_expired', message: 'That code has expired or was already used. Ask for a new one.' });

    if (body.consent_given === false) {
      // Declining and withdrawing are the same shape: the row stays, and says
      // so, and the history keeps which it was.
      const wasGiven = Number(row.consent_given) === 1 && !row.withdrawn_at;
      const declined = await c.env.DB.prepare(
        `UPDATE advisor_proof_consents
            SET consent_given = 0, withdrawn_at = ?, updated_at = ? WHERE id = ? AND request_token = ?`
      ).bind(now, now, row.id, row.request_token).run();
      if (!declined.meta.changes) return refuse(c, 404, NO_REQUEST);
      await proofEvent(c.env, row.id, wasGiven || row.consent_given_at ? 'withdrawn' : 'declined', row.claim_sha256, now);
    } else {
      const consent_text = String(body.consent_text || '').trim();
      if (!consent_text) return refuse(c, 400, { code: 'consent_text_required', message: 'The confirmation must record what was agreed to.' });
      const asked = row.claim_sha256 || currentSha;
      if (asked !== currentSha || (typeof body.claim_sha256 === 'string' && body.claim_sha256 !== currentSha)) {
        return refuse(c, 409, { code: 'claim_changed', message: 'The claim has changed since you were asked. Nothing was recorded; the advisor needs to ask again.' });
      }
      const again = !!row.consent_given_at;
      const confirmed = await c.env.DB.prepare(
        `UPDATE advisor_proof_consents
            SET consent_given = 1, consent_given_at = ?, consent_text = ?,
                statement = ?, withdrawn_at = NULL, claim_sha256 = ?, claim_json = ?, updated_at = ?
          WHERE id = ? AND request_token = ?`
      ).bind(now, consent_text.slice(0, 2000), trimOrNull(body.statement, 2000),
             currentSha, row.claim_json || claimJson(item), now, row.id, row.request_token).run();
      if (!confirmed.meta.changes) return refuse(c, 404, NO_REQUEST);
      await proofEvent(c.env, row.id, again ? 'reconfirmed' : 'confirmed', currentSha, now);
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_proof_consents WHERE id = ?')
      .bind(row.id).first<ConsentRow>();
    // The attester's own answer, never the advisor's link.
    const { invite_token: _hidden, attester_email: _addr, ...answer } = consentDto(fresh!, currentSha);
    return c.json(answer);
  } catch (e) { return mapError(c, e); }
});

export default advisors;
