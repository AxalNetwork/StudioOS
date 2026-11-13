/**
 * D5059 (#5059, user licences 3/4 under #5047) — program entitlements from held user licences, for HQ. Mounted at
 * `/api/admin/program-entitlements`; the evaluation is `services/programEntitlements.ts`.
 *
 *   GET  /                               Program access by user licence: one row per account and program
 *                                        (?licence_type=all|founder|investor|operating_partner|advisor
 *                                         &holder=user:<id>&program=&q=&limit=)
 *   GET  /rules                          every rule version, and the one in force per program and licence type
 *   POST /rules                          { program_key, licence_type, eligible, agreement_required?, effective_from, reason }
 *                                        the pair's next version
 *   GET  /accounts/:id                   one account: its licences, every program they make it eligible for, and history
 *   POST /accounts/:id/programs/:program { action: grant|pause|resume|end, expected_revision, reason }
 *   GET  /licences/:uid                  one user licence: eligible, granted and in-force programs, source and blockers
 *
 * WHO. Every read is `requireSuperAdmin`, as the licence registry and Program access by licence are read: these
 * list every member's licences. Every write is `requireSuperAdminWriteBar` (a TOTP session, a fresh step-up, the
 * elevation), as a territory program grant is, with a reason of at least 10 characters, and is audited.
 *
 * Territory program grants stay `routes/admin_program_grants.ts`; nothing here reads or writes them.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { isRegistryKey } from '../services/programRegistry';
import {
  EntitlementError, GRANT_ACTIONS, REASON_MIN, accessQuery, addRuleVersion, changeGrant, entitlementsOfAccount,
  entitlementsOfLicence, grantEventsOf, parseRuleInput, programAccessByHolder, programNames, readRules, rulesInForce, todayUtc,
} from '../services/programEntitlements';

const r = new Hono<{ Bindings: Env }>();

r.onError((error, c) => {
  if (error instanceof EntitlementError) return refuse(c, error.status, { code: error.code, message: error.sentence, extra: error.extra });
  // Authentication, step-up and storage failures answer as every HQ licence route answers them (D110, D134, D278).
  return mapError(c, error);
});

const UID = /^[A-Za-z0-9_-]{1,80}$/;
function accountId(raw: string | undefined): number {
  const s = raw || '';
  if (!/^[1-9][0-9]{0,15}$/.test(s) || !Number.isSafeInteger(Number(s))) throw new EntitlementError(404, 'not_found', 'Account not found.');
  return Number(s);
}

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  return c.json(await programAccessByHolder(c.env, accessQuery(c.req.query())));
});

r.get('/rules', async (c) => {
  await requireSuperAdmin(c);
  const day = todayUtc();
  const [rules, name] = await Promise.all([readRules(c.env), programNames(c.env)]);
  const inForce = rulesInForce(rules, day);
  const pairs = new Map<string, { program_key: string; program_name: string; licence_type: string; in_force: unknown; scheduled: unknown[]; versions: unknown[] }>();
  for (const rule of rules) {
    const k = `${rule.program_key}|${rule.licence_type}`;
    if (!pairs.has(k)) pairs.set(k, { program_key: rule.program_key, program_name: name(rule.program_key), licence_type: rule.licence_type, in_force: inForce.get(k) ?? null, scheduled: [], versions: [] });
    const p = pairs.get(k)!;
    p.versions.unshift(rule);
    if (rule.effective_from > day) p.scheduled.push(rule);
  }
  return c.json({ on: day, items: [...pairs.values()] });
});

r.post('/rules', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const body = await c.req.json().catch(() => null);
  const v = parseRuleInput(body);
  if (!v.ok) throw new EntitlementError(400, 'invalid_rule', 'The rule has fields to fix.', { fields: v.fields });
  const rule = await addRuleVersion(c.env, v.value, admin.id);
  await logAdminAction(c.env, admin.id, admin.email || '', 'program_licence_rule_versioned', {
    rule_uid: rule.uid, program_key: rule.program_key, licence_type: rule.licence_type, version: rule.version,
    eligible: rule.eligible, agreement_required: rule.agreement_required, effective_from: rule.effective_from, reason: rule.reason,
  });
  return c.json({ rule }, 201);
});

r.get('/accounts/:id', async (c) => {
  await requireSuperAdmin(c);
  const id = accountId(c.req.param('id'));
  const read = await entitlementsOfAccount(c.env, id);
  return c.json({ ...read, history: await grantEventsOf(c.env, id), actions: Object.keys(GRANT_ACTIONS) });
});

r.post('/accounts/:id/programs/:program', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const id = accountId(c.req.param('id'));
  const program = c.req.param('program') || '';
  if (!isRegistryKey(program)) throw new EntitlementError(404, 'not_found', 'There is no such program.');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!GRANT_ACTIONS[action]) throw new EntitlementError(400, 'invalid_action', `The action must be one of ${Object.keys(GRANT_ACTIONS).join(', ')}.`);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > 500) throw new EntitlementError(400, 'reason_required', `Say why, in ${REASON_MIN} to 500 characters.`);
  const rev = body?.expected_revision;
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 0) throw new EntitlementError(400, 'expected_revision_required', 'Name the revision you read (expected_revision; 0 when there is no grant yet).');
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!exists) throw new EntitlementError(404, 'not_found', 'Account not found.');
  const out = await changeGrant(c.env, { userId: id, programKey: program, action, expectedRevision: rev, reason, actorId: admin.id });
  await logAdminAction(c.env, admin.id, admin.email || '', 'user_program_grant_changed', {
    target_user_id: id, program_key: program, action, grant_uid: out.grant.uid, state: out.grant.state, revision: out.grant.revision,
    sources: out.entitlement?.sources.map((s) => s.licence_uid) ?? [], reason,
  });
  return c.json(out);
});

r.get('/licences/:uid', async (c) => {
  await requireSuperAdmin(c);
  const uid = c.req.param('uid') || '';
  if (!UID.test(uid)) throw new EntitlementError(404, 'not_found', 'No user licence with that id.');
  return c.json(await entitlementsOfLicence(c.env, uid));
});

export const mount: RouteMount = { path: '/api/admin/program-entitlements', router: r };
export default r;
