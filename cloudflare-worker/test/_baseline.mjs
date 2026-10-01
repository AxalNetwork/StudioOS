/**
 * `schema_baseline.sql`, read table by table — with no regex built from a variable.
 *
 * WHY A FIXTURE COMES FROM THE BASELINE AT ALL. A hand-copied `CREATE TABLE` in a
 * test drifts from the one production has, and then every assertion above it is
 * true of a schema nobody runs. That is the whole of #203, and it happened again
 * while #176 was being written: `okr_move_log.test.ts`'s first fixture spelled the
 * column `key_results` where `roadmap_okrs` has `key_results_json`, so every route
 * call died on `no such column`. Reading the DDL out of the baseline is what stops
 * the fixture and production disagreeing.
 *
 * WHY IT IS NOT A REGEX ANY MORE. Three files carried a byte-identical
 *
 *     new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?"?${name}"?\\s*\\(`, 'im')
 *
 * and Semgrep flagged all three under
 * `javascript.lang.security.audit.detect-non-literal-regexp` (alerts 6088-6091,
 * with `cadence_vocabulary.test.mjs`). The ReDoS framing those alerts lead with is
 * not the live risk here — this runs at test time and every argument is a literal
 * written in the test itself. `frontend/test/_escapeRe.mjs` states the reason that
 * does apply, and it is sharper for a fixture reader than for anything else in
 * this repo: a metacharacter in an interpolated value changes what the pattern
 * means SILENTLY, so the assertion still passes and now checks something else. A
 * fixture reader that silently resolves the wrong table is the #203 failure with
 * an extra step.
 *
 * The repo's answer to this rule is settled by `d716900ee` — "Close the open
 * Semgrep alerts by rewriting the matches, not silencing them" — whose own body
 * says the non-literal RegExp sites "become hardcoded patterns or indexOf walks".
 * This file is the indexOf walk. `nosemgrep` is supported by the workflow but
 * appears only in generated and vendored trees, never in hand-written source.
 */

/** The two keyword runs that may precede the name, compared upper-cased. */
const CREATE = 'CREATE TABLE ';
const IF_NOT_EXISTS = 'IF NOT EXISTS ';

const isWordChar = (ch) => ch !== '' && /[A-Za-z0-9_]/.test(ch);

/**
 * `word` present in `text` as a whole word — the `\b…\b` walk from
 * `research_stores_scoping.test.ts`, which #521 wrote for exactly this reason.
 *
 * A bare `includes` is not the same test and the difference is load-bearing:
 * `scope` occurs inside `scope_id`, `metric_name` inside `xmetric_name`, and a
 * column ban written with `includes` would fire on a name that merely contains
 * the banned one. `END TRANSACTION` carries a space, so the boundary is checked
 * at the ends of the whole phrase rather than per token.
 */
