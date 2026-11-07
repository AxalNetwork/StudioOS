/**
 * #4568 (D1 scale S2) — the dependency matrix for the five usage tables, read
 * from the code: every SQL string in `cloudflare-worker/src` that names one of
 * them, what it does to each (read or write), and the query plan SQLite picks
 * for it on the migrated schema; every index on them, which statements use it
 * and how many statements write its table; and every foreign key into or out
 * of them. Nothing here is inferred from a document.
 *
 * Pure apart from reading files: `buildMatrix({ root, db })` takes the repo
 * root and a node:sqlite database already holding the migrated schema
 * (`cloudflare-worker/test/_schema_once.mjs`), and returns the matrix. The CLI
 * is `scripts/usage-tables-matrix.mjs`.
 *
 * A statement whose text is built at run time (a template with `${…}`, or a
 * string joined with `+`) is planned with each `${…}` as one bound value; when
 * that is not valid SQL it is listed as `dynamic` with no plan, never guessed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const TABLES = Object.freeze(['ai_usage_logs', 'ai_budget_reservations', 'ai_credit_ledger', 'agent_task_runs', 'ai_rail_proposals']);

/**
 * Who reads or writes a table, by where the code lives. A coarse map, stated so
 * a reader can check it; a file can be in more than one. A file no rule names
 * is `other`, and the matrix lists those, so the map can be extended.
 */
export const CONSUMERS = Object.freeze([
  ['money', /\/(aiBudget|aiSpendLimit|aiAutoReload|aiCredit|aiCredits|aiTokenPacks?|stripe|tokenPacks?|billing|aiPrices?|aiCost|aiSpend|statements|admin_revenue|revenue)/i],
  ['metering', /\/(aiRouter|metering|aiProviders|aiSurfaces|ai\/decide)\b/i],
  ['agents', /\/(agents\/|agents?_|team_agents|engine|loop|agentQueue)/i],
  ['proposals', /\/(railProposals|rail_|proposal|fills\/)/i],
  ['hq_usage', /\/(aiUsageAdmin|aiConsumption|adminInsights|tokenAnomalies|monitoring|studioGlance|admin_ai|ai_usage|usage)/i],
  ['skills', /\/(skillEval|skills?)/i],
  ['erasure_export', /\/(erase|erasure|privacy|gdpr|dataExport|export|accountDelete|deleteAccount|retention)/i],
  ['decks', /\/(decks?\/|deck_)/i],
]);

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i;
const tableRe = (t) => new RegExp(`\\b${t}\\b`);
const WRITE_OF = (t) => new RegExp(`\\b(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE(?:\\s+OR\\s+\\w+)?|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+${t}\\b`, 'i');

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(ts|mjs|js)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every string literal in `src` with its 1-based line: '…', "…" and `…`, the
 * last with `${…}` kept verbatim (nesting followed), so a template reads as it
 * is written. Comments are skipped.
 */
export function stringLiterals(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const start = line; let j = i + 1; let text = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { text += src[j] + (src[j + 1] ?? ''); if (src[j + 1] === '\n') line++; j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          let depth = 1; text += '${'; j += 2;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; if (src[j] === '\n') line++; if (depth) text += src[j]; j++; }
          text += '}'; continue;
        }
        if (src[j] === '\n') line++;
        text += src[j]; j++;
      }
      out.push({ text, line: start });
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}

/** `${…}` becomes one bound value, so the plan is the one a bound call gets. */
const planText = (sql) => sql.replace(/\$\{[^}]*\}/g, '?').replace(/\\n/g, ' ');

function plan(db, sql) {
  try { return db.prepare(`EXPLAIN QUERY PLAN ${planText(sql)}`).all().map((r) => String(r.detail)); } catch { return null; }
}

/** What the plan does to `table`: the index it searches, a scan, or not named (a subquery's EXISTS on another table, say). */
function access(lines, table, aliases) {
  const names = new Set([table, ...aliases]);
  const hits = (lines || []).filter((d) => { const m = /^(SCAN|SEARCH) (\w+)/.exec(d); return m && names.has(m[2]); });
  return hits.map((d) => {
    const idx = /USING (?:COVERING )?INDEX (\w+)/.exec(d)?.[1] ?? (/USING INTEGER PRIMARY KEY/.test(d) ? 'rowid' : null);
    return { kind: d.startsWith('SCAN') ? 'scan' : 'search', index: idx };
  });
}

const aliasesOf = (sql, table) => [...sql.matchAll(new RegExp(`\\b${table}\\s+(?:AS\\s+)?(\\w+)`, 'gi'))].map((m) => m[1])
  .filter((a) => !/^(WHERE|SET|ON|JOIN|LEFT|INNER|GROUP|ORDER|LIMIT|VALUES|USING|AND|OR|SELECT)$/i.test(a));

