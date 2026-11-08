/**
 * D5048 (#5048, part 1 of #5047) — HQ's reads of the canonical package and program agreements. Mounted at
 * `/api/admin/licence-agreements`; the store is `licence_program_agreements` (`services/programAgreements.ts`).
 *
 *   GET /licences/:licenceUid   every agreement version of one licence, each slot's executed and in-flight
 *                               version, and each granted program's five legal states
 *   GET /:uid                   one version and its history
 *
 * WHO. `requireSuperAdmin`, as the licence ledger and the program grants are read. A D1 failure is a 5xx
 * through `mapError`, never an empty list.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { agreementByUid, agreementEvents, agreementsOfLicence, programLegalState, slotsOf } from '../services/programAgreements';
import { presentGrant, type LicenceLite } from '../services/programGrants';

const r = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);

r.get('/licences/:licenceUid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await c.env.DB.prepare('SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences WHERE uid = ?')
      .bind(c.req.param('licenceUid')).first<LicenceLite & { id: number }>();
    if (!licence) return c.json({ error: 'not_found', message: 'There is no such licence.' }, 404);
    const [rows, grants] = await Promise.all([
      agreementsOfLicence(c.env, licence.uid),
      c.env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? ORDER BY program_key').bind(licence.id).all<Record<string, any>>(),
    ]);
    const now = today();
    return c.json({
      licence_uid: licence.uid,
      // #5057 has not built the shared licence identity, so this is the territory licence's uid (D5048 §2).
      licence_identity: 'territory_licence',
      agreements: rows,
      slots: slotsOf(rows).map((s) => ({ ...s, executed: s.executed?.uid ?? null, in_flight: s.in_flight?.uid ?? null })),
      programs: (grants.results || []).map((g) => programLegalState(g, rows, { grantInForce: presentGrant(g, licence, now).in_force })),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const row = await agreementByUid(c.env, c.req.param('uid'));
    if (!row) return c.json({ error: 'not_found', message: 'There is no such agreement.' }, 404);
    return c.json({ agreement: row, events: await agreementEvents(c.env, row.uid) });
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/licence-agreements', router: r };
export default r;
