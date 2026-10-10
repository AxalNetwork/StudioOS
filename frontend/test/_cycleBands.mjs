/**
 * The AI bands each founder cycle page draws, read out of
 * `frontend/src/pages/cycles/CycleRoute.jsx`'s `CYCLE_DEFS` (D661, #1474).
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

export function cycleRouteSource() {
  return codeOnly(readFileSync(resolve(process.cwd(), CYCLE_ROUTE), 'utf8'));
}

/** One cycle's entry in `CYCLE_DEFS`, as text. */
export function cycleDef(src, cycle) {
  const table = src.slice(src.indexOf('const CYCLE_DEFS = {'));
  const at = table.indexOf(`\n  ${cycle}: {`);
  if (at < 0) return '';
  const rest = table.slice(at + 1);
  const end = rest.slice(1).search(/\n {2}[a-z]+: \{|\n\};/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

/** `[[moduleSlug, surface], …]` for every draft band in a cycle's `drafts` table. */
export function cycleBands(src, cycle) {
  const def = cycleDef(src, cycle);
  const at = def.indexOf('drafts: new Map([');
  if (at < 0) return [];
  const block = def.slice(at, def.indexOf('\n    ]),', at));
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
  const fills = def.match(/\n {4}fills: \{([^}]*)\},/)?.[1] || '';
  return Object.fromEntries([...fills.matchAll(/'?([a-z-]+)'?: '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
}
