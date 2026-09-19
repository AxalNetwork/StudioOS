/**
 * Which timestamp columns SQLite writes in SQL format — derived, never typed.
 *
 * WHY THIS EXISTS. D160 closed the bound-parameter blind spot the timestamp
 * guard names in its own header: a raw `.toISOString()` bind meeting a bare
 * comparison drops every row dated on the bind's own date, because SQLite
 * compares TEXT lexically and index 10 is `'T'` (0x54) against `' '` (0x20).
 * But D160's rule watched a HAND-TYPED list of six column names, and a typed
 * list is the shape this repo has now watched go stale three times. Measured
 * against the wider vocabulary it misses four live sites across three files
 * (D162), every one of them money- or entitlement-adjacent.
 *
 * WHY THE DDL DEFAULT IS THE DISCRIMINATOR, and this is the whole idea. The
 * defect is not "a raw ISO bind" — it is a raw ISO bind meeting a column
 * SQLite itself wrote. A column declared `DEFAULT (datetime('now'))` or
 * `DEFAULT CURRENT_TIMESTAMP` holds `YYYY-MM-DD HH:MM:SS`; a column with no
 * default holds whatever JavaScript bound into it, which in this codebase is
 * ISO, and ISO-against-ISO is consistent. So the schema already knows which
 * columns are which, and asking it beats curating a list.
 *
 * Measured at the time of writing, it separates the seven candidate columns
 * perfectly — the three with a datetime default are exactly the three defects,
 * and the four without are exactly the four D125 and this pass both struck:
 *
 *   flagged   article_submission_log.submitted_at   DEFAULT (datetime('now'))
 *   flagged   expert_profile_views.viewed_at        DEFAULT (datetime('now'))
 *   flagged   market_intel_indexes.computed_at      DEFAULT (datetime('now'))
 *   clear     advisor_office_hour_slots.starts_at   no default — bound by the caller
 *   clear     legal_obligations.expires_at          no default — written .toISOString()
 *   clear     pairwise_ndas.valid_until             no default — written .toISOString()
 *   clear     users.mi_digest_paused_until          no default — written .toISOString()
 *
 * WHAT IT DELIBERATELY CANNOT SEE. A column with a SQL default that some
 * INSERT nonetheless writes as ISO is genuinely mixed — D125's `shareLink.ts`
 * case, where revoking wrote one format and minting the other. This flags it,
 * which is right: a mixed column is a defect whichever way the read is bound.
 * The reverse, a default-less column that one writer fills with
 * `datetime('now')`, would be missed; no such column exists today, and the
 * honest answer is that the rule is about what the SCHEMA declares.
 */

/** Name characters, so a scan can require a whole-word match without a regex built from data. */
const isWordChar = (ch) => ch !== undefined && ch !== '' && /[A-Za-z0-9_]/.test(ch);

/**
 * `{table -> Set<column>}` for every column whose DDL carries a clock default.
 *
 * Parsed with an indexOf walk rather than a regex over the whole file: the
 * baseline is 4000-odd lines and a greedy `\(([\s\S]*?)\)` across it reads one
 * table's columns into the next table's set, which would flag correct code.
 */
export function sqlFormatColumns(baseline) {
  const out = new Map();
  const upper = baseline.toUpperCase();
  let at = upper.indexOf('CREATE TABLE ');
  while (at >= 0) {
    // The name: skip the optional IF NOT EXISTS, then read to the opening paren.
    let i = at + 'CREATE TABLE '.length;
    if (upper.startsWith('IF NOT EXISTS ', i)) i += 'IF NOT EXISTS '.length;
    const open = baseline.indexOf('(', i);
    if (open < 0) break;
    const name = baseline.slice(i, open).trim().replace(/^"|"$/g, '');
    // The body: to the paren that closes this CREATE, counted rather than guessed —
    // `DEFAULT (datetime('now'))` nests, and a first-close scan stops inside it.
    let depth = 0, close = -1;
    for (let j = open; j < baseline.length; j += 1) {
      if (baseline[j] === '(') depth += 1;
      else if (baseline[j] === ')') { depth -= 1; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) break;
    const cols = new Set();
    // Split the body on top-level commas only, so a nested DEFAULT survives intact.
    let d = 0, start = open + 1;
    const parts = [];
    for (let j = open + 1; j <= close; j += 1) {
      const ch = baseline[j];
      if (ch === '(') d += 1;
      else if (ch === ')') { if (d === 0) { parts.push(baseline.slice(start, j)); break; } d -= 1; }
      else if (ch === ',' && d === 0) { parts.push(baseline.slice(start, j)); start = j + 1; }
    }
    for (const part of parts) {
      const t = part.trim();
      const col = (t.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/) || [])[1];
      if (!col) continue;
      const u = t.toUpperCase();
      if (!u.includes('DEFAULT')) continue;
      if (u.includes('CURRENT_TIMESTAMP') || u.includes("DATETIME('NOW')")) cols.add(col);
    }
    if (cols.size) out.set(name, cols);
    at = upper.indexOf('CREATE TABLE ', close);
  }
  return out;
}

/** Every column name that is SQL-format on at least one table. */
export function sqlFormatColumnNames(baseline) {
  const all = new Set();
  for (const cols of sqlFormatColumns(baseline).values()) for (const c of cols) all.add(c);
  return all;
}

