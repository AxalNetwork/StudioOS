#!/usr/bin/env node
/**
 * build-route-registry — writes `cloudflare-worker/src/routes/_registry.ts`,
 * the list of Worker route modules that mount themselves (#4105).
 *
 * A module under `cloudflare-worker/src/routes/` that exports
 * `mount: RouteMount | RouteMount[]` (`src/util/routeRegistry.ts`) is mounted
 * by the registry, so adding one is a new file and nothing else, with no edit
 * to `index.ts`. Workers cannot list a folder at runtime, and the registry is
 * read by `tsc`, the node tests and wrangler's bundler, so it is generated
 * here. Since D5612 (#5612) it is gitignored, never committed:
 * `scripts/build-generated.mjs` writes it before every build, typecheck and
 * test, so two branches adding neighbouring routes no longer conflict on it.
 *
 *   node scripts/build-route-registry.mjs           # check the descriptors, write the registry
 *   node scripts/build-route-registry.mjs --check   # exit 1 when a descriptor is wrong, the
 *                                                   # generator is not deterministic, or git tracks
 *                                                   # the registry
 *
 * `cloudflare-worker/test/route_registry_4105.test.ts` (in `npm run
 * test:drift`) runs the same checks.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY_REL, buildRegistry, descriptorProblems, registryProblems } from './lib/routeRegistry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// A missing registry reads as null; read without an existence check first
// (CodeQL js/file-system-race).
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

// Writing needs sound descriptors; --check also needs a deterministic
// generator and an untracked output.
const problems = CHECK ? registryProblems(ROOT) : descriptorProblems(ROOT);
if (problems.length) {
  console.error(`route registry: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (CHECK) {
  console.log(`${REGISTRY_REL}: the generator is deterministic and git does not track its output.`);
} else {
  const file = resolve(ROOT, REGISTRY_REL);
  const want = buildRegistry(ROOT);
  if (readOrNull(file) === want) {
    console.log(`${REGISTRY_REL} is already current.`);
  } else {
    writeFileSync(file, want);
    console.log(`wrote ${REGISTRY_REL}`);
  }
}
