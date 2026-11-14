/**
 * #6326 — the schema-change skill's rules, apart from git and the disk.
 *
 * It decides:
 *
 *   - the name of a new D1 migration: `YYYYMMDDHHMM_<issue>_<slug>.sql`, the
 *     current UTC minute and the issue (D4106, D5398), refused when another
 *     file already holds that identity (`migrationIdentity`);
 *   - what is wrong with the migrations a branch adds: a name the guards
 *     refuse, an identity two files share, a stamp later than now, a stamp
 *     whose issue is not the branch's issue, a new stamped file with no issue
 *     or a stamp before DISCRIMINATOR_FROM (a backdated name the guards would
 *     still accept), a new numbered file (numbers stop at 799 and new work
 *     uses the stamp);
 *   - which applied migrations the branch edits, deletes or renames, working
 *     tree included (D269), which the CI gate sees only once committed;
 *   - what in a new migration's SQL needs a second look before CI: a CREATE
 *     without IF NOT EXISTS, an ADD COLUMN NOT NULL with no default (SQLite
 *     refuses it), a DROP or a RENAME (the contract step,
 *     documentation/operations/SCHEMA_DRIFT.md §4);
 *   - what the branch's own Worker lines add as runtime DDL: an ALTER TABLE
 *     outside `runSchemaBootstrap` (#4568, D5343) or a runtime CREATE TABLE
 *     that must mirror a migration (D235);
 *   - which guards a schema change runs, in the order `test:guards` runs them.
 *
 * Owned by `../schema-change.mjs`; tested in `schemaChange.test.mjs`.
 */
import { migrationNameProblem, migrationDuplicates, migrationStamp, migrationIssue, migrationIdentity, DISCRIMINATOR_FROM } from './migrationPlan.mjs';

export const MIGRATIONS_DIR = 'cloudflare-worker/sql/migrations/';

/**
 * The schema guards, in `test:guards` order, each with the node flags
 * `package.json` gives it. `migration-immutability-gate.mjs` is not here: it is
 * CI-only (its own workflow) and needs `GITHUB_BASE_REF`, so the CLI runs it
 * separately.
 */
export const SCHEMA_CHECKS = Object.freeze([
  { script: 'check-sql-migrations.mjs', flags: [] },
  { script: 'check-sqlite-dialect.mjs', flags: [] },
  { script: 'check-sqlite-tables.mjs', flags: [] },
  { script: 'check-sqlite-columns.mjs', flags: [] },
  { script: 'check-write-router-columns.mjs', flags: [] },
  { script: 'check-sqlite-table-collisions.mjs', flags: [] },
  { script: 'check-schema-pair-drift.mjs', flags: ['--no-warnings'] },
  { script: 'check-migration-declarations.mjs', flags: ['--no-warnings'] },
  { script: 'check-runtime-schema-declared.mjs', flags: ['--no-warnings'] },
  { script: 'check-runtime-ddl.mjs', flags: ['--no-warnings'] },
  { script: 'check-timestamp-comparisons.mjs', flags: [] },
  { script: 'check-migration-column-shapes.mjs', flags: [] },
  { script: 'check-schema-readiness.mjs', flags: [] },
]);

const SLUG = /^[a-z][a-z0-9_]*$/;
const ISSUE = /^[1-9]\d{0,6}$/;

/** A Date → its UTC minute as twelve digits, `YYYYMMDDHHMM`. */
export function utcStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('utcStamp: not a date');
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

/**
 * The new migration's file name for `issue` and `slug` at `now`, or the reason
 * there is none. `existing` is every file name already in the folder.
 */