export function wordInText(text, word) {
  const hay = String(text);
  const needle = String(word);
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : hay[at - 1];
    const after = hay[at + needle.length] ?? '';
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/**
 * The line index at which `name`'s `CREATE TABLE` starts, or -1.
 *
 * TWO PROPERTIES THE OLD PATTERN HAD, BOTH LOAD-BEARING, BOTH KEPT:
 *
 *   · ANCHORED AT A LINE START. `traction_snapshots.test.ts` records what happens
 *     without it — an earlier helper allowed `[^;]*?` between `CREATE TABLE` and
 *     the name, matched the `REFERENCES projects(id)` INSIDE `activity_logs`, and
 *     built that table under the name `projects`. It failed loudly, which its own
 *     comment calls luck.
 *   · A BOUNDARY AFTER THE NAME. `metric_targets` and `metrics_snapshots` sit two
 *     lines apart in the baseline, so a prefix match takes the wrong one. The `(`
 *     this requires IS that boundary — see the note at the check itself.
 *
 * The optional `"` is NOT padding: seven tables in the baseline quote their names
 * — `"advisors"`, `"capital_calls"`, `"landing_pages"`, `"watchlist_items"` and
 * three more — so a rewrite that dropped it would resolve none of them.
 * `IF NOT EXISTS` is tolerance the baseline does not currently exercise; it stays
 * because the baseline is generated, and a reader that misses throws rather than
 * guessing.
 *
 * The KEYWORDS match case-insensitively, as the old `i` flag did. The NAME
 * compares exactly, which the old flag did not — a deliberate tightening, stated
 * here rather than left to be discovered: a test asking for `Projects` and getting
 * `projects` is a test whose author has lost track of which table they meant.
 */
function createTableAt(baseline, name) {
  const src = String(baseline);
  const target = String(name);
  // LINE BY LINE, not `indexOf('CREATE TABLE ')`. Searching for the literal would
  // anchor on one casing and quietly stop finding `create table`, which the old
  // pattern's `i` flag did find — a narrowing disguised as a rewrite.
  for (let at = 0; at <= src.length; ) {
    const nl = src.indexOf('\n', at);
    const lineEnd = nl < 0 ? src.length : nl;
    const start = at;
    at = lineEnd + 1;
    if (src.slice(start, start + CREATE.length).toUpperCase() !== CREATE) continue;
    let i = start + CREATE.length;
    if (src.slice(i, i + IF_NOT_EXISTS.length).toUpperCase() === IF_NOT_EXISTS) {
      i += IF_NOT_EXISTS.length;
    }
    const quoted = src[i] === '"';
    if (quoted) i += 1;
    if (src.slice(i, i + target.length) !== target) continue;
    i += target.length;
    if (quoted) {
      if (src[i] !== '"') continue;
      i += 1;
    }
    // NO SEPARATE BOUNDARY CHECK AFTER AN UNQUOTED NAME, and the absence is
    // deliberate rather than an oversight: the `(` required below already is the
    // boundary. A strict prefix of a longer name is always followed by another
    // name character — `metrics_snapshot` against `CREATE TABLE metrics_snapshots (`
    // stops on the `s` — so an `isWordChar` test there can never fire. It was
    // written first and a mutation proved it dead; the property it was meant to
    // hold is asserted in `baseline_reader.test.mjs` against the behaviour, not
    // against this line.
    // `\s*`, newlines included, as the old pattern had — all 397 of the
    // baseline's `CREATE TABLE` lines carry their `(` on the same line, so this
    // is equivalence on the real input rather than a shape anybody relies on.
    while (/\s/.test(src[i] ?? '')) i += 1;
    if (src[i] !== '(') continue;
    return start;
  }
  return -1;
}

/**
 * One table's `CREATE TABLE … );` taken verbatim out of `schema_baseline.sql`.
 *
 * Throws on a table the baseline does not declare, and on a DDL with no
 * terminator — the strictest of the three helpers this replaces, two of which
 * checked only the first. A missing check here can only ever hide a fault.
 */
export function tableFromBaseline(baseline, name) {
  const src = String(baseline);
  const at = createTableAt(src, name);
  if (at < 0) throw new Error(`${name} is not declared at the start of a line in schema_baseline.sql`);
  const end = src.indexOf(');', at);
  if (end < 0) throw new Error(`${name}'s DDL is not terminated in the baseline`);
  return src.slice(at, end + 2);
}

/**
 * A migration split into the statements `db.exec` can take, one at a time.
 *
 * WHY NOT `sql.split(';')`, WHICH IS WHAT EVERY FIXTURE HERE USED TO DO. These
 * migrations carry more prose than DDL, and **51 of them have a semicolon inside
 * a `--` comment**. A naive split cuts such a comment in half and hands the
 * second half to SQLite as a statement; it fails with a syntax error quoting the
 * migration's own prose, which reads like a broken migration rather than a broken
 * test. That is not hypothetical — it is how this function came to exist, on
 * migration 254's own comment: "…`item.blocks`; `roadmap_okrs` has none of those
 * columns".
 *
 * Stripping whole-line comments before splitting fixes that case and is what the
 * fixtures that were passing already did. It is still not enough: at least five
 * migrations (016, 099, 100, 109, 156) put a semicolon in a TRAILING comment
 * after real SQL on the same line, so the next fixture to apply one of those
 * would hit the identical failure with a different file.
 *
 * So this tracks string literals instead of pattern-matching around them: `--`
 * starts a comment only outside a quoted string, and `;` ends a statement only
 * outside one. `''` inside a string is an escaped quote, not a close — SQLite's
 * own rule, and the one a regex cannot express.
 */
export function splitStatements(sql) {
  const src = String(sql);
  const out = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      buf += ch;
      if (ch === "'") {
        if (src[i + 1] === "'") { buf += src[i + 1]; i += 1; } else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; buf += ch; continue; }
    if (ch === '-' && src[i + 1] === '-') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl - 1;
      continue;
    }
    if (ch === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * The same DDL with its `REFERENCES` clauses removed.
 *
 * `node:sqlite` enforces foreign keys by default, so a `REFERENCES` to a table a
 * fixture does not create fails at CREATE rather than at INSERT. What that drops
 * is referential integrity between fixture rows, which no assertion depending on
 * it has been written — and D1 ignores `PRAGMA foreign_keys` inside a batch
 * anyway, so production is not relying on it either.
 *
 * OPT-IN AT THE CALL SITE, because only one of the three callers wants it and the
 * other two are green on the untouched DDL. A shared reader that quietly stripped
 * for everybody would change two fixtures while claiming to move one.
 */
export function stripForeignKeys(ddl) {
  return String(ddl).replace(
    /\s+REFERENCES\s+"?\w+"?\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi,
    '',
  );
}
