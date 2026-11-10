#!/usr/bin/env node
// D1541 (#3779) — writes the deck icon set from the installed lucide-react:
// every icon's SVG nodes (its `key`s dropped), and the set's licence record
// (ISC, its copyright and the Feather notice it keeps). No network. The output
// is sorted, so a second run with the same package writes the same bytes;
// `deck_elements_d1541.test.ts` checks the record.
//
// D4574 H3 (#4574): it writes TWO files, because the nodes were 395.5 KiB of
// the Worker script — its largest single input — while almost every caller
// needs only the names.
//
//   cloudflare-worker/src/services/decks/iconNames.json  the set's record and
//       its icon names, imported by `elements.ts` and so in the Worker script.
//   frontend/public/deck-icons/lucide-<version>.json     the nodes and the
//       licence text, a static asset the Worker reads through its own assets
//       binding (`decks/iconGeometry.ts`), never bundled.
//
// The asset's name carries the package version, so the Worker never reads an
// older deploy's nodes: one deploy ships the names file and its own asset.
//
//   node scripts/gen-deck-icon-set.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('lucide-react/package.json');
const root = dirname(pkgPath);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const iconsDir = join(root, 'dist/esm/icons');
const ALLOWED = new Set(['path', 'circle', 'rect', 'line', 'ellipse', 'polyline', 'polygon']);
const icons = {};
for (const f of readdirSync(iconsDir).filter((n) => n.endsWith('.mjs')).sort()) {
  const m = /const __iconData = (\{[\s\S]*?\n\});/.exec(readFileSync(join(iconsDir, f), 'utf8'));
  if (!m) continue;
  // The file is the package's own data literal: names, numbers and strings only.
  const data = Function(`"use strict"; return (${m[1]});`)();
  if (!/^[a-z0-9-]{1,64}$/.test(data.name) || icons[data.name]) continue;
  icons[data.name] = data.node.map(([tag, attrs]) => {
    if (!ALLOWED.has(tag)) throw new Error(`${data.name}: ${tag} is not an element the set may draw`);
    const { key, ...rest } = attrs;
    return [tag, rest];
  });
}
const licence = readFileSync(join(root, 'LICENSE'), 'utf8');
const names = Object.keys(icons).sort();
const set = {
  id: 'lucide', name: 'Lucide', version: pkg.version, spdx: pkg.license, url: 'https://lucide.dev',
  copyright: (/Copyright \(c\) [^\n]+/.exec(licence) || ['Lucide Icons and Contributors'])[0],
  derived: 'Some icons derive from Feather (MIT, Copyright (c) 2013-2023 Cole Bemis); the notice is kept with the set.',
  viewBox: '0 0 24 24', stroke: 'currentColor', fill: 'none', stroke_width: 2,
};
// The names file: what `elements.ts` imports, so what the Worker script carries.
// It holds no node data and no licence text — both live in the asset below.
writeFileSync(
  new URL('../cloudflare-worker/src/services/decks/iconNames.json', import.meta.url),
  `${JSON.stringify({ set, asset: `/deck-icons/lucide-${set.version}.json`, names })}\n`,
);
// The asset: the nodes and the licence text, read at runtime through the
// assets binding. `version` is checked against the names file on every read.
const assetDir = new URL('../frontend/public/deck-icons/', import.meta.url);
mkdirSync(assetDir, { recursive: true });
writeFileSync(
  new URL(`lucide-${set.version}.json`, assetDir),
  `${JSON.stringify({ version: set.version, licence_text: licence.trim(), icons: Object.fromEntries(names.map((k) => [k, icons[k]])) })}\n`,
);
console.log(`[icons] ${names.length} icons from lucide-react ${pkg.version} (${pkg.license}); names in the Worker, nodes in /deck-icons/lucide-${set.version}.json`);