export function newMigrationName({ now, issue, slug, existing = [] }) {
  const i = String(issue ?? '');
  if (!ISSUE.test(i)) return { problem: `the issue is 1 to 7 digits with no leading zero, not '${i}'` };
  if (!SLUG.test(String(slug ?? ''))) return { problem: `the slug is lower case, starts with a letter and holds only a-z, 0-9 and _, not '${slug}'` };
  const name = `${utcStamp(now)}_${i}_${slug}.sql`;
  const problem = migrationNameProblem(name);
  if (problem) return { problem };
  const id = migrationIdentity(name);
  const taken = existing.find((f) => migrationStamp(f) && migrationIdentity(f) === id);
  if (taken) return { problem: `${taken} already holds ${id.slice(1)}; wait for the next minute` };
  return { name, path: MIGRATIONS_DIR + name };
}

/**
 * What is wrong with the migrations a branch adds. `added` are the new file
 * names, `onBase` the names already on the base, `now` the clock, `issue` the
 * branch's issue (optional). Every finding is `{ file, level, text }`, level
 * `error` (CI will fail, or the rule forbids it) or `note` (check by hand).
 */
export function nameFindings({ added = [], onBase = [], now, issue = null }) {
  const out = [];
  const nowStamp = utcStamp(now);
  for (const file of added) {
    const p = migrationNameProblem(file);
    if (p) { out.push({ file, level: 'error', text: p }); continue; }
    const stamp = migrationStamp(file);
    if (!stamp) {
      out.push({ file, level: 'error', text: 'a new migration is named by its UTC minute and issue, YYYYMMDDHHMM_<issue>_<slug>.sql; a number is only for an issue written before D4106 that gave one' });
      continue;
    }
    if (!migrationIssue(file)) out.push({ file, level: 'error', text: 'a new migration names its issue, YYYYMMDDHHMM_<issue>_<slug>.sql (D5398); only a file already on main keeps a name without one' });
    else if (stamp < DISCRIMINATOR_FROM) out.push({ file, level: 'error', text: `the stamp ${stamp} is before ${DISCRIMINATOR_FROM}; a new migration is stamped with the current UTC minute (date -u +%Y%m%d%H%M)` });
    if (stamp > nowStamp) out.push({ file, level: 'error', text: `the stamp ${stamp} is later than now (${nowStamp} UTC); take it from date -u` });
    const own = migrationIssue(file);
    if (issue && own && own !== String(issue)) out.push({ file, level: 'error', text: `the file names issue ${own}, the branch's issue is ${issue}` });
  }
  const addedSet = new Set(added);
  for (const d of migrationDuplicates([...onBase, ...added])) {
    if ([...addedSet].some((f) => d.includes(f))) out.push({ file: [...addedSet].find((f) => d.includes(f)), level: 'error', text: d });
  }
  return out;
}

/**
 * The applied migrations a branch edits, deletes or renames. `nameStatus` is
 * `git diff --name-status <mergeBase> -- <MIGRATIONS_DIR>` (working tree
 * included), `onBase` the file names at the merge base. A file on the base is
 * never changed (D269; migration-immutability-gate).
 */
export function changedBaseFindings(nameStatus, onBase = []) {
  const base = new Set(onBase);
  const out = [];
  for (const raw of String(nameStatus ?? '').split('\n')) {
    const parts = raw.split('\t');
    const code = parts[0]?.[0];
    if (!code || !'MDRT'.includes(code)) continue;
    const name = parts[1]?.startsWith(MIGRATIONS_DIR) ? parts[1].slice(MIGRATIONS_DIR.length) : null;
    if (!name || !base.has(name)) continue;
    const what = code === 'D' ? 'deleted' : code === 'R' ? `renamed to ${parts[2]}` : 'edited';
    out.push({ file: name, level: 'error', text: `an applied migration is ${what}: a file on main is never changed (D269); revert it and write a new migration` });
  }
  return out;
}

/** The text of a column definition at paren depth 0, so a CHECK (...) body cannot trip a rule. */
function topLevel(text) {
  let depth = 0;
  let out = '';
  for (const ch of String(text)) {
    if (ch === '(') { depth++; out += ' '; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); out += ' '; continue; }
    out += depth === 0 ? ch : ' ';
  }
  return out;
}