/** The statement's opening with every literal masked; a cut through a masked literal is closed, so no quote is left open. */
export function shapeOf(sql) {
  let s = sql.replace(/'(?:[^']|'')*'/g, "'?'").slice(0, 120);
  if ((s.match(/'/g) || []).length % 2) s += "'";
  return s;
}

export function consumersOf(file) {
  const tags = CONSUMERS.filter(([, re]) => re.test(`/${file}`)).map(([k]) => k);
  return tags.length ? tags : ['other'];
}

export function buildMatrix({ root, db }) {
  const src = join(root, 'cloudflare-worker', 'src');
  const statements = [];
  for (const path of filesUnder(src).sort()) {
    const file = relative(root, path);
    const text = readFileSync(path, 'utf8');
    if (!TABLES.some((t) => tableRe(t).test(text))) continue;
    for (const lit of stringLiterals(text)) {
      const sql = lit.text.replace(/\s+/g, ' ').trim();
      const named = TABLES.filter((t) => tableRe(t).test(sql));
      if (!named.length) continue;
      // DDL, comments and log text name tables too; only statements are counted.
      if (!SQL_START.test(sql)) continue;
      const lines = plan(db, sql);
      for (const table of named) {
        const write = WRITE_OF(table).test(sql);
        statements.push({
          file, line: lit.line, table, op: write ? 'write' : 'read',
          dynamic: /\$\{/.test(sql), planned: lines != null,
          access: lines ? access(lines, table, aliasesOf(sql, table)) : [],
          consumers: consumersOf(file),
          // The statement's opening, with every literal masked: enough to find it, never a value.
          shape: shapeOf(sql),
        });
      }
    }
  }

  const indexes = [];
  for (const table of TABLES) {
    const list = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name`).all(table);
    for (const ix of list) {
      const cols = db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(ix.name).map((r) => String(r.name));
      const unique = Number(db.prepare('SELECT "unique" AS u FROM pragma_index_list(?) WHERE name = ?').get(table, ix.name)?.u ?? 0) === 1;
      const partial = ix.sql ? (/\bWHERE\b([\s\S]*)$/i.exec(ix.sql)?.[1] ?? '').trim() || null : null;
      const users = statements.filter((s) => s.table === table && s.access.some((a) => a.index === ix.name));
      indexes.push({ table, name: String(ix.name), columns: cols, unique, partial, auto: !ix.sql,
        statements_using: users.length, files_using: [...new Set(users.map((s) => s.file))].sort() });
    }
  }
  // An index whose columns are a leading prefix of another's on the same table, with the same partial clause,
  // serves no read the longer one cannot (bar a uniqueness it enforces): a review candidate, never a drop.
  for (const ix of indexes) {
    const wider = indexes.find((o) => o !== ix && o.table === ix.table && o.partial === ix.partial && o.columns.length > ix.columns.length
      && ix.columns.every((c, k) => o.columns[k] === c));
    ix.prefix_of = !ix.unique && wider ? wider.name : null;
  }

  const fks = [];
  const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => String(r.name));
  for (const from of allTables) {
    for (const fk of db.prepare('SELECT "table" AS t, "from" AS c, "to" AS r, on_delete FROM pragma_foreign_key_list(?)').all(from)) {
      if (TABLES.includes(from) || TABLES.includes(String(fk.t))) fks.push({ from, column: String(fk.c), to: String(fk.t), to_column: fk.r == null ? null : String(fk.r), on_delete: String(fk.on_delete) });
    }
  }
  const triggers = db.prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${TABLES.map(() => '?').join(',')}) ORDER BY name`).all(...TABLES)
    .map((r) => ({ name: String(r.name), table: String(r.tbl_name) }));

  const tables = TABLES.map((table) => {
    const s = statements.filter((x) => x.table === table);
    const scans = s.filter((x) => x.access.some((a) => a.kind === 'scan'));
    return {
      table,
      writers: [...new Set(s.filter((x) => x.op === 'write').map((x) => x.file))].sort(),
      readers: [...new Set(s.filter((x) => x.op === 'read').map((x) => x.file))].sort(),
      statements: s.length, writes: s.filter((x) => x.op === 'write').length, reads: s.filter((x) => x.op === 'read').length,
      unplanned: s.filter((x) => !x.planned).length,
      scans: scans.map((x) => ({ file: x.file, line: x.line, shape: x.shape })),
      consumers: [...new Set(s.flatMap((x) => x.consumers))].sort(),
      indexes: indexes.filter((i) => i.table === table).map((i) => i.name),
    };
  });
  return { issue: 4568, tables, indexes, foreign_keys: fks, triggers, statements };
}

/**
 * The indexes this work proposes (D4568), exactly as the migration writes them.
 * Each is partial, so a usage row without the column writes nothing to it.
 */
export const CANDIDATE_INDEXES = Object.freeze([
  'CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_guard_for ON ai_usage_logs (guard_for) WHERE guard_for IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_reservation_ref ON ai_usage_logs (reservation_uid, record_ref) WHERE reservation_uid IS NOT NULL',
]);

/**
 * Plan every statement on the schema as it is, then with `ddl` applied to the
 * same database, and list each statement whose access to its table changed.
 * The caller's database keeps the indexes; pass a copy.
 */
export function planDiff({ root, db, ddl = CANDIDATE_INDEXES }) {
  const before = buildMatrix({ root, db });
  for (const s of ddl) db.exec(s);
  const after = buildMatrix({ root, db });
  const key = (s) => `${s.file}:${s.line}:${s.table}`;
  const was = new Map(before.statements.map((s) => [key(s), s]));
  const fmt = (a) => a.map((x) => `${x.kind}${x.index ? ` ${x.index}` : ''}`).join(', ') || 'not named';
  const changed = [];
  for (const s of after.statements) {
    const b = was.get(key(s));
    if (!b || fmt(b.access) === fmt(s.access)) continue;
    changed.push({ file: s.file, line: s.line, table: s.table, op: s.op, consumers: s.consumers, shape: s.shape, before: fmt(b.access), after: fmt(s.access) });
  }
  const writes = (m, t) => m.statements.filter((s) => s.table === t && s.op === 'write').length;
  return { ddl, changed, scans_before: before.tables.find((t) => t.table === 'ai_usage_logs').scans.length,
    scans_after: after.tables.find((t) => t.table === 'ai_usage_logs').scans.length, usage_write_statements: writes(after, 'ai_usage_logs') };
}
