// D8936 (#8936): when a pending migration fails with `duplicate column name`
// because Worker runtime DDL already added its columns, adopt those columns and
// run the rest of the file, or refuse exactly as before. Owned by
// `../migrate-d1.mjs`.
//
// WHY. The 2026-11-21 → 11-27 production deploys all died at
// `202611191833_7707_market_intel_row_dates_runs.sql` with
// `duplicate column name: observed_period`: services/market_intel/schema.ts had
// already added the file's six columns to production at runtime, while the
// ledger did not record the file. A migration on main is never edited (D269),
// and `--baseline` marks EVERY non-idempotent pending file without running it,
// which would skip genuinely new migrations. So the runner learns one narrow
// case and nothing else:
//
//   1. the file failed with `duplicate column name` (D1 rolled the whole
//      `--file` batch back, so nothing of it landed);
//   2. the column D1 named is one the file adds, and EVERY
//      `ALTER TABLE <t> ADD COLUMN <c>` in the file names a column already on
//      <t> with the same declared type and NOT NULL-ness;
//   3. no other statement of the file that is not a CREATE mentions one of
//      those columns (a backfill would overwrite what the Worker wrote);
//
// then the file's other statements run as ONE batch (all or nothing, like the
// `--file` apply they replace) and the file is recorded exactly as a normal
// apply records it. Anything else — a column absent (partial state), a type
// that differs, an unreadable ALTER, any other error — fails as it always did.
//
// `table … already exists` / `index … already exists` are deliberately NOT
// adopted: a table or index of that name says nothing about its columns, so it
// is not the same evidence a present column with the same declared type is.
//
// Pure: the CLI injects `exec`, `execStatements` and `tableColumns`, bound to
// wrangler there and to node:sqlite in
// `cloudflare-worker/test/migrate_d1_present_columns_8936.test.ts`.

import { splitStatements } from '../dr-drill-split.mjs';

// One identifier: "a", `a`, [a] or a bare word (the splitter's own grammar).
const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60(?:[^\x60]|\x60\x60)+\x60|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;
const ADD_COLUMN = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(${IDENT})\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})([\s\S]*?)\s*;?\s*$`,
  'i',
);
// An ALTER that adds something; if ADD_COLUMN cannot read it, adoption is refused.
const ANY_ADD = /^ALTER\s+TABLE\b[\s\S]*?\bADD\b/i;
// Where a column definition's type ends and its constraints begin.
const CONSTRAINT_WORD = /\b(?:CONSTRAINT|PRIMARY|NOT|NULL|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED|AS)\b/i;
// A table name the runner will interpolate into `PRAGMA table_info(...)`.
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unquote(s) {
  if (/^".*"$/s.test(s)) return s.slice(1, -1).replace(/""/g, '"');
  if (/^`.*`$/s.test(s)) return s.slice(1, -1).replace(/``/g, '`');
  if (/^\[.*\]$/s.test(s)) return s.slice(1, -1);
  return s;
}

/** `VARCHAR ( 10 )` and `varchar(10)` compare equal; an absent type is ''. */
export function normalizeType(type) {
  return String(type ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\)/g, ')')
    .toUpperCase();
}

/**
 * One `ALTER TABLE <t> ADD [COLUMN] <c> <definition>` statement, or null.
 * `table` and `column` are lower-cased (SQLite names are case-insensitive).
 */
export function parseAddColumn(statement) {
  const m = ADD_COLUMN.exec(String(statement).trim());
  if (!m) return null;
  const [, rawTable, rawColumn, rest] = m;
  const definition = rest.trim();
  const cut = CONSTRAINT_WORD.exec(definition);
  return {
    table: unquote(rawTable).toLowerCase(),
    column: unquote(rawColumn).toLowerCase(),
    type: normalizeType(cut ? definition.slice(0, cut.index) : definition),
    notNull: /\bNOT\s+NULL\b/i.test(definition),
  };
}

