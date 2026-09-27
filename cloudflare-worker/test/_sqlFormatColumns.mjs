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

/** A JavaScript identifier character: a word character or `$`. */
const isIdentChar = (ch) => ch !== undefined && ch !== '' && /[A-Za-z0-9_$]/.test(ch);

/**
 * Every index in `text` where `name` occurs as a whole identifier — not a
 * prefix or suffix of a longer one and, unless `allowMember`, not a member
 * access (`a.name`).
 *
 * AN indexOf WALK, NOT A PATTERN BUILT FROM THE NAME. The repo settled this in
 * `d716900ee` ("rewriting the matches, not silencing them"): a `RegExp` built
 * from data is what Semgrep's `detect-non-literal-regexp` flags, and escaping
 * the data first is what CodeQL's incomplete-escaping rule then argues about.
 * D423's first draft did both; neither is needed to find a name in text.
 */
export function identifierAt(text, name, { allowMember = false } = {}) {
  const out = [];
  if (!name) return out;
  let at = text.indexOf(name);
  while (at >= 0) {
    const before = text[at - 1];
    const after = text[at + name.length];
    const member = before === '.' && text[at - 2] !== '.'; // `...name` is a spread, not a member
    if (!isIdentChar(before) && !isIdentChar(after) && (allowMember || !member)) out.push(at);
    at = text.indexOf(name, at + 1);
  }
  return out;
}

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
      // D423: a `-- comment` ending the PREVIOUS column's line lands at the head
      // of this part (the split is on commas, and the comment follows one), so
      // the column-name match below read the comment and dropped the column.
      // `founder_needs.created_at` — after `status … DEFAULT 'open', -- open|…`
      // — was invisible to the rule that way. Line comments go before parsing.
      const t = part.replace(/--[^\n]*/g, '').trim();
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
    // D423: the raw call must PRODUCE the assigned value — at bracket depth 0
    // in the right-hand side. `axis = weekAxis(new Date(n).toISOString(), …)`
    // passes an ISO string INTO a function and assigns whatever comes back
    // (`branch_insights.ts`: SQL-format `from`/`to`), so it is not raw.
    const rhs = m[2];
    const iso = rhs.indexOf('.toISOString()');
    let depth = 0;
    for (let k = 0; k < iso; k += 1) {
      if ('([{'.includes(rhs[k])) depth += 1;
      else if (')]}'.includes(rhs[k])) depth -= 1;
    }
    if (depth > 0) continue;
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

// ── D423: following the bind through helpers, wrappers and object fields ─────
//
// D162's sweep saw a raw ISO value only when it was named from
// `x = ….toISOString()` in the SAME file, reached `.bind(` within 40 characters
// of a `.prepare(` whose SQL was written inline, and it skipped any file with no
// `.toISOString()` in it. Three shapes walked past it (the gap map's D162
// section, and D301's own filed half):
//
//   a HELPER    `nowIso()` returns raw ISO from another file; `iso()` and
//               `isoNow()` return SQL format — the NAME says nothing, so the
//               helper's BODY decides (`isRawIsoExpr` on what it returns)
//   a WRAPPER   `safeFirst(env, sql, ...bind)` / `joinRows(env, sinceIso)` —
//               the SQL and the binds meet inside a function, and the raw value
//               arrives as an ARGUMENT at a call site the old sweep never read
//   a FIELD     `{ periodStart: new Date().toISOString() }` then
//               `w.periodStart` in the call — the value travels in an object
//
// Everything below is text analysis over TypeScript source, deliberately
// coarse in the flagging direction (a field name raw anywhere in a file is raw
// everywhere in it) and exact about brackets, strings and comments, because a
// miscounted brace reads one function's body into the next.

/** True when `expr` produces a raw ISO string: `.toISOString()` not narrowed after it. */
export function isRawIsoExpr(expr) {
  const i = expr.lastIndexOf('.toISOString()');
  if (i < 0) return false;
  const tail = expr.slice(i + '.toISOString()'.length);
  if (tail.includes(".replace('T'") || tail.includes('.replace("T"')) return false;
  // `.slice(0, 10)` (a date), `.slice(0, 7)` (a month) — anything cut before the T.
  const cut = tail.match(/\.slice\(\s*0\s*,\s*(\d+)\s*\)/);
  if (cut && Number(cut[1]) <= 10) return false;
  return true;
}

/** Index just past the string or template literal that opens at `i`. */
export function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { j += 2; continue; }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') { const e = matchClose(src, j + 1); j = e < 0 ? src.length : e + 1; continue; }
    j += 1;
  }
  return j + 1;
}

