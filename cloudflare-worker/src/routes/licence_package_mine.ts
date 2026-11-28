/**
 * D5026 part 2 (#5026, board L35) — the Axal VC package the caller's licence holds, read only, for the studio's
 * own Licence page: `GET /api/licence/mine/package`.
 *
 * ON HQ the licence is the one `licence_admins` binds the caller to (as `licence_programs.ts` binds it), and the
 * package is read from D5024's immutable accepted offers (`licence_package_offers`, `state = 'accepted'`):
 *   current        the term D5025's `currentTerm` reads (the active one, else the latest scheduled), or null;
 *   next           a later accepted term that starts after the current one ends, or null;
 *   standalone     programs granted today that no accepted package item names (D5025 `standaloneGranted`).
 * Each term carries the package name and version, its dates, its state, the frozen programs and the accepted
 * annual price. The accepted price is shown to the same accounts that already read the licence's own fees on
 * `GET /api/licence/mine` (D797: the principal and every delegate), so no role is refused here.
 *
 * WHAT THE STUDIO DOES NOT READ (#5026: "Do not expose HQ-only country model internals"): the recommended fee,
 * the override and its reason, the pricing recommendation and country snapshot, the acceptance receipt and who at
 * HQ decided. None of them leaves this file.
 *
 * ON A BRANCH no package copy is pushed, so the answer is `source: 'copy'` with `current: null` and a reason,
 * never "no package". A licence with no accepted offer answers `current: null` with the standalone programs, so
 * the page can say whether its programs are standalone grants (#5026, Empty states). A ledger from before the
 * offer migration answers `recorded: false`. A failed read is a 503, never an empty answer.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { nowIso } from './_t13t14t15_helpers';
import type { PackageOffer } from '../services/packageOffers';
import { currentTerm, licenceOffers, programKeys, standaloneGranted, termState } from '../services/packageLifecycle';

const r = new Hono<{ Bindings: Env }>();

const UNREADABLE = { code: 'licence_package_unreadable', message: 'Your Axal VC package could not be read. That is not the same as no package. Try again in a moment.' };
const NO_TABLE = /no such table: (?:main\.)?(licence_package_offers|licence_package_items)\b/i;
export const BRANCH_REASON = 'HQ does not send this studio deployment its Axal VC package. HQ’s copy of your licence page shows it.';
export const NOT_RECORDED_REASON = 'This ledger has no package offers yet, so no package is recorded for any licence.';

/** One accepted term as the studio reads it: no recommendation, override, snapshot or decider. */
export function studioTerm(o: PackageOffer, all: PackageOffer[], day: string) {
  return {
    package_key: o.package_key,
    package_name: o.package_name,
    package_version: o.package_version,
    starts_on: o.starts_on,
    ends_on: o.ends_on,
    state: termState(o, all, day),
    programs: programKeys(o),
    annual_fee_cents: o.accepted_annual_fee_cents,
    currency: o.currency,
  };
}

// GET /api/licence/mine/package
r.get('/mine/package', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  if (branchOf(c.env)) {
    if (user.role !== 'admin') throw new Error('Admin required');
    return c.json({ source: 'copy', recorded: false, current: null, next: null, standalone: null, reason: BRANCH_REASON });
  }
  let licence: { uid: string; licence_ref: string | null; brand_name: string | null } | null;
  try {
    licence = await c.env.DB.prepare(
      `SELECT l.uid, l.licence_ref, l.brand_name FROM licence_admins la
         JOIN territory_licences l ON l.id = la.licence_id WHERE la.user_id = ?`,
    ).bind(user.id).first();
  } catch (e) {
    return refuse(c, 503, { ...UNREADABLE, raw: e });
  }
  if (!licence) return c.json({ error: 'no_licence', message: 'You do not administer a territory licence.' }, 404);
  const day = nowIso().slice(0, 10);
  try {
    const all = await licenceOffers(c.env, licence.uid);
    const cur = currentTerm(all, day);
    const next = cur
      ? all.filter((o) => o.state === 'accepted' && o.starts_on > cur.ends_on).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] ?? null
      : null;
    const standalone = await standaloneGranted(c.env, licence.uid);
    return c.json({
      source: 'hq', recorded: true, licence: { uid: licence.uid, licence_ref: licence.licence_ref, brand_name: licence.brand_name },
      current: cur ? studioTerm(cur, all, day) : null,
      next: next ? studioTerm(next, all, day) : null,
      standalone,
      reason: null,
    });
  } catch (e) {
    if (NO_TABLE.test(String(e))) {
      return c.json({ source: 'hq', recorded: false, current: null, next: null, standalone: null, reason: NOT_RECORDED_REASON });
    }
    return refuse(c, 503, { ...UNREADABLE, raw: e });
  }
});

export default r;
export const mount: RouteMount = { path: '/api/licence', router: r };
