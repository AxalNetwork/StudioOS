/**
 * #4715 — the advisor router's source, read as a whole. `routes/advisors.ts`
 * mounts the route modules split out of it (`advisors_*.ts`, each named in its
 * imports) at the place their routes held, and they share
 * `services/advisorPractice.ts`. A test that reads "the worker" to hold the
 * frontend to it (a DTO's keys, a state graph, a route's guard) reads all of
 * them, so moving a handler between those files never moves it out of the
 * test's sight. The module list comes from advisors.ts's own imports, so a
 * further split needs no edit here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTES = resolve(process.cwd(), 'cloudflare-worker/src/routes');

/** advisors.ts's mounted route modules, in the order it imports them. */
export const advisorRouteFiles = () => {
  const core = readFileSync(resolve(ROUTES, 'advisors.ts'), 'utf8');
  const split = [...core.matchAll(/^import \w+ from '\.\/(advisors_\w+)';$/gm)].map((m) => `${m[1]}.ts`);
  return ['advisors.ts', ...split].map((f) => resolve(ROUTES, f))
    .concat(resolve(ROUTES, '../services/advisorPractice.ts'));
};

/** The router, its route modules and their shared kit, joined. */
export const advisorRoutesSource = () => advisorRouteFiles().map((f) => readFileSync(f, 'utf8')).join('\n');