/** `--` line comments and block comments out, so prose cannot trip a rule. */
function stripComments(sql) {
  return String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

/** One statement per entry, trigger bodies kept whole. */
function statements(sql) {
  const body = stripComments(sql);
  const out = [];
  const re = /\s*(?:CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;?)/gi;
  let m;
  while ((m = re.exec(body))) { const s = m[0].trim(); if (s && s !== ';') out.push(s.replace(/\s+/g, ' ')); }
  return out;
}

/** What in one new migration's SQL needs a second look. */
export function sqlFindings(file, sql) {
  const out = [];
  const add = (level, text) => out.push({ file, level, text });
  for (const s of statements(sql)) {
    const head = s.slice(0, 120);
    const create = /^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+(?!IF\s+NOT\s+EXISTS)/i.exec(s);
    if (create) add('note', `CREATE ${create[1].toUpperCase()} without IF NOT EXISTS (not re-runnable; migrate-d1 --audit lists it): ${head}`);
    const addCol = /^ALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN\s+)?(.*)$/i.exec(s);
    const colDef = addCol ? topLevel(addCol[1]) : '';
    if (addCol && /\bNOT\s+NULL\b/i.test(colDef) && !/\bDEFAULT\b/i.test(colDef)) {
      add('error', `ADD COLUMN NOT NULL with no DEFAULT: SQLite refuses it on a table with rows: ${head}`);
    }
    if (/^DROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i.test(s) || /^ALTER\s+TABLE\s+\S+\s+DROP\b/i.test(s)) {
      add('note', `a drop is the contract step: only after no deployable Worker reads it, with the owner's decision, an export and a Time Travel bookmark (SCHEMA_DRIFT.md §4): ${head}`);
    }
    if (/^ALTER\s+TABLE\s+\S+\s+RENAME\b/i.test(s)) {
      add('note', `a rename takes two deploys: the Worker one version back must still work (SCHEMA_DRIFT.md §4): ${head}`);
    }
    if (/^(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i.test(s)) {
      add('error', `a transaction statement: D1 rejects it and the deploy stops at the migration step (check-sql-migrations): ${head}`);
    }
  }
  return out;
}

/**
 * The runtime DDL a branch's added Worker lines carry. `lines` are
 * `{ file, line, text }` for lines added under cloudflare-worker/src.
 */
export function runtimeDdlFindings(lines) {
  const out = [];
  for (const { file, line, text } of lines) {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
    if (/ALTER\s+TABLE\s+\S+\s+ADD\s+(COLUMN\s+)?/i.test(text)) {
      out.push({ file: `${file}:${line}`, level: 'note', text: 'a runtime ADD COLUMN: declare the column in a migration, and route any bootstrap through runSchemaBootstrap (util/schemaBootstrap.ts), never a blind ALTER (#4568, D5343; check-runtime-ddl)' });
    } else if (/CREATE\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i.test(text)) {
      out.push({ file: `${file}:${line}`, level: 'note', text: 'runtime DDL: the same object, column for column, must be declared by a migration (D235; check-runtime-schema-declared, check-schema-pair-drift)' });
    }
  }
  return out;
}

/** The added lines of a unified diff (`git diff -U0`), as `{ file, line, text }`. */
export function addedLines(diff) {
  const out = [];
  let file = null;
  let n = 0;
  for (const raw of String(diff ?? '').split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); if (file === '/dev/null') file = null; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) { n = Number(h[1]); continue; }
    if (!file) continue;
    if (raw.startsWith('+')) { out.push({ file, line: n, text: raw.slice(1) }); n++; }
    else if (!raw.startsWith('-') && !raw.startsWith('\\')) n++;
  }
  return out;
}

/** Each guard's result as one line, and whether every one passed. */
export function summarise(results) {
  const lines = results.map((r) => `${r.code === 0 ? 'pass' : 'FAIL'}  ${r.script}  (${Math.round(r.ms / 1000)}s)${r.code === 0 ? '' : `  exit ${r.code}`}`);
  return { ok: results.length > 0 && results.every((r) => r.code === 0), lines };
}
