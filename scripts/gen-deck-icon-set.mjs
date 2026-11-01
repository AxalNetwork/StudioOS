#!/usr/bin/env node
// D1541 (#3779) — writes cloudflare-worker/src/services/decks/iconSet.json from
// the installed lucide-react: every icon's SVG nodes (its `key`s dropped), and
// the set's licence record (ISC, its copyright and the Feather notice it keeps).
// No network. The output is sorted, so a second run with the same package
// writes the same bytes; `deck_elements_d1541.test.ts` checks the record.
//
//   node scripts/gen-deck-icon-set.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const out = {
  set: {
    id: 'lucide', name: 'Lucide', version: pkg.version, spdx: pkg.license, url: 'https://lucide.dev',
    copyright: (/Copyright \(c\) [^\n]+/.exec(licence) || ['Lucide Icons and Contributors'])[0],
    derived: 'Some icons derive from Feather (MIT, Copyright (c) 2013-2023 Cole Bemis); the notice is kept with the set.',
    licence_text: licence.trim(),
    viewBox: '0 0 24 24', stroke: 'currentColor', fill: 'none', stroke_width: 2,
  },
  icons: Object.fromEntries(Object.keys(icons).sort().map((k) => [k, icons[k]])),
};
writeFileSync(new URL('../cloudflare-worker/src/services/decks/iconSet.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`[icons] ${Object.keys(out.icons).length} icons from lucide-react ${pkg.version} (${pkg.license})`);
