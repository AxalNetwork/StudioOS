#!/usr/bin/env node
/**
 * D1615 (#4102): the route map as one document, built from its fragments.
 *
 *   node scripts/build-route-map.mjs           writes the combined map (not committed)
 *   node scripts/build-route-map.mjs --check   only checks the fragments (test:guards)
 *
 * The fragments live in documentation/architecture/route-map/ (its README has
 * the rules). The check fails on a canvas with two rows, naming both files; on
 * a canvas file holding anything but one table row; on rows written inline in a
 * section; and on a rows folder no section places. The combined file is for
 * reading only, and .gitignore keeps it out of git: nothing reads it back, every
 * script and test reads the fragments through scripts/lib/routeMap.mjs.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRouteMap, routeMapFragments, REPO_ROOT, ROUTE_MAP_DIR } from './lib/routeMap.mjs';

export const COMBINED = `${ROUTE_MAP_DIR}/ROUTE_MAP.combined.md`;

const STAMP = '<!-- Built by scripts/build-route-map.mjs from documentation/architecture/route-map/. Do not edit: edit the fragment. Not committed. -->\n';

function main() {
  let text;
  try {
    text = readRouteMap();
  } catch (e) {
    console.error(`✖ check-route-map: ${e.message}`);
    process.exit(1);
  }
  const lines = routeMapFragments();
  const rows = lines.filter((l) => l.canvasRow).length;
  const files = new Set(lines.map((l) => l.file)).size;
  if (process.argv.includes('--check')) {
    console.log(`✓ check-route-map: ${files} fragments, ${rows} canvas rows, one row per canvas.`);
    return;
  }
  writeFileSync(join(REPO_ROOT, COMBINED), STAMP + text);
  console.log(`wrote ${COMBINED} (${rows} canvas rows from ${files} fragments)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
