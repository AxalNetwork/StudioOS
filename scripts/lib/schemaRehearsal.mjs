/**
 * #4591 — the pure half of the schema rehearsal (`scripts/schema-rehearsal.mjs`):
 * run names, the generated wrangler config, and the comparisons that decide
 * whether provisioning and restore reproduced the schema. No filesystem, no
 * spawn, so `schemaRehearsal.test.mjs` can hold each rule to account.
 *
 * WHAT THE REHEARSAL PROVES, AND WHAT IT DOES NOT.
 *  - A database created empty in the account and provisioned only from the
 *    committed files (`schema_baseline.sql` and the migrations, through
 *    `migrate-d1.mjs` itself) has the same tables, indexes, views, triggers
 *    and columns as a fresh local build of the same files. That is the parity
 *    production is held to after every deploy, applied to a hosted database
 *    the repository built.
 *  - That database, holding the #4566 synthetic fixtures and its ledger, can be
 *    exported and imported into a second empty database through the D4558
 *    drill's chunked import, and comes back with the same schema text and the
 *    same row count in every table, with no foreign-key violations.
 * It never reads or writes production, so it says nothing about production's
 * data, and it is not a Time Travel restore.
 */

import { REHEARSAL_DB_PREFIX, REHEARSAL_ID_RE } from './migrationTargets.mjs';

/** A run id. The #4566 fixture ids use it too, so it keeps their shape (6–20 of [a-z0-9]). */
export const RUN_RE = /^[a-z0-9]{6,20}$/;

/** The two throwaway databases of one run. Throws on anything that is not a run id. */
export function rehearsalNames(run) {
  if (!RUN_RE.test(String(run ?? ''))) throw new Error(`a rehearsal run id is 6 to 20 of [a-z0-9]; got ${JSON.stringify(run)}`);
  const side = (s) => {
    const id = `${run}-${s}`;
    if (!REHEARSAL_ID_RE.test(id)) throw new Error(`rehearsal id ${id} does not match ${REHEARSAL_ID_RE}`);
    return { id, dbName: `${REHEARSAL_DB_PREFIX}${id}` };
  };
  return { run, src: side('src'), dst: side('dst') };
}

/** The UUID `wrangler d1 create` prints for the new database (its TOML or JSON form). */
export function createdDatabaseId(stdout) {
  const m = String(stdout ?? '').match(/"?database_id"?\s*[:=]\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
  if (!m) throw new Error('wrangler d1 create printed no database_id');
  return m[1];
}

/**
 * The wrangler config that declares ONE rehearsal database and nothing else:
 * no route, no custom domain, no other binding, so no command run with it can
 * reach production or a branch. `migrate-d1.mjs --rehearsal <id>` names it.
 */
export function rehearsalConfig({ dbName, databaseId }) {
  if (!String(dbName).startsWith(REHEARSAL_DB_PREFIX)) throw new Error(`refusing a config for ${dbName}: not a rehearsal database`);
  if (!/^[0-9a-f-]{36}$/i.test(String(databaseId))) throw new Error('refusing a config without a database id');
  return [
    '# #4591 — written by scripts/schema-rehearsal.mjs for one throwaway database; deleted when the run ends.',
    `name = "${dbName}"`,
    'compatibility_date = "2026-01-01"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${dbName}"`,
    `database_id = "${databaseId}"`,
    '',
  ].join('\n');
}

/** Objects the engine or D1 makes on its own, never part of the comparison. */
export const ENGINE_OWNED = /^(_cf_[A-Z]|sqlite_)/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * DDL without its comments. SQLite stores a CREATE statement's text as written,
 * comments included; the restore path (export, split, import) does not keep
 * them, so the restored text of a commented table differs only in comments
 * (measured on the first local rehearsal: identical columns, types, defaults
 * and constraints). Comments are dropped outside quotes only, so a `--` inside
 * a string default or a quoted name is kept.
 */
export function stripSqlComments(sql) {
  const s = String(sql ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const close = { "'": "'", '"': '"', '`': '`', '[': ']' }[c];
    if (close) {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === close) { if (close !== ']' && s[j + 1] === close) { j += 2; continue; } break; }
        j++;
      }
      out += s.slice(i, j + 1); i = j; continue;
    }
    if (c === '-' && s[i + 1] === '-') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e === -1 ? s.length : e + 1; out += ' '; continue; }
    out += c;
  }
  return out;
}
const norm = (sql) => stripSqlComments(sql).replace(/\s+/g, ' ').replace(/\s+([,)])/g, '$1').trim();

/** `sqlite_master` rows reduced to what is compared: `type:name` → normalised SQL. */
export function schemaMap(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r?.name || ENGINE_OWNED.test(r.name)) continue;
    out.set(`${r.type}:${r.name}`, norm(r.sql));
  }
  return out;
}

/**
 * Queries counting every table: one WIDE row per batch, each column a scalar
 * subquery (`SELECT (SELECT COUNT(*) FROM "a") AS "a", …`). Not UNION ALL: D1
 * caps a compound SELECT at a handful of terms (six already fail with "too
 * many terms in compound SELECT"; stock SQLite allows 500), so a union of
 * table counts cannot run there at any useful batch size. A row may carry at
 * most 100 columns on D1 (measured locally: 100 runs, 101 fails "too many
 * columns in result set"), so a batch is 50: half the limit, never at it.
 */
export function rowCountQueries(tables, perQuery = 50) {
  const names = [...tables].filter((t) => !ENGINE_OWNED.test(t)).sort();
  for (const t of names) if (!IDENT.test(t)) throw new Error(`not counting a table whose name is not a plain identifier: ${JSON.stringify(t)}`);
  if (!names.length) throw new Error('no tables to count');
  const out = [];
  for (let i = 0; i < names.length; i += perQuery) {
    out.push(`SELECT ${names.slice(i, i + perQuery).map((t) => `(SELECT COUNT(*) FROM "${t}") AS "${t}"`).join(', ')}`);
  }
  return out;
}

/** The wide rows `rowCountQueries` returns, merged into one Map of table → count. */
export const countMap = (rows) => new Map((rows || []).flatMap((r) => Object.entries(r).map(([t, n]) => [t, Number(n)])));

/**
 * Restored against source: every object with the same SQL, every table with
 * the same row count. Names only in the result, never row content.
 */
export function compareRestore(src, dst) {
  const missing = [...src.schema.keys()].filter((k) => !dst.schema.has(k)).sort();
  const extra = [...dst.schema.keys()].filter((k) => !src.schema.has(k)).sort();
  const sqlDiffers = [...src.schema.keys()].filter((k) => dst.schema.has(k) && dst.schema.get(k) !== src.schema.get(k)).sort();
  const countDiffers = [...new Set([...src.counts.keys(), ...dst.counts.keys()])].sort()
    .filter((t) => src.counts.get(t) !== dst.counts.get(t))
    .map((t) => ({ table: t, source: src.counts.get(t) ?? null, restored: dst.counts.get(t) ?? null }));
  return { ok: !missing.length && !extra.length && !sqlDiffers.length && !countDiffers.length, missing, extra, sqlDiffers, countDiffers };
}

/** The rows the fixtures must have written, read back by count only. */
export const FIXTURE_TABLES = Object.freeze(['founders', 'users', 'company_profiles', 'projects', 'team_agents', 'scope_tasks']);