/** A migration's statements, split into its ADD COLUMNs and everything else. */
export function splitMigration(sql) {
  const { statements, error } = splitStatements(String(sql));
  if (error) return { error: `the file cannot be split into statements (${error.reason} at offset ${error.offset})` };
  const adds = [];
  const others = [];
  for (const statement of statements) {
    const add = parseAddColumn(statement);
    if (add) adds.push({ ...add, statement });
    else if (ANY_ADD.test(statement)) {
      return { error: `the runner cannot read this ALTER: ${statement.replace(/\s+/g, ' ').slice(0, 120)}` };
    } else others.push(statement);
  }
  return { adds, others, error: null };
}

/** Is this the error D1 (and SQLite) give for an ADD COLUMN of a column the table has? */
export function isDuplicateColumnError(error) {
  return /duplicate column name/i.test(String(error?.message ?? error ?? ''));
}

/** The column a `duplicate column name: <c>` error names, lower-cased, or null. */
export function duplicateColumnNamed(error) {
  const m = /duplicate column name:\s*("(?:[^"]|"")+"|`[^`]+`|\[[^\]]+\]|[^\s:]+)/i.exec(String(error?.message ?? error ?? ''));
  return m ? unquote(m[1]).toLowerCase() : null;
}

const mentions = (statement, column) => {
  const esc = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_$])${esc}($|[^A-Za-z0-9_$])`, 'i').test(statement);
};

const label = (a) => `${a.table}.${a.column}`;
const describeLive = (live) => `${live.type || '(no type)'}${live.notnull ? ' NOT NULL' : ''}`;

/**
 * May this file's present columns be adopted?
 *
 * @param {string} sql the migration file's full text
 * @param {{ tableColumns:(t:string)=>Map<string,{name:string,type:string,notnull:number|boolean}>, error?:unknown }} probes
 *   `tableColumns(t)` is the live `PRAGMA table_info(t)` keyed by lower-cased
 *   name (an empty map when the table is absent); `error` is the failure the
 *   apply gave, when there was one.
 * @returns {{ ok:true, adopted:Array<{table:string,column:string,type:string,live:object}>, statements:string[] }
 *         | { ok:false, reason:string, present:string[], absent:string[] }}
 */
export function planAdoption(sql, { tableColumns, error } = {}) {
  const refuse = (reason, present = [], absent = []) => ({ ok: false, reason, present, absent });
  const parsed = splitMigration(sql);
  if (parsed.error) return refuse(parsed.error);
  const { adds, others } = parsed;
  if (adds.length === 0) return refuse('the file adds no column, so a duplicate column is not one it adds');

  if (error !== undefined) {
    const named = duplicateColumnNamed(error);
    if (named && !adds.some((a) => a.column === named)) {
      return refuse(`the duplicate column D1 named (${named}) is not one this file adds`);
    }
  }

  const present = [];
  const absent = [];
  const differs = [];
  const cache = new Map();
  for (const add of adds) {
    if (!PLAIN_NAME.test(add.table)) return refuse(`the table name ${add.table} cannot be checked against the live schema`);
    if (!cache.has(add.table)) cache.set(add.table, tableColumns(add.table));
    const live = cache.get(add.table).get(add.column);
    if (!live) absent.push(add);
    else if (normalizeType(live.type) !== add.type || Boolean(Number(live.notnull)) !== add.notNull) {
      differs.push(`${label(add)} is ${describeLive(live)} on the target, the file declares ${add.type || '(no type)'}${add.notNull ? ' NOT NULL' : ''}`);
    } else present.push({ ...add, live });
  }
  const presentNames = present.map(label);
  const absentNames = absent.map(label);
  if (absent.length) {
    return refuse(
      `partial state: ${absentNames.join(', ')} ${absent.length === 1 ? 'is' : 'are'} absent` +
        (presentNames.length ? ` while ${presentNames.join(', ')} ${presentNames.length === 1 ? 'is' : 'are'} present` : ''),
      presentNames,
      absentNames,
    );
  }
  if (differs.length) return refuse(`a present column is not the column the file adds: ${differs.join('; ')}`, presentNames);

  for (const statement of others) {
    if (/^CREATE\b/i.test(statement.trim())) continue;
    const hit = present.find((a) => mentions(statement, a.column));
    if (hit) {
      return refuse(
        `the statement "${statement.replace(/\s+/g, ' ').slice(0, 100)}" mentions ${label(hit)}, ` +
          'whose values the Worker already wrote; review that file by hand',
        presentNames,
      );
    }
  }
  return {
    ok: true,
    adopted: present.map(({ table, column, type, live }) => ({ table, column, type, live })),
    statements: others,
  };
}

/**
 * Wrap the runner's `exec(file)`: a file that applies is untouched; one that
 * fails with `duplicate column name` is adopted when `planAdoption` allows it,
 * and its other statements go to `execStatements(statements, file)` as one
 * batch. Any refusal rethrows the ORIGINAL error with the reason appended, so
 * applyPlan reports the same failure it always did.
 *
 * `wrapped.adopted` lists every file adopted, with its columns.
 */
export function withPresentColumnAdoption(exec, { tableColumns, execStatements, log = () => {} }) {
  const adopted = [];
  const wrapped = (file) => {
    try {
      return exec(file);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
      const plan = planAdoption(file.sql, { tableColumns, error });
      if (!plan.ok) {
        const msg = String(error?.message ?? error);
        const out = new Error(`${msg}\n[migrate-d1] not adopted (D8936): ${plan.reason}.`);
        out.cause = error;
        throw out;
      }
      log(
        `[migrate-d1]   ${file.name}: column(s) already present on the target, not added again: ` +
          plan.adopted.map((a) => `${label(a)} (${describeLive(a.live)})`).join(', '),
      );
      if (plan.statements.length) {
        log(`[migrate-d1]   ${file.name}: running its other ${plan.statements.length} statement(s) as one batch ...`);
        try {
          execStatements(plan.statements, file);
        } catch (restError) {
          const out = new Error(
            `${String(restError?.message ?? restError)}\n[migrate-d1] adopting ${file.name} (D8936): ` +
              'its columns were present, but the rest of the file FAILED; nothing of that batch landed.',
          );
          out.cause = restError;
          throw out;
        }
      } else {
        log(`[migrate-d1]   ${file.name}: it has no other statement to run.`);
      }
      adopted.push({ file, columns: plan.adopted.map(label) });
      return undefined;
    }
  };
  wrapped.adopted = adopted;
  return wrapped;
}

/**
 * What a plain apply run will do with each pending file, read against the live
 * schema for `--dry-run`. Columns an earlier pending file adds count as present
 * for the files after it, so the prediction follows the order the run takes.
 * Files before them may still change the schema in ways this cannot see (a
 * table a CREATE brings with its columns), and the prediction says so.
 *
 * @returns {Map<string, {action:'apply'} | {action:'adopt', columns:string[]} | {action:'fail', reason:string}>}
 */
export function predictAdoptions(actions, tableColumns) {
  const added = new Map(); // table -> Map(column -> live-like row) from earlier pending files
  const view = (t) => {
    const live = new Map(tableColumns(t));
    for (const [c, row] of added.get(t) ?? []) if (!live.has(c)) live.set(c, row);
    return live;
  };
  const out = new Map();
  for (const a of actions) {
    if (a.action !== 'apply') continue;
    const parsed = splitMigration(a.file.sql);
    if (parsed.error || parsed.adds.length === 0) {
      out.set(a.file.name, { action: 'apply' });
      continue;
    }
    const plain = parsed.adds.every((add) => !PLAIN_NAME.test(add.table) || !view(add.table).has(add.column));
    let prediction;
    if (plain) prediction = { action: 'apply' };
    else {
      const plan = planAdoption(a.file.sql, { tableColumns: view });
      prediction = plan.ok ? { action: 'adopt', columns: plan.adopted.map(label) } : { action: 'fail', reason: plan.reason };
    }
    out.set(a.file.name, prediction);
    if (prediction.action !== 'fail') {
      for (const add of parsed.adds) {
        if (!added.has(add.table)) added.set(add.table, new Map());
        added.get(add.table).set(add.column, { name: add.column, type: add.type, notnull: add.notNull ? 1 : 0 });
      }
    }
  }
  return out;
}
