/**
 * The platform's modules, counted from the code that serves them (owner,
 * 2026-10-12: "count them independently"). The home hero prints the total; the
 * canvas's "488+" was an example and no number here is typed.
 *
 * A module is one route a member opens to do one job, counted once however
 * many workspaces share it:
 *   - every zone the four workspace shells register (`workspaces/shellConfig.js`,
 *     each guard-tested to open in App.jsx), except a zone the code itself says
 *     has nothing behind it on that licence (`workspaces/noStoreCopy.js`);
 *   - every founder cycle module (`pages/cycles/modules.js`, held equal to the
 *     Worker's own lists by `cycle_adapters_d661.test.ts`);
 *   - every Spin-Out Lab tool the Platform page lists (`PLATFORM_LAYERS`).
 *
 * `frontend/test/hero_figures_d675.test.mjs` pins the rule and re-checks that
 * every Research zone counted is one `ResearchWorkspace` renders live.
 */
import { bucketsFor, zonePath, ROLES_WITH_SHELL } from '../workspaces/shellConfig.js';
import { ADVISOR_COPY, ORG_BACKED } from '../workspaces/noStoreCopy.js';
import { MODULES as CYCLE_MODULES } from '../pages/cycles/modules.js';
import { PLATFORM_LAYERS } from './siteFirm.js';

/** True when the code renders this zone, for this licence, with no store behind it. */
function storeless(role, bucket, zone) {
  if (role === 'advisor' && ADVISOR_COPY[bucket.prefix]?.[zone.slug]) return true;
  if (bucket.prefix === '/network' && zone.slug === 'organizations' && !ORG_BACKED.has(role)) return true;
  return false;
}

/** Every module's route, each once, in a stable order. */
export function platformModuleRoutes() {
  const routes = new Set();
  for (const role of ROLES_WITH_SHELL) {
    for (const bucket of bucketsFor(role)) {
      for (const zone of bucket.zones) {
        if (!storeless(role, bucket, zone)) routes.add(zonePath(bucket, zone));
      }
    }
  }
  for (const [cycle, mods] of Object.entries(CYCLE_MODULES)) {
    for (const m of mods) routes.add(`/${cycle}/${m.slug}`);
  }
  for (const layer of PLATFORM_LAYERS) {
    for (const m of layer.mods) routes.add(m.to);
  }
  return [...routes];
}

export const PLATFORM_MODULE_COUNT = platformModuleRoutes().length;
