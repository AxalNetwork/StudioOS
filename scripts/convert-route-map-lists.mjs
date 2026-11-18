#!/usr/bin/env node
/**
 * D6471 (#6471): write every route-map canvas file's list cells one item per line.
 *
 *   node scripts/convert-route-map-lists.mjs   converts in place and names each file it changed
 *
 * A canvas row's "Backend it wires to" cell, when it is a pure list (backticked
 * names joined by ", ", each with at most one parenthetical), moves out of the
 * row into a sorted `backend:` list below it; the row keeps the slot `{backend}`.
 * Prose cells and cells that are not pure lists are left exactly as written.
 * Running it again changes nothing. `node scripts/build-route-map.mjs --check`
 * fails on a list cell still written inline and names this script.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listifyCanvasFile, REPO_ROOT, ROUTE_MAP_DIR } from './lib/routeMap.mjs';

const canvases = join(REPO_ROOT, ROUTE_MAP_DIR, 'canvases');
let changed = 0;
let seen = 0;
for (const part of readdirSync(canvases, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  for (const name of readdirSync(join(canvases, part)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
    seen += 1;
    const path = join(canvases, part, name);
    const text = readFileSync(path, 'utf8');
    const out = listifyCanvasFile(text);
    if (out === text) continue;
    writeFileSync(path, out);
    changed += 1;
    console.log(`  listed  ${ROUTE_MAP_DIR}/canvases/${part}/${name}`);
  }
}
console.log(`${changed} of ${seen} canvas files converted; the rest have no list cell, or are already converted.`);
