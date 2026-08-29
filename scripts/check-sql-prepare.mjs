#!/usr/bin/env node
/**
 * SQL-injection tripwire for `DB.prepare(`…`)` — the other half of M3.
 *
 * `check-sql-unsafe.mjs` guards `sql.unsafe(…)`, and that is the smaller
 * surface by an order of magnitude: 4 interpolations there against 282 here,
 * across 77 distinct expressions. `DB.prepare` carries exactly the same risk —
 * a `${…}` lands in the query TEXT, where no binding protects it — and had no
 * guard at all.
 *
 * WHY A BASELINE RATHER THAN AN ALLOWLIST. All 77 were reviewed when this
 * script was written and none is an injection: they are placeholder strings,
 * column allow-lists, `"col = ?"` pairs with values bound separately, literal
 * SQL fragments held in module constants, clamped integers, and ids read back
 * out of D1. Adding 77 names to the exact-match ALLOWLIST in the sibling
 * script would have swamped it — its own header says to keep that list
 * SHRINKING — and would have implied each was individually argued for.
 *
 * So this mirrors the repo's existing `api-drift-baseline.json` pattern
 * instead. The baseline records what was there and where, and the gate fails
 * on anything NEW. That is an honest claim: "these were audited on the date
 * this file was written", not "these are safe forever". Removing a site is
 * always allowed and shrinks the ledger; adding one requires a decision.
 *
 * Wired into `npm run test:drift` via `test:guards`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker', 'src');
const BASELINE = path.join(ROOT, 'scripts', 'sql-prepare-baseline.json');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Every `${…}` inside a `DB.prepare(`…`)` template, as `expr @ file`.
 *
 * The backtick is scanned rather than regex-matched to the closing one,
 * because a template containing an escaped backtick would otherwise end the
 * match early and hide everything after it.
 */
export function scan() {
  const found = new Map();
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    for (const m of src.matchAll(/\.prepare\(\s*`/g)) {
      let i = m.index + m[0].length - 1;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') break;
        j += 1;
      }
      for (const im of src.slice(i + 1, j).matchAll(/\$\{([^}]+)\}/g)) {
        const key = `${im[1].trim()} @ ${rel}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    }
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = scan();
  if (process.argv.includes('--write')) {
    const sorted = Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BASELINE, `${JSON.stringify({
      note: 'Interpolations inside DB.prepare(`…`) present when this ledger was written, '
          + 'each reviewed and none an injection. The gate fails on NEW entries only. '
          + 'Removing a site is always allowed. Regenerate with: node scripts/check-sql-prepare.mjs --write',
      sites: sorted,
    }, null, 2)}\n`);
    console.log(`✓ wrote baseline: ${Object.keys(sorted).length} sites`);
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('✖ check-sql-prepare: baseline missing — run with --write');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).sites ?? {};
  const added = [...found.keys()].filter((k) => !(k in baseline));

  if (added.length) {
    console.error('✖ check-sql-prepare: NEW interpolation inside DB.prepare(`…`):');
    for (const k of added) console.error(`  ${k}`);
    console.error('\nA `${…}` here lands in the query TEXT — no binding protects it.');
    console.error('Use a bound `?` parameter. If the value is provably safe (a');
    console.error('placeholder string, a column allow-list, a literal fragment, a');
    console.error('clamped integer), say so in review and re-run:');
    console.error('  node scripts/check-sql-prepare.mjs --write');
    process.exit(1);
  }

  const gone = Object.keys(baseline).filter((k) => !found.has(k));
  console.log(`✓ check-sql-prepare: no new DB.prepare() interpolations `
    + `(${found.size} known${gone.length ? `, ${gone.length} since removed` : ''}).`);
}