/**
 * Index of the bracket closing the one at `open` (`(`, `[` or `{`), skipping
 * strings, template literals (with `${…}` nesting) and comments. -1 if none.
 */
export function matchClose(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (ch === '/' && next === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** Split an argument or parameter list on its top-level commas. */
export function splitTop(text) {
  const out = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue; }
    if ('([{'.includes(ch)) {
      const e = matchClose(text, i);
      i = e < 0 ? text.length : e + 1; continue;
    }
    if (ch === ',') { out.push(text.slice(start, i)); start = i + 1; }
    i += 1;
  }
  const last = text.slice(start);
  if (last.trim() || out.length) out.push(last);
  return out.map((s) => s.trim()).filter((s, k, all) => s !== '' || k < all.length - 1);
}

/** Every string and template literal inside `expr`, in order. */
function literalsIn(expr) {
  const out = [];
  const re = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  for (const m of expr.matchAll(re)) out.push(m[0].slice(1, -1));
  return out;
}

/** `const NAME = <expr>;` in `src`, as text — the first declaration found, or null. */
function constExpr(src, name) {
  let i = -1;
  for (const at of identifierAt(src, name)) {
    if (!/(?:^|[^\w$])(?:const|let)\s+$/.test(src.slice(Math.max(0, at - 12), at))) continue;
    const decl = src.slice(at + name.length).match(/^\s*(?::[^=\n]+)?=(?![=>])\s*/);
    if (!decl) continue;
    i = at + name.length + decl[0].length;
    break;
  }
  if (i < 0) return null;
  const start = i;
  while (i < src.length) {
    const ch = src[i];
    if ('([{'.includes(ch)) { const e = matchClose(src, i); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (ch === ';' || ch === '\n' && /^\s*(?:const|let|export|function|async|\})/.test(src.slice(i + 1))) break;
    i += 1;
  }
  return src.slice(start, i);
}

/**
 * The SQL text an expression can carry: a literal as written; an identifier
 * resolved to its `const` (every literal in it, so both arms of a ternary are
 * read); and `${NAME}` inside a template replaced by that const's text, which
 * is how `telegramAggregator.ts` spells its one shared WINDOW predicate.
 */
export function resolveSql(expr, src, depth = 0) {
  const e = expr.trim();
  const subst = (text) => (depth > 3 ? text : text.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g,
    (_, id) => { const c = constExpr(src, id); return c ? resolveSql(c, src, depth + 1) : ''; }));
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const c = constExpr(src, e);
    return c ? resolveSql(c, src, depth + 1) : '';
  }
  return literalsIn(e).map(subst).join('\n');
}

/**
 * Every named function in `src`: `function f(…) {…}` and `const f = (…) => …`.
 * `{ name, params: [{ name, rest }], body, returns: [expr] }`.
 */
