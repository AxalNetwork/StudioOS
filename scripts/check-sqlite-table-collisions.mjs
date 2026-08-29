#!/usr/bin/env node
/**
 * Fails the build when two CREATE TABLE definitions for the same table are
 * mutually fatal — each demanding a NOT NULL column the other has no place for.
 *
 * D1 holds exactly one table per name. Every one of these definitions is
 * `CREATE TABLE IF NOT EXISTS`, so the first to run wins and the rest are
 * silent no-ops. Whichever loses, the code written against its shape is broken:
 * an INSERT naming columns the live table lacks throws "no such column", and an
 * INSERT omitting a NOT NULL column the live table has throws a constraint
 * error. Both land in the same swallowing catches as everything else.
 *
 * THIS IS THE BLIND SPOT OF `check-sqlite-columns`, and it is structural rather
 * than accidental: that check UNIONS every definition it finds, because it has
 * no way to know which one is live. The union satisfies every query, so no
 * column ever looks missing — `capital_calls` reads as nineteen columns wide
 * when no version of it has ever had more than thirteen. A union is the right
 * default for a check that must not over-report. It just cannot see this.
 *
 * "Mutually fatal" is deliberately narrow. Definitions that merely differ are
 * common and usually fine: a `.ts` ensureSchema mirroring a migration plus the
 * columns later ALTERs added is not a conflict. What cannot be reconciled is
 * two definitions that each REQUIRE something the other does not even have a
 * column for. Then no single table can satisfy both, and one of the two code
 * paths is dead — a fact provable from the repository alone.
 *
 * WHICH ONE IS LIVE IS NOT PROVABLE FROM THE REPOSITORY. Top-level
 * `sql/*.sql` files are applied by hand (`scripts/migrate-d1.mjs` enumerates
 * only `sql/migrations/*.sql`), so file order does not settle it, and
 * `advisor_bookings` is a worked example that the numbered file is not always
 * the winner: bookings are written in the `t13_t14_t15.sql` shape and that
 * feature works, so `schema.sql`'s six-column version is the dead one. Each
 * baseline entry therefore records what is known and names the
 * `PRAGMA table_info` that would settle the rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/sqlite-table-collisions-baseline.json');

function walk(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * Column name -> "required": NOT NULL, no DEFAULT, not the primary key.
 * Those three together are what makes an omission fatal at INSERT time.
 */
export function tableColumns(body) {
  const cols = new Map();
  // Comments first: a commented-out column is not a column, and a comment
  // containing a comma would otherwise corrupt the split itself.
  const clean = body.replace(/--.*$/gm, '');
  for (const line of clean.split(/,(?![^(]*\))/)) {
    const c = /^\s*[`"[]?([a-z_]\w*)[`"\]]?\s+\w/i.exec(line);
    if (!c) continue;
    const col = c[1].toLowerCase();
    if (['primary', 'unique', 'foreign', 'check', 'constraint'].includes(col)) continue;
    const required = /\bNOT\s+NULL\b/i.test(line) && !/\bDEFAULT\b/i.test(line) && !/\bPRIMARY\s+KEY\b/i.test(line);
    cols.set(col, required);
  }
  return cols;
}

/** Every CREATE TABLE in the worker, by table name. */
export function definitions() {
  const defs = new Map();
  const files = walk(path.join(ROOT, 'cloudflare-worker/sql'), ['.sql'])
    .concat(walk(path.join(ROOT, 'cloudflare-worker/src'), ['.ts']));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    for (const m of src.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(/gi)) {
      let depth = 0, i = m.index + m[0].length - 1;
      const start = i + 1;
      for (; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
      }
      if (depth !== 0) continue;                       // unbalanced — decline
      const t = m[1].toLowerCase();
      if (!defs.has(t)) defs.set(t, []);
      defs.get(t).push({
        cols: tableColumns(src.slice(start, i)),
        rel,
        line: src.slice(0, start).split('\n').length,
      });
    }
  }
  return defs;
}

/** Tables whose definitions cannot all describe one table. */
export function fatalCollisions() {
  const out = new Map();
  for (const [table, list] of definitions()) {
    if (list.length < 2) continue;
    const pairs = [];
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const A = list[a], B = list[b];
        const aOnly = [...A.cols].filter(([c, req]) => req && !B.cols.has(c)).map(([c]) => c);
        const bOnly = [...B.cols].filter(([c, req]) => req && !A.cols.has(c)).map(([c]) => c);
        // Both directions must be fatal. One-directional means the second
        // definition is a strict subset — an older shape a later ALTER filled
        // in — which is ordinary, not a conflict.
        if (aOnly.length && bOnly.length) {
          pairs.push({ a: `${A.rel}:${A.line}`, aNeeds: aOnly, b: `${B.rel}:${B.line}`, bNeeds: bOnly });
        }
      }
    }
    if (pairs.length) out.set(table, pairs);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = fatalCollisions();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).tables ?? {};

  const added = [...found.keys()].filter((t) => !(t in baseline)).sort();
  const resolved = Object.keys(baseline).filter((t) => !found.has(t)).sort();

  if (added.length) {
    console.error('✖ check-sqlite-table-collisions: two definitions that cannot be one table:\n');
    for (const t of added) {
      console.error(`  ${t}`);
      for (const p of found.get(t)) {
        console.error(`      ${p.a}  requires ${p.aNeeds.join(', ')}`);
        console.error(`      ${p.b}  requires ${p.bNeeds.join(', ')}`);
      }
    }
    console.error('\nD1 holds one table per name and every definition is IF NOT EXISTS, so');
    console.error('the first to run wins and the rest do nothing. Whichever loses, the code');
    console.error('written against it cannot insert a row.');
    console.error('\nConverge the definitions, or record the collision in');
    console.error('scripts/sqlite-table-collisions-baseline.json with what is known about');
    console.error('which shape is live.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-sqlite-table-collisions: baseline entries that no longer collide:\n');
    for (const t of resolved) console.error(`  ${t}`);
    console.error('\nDelete them from scripts/sqlite-table-collisions-baseline.json — a ledger');
    console.error('of known conflicts is only worth reading if every line in it is still true.');
    process.exit(1);
  }

  const defs = definitions();
  const multi = [...defs.values()].filter((l) => l.length > 1).length;
  const n = Object.keys(baseline).length;
  console.log(
    `✓ check-sqlite-table-collisions: ${defs.size} tables defined, ${multi} more than once, `
    + `${n} irreconcilable and on record.`,
  );
}