/**
 * The tables a single SQL statement reads or writes, by name.
 *
 * Deliberately coarse — `FROM`, `JOIN`, `UPDATE`, `INTO` — because the question
 * it answers is only "could this column belong to a SQL-format table", and a
 * guard that resolves one table too many errs toward flagging, which is the
 * safe direction for a check whose failure mode is a silently dropped day.
 */
export function tablesIn(sql) {
  const names = new Set();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
    names.add(m[1]);
  }
  return names;
}

/** True when `sql` compares `col` against a bare `?` with neither side wrapped in datetime(). */
export function comparesBare(sql, col) {
  let at = sql.indexOf(col);
  while (at >= 0) {
    const before = sql[at - 1];
    const after = sql[at + col.length];
    // A whole word, optionally qualified (`w.viewed_at`) — never a suffix of a longer name.
    const qualified = before === '.';
    if ((!isWordChar(before) || qualified) && !isWordChar(after)) {
      const tail = sql.slice(at + col.length);
      // `datetime(col) >= ?` is STILL the defect: the left becomes SQL format and
      // the right stays ISO. So the PLACEHOLDER side is what decides it, and the
      // optional `)` is what lets the half-wrapped form be seen at all.
      const m = tail.match(/^\)?\s*(?:>=|<=|>|<)\s*(\?|datetime\s*\()/i);
      if (m && m[1] === '?') {
        // Unless the COLUMN side was wrapped AND the placeholder was too, which
        // the branch above already excluded — so reaching here is the bare form.
        return true;
      }
    }
    at = sql.indexOf(col, at + 1);
  }
  return false;
}

/**
 * Names in `src` bound to a RAW `.toISOString()` — one whose result is not
 * narrowed to SQL format (`.replace('T', ' ')`) or to a bare date
 * (`.slice(0, 10)`). Both `const x = …` and a later `x = …` assignment count:
 * `market_intel.ts` declares `let cutoff: string` and assigns it in branches.
 */
export function rawIsoNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^;]*?\.toISOString\(\)[^;]*);/g)) {
    const name = m[1];
    const tail = m[2].slice(m[2].indexOf('.toISOString()') + '.toISOString()'.length);
    const normalised = tail.includes(".replace('T'") || tail.includes('.replace("T"') || /\.slice\(\s*0\s*,\s*10\s*\)/.test(tail);
    if (!normalised) names.add(name);
  }
  return names;
}

/**
 * Columns the CODE writes with the clock, though the schema declares no default.
 * `{table -> Set<column>}`, the same shape as `sqlFormatColumns`.
 *
 * FOUND BY PROVING THE SUBSUMPTION RATHER THAN ASSUMING IT. The first draft of
 * this module read DDL defaults only, and `paid_at` — one of D160's six — has
 * none. It is nonetheless SQL-format in practice: four writers set it with
 * `datetime('now')` or `CURRENT_TIMESTAMP` (`services/incorporations.ts` twice,
 * `services/orders.ts`, `routes/network.ts`). A rule reading only the schema
 * would have called a genuinely SQL-format money column clear.
 *
 * WHY IT IS TABLE-AWARE, and the first draft was not. Attributing a clock write
 * to every table at once looked like the safe direction — err toward flagging —
 * and it is not: `expires_at` is written with the clock on one table and with
 * `.toISOString()` on `legal_obligations`, so the table-agnostic set demanded a
 * rewrite of the very query D125 examined and STRUCK. A false positive here
 * costs churn on correct code, which is the thing D125 refused by name. So the
 * write is attributed to the table its own statement names, and nowhere else.
 */
export function clockWrittenColumns(sources) {
  const out = new Map();
  const add = (table, col) => {
    if (!out.has(table)) out.set(table, new Set());
    out.get(table).add(col);
  };
  const CLOCK = /^(?:datetime\s*\(\s*'now'[^)]*\)|CURRENT_TIMESTAMP)$/i;

  for (const src of sources) {
    // UPDATE <table> SET … — the statement runs to the next statement keyword,
    // a closing backtick or the end, so a neighbouring query's SET cannot be
    // read as this one's.
    for (const m of src.matchAll(/\bUPDATE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+SET\b/gi)) {
      const from = m.index + m[0].length;
      const rest = src.slice(from, from + 1200);
      const end = rest.search(/`|;|\bUPDATE\s|\bINSERT\s/i);
      const body = end >= 0 ? rest.slice(0, end) : rest;
      for (const p2 of body.matchAll(/\b([a-z_][a-z0-9_]*)\s*=\s*([^,\n]+)/gi)) {
        if (CLOCK.test(p2[2].trim())) add(m[1], p2[1]);
      }
    }
    // INSERT INTO <table> (cols) VALUES (vals) — matched by position, because
    // the insert form is not a `col = value` pair.
    for (const ins of src.matchAll(
      /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:`|;|ON\s+CONFLICT)/gi)) {
      const names = ins[2].split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
      const vals = ins[3].split(',').map((x) => x.trim());
      for (let i = 0; i < names.length && i < vals.length; i += 1) {
        if (CLOCK.test(vals[i])) add(ins[1], names[i]);
      }
    }
  }
  return out;
}
