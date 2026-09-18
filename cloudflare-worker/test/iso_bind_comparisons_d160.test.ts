/**
 * D160 — a raw ISO bind must not meet a bare timestamp comparison.
 *
 * THE BLIND SPOT THIS CLOSES, in the existing guard's own words.
 * `scripts/check-timestamp-comparisons.mjs` watches for a bare TTL column
 * compared against `CURRENT_TIMESTAMP` / `datetime('now')`, and its header says
 * plainly what it cannot see:
 *
 *   "A column compared against a BOUND PARAMETER (`created_at >= ?`) is the
 *    same defect and is invisible here, because the format lives at the bind
 *    site. That is how `rpc/branchOps.ts` came to drop every row dated on a
 *    quarter's first day. Finding those needs the bind traced, which is a
 *    different tool."
 *
 * This is that tool, narrowed to the case that actually bites.
 *
 * WHY THE FORMAT DECIDES IT. SQLite compares TEXT lexically. Three bind shapes
 * reach these queries and only one is wrong:
 *
 *   · `.toISOString()`                        → `2026-08-19T12:44:00.000Z`
 *   · `.toISOString().slice(0,19).replace('T',' ')` → `2026-08-19 12:44:00`
 *   · `.toISOString().slice(0,10)`            → `2026-08-19`
 *
 * Columns default to `datetime('now')`, i.e. `2026-08-19 12:44:00`. Against the
 * SQL-format bind the comparison is exact. Against the bare DATE it is also
 * correct: the ten-character prefix aligns and a longer string with a matching
 * prefix sorts GREATER, so `'2026-08-19 12:44:00' >= '2026-08-19'` holds and the
 * whole first day is included. Against the RAW ISO bind it is wrong: index 10 is
 * `' '` (0x20) against `'T'` (0x54), so every row dated on the bind's own date
 * sorts BELOW it and is dropped, while later dates pass. A thirty-day window
 * quietly returns twenty-nine.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not require every timestamp
 * comparison to be wrapped. Measured at the time of writing: 46 comparison sites
 * bind a value against a bare timestamp column and all but three are correct,
 * because their binds are already SQL-format or bare dates. A blanket
 * wrap-everything rule would mean rewriting 43 working queries — churn on
 * correct code, and a diff nobody can review for the one line that matters. The
 * rule here fires only where a RAW ISO bind and a BARE comparison meet, which is
 * exactly the defect and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'cloudflare-worker/src');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** The text from `at` to the matching close paren — exact, never a window. */
function balanced(src: string, at: number): string {
  const open = src.indexOf('(', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/**
 * Names in `src` bound to a RAW `.toISOString()` — one whose result is not
 * narrowed to SQL format (`.replace('T', ' ')`) or to a bare date
 * (`.slice(0, 10)`). Both `const x = …` and a later `x = …` assignment count:
 * `market_intel.ts` declares `let cutoff: string` and assigns it in branches.
 */
export function rawIsoNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^;]*?\.toISOString\(\)[^;]*);/g)) {
    const name = m[1];
    const tail = m[2].slice(m[2].indexOf('.toISOString()') + '.toISOString()'.length);
    const normalised = tail.includes(".replace('T'") || tail.includes('.replace("T"') || /\.slice\(\s*0\s*,\s*10\s*\)/.test(tail);
    if (!normalised) names.add(name);
  }
  return names;
}

/**
 * A timestamp column compared to a RAW placeholder.
 *
 * THE PLACEHOLDER SIDE IS WHAT DECIDES IT, and the first draft of this rule had
 * that backwards. It carried a `(?<!datetime\()` lookbehind, meaning "skip it if
 * the COLUMN is wrapped" — which is exactly the wrong test. `col >= datetime(?)`
 * is CORRECT even with a raw ISO bind, because `datetime()` normalises the bind
 * to the column's own format. `datetime(col) >= ?` is still BROKEN: the left
 * becomes `YYYY-MM-DD HH:MM:SS` and the right stays ISO, so the T separator sorts
 * wrong exactly as before. The lookbehind would have waved that through. The
 * optional `\)?` below is what lets the half-wrapped form be seen at all.
 */
const BARE_BIND_COMPARE =
  /\b(?:[a-z_]+\.)?(?:created_at|updated_at|occurred_at|recorded_at|issued_at|paid_at)\)?\s*(?:>=|<=|>|<)\s*\?/;

test('a raw ISO bind never meets a bare timestamp comparison', () => {
  const offenders: string[] = [];

  for (const file of tsFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('.toISOString()')) continue;
    const raw = rawIsoNames(src);
    if (raw.size === 0) continue;

    let at = src.indexOf('.prepare(');
    while (at >= 0) {
      const sql = balanced(src, at);
      if (BARE_BIND_COMPARE.test(sql)) {
        // The `.bind(...)` that feeds THIS statement: the next one after the
        // prepare's own closing paren, matched by parens rather than by a
        // character window so a neighbouring call cannot be read as this one's.
        const afterPrepare = at + sql.length;
        const bindAt = src.indexOf('.bind(', afterPrepare);
        if (bindAt >= 0 && bindAt - afterPrepare < 40) {
          const args = balanced(src, bindAt);
          for (const name of raw) {
            if (new Set(args.match(/[A-Za-z_$][\w$]*/g) || []).has(name)) {
              offenders.push(`${file.slice(SRC.length + 1)} binds raw-ISO \`${name}\` into a bare comparison`);
            }
          }
        }
      }
      at = src.indexOf('.prepare(', at + 1);
    }
  }

  assert.deepEqual(offenders, [],
    'A raw `.toISOString()` value is bound against an unwrapped timestamp column. SQLite compares '
    + 'TEXT lexically and the column is stored `YYYY-MM-DD HH:MM:SS`, so the T separator sorts every '
    + "row dated on the bind's own date below it and the window loses a day. Wrap both sides: "
    + '`datetime(col) >= datetime(?)`.');
});

test('the three shapes are classified correctly, so the rule can fire and can hold', () => {
  // Raw — the defect.
  assert.ok(rawIsoNames('const cutoff = new Date(Date.now() - 30).toISOString();').has('cutoff'));
  // Normalised to SQL format — correct, and must NOT be flagged, or `aiRouter`
  // and `aiSpend` would be rewritten for no reason.
  assert.ok(!rawIsoNames("const since = new Date(x).toISOString().slice(0, 19).replace('T', ' ');").has('since'));
  // Bare date — also correct, by prefix alignment. `quarterOf` relies on it.
  assert.ok(!rawIsoNames('const start = d.toISOString().slice(0, 10);').has('start'));
  // Re-assignment without a declarator, which `market_intel` uses in a branch.
  assert.ok(rawIsoNames('let c: string;\n  c = d.toISOString();').has('c'));
});

test('a wrapped comparison is not a bare one', () => {
  assert.ok(BARE_BIND_COMPARE.test('WHERE a.created_at >= ?'), 'the bare form must match');
  assert.ok(!BARE_BIND_COMPARE.test('WHERE datetime(a.created_at) >= datetime(?)'),
    'the wrapped form must not match, or the fix would still read as the defect');
  assert.ok(!BARE_BIND_COMPARE.test('WHERE created_at >= datetime(?)'),
    'wrapping the PLACEHOLDER is sufficient — datetime() normalises the bind to the column format');
  assert.ok(BARE_BIND_COMPARE.test('WHERE datetime(created_at) >= ?'),
    'the HALF-wrapped form is still the defect: a normalised column against a raw ISO bind. '
    + 'The first draft of this rule skipped it, which is the hole this assertion exists to keep shut');
});
