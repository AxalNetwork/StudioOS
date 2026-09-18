/**
 * D162 — the bound-parameter rule stops being a typed list of six.
 *
 * WHAT D160 LEFT. D160 closed D125's stated blind spot — a raw `.toISOString()`
 * bind meeting a bare timestamp comparison, which drops every row dated on the
 * bind's own date — and watched SIX column names, chosen by hand:
 * `created_at|updated_at|occurred_at|recorded_at|issued_at|paid_at`. A hand
 * list is the shape this repo has watched go stale three times, and measured
 * against the wider vocabulary it missed FOUR live sites in three files, every
 * one of them money- or entitlement-adjacent:
 *
 * | site | column | what it did |
 * | --- | --- | --- |
 * | `routes/news.ts` | `article_submission_log.submitted_at` | the 3-per-week submission limit **under-counted**, so an author whose earlier submission fell on the window's own date got a fourth |
 * | `routes/wellbeing.ts` (the count) | `expert_profile_views.viewed_at` | the free-tier monthly cap **under-counted**, so views taken on the 1st were free |
 * | `routes/wellbeing.ts` (the already-seen check) | the same column | a founder who viewed an expert **on the 1st** was told they had not, and was charged for it a second time |
 * | `services/xAggregator.ts` | `market_intel_indexes.computed_at` | `safeHasMIChart` answered **false** for a chart computed on the period's first day |
 *
 * THE TWO WELLBEING SITES PULL OPPOSITE WAYS ON THE SAME DAY, which is why the
 * class is worth stating rather than assuming understood. On the 1st of a month
 * the cap both LEAKS (the count misses views, so the quota reads low) and
 * OVER-CHARGES (the already-seen check misses the prior view, so the same
 * expert costs a second unit) — on one request path, from one date boundary.
 *
 * THE RULE, and it needs no list. The defect is not "a raw ISO bind"; it is a
 * raw ISO bind meeting a column SQLite ITSELF wrote. A column declared
 * `DEFAULT (datetime('now'))` or `DEFAULT CURRENT_TIMESTAMP` holds
 * `YYYY-MM-DD HH:MM:SS`; a column with no default holds whatever JavaScript
 * bound, which in this codebase is ISO — and ISO against ISO is consistent.
 * So the schema already knows, and `_sqlFormatColumns.mjs` asks it. The
 * derivation separates the seven measured candidates perfectly: the three with
 * a clock default are exactly the three broken columns, and the four without
 * are exactly the four struck — `advisor_office_hour_slots.starts_at` (bound
 * by the caller), `legal_obligations.expires_at` and `pairwise_ndas.valid_until`
 * (D125 struck these explicitly), and `users.mi_digest_paused_until`, whose own
 * comment already documented it as ISO.
 *
 * WHAT IT STILL DOES NOT DO. It does not require every timestamp comparison to
 * be wrapped. It fires only where a RAW ISO bind meets a BARE comparison on a
 * column the schema declares SQL-format — which is the defect and nothing else.
 * Wrapping costs the column's index for that predicate; accepted here for the
 * same reason D160 accepted it, and stated rather than discovered: these are
 * small tables read once per request, and a correct count beats a fast wrong one.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/iso_bind_sql_columns_d162.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  rawIsoNames, sqlFormatColumns, tablesIn, comparesBare, clockWrittenColumns,
} from './_sqlFormatColumns.mjs';

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'cloudflare-worker/src');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const BY_TABLE = sqlFormatColumns(BASELINE);

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Every worker source, read once — the corpus both the sweep and the
 * clock-written derivation walk.
 */
const SOURCES = tsFiles(SRC).map((f) => ({ file: f, src: readFileSync(f, 'utf8') }));
const CLOCK_WRITTEN = clockWrittenColumns(SOURCES.map((s) => s.src));

/** Is this column SQL-format for a statement touching `tables`? */
function sqlFormatHere(tables: Set<string>, col: string): boolean {
  for (const t of tables) {
    if (BY_TABLE.get(t)?.has(col)) return true;
    if (CLOCK_WRITTEN.get(t)?.has(col)) return true;
  }
  return false;
}

