/**
 * /api/mercury/attestations — an investor's proof of capital (D752, #1888).
 * NOTHING HERE MOVES MONEY, and no route returns a balance: the Worker sums the
 * picked accounts' available balance inside the investor's own request and
 * keeps only the statement "at least $X was available on <date>, held by
 * <holder>" (`services/capitalAttestations.ts`, migration 491).
 *
 *   GET  /               the caller's own statements, every state, with admin views
 *   GET  /targets        their open commitments, the minimum, and the consent words;
 *                        reads no bank, so it answers before they connect
 *   GET  /accounts       their checking and savings accounts: id, name, kind, last four
 *   POST /               { purpose, target_id, account_ids, amount_cents?, consent, consent_version }
 *   POST /:uid/revoke    revoke one of their statements
 *
 * `GET /targets`, `GET /accounts` and `POST /` run the use's policy: a support
 * session is 403 `support_session_refused`, a role without the use 403
 * `purpose_not_allowed`, a branch 403 `hq_only`. `GET /` and revoke refuse a
 * support session and a branch but not a role, so a member whose role changed
 * can still see and revoke what they shared. Another member's target or
 * statement is 404, exactly as a missing one is. The share refuses, before any
 * bank read: `consent_required`, `consent_outdated`, `invalid_purpose`,
 * `invalid_target_id`, `invalid_accounts`, `target_not_found`,
 * `target_not_attestable`, `invalid_amount`, `amount_above_target`; after the
 * read: `account_not_found`, `mercury_unreadable`, `holder_unreadable`,
 * `balance_below_amount`, with no figure.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  UUID_RE, attestationPolicy, createAttestation, listOwn, openTargets, ownAccounts, ownerGate, revokeOwn,
} from '../services/capitalAttestations';
import { CONSENT_TEMPLATE, CONSENT_VERSION, MIN_FLOOR_CENTS, VALID_DAYS } from '../services/capitalAttestationTerms';

const mercuryAttestations = new Hono<{ Bindings: Env }>();

mercuryAttestations.get('/', async (c) => {
  const user = await requireAuth(c);
  const gate = await ownerGate(c);
  if (gate) return gate;
  return c.json({ attestations: await listOwn(c.env, user) });
});

mercuryAttestations.get('/targets', async (c) => {
  const user = await requireAuth(c);
  const policy = await attestationPolicy(c, user);
  if (policy) return policy;
  const { targets, unreadable } = await openTargets(c.env, user);
  return c.json({
    minimum_cents: MIN_FLOOR_CENTS,
    valid_days: VALID_DAYS,
    consent: { version: CONSENT_VERSION, template: CONSENT_TEMPLATE },
    targets,
    unreadable,
  });
});

mercuryAttestations.get('/accounts', async (c) => {
  const user = await requireAuth(c);
  return ownAccounts(c, user);
});

mercuryAttestations.post('/', async (c) => {
  const user = await requireAuth(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return createAttestation(c, user, body && typeof body === 'object' && !Array.isArray(body) ? body : {});
});

mercuryAttestations.post('/:uid/revoke', async (c) => {
  const user = await requireAuth(c);
  const gate = await ownerGate(c);
  if (gate) return gate;
  const uid = c.req.param('uid');
  if (!UUID_RE.test(uid)) return c.json({ error: 'attestation_not_found', message: 'No such statement.', detail: 'No such statement.' }, 404);
  return revokeOwn(c, user, uid.toLowerCase());
});

export default mercuryAttestations;
