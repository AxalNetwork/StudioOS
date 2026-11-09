/**
 * D5052 (#5052, part 5 of #5047) — package and program agreement policies, a licence's legal readiness and its
 * legal history. Mounted at `/api/admin/licence-agreement-policies`; the store is migration 202611090840
 * (`services/agreementPolicies.ts`).
 *
 *   GET  /                                             every package's and program's latest policy version
 *   GET  /licences/:licenceUid                         the licence's frozen holdings, each program's legal status
 *                                                      (with the documents it needs and which are executed) and
 *                                                      the executed agreements that need replacing
 *   GET  /licences/:licenceUid/history                 the agreement lifecycle (D5048) and the legal events (D5052),
 *                                                      one list, oldest first, each line with actor and context
 *   POST /licences/:licenceUid/package-acceptances     freeze a package's latest policy on the licence  (write bar, reason)
 *   GET  /:scopeKind/:scopeKey                         one package's or program's versions and their history
 *   POST /:scopeKind/:scopeKey                         a new policy version                             (write bar, reason)
 *
 * WHO. Reads are `requireSuperAdmin`, as the licence agreements are read. Writes are `requireSuperAdminWriteBar`
 * with a reason of at least 10 characters, a history line in the write's own batch and an admin audit row.
 *
 * A NEW VERSION REACHES NO HOLDER. A policy write adds a version; a licence keeps the version it froze until a
 * package is accepted again or the program is granted again. `GET /licences/:uid` says which version each
 * licence holds beside the latest, so HQ sees who is behind without anything changing for them.
 *
 * PACKAGE ACCEPTANCE IS HERE UNTIL #5021. No package offer store exists yet; when #5021 records an accepted
 * offer it calls the same statements. Accepting the package already held at its latest version and offer changes
 * nothing (no row, no line). Accepting another package supersedes the old holding and records that its executed
 * master needs replacing; the master itself is never touched, and no replacement is drafted or sent.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { pushLicenceToBranch } from '../services/licencePush';
import type { LicenceLite } from '../services/programGrants';
import {
  DEFAULT_GATE, LEGAL_GATES, SCOPE_KINDS, STRATEGIES, alreadyHolds, freezeHoldingStatements, holdingsOf, latestPolicies, latestPolicy,
  legalEventsOf, parsePolicyInput, policyVersionStatements, policyVersions, readLicenceLegal, replacementOnPackageMoveStatement,
  syncLegalGate, type ScopeKind,
} from '../services/agreementPolicies';

const r = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);
const REASON_MIN = 10;
const PACKAGE_KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const OFFER_UID = /^[A-Za-z0-9_-]{1,64}$/;
const refuse = (c: any, status: 400 | 404 | 409 | 422, error: string, message: string, extra: Record<string, unknown> = {}) =>
  c.json({ error, message, ...extra }, status);

async function licenceOf(env: Env, uid: string) {
  return await env.DB.prepare('SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences WHERE uid = ?')
    .bind(uid).first<LicenceLite & { id: number }>();
}

r.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    return c.json({
      items: await latestPolicies(c.env),
      strategies: STRATEGIES,
      legal_gates: LEGAL_GATES,
      default_gate: DEFAULT_GATE,
      // A scope with no row has no recorded policy: its grants keep the schedule rule alone (D1120/D4805).
      unrecorded_means: 'not_recorded',
    });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── one licence (registered before /:scopeKind/:scopeKey)

r.get('/licences/:licenceUid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceOf(c.env, c.req.param('licenceUid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    const [legal, allHoldings, latest] = await Promise.all([
      readLicenceLegal(c.env, licence, today()),
      holdingsOf(c.env, licence.uid, true),
      latestPolicies(c.env),
    ]);
    const latestOf = new Map(latest.map((p) => [`${p.scope_kind}:${p.scope_key}`, p]));
    return c.json({
      licence_uid: licence.uid,
      licence_identity: 'territory_licence',
      holdings: allHoldings.map((h) => {
        const l = latestOf.get(`${h.scope_kind}:${h.scope_key}`);
        return { ...h, current: !h.superseded_at, latest_version: l?.version ?? null, behind_latest: !!l && l.version > h.policy_version };
      }),
      programs: legal.programs,
      replacements_required: legal.replacements,
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/licences/:licenceUid/history', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await licenceOf(c.env, c.req.param('licenceUid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    const lifecycle = await c.env.DB.prepare(
      `SELECT e.id, e.agreement_uid, e.action, e.from_status, e.to_status, e.revision, e.actor_user_id, e.detail_json, e.created_at,
              a.agreement_kind, a.slot_key, a.program_key, a.package_key, a.package_version, a.template_slug, a.template_version
         FROM licence_agreement_events e LEFT JOIN licence_program_agreements a ON a.uid = e.agreement_uid
        WHERE e.licence_uid = ? ORDER BY e.id`,
    ).bind(licence.uid).all<Record<string, any>>();
    const legal = await legalEventsOf(c.env, licence.uid);
    const parse = (v: string | null) => { try { return v ? JSON.parse(v) : null; } catch { return { unreadable: true }; } };
    const items = [
      ...(lifecycle.results || []).map((e) => ({
        source: 'agreement' as const, id: e.id, action: e.action, created_at: e.created_at, actor_user_id: e.actor_user_id,
        agreement_uid: e.agreement_uid, agreement_revision: e.revision, from_status: e.from_status, to_status: e.to_status,
        agreement_kind: e.agreement_kind ?? null, slot_key: e.slot_key ?? null, program_key: e.program_key ?? null,
        package_key: e.package_key ?? null, package_version: e.package_version ?? null,
        template_slug: e.template_slug ?? null, template_version: e.template_version ?? null,
        reason: (parse(e.detail_json) as any)?.reason ?? null, detail: parse(e.detail_json),
      })),
      ...legal.map((e) => ({ source: 'legal' as const, ...(e as Record<string, any>), id: Number((e as any).id), created_at: String((e as any).created_at) })),
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || (a.source === b.source ? a.id - b.id : a.source === 'agreement' ? -1 : 1));
    return c.json({ licence_uid: licence.uid, items });
  } catch (e) { return mapError(c, e); }
});

r.post('/licences/:licenceUid/package-acceptances', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (reason.length < REASON_MIN) return refuse(c, 400, 'reason_required', `Say why, in at least ${REASON_MIN} characters. It is the line HQ's record keeps.`);
    const packageKey = typeof b?.package_key === 'string' && PACKAGE_KEY.test(b.package_key) ? b.package_key : null;
    if (!packageKey) return refuse(c, 400, 'invalid_package', 'Name the package that was accepted.');
    const offer = b?.package_offer_uid == null ? null : (typeof b.package_offer_uid === 'string' && OFFER_UID.test(b.package_offer_uid) ? b.package_offer_uid : undefined);
    if (offer === undefined) return refuse(c, 400, 'invalid_offer', 'A package offer uid is letters, digits, dashes and underscores.');
    const licence = await licenceOf(c.env, c.req.param('licenceUid'));
    if (!licence) return refuse(c, 404, 'not_found', 'There is no such licence.');
    const policy = await latestPolicy(c.env, 'package', packageKey);
    if (!policy) return refuse(c, 409, 'no_policy', 'HQ has not recorded an agreement policy for this package, so there is nothing to freeze. Record one first.');
    const holdings = await holdingsOf(c.env, licence.uid);
    if (alreadyHolds(holdings, 'package', packageKey, policy, offer)) {
      // Idempotent: a repeated acceptance (a retry, a double click) writes nothing.
      return c.json({ ok: true, unchanged: true, holding: holdings.find((h) => h.scope_kind === 'package' && h.scope_key === packageKey) });
    }
    const uid = newUid();
    const at = nowIso();
    try {
      await c.env.DB.batch([
        replacementOnPackageMoveStatement(c.env, { licenceUid: licence.uid, packageKey, actorId: admin.id, at, reason }),
        ...freezeHoldingStatements(c.env, {
          uid, licenceUid: licence.uid, scopeKind: 'package', scopeKey: packageKey, origin: 'package_offer_accepted',
          packageOfferUid: offer, actorId: admin.id, at, reason,
        }),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(e instanceof Error ? e.message : '')) return refuse(c, 409, 'acceptance_conflict', 'Another acceptance for this licence was recorded at the same moment. Read it again.');
      throw e;
    }
    await logAdminAction(c.env, admin.id, admin.email, 'licence_package_policy_frozen', {
      licence_uid: licence.uid, package_key: packageKey, package_offer_uid: offer, policy_uid: policy.uid, policy_version: policy.version, reason,
    });
    await syncLegalGate(c.env, licence.uid, { actorId: admin.id, reason });
    // The branch copy's `legal_waiting` reads the holdings, so the licence goes to its branch now.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    const after = await holdingsOf(c.env, licence.uid);
    return c.json({ ok: true, unchanged: false, holding: after.find((h) => h.uid === uid) ?? null, pushed }, 201);
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── one scope

function scopeOf(c: any): { kind: ScopeKind; key: string } | null {
  const kind = c.req.param('scopeKind');
  if (!(SCOPE_KINDS as readonly string[]).includes(kind)) return null;
  return { kind, key: c.req.param('scopeKey') };
}

r.get('/:scopeKind/:scopeKey', async (c) => {
  try {
    await requireSuperAdmin(c);
    const s = scopeOf(c);
    if (!s) return refuse(c, 404, 'not_found', 'A policy belongs to a program or a package.');
    const [versions, events, holders] = await Promise.all([
      policyVersions(c.env, s.kind, s.key),
      c.env.DB.prepare(
        `SELECT id, action, licence_uid, policy_uid, policy_version, actor_user_id, reason, detail_json, created_at
           FROM licence_legal_events WHERE scope_kind = ? AND scope_key = ? AND action IN ('policy_versioned', 'policy_frozen') ORDER BY id`,
      ).bind(s.kind, s.key).all<Record<string, any>>(),
      c.env.DB.prepare(
        `SELECT policy_version, COUNT(*) AS n FROM licence_agreement_policy_holdings
          WHERE scope_kind = ? AND scope_key = ? AND superseded_at IS NULL GROUP BY policy_version ORDER BY policy_version`,
      ).bind(s.kind, s.key).all<{ policy_version: number; n: number }>(),
    ]);
    return c.json({
      scope_kind: s.kind, scope_key: s.key,
      latest: versions[0] ?? null,
      versions,
      holders_by_version: (holders.results || []).map((h) => ({ policy_version: Number(h.policy_version), licences: Number(h.n) })),
      history: (events.results || []).map((e) => {
        let detail: unknown = null;
        try { detail = e.detail_json ? JSON.parse(e.detail_json) : null; } catch { detail = { unreadable: true }; }
        return { ...e, detail_json: undefined, detail };
      }),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:scopeKind/:scopeKey', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const b = await c.req.json().catch(() => ({} as any));
    const parsed = parsePolicyInput(c.req.param('scopeKind'), c.req.param('scopeKey'), b);
    if (!parsed.ok) return refuse(c, 400, 'invalid_policy', parsed.error);
    const p = parsed.value;
    const uid = newUid();
    try {
      await c.env.DB.batch(policyVersionStatements(c.env, p, { uid, actorId: admin.id, at: nowIso() }));
    } catch (e) {
      if (/UNIQUE/i.test(e instanceof Error ? e.message : '')) return refuse(c, 409, 'policy_conflict', 'Another version of this policy was saved at the same moment. Read it again.');
      throw e;
    }
    const saved = (await policyVersions(c.env, p.scope_kind, p.scope_key)).find((v) => v.uid === uid) ?? null;
    await logAdminAction(c.env, admin.id, admin.email, 'licence_agreement_policy_versioned', {
      scope_kind: p.scope_kind, scope_key: p.scope_key, policy_uid: uid, version: saved?.version ?? null,
      strategy: p.strategy, legal_gate: p.legal_gate, programs: p.programs, required_schedules: p.required_schedules, reason: p.reason,
    });
    return c.json({ ok: true, policy: saved, reaches_existing_holders: false }, 201);
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/licence-agreement-policies', router: r };
export default r;