/** The text from `at` to the matching close paren — exact, never a window. */
function balanced(src: string, at: number): string {
  const open = src.indexOf('(', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

// ── the derivation ───────────────────────────────────────────────────────────

test('the schema decides which columns are SQL-format, and it separates all seven', () => {
  const has = (t: string, c: string) => Boolean(BY_TABLE.get(t)?.has(c));

  // The three that were broken — each declared with a clock default.
  assert.ok(has('article_submission_log', 'submitted_at'));
  assert.ok(has('expert_profile_views', 'viewed_at'));
  assert.ok(has('market_intel_indexes', 'computed_at'));

  // The four that are correct — no default, so JavaScript decides the format
  // and it binds ISO on both sides. Flagging any of these would mean rewriting
  // working queries, which is the churn D125 refused.
  assert.ok(!has('advisor_office_hour_slots', 'starts_at'),
    'the caller binds this one, so the column is whatever the request sent');
  assert.ok(!has('legal_obligations', 'expires_at'), 'written .toISOString() — D125 struck it');
  assert.ok(!has('pairwise_ndas', 'valid_until'), 'written .toISOString() — D125 struck it');
  assert.ok(!has('users', 'mi_digest_paused_until'),
    "written .toISOString(); its own comment already said so");
});

test('the derivation reads whole tables, not the next one along', () => {
  // A greedy scan across the baseline reads one table's columns into the next
  // table's set, which would flag correct code. Both nesting cases are pinned:
  // `DEFAULT (datetime('now'))` has parens INSIDE the column list, and a table
  // is bounded by its own closing paren rather than the first one found.
  const ddl = `
    CREATE TABLE a (id INTEGER, made_at TEXT NOT NULL DEFAULT (datetime('now')), note TEXT);
    CREATE TABLE b (id INTEGER, given_at TEXT, seen_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `;
  const m = sqlFormatColumns(ddl);
  assert.deepEqual([...(m.get('a') || [])], ['made_at']);
  assert.deepEqual([...(m.get('b') || [])].sort(), ['seen_at']);
  assert.ok(!m.get('a')?.has('given_at'), "table b's column must not land in table a");
  assert.ok(!m.get('b')?.has('made_at'), "and table a's must not land in b");
});

test('a wrapped comparison is not a bare one, and the half-wrapped form is still the defect', () => {
  assert.ok(comparesBare('WHERE viewed_at >= ?', 'viewed_at'), 'the bare form');
  assert.ok(comparesBare('WHERE v.viewed_at >= ?', 'viewed_at'), 'qualified, still bare');
  assert.ok(!comparesBare('WHERE datetime(viewed_at) >= datetime(?)', 'viewed_at'), 'the fix');
  assert.ok(!comparesBare('WHERE viewed_at >= datetime(?)', 'viewed_at'),
    'wrapping the PLACEHOLDER is sufficient — datetime() normalises the bind to the column');
  assert.ok(comparesBare('WHERE datetime(viewed_at) >= ?', 'viewed_at'),
    'the HALF-wrapped form is still broken: a normalised column against a raw ISO bind');
  assert.ok(!comparesBare('WHERE last_viewed_at >= ?', 'viewed_at'),
    'a longer column name that ENDS in the watched one is a different column');
});

// ── the sweep ────────────────────────────────────────────────────────────────

test('no raw ISO bind meets a bare comparison on a column SQLite wrote', () => {
  const offenders: string[] = [];

  for (const { file, src } of SOURCES) {
    if (!src.includes('.toISOString()')) continue;
    const raw = rawIsoNames(src);
    if (raw.size === 0) continue;

    let at = src.indexOf('.prepare(');
    while (at >= 0) {
      const sql = balanced(src, at);
      // The columns this statement's own tables declare SQL-format, PLUS any the
      // code itself writes with the clock — `paid_at` has no DDL default and is
      // set with `datetime('now')` at four sites, so the schema alone misses it.
      const tables = tablesIn(sql);
      const cols = new Set<string>();
      for (const t of tables) {
        for (const c of BY_TABLE.get(t) || []) cols.add(c);
        for (const c of CLOCK_WRITTEN.get(t) || []) cols.add(c);
      }

      for (const col of cols) {
        if (!sqlFormatHere(tables, col)) continue;
        if (!comparesBare(sql, col)) continue;
        // The `.bind(...)` feeding THIS statement: the next one after the
        // prepare's own closing paren, matched by parens rather than by a
        // character window so a neighbouring call cannot be read as this one's.
        const afterPrepare = at + sql.length;
        const bindAt = src.indexOf('.bind(', afterPrepare);
        if (bindAt < 0 || bindAt - afterPrepare >= 40) continue;
        const args = new Set(balanced(src, bindAt).match(/[A-Za-z_$][\w$]*/g) || []);
        for (const name of raw) {
          if (args.has(name)) {
            const line = src.slice(0, at).split('\n').length;
            offenders.push(`${file.slice(SRC.length + 1)}:${line} binds raw-ISO \`${name}\` against \`${col}\``);
          }
        }
      }
      at = src.indexOf('.prepare(', at + 1);
    }
  }

  assert.deepEqual(offenders, [],
    'A raw `.toISOString()` value is bound against an unwrapped column the SCHEMA declares '
    + 'SQL-format (`DEFAULT (datetime(\'now\'))` / `CURRENT_TIMESTAMP`). SQLite compares TEXT '
    + "lexically, so the T separator sorts every row dated on the bind's own date below it and "
    + 'the window silently loses a day. Wrap both sides: `datetime(col) >= datetime(?)`.');
});

// ── the four sites, pinned by what they now do ───────────────────────────────

test('the four fixed comparisons are wrapped, and the fix is on the read they gate', () => {
  const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

  const news = read('cloudflare-worker/src/routes/news.ts');
  assert.match(news, /datetime\(submitted_at\) >= datetime\(\?\)/,
    'the weekly submission limit must count the whole window, or it lets a fourth through');

  const wb = read('cloudflare-worker/src/routes/wellbeing.ts');
  assert.equal((wb.match(/datetime\(viewed_at\) >= datetime\(\?\)/g) || []).length, 2,
    'BOTH wellbeing reads — the monthly count and the already-seen check. Fixing one leaves the '
    + 'cap wrong in the other direction on the same day, which is worse than leaving both');

  const agg = read('cloudflare-worker/src/services/xAggregator.ts');
  assert.match(agg, /datetime\(computed_at\) >= datetime\(\?\)/,
    'safeHasMIChart must see a chart computed on the period\'s first day');
});

test("the derived set covers D160's typed six, so its narrower scan is a backstop and not the rule", () => {
  // D160's whole-repo scan stays, deliberately, and this is what makes keeping
  // it honest rather than redundant: if the derivation above ever returned an
  // empty map, the sweep in this file would pass VACUOUSLY while D160's typed
  // list still caught its six. A guard whose failure mode is silence needs one
  // that cannot go silent the same way. What must not happen is the two rules
  // disagreeing, so the subsumption is proved rather than assumed.
  const all = new Set<string>();
  for (const cols of BY_TABLE.values()) for (const c of cols) all.add(c);
  assert.ok(all.size > 20, `the derivation must actually find columns, got ${all.size}`);
  for (const col of ['created_at', 'updated_at', 'issued_at']) {
    assert.ok(all.has(col), `${col} is in D160's list and must be in the derived set too`);
  }
  // `paid_at` is covered by the OTHER half of the derivation — no DDL default,
  // but four writers set it with the clock. Reading only the schema would have
  // called a money column clear, which is what proving this found.
  const clockCols = new Set<string>();
  for (const cols of CLOCK_WRITTEN.values()) for (const c of cols) clockCols.add(c);
  assert.ok(clockCols.has('paid_at'),
    'paid_at is SQL-format because the CODE writes it so, not because the schema says so');
  // And it is attributed to the tables that write it, not to every table: the
  // table-agnostic first draft made `legal_obligations.expires_at` look broken,
  // which is the correct query D125 examined and struck.
  assert.ok(!CLOCK_WRITTEN.get('legal_obligations')?.has('expires_at'),
    "a clock write on one table must not make another table's column look SQL-format");

  // AND THE SIXTH IS THE ARGUMENT FOR DERIVING, FOUND WHILE PROVING THE
  // SUBSUMPTION. `occurred_at` is in D160's typed list and does not exist:
  // zero declarations in the baseline, zero in any migration, zero in any
  // runtime bootstrap. A hand list can carry a name nothing has ever declared
  // and nothing will ever tell you — it costs no failure, so it is invisible.
  // The derived set cannot hold one, because every member comes from a DDL.
  for (const ghost of ['occurred_at', 'recorded_at']) {
    assert.ok(!all.has(ghost) && !clockCols.has(ghost),
      `${ghost} is in D160's list and is declared by nothing`);
  }
  assert.equal(BASELINE.includes('occurred_at'), false,
    'If either is ever declared, delete this assertion and add it above — but do not '
    + "loosen the subsumption check to make D160's typed list look right, which is how the "
    + 'name survived in it this long');
});