export function functionsIn(src) {
  const out = [];
  const heads = /(?:^|[^\w$.])(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(|(?:^|[^\w$.])(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*)?(?:<[^>()]*>)?\s*\(/g;
  for (const m of src.matchAll(heads)) {
    const name = m[1] || m[2];
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    if (close < 0) continue;
    const params = splitTop(src.slice(open + 1, close)).map((p) => {
      const rest = p.startsWith('...');
      const id = (p.replace(/^\.\.\./, '').match(/^([A-Za-z_$][\w$]*)/) || [])[1] || null;
      return { name: id, rest };
    });
    // After the params: an optional return type, then `=>` or `{`.
    let i = close + 1;
    const after = src.slice(i, i + 400);
    const arrow = m[2] ? after.match(/^\s*(?::\s*[^=]*?)?\s*=>\s*/) : null;
    let body = '';
    const returns = [];
    if (m[2] && !arrow) continue; // `const x = (…)` that is not an arrow function
    if (arrow) {
      i += arrow[0].length;
      if (src[i] === '{') {
        const e = matchClose(src, i); if (e < 0) continue;
        body = src.slice(i, e + 1);
      } else {
        // Expression body: to the `;` or line end at depth zero.
        let j = i;
        while (j < src.length) {
          const ch = src[j];
          if ('([{'.includes(ch)) { const e = matchClose(src, j); j = e < 0 ? src.length : e + 1; continue; }
          if (ch === '"' || ch === "'" || ch === '`') { j = skipString(src, j); continue; }
          if (ch === ';' || ch === '\n' || ch === ',' || ch === ')') break;
          j += 1;
        }
        body = src.slice(i, j);
        returns.push(body);
      }
    } else {
      const brace = src.indexOf('{', i);
      if (brace < 0) continue;
      const e = matchClose(src, brace); if (e < 0) continue;
      body = src.slice(brace, e + 1);
    }
    for (const r of body.matchAll(/\breturn\s+([^;]+);/g)) returns.push(r[1]);
    out.push({ name, params, body, returns });
  }
  return out;
}

/** Functions in `src` that return raw ISO, judged by what they return — never by name. */
export function rawIsoHelpers(src) {
  const names = new Set();
  for (const f of functionsIn(src)) {
    if (f.returns.some((r) => isRawIsoExpr(r))) names.add(f.name);
  }
  return names;
}

/**
 * Functions in `src` where a PARAMETER reaches `.bind(…)` of a `.prepare(…)`.
 * `{ name -> { sqlParam: index|null, sql: string, bindParams: Set<index>, restFrom: index|null } }`.
 * `sql` is what the function prepares when it is not a parameter (a literal or
 * a local const — `joinRows` builds its own); `sqlParam` is set when the call
 * site supplies it (`safeFirst(env, "SELECT …", …)`).
 */
export function bindWrappers(src) {
  const out = new Map();
  for (const f of functionsIn(src)) {
    const at = f.body.indexOf('.prepare(');
    if (at < 0) continue;
    const pOpen = at + '.prepare'.length;
    const pClose = matchClose(f.body, pOpen);
    if (pClose < 0) continue;
    const prepArg = f.body.slice(pOpen + 1, pClose).trim();
    const bindAt = f.body.indexOf('.bind(', pClose);
    if (bindAt < 0 || bindAt - pClose > 40) continue;
    const bClose = matchClose(f.body, bindAt + '.bind'.length);
    // A spread is a use: `...bind` passes the rest parameter through, and
    // `identifierAt` reads `...name` as the name rather than a member access.
    const bindText = f.body.slice(bindAt + '.bind('.length, bClose);
    const bindParams = new Set();
    let restFrom = null;
    f.params.forEach((p, idx) => {
      if (!p.name) return;
      const used = identifierAt(bindText, p.name).length > 0;
      if (!used) return;
      if (p.rest) restFrom = idx; else bindParams.add(idx);
    });
    if (!bindParams.size && restFrom === null) continue;
    const sqlParam = f.params.findIndex((p) => p.name && p.name === prepArg);
    out.set(f.name, {
      sqlParam: sqlParam >= 0 ? sqlParam : null,
      sql: sqlParam >= 0 ? '' : resolveSql(prepArg, f.body + '\n' + src),
      bindParams,
      restFrom,
    });
  }
  return out;
}

/** `import { a, b as c } from './x'` → `{ local -> { from, imported } }`. */
export function importsIn(src) {
  const out = new Map();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const [imported, local] = t.split(/\s+as\s+/).map((s) => s.trim());
      out.set(local || imported, { from: m[2], imported });
    }
  }
  return out;
}

/**
 * The raw-ISO vocabulary of one file: names assigned raw ISO (directly or from
 * a raw helper), arrays holding one, and object FIELDS holding one.
 */
export function rawVocabulary(src, helpers) {
  const names = rawIsoNames(src);
  for (const m of src.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (helpers.has(m[2])) names.add(m[1]);
  }
  const rawExpr = (expr) => {
    const e = expr.trim();
    if (isRawIsoExpr(e)) return true;
    if (names.has(e)) return true;
    const call = e.match(/^(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    return Boolean(call && helpers.has(call[1]));
  };
  // Arrays: `const binds = [start, end]` makes `...binds` raw.
  for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*\[/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    if (close > 0 && splitTop(src.slice(open + 1, close)).some(rawExpr)) names.add(m[1]);
  }
  // Fields: `key: <raw>` and the shorthand `{ …, rawName, … }`.
  const fields = new Set();
  // The value is read to its top-level `,` / `}` / line end — never by a regex
  // character class, which stops at the comma INSIDE `.slice(0, 10)` and reads
  // a date-cut value as raw (it flagged `admin_revenue.ts`'s `quarterOf`).
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?=\S)/g)) {
    let j = m.index + m[0].length;
    const start = j;
    while (j < src.length) {
      const ch = src[j];
      if ('([{'.includes(ch)) { const e = matchClose(src, j); j = e < 0 ? src.length : e + 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { j = skipString(src, j); continue; }
      if (ch === ',' || ch === '}' || ch === ')' || ch === ';' || ch === '\n') break;
      j += 1;
    }
    if (rawExpr(src.slice(start, j))) fields.add(m[1]);
  }
  for (const n of names) {
    const shorthand = identifierAt(src, n).some((at) => {
      const left = src.slice(0, at).trimEnd();
      const right = src.slice(at + n.length).trimStart();
      return (left.endsWith('{') || left.endsWith(',')) && (right.startsWith(',') || right.startsWith('}'));
    });
    if (shorthand) fields.add(n);
  }
  const isRawArg = (arg) => {
    const a = arg.trim().replace(/^\.\.\./, '');
    if (rawExpr(a)) return true;
    const member = a.match(/^[A-Za-z_$][\w$]*(?:\?\.|\.)([A-Za-z_$][\w$]*)$/);
    return Boolean(member && fields.has(member[1]));
  };
  return { names, fields, isRawArg };
}

/**
 * The whole sweep over a corpus — `sources: Map<path, text>` — returning one
 * line per offender. Two kinds of site:
 *
 *   `.prepare(…).bind(…)` written out, with the SQL resolved through a local
 *   const or a `${NAME}` template, and each bind argument classified by the
 *   file's raw vocabulary (names, helper calls, fields, spreads); and
 *
 *   a call to a BIND WRAPPER — local or imported — whose bound parameters
 *   receive a raw argument, checked against the SQL the call supplies or the
 *   wrapper prepares itself.
 *
 * `resolveImport(fromPath, spec)` maps an import to a corpus path, or null.
 */
export function sweepBinds({ sources, baseline, resolveImport }) {
  const byTable = sqlFormatColumns(baseline);
  const clock = clockWrittenColumns([...sources.values()]);
  const helpersOf = new Map([...sources].map(([f, s]) => [f, rawIsoHelpers(s)]));
  const wrappersOf = new Map([...sources].map(([f, s]) => [f, bindWrappers(s)]));
  const offenders = [];
  const check = (where, sql, rawArgs, via) => {
    if (!rawArgs.length || !sql) return;
    for (const t of tablesIn(sql)) {
      for (const col of new Set([...(byTable.get(t) || []), ...(clock.get(t) || [])])) {
        if (comparesBare(sql, col)) offenders.push(`${where} ${via} binds raw-ISO ${rawArgs.join(', ')} against ${t}.${col}`);
      }
    }
  };
  for (const [file, src] of sources) {
    const helpers = new Set(helpersOf.get(file));
    const wrappers = new Map(wrappersOf.get(file));
    for (const [local, { from, imported }] of importsIn(src)) {
      const target = resolveImport(file, from);
      if (!target || !sources.has(target)) continue;
      if (helpersOf.get(target).has(imported)) helpers.add(local);
      const w = wrappersOf.get(target).get(imported);
      if (w) wrappers.set(local, w);
    }
    const vocab = rawVocabulary(src, helpers);
    const lineOf = (i) => src.slice(0, i).split('\n').length;

    let at = src.indexOf('.prepare(');
    while (at >= 0) {
      const pOpen = at + '.prepare'.length;
      const pClose = matchClose(src, pOpen);
      if (pClose > 0) {
        const bindAt = src.indexOf('.bind(', pClose);
        if (bindAt >= 0 && bindAt - pClose < 40) {
          const bClose = matchClose(src, bindAt + '.bind'.length);
          const args = splitTop(src.slice(bindAt + '.bind('.length, bClose)).filter((a) => vocab.isRawArg(a));
          check(`${file}:${lineOf(at)}`, resolveSql(src.slice(pOpen + 1, pClose), src), args, '.prepare()');
        }
      }
      at = src.indexOf('.prepare(', at + 1);
    }

    for (const [name, w] of wrappers) {
      for (const at of identifierAt(src, name)) {
        const call = src.slice(at + name.length).match(/^\s*(?:<[^>()]*>)?\s*\(/);
        if (!call) continue;
        const before = src.slice(Math.max(0, at - 24), at);
        if (/function\s*\*?\s*$|(?:const|let)\s+$/.test(before)) continue; // the definition itself
        const open = at + name.length + call[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const args = splitTop(src.slice(open + 1, close));
        const raw = args.filter((a, i) => (w.bindParams.has(i) || (w.restFrom !== null && i >= w.restFrom)) && vocab.isRawArg(a));
        const sql = w.sqlParam !== null ? resolveSql(args[w.sqlParam] || '', src) : w.sql;
        check(`${file}:${lineOf(at)}`, sql, raw, `${name}()`);
      }
    }
  }
  return offenders;
}
