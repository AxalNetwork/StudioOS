/**
 * The AI bands each founder cycle page draws, read out of the cycle table
 * `frontend/src/pages/cycles/CycleRoute.jsx` draws by (`CYCLE_DEFS`, D661,
 * #1474). Since D5615 (#5615) each cycle's entry is its own file,
 * `frontend/src/pages/cycles/defs/<cycle>.jsx`, so the route's source is
 * CycleRoute.jsx and those four files read together.
 *
 * The retired desks mounted each band as a literal `<ZoneDraft surface="…">`,
 * so the band census and the rail-sentence check read that attribute. The
 * cycle pages draw every band from one table through one
 * `<ZoneDraft {...draft}>`, so the same checks read the table: a band is a
 * `surface: '…'` entry under the module slug it sits on, and a fill band is a
 * `fills` entry. One entry per cycle, sliced so one cycle's bands are never
 * counted as another's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

export const CYCLE_ROUTE = 'frontend/src/pages/cycles/CycleRoute.jsx';
export const CYCLES = ['validate', 'raise', 'grow', 'build'];
/** D5615: each cycle's entry in the table, one file per cycle. */
export const CYCLE_DEF_FILES = CYCLES.map((cycle) => `frontend/src/pages/cycles/defs/${cycle}.jsx`);
/** Every file the cycle route's own source is: the component, then the four entries. */
export const CYCLE_ROUTE_FILES = [CYCLE_ROUTE, ...CYCLE_DEF_FILES];

/** The route's source with its cycle entries, raw (comments kept). */
export function cycleRouteText() {
  return CYCLE_ROUTE_FILES.map((f) => readFileSync(resolve(process.cwd(), f), 'utf8')).join('\n');
}

export function cycleRouteSource() {
  return CYCLE_ROUTE_FILES.map((f) => codeOnly(readFileSync(resolve(process.cwd(), f), 'utf8'))).join('\n');
}

/** One cycle's entry (`const <cycle> = { … };` in `defs/<cycle>.jsx`), as text. */
export function cycleDef(src, cycle) {
  const head = `const ${cycle} = {`;
  const at = src.startsWith(head) ? 0 : src.indexOf(`\n${head}`) + 1;
  if (at <= 0 && !src.startsWith(head)) return '';
  const rest = src.slice(at);
  const end = rest.indexOf('\n};');
  return end < 0 ? rest : rest.slice(0, end + 3);
}

/** The text of a cycle's `drafts` table, from its opening to its closing line. */
export function cycleDraftsBlock(src, cycle) {
  const def = cycleDef(src, cycle);
  const at = def.indexOf('drafts: new Map([');
  return at < 0 ? '' : def.slice(at, def.indexOf('\n  ]),', at));
}

/** `[[moduleSlug, surface], …]` for every draft band in a cycle's `drafts` table. */
export function cycleBands(src, cycle) {
  const block = cycleDraftsBlock(src, cycle);
  const out = [];
  let slug = null;
  for (const m of block.matchAll(/\['([a-z-]+)', \[\{|surface: '([a-z/-]+)'/g)) {
    if (m[1]) slug = m[1];
    else out.push([slug, m[2]]);
  }
  return out;
}

/** `{ moduleSlug: fillKind }` from a cycle's `fills` entry. */
export function cycleFills(src, cycle) {
  const def = cycleDef(src, cycle);
  const fills = def.match(/\n {2}fills: \{([^}]*)\},/)?.[1] || '';
  return Object.fromEntries([...fills.matchAll(/'?([a-z-]+)'?: '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
}
