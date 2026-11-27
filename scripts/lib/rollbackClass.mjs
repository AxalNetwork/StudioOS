// D7151 (#7151): a release's rollback class — `auto`, `auto-additive` or
// `manual` — from its pending D1 statements (each with file and line), its
// Durable Object migration tags against the live one, and the live version's
// bindings it drops; unknown is manual. Owned by
// `../release-rollback-class.mjs`; tested in `rollbackClass.test.mjs`.
//
// D7151 (#7151): may this release be rolled back automatically?
//
// A Worker rollback reverts the code and never D1 (DEPLOY.md §3), so after a
// rollback the PREVIOUS Worker version runs on the schema THIS release
// migrated. Cloudflare also refuses a rollback across a Durable Object
// migration, and to a version whose bound resource no longer exists. So the
// answer depends on three things the release preflight can see before it
// writes anything: the D1 migrations it would apply, the Durable Object
// migration tags it would add, and the bindings the live version has that
// this one drops.
//
//   auto           no pending D1 migration, no Durable Object migration, no
//                  binding removed, and a single recorded version to return to.
//   auto-additive  as `auto`, except that every pending migration only adds:
//                  a table, a view, a non-unique index, a column that is
//                  nullable or has a default, or anything (rows, a unique
//                  index, a trigger) confined to a table this same release
//                  creates. The old code never names any of them.
//   manual         anything else. Unknown is manual: a statement this module
//                  does not recognise, a plan it cannot read, or a deployed
//                  state it could not observe is never treated as safe.
//
// Pure: no process, no network, no file system. `../release-rollback-class.mjs`
// gathers the inputs during the release and writes the evidence. REPORT ONLY
// until #7152 acts on it.

import { parseToml } from './branchConfig.mjs';

export const CLASSES = Object.freeze(['auto', 'auto-additive', 'manual']);

// Each rule that makes a release `manual`, with the reason a person reads.
export const MANUAL_RULES = Object.freeze({
  'drop': 'a drop: the previous Worker still reads what this removes',
  'rename': 'a rename: the previous Worker still uses the old name',
  'not-null-no-default': 'a NOT NULL column with no default: the previous Worker inserts rows without it',
  'data-rewrite': 'an UPDATE or DELETE on a table that already exists rewrites rows the previous Worker reads',
  'data-write': 'rows written into a table that already exists: the previous Worker reads them without knowing them',
  'cross-column-check': 'a new column whose CHECK names an existing column, or whose foreign key has a default: it can refuse the previous Worker\'s writes',
  'unique-index': 'a UNIQUE index on a table that already exists: the previous Worker may write a row it refuses',
  'trigger': 'a trigger on a table that already exists runs on the previous Worker\'s writes too',
  'unrecognised': 'a statement this classifier does not recognise (unknown is manual)',
  'migration-unreadable': 'a pending migration file could not be read',
  'plan-unreadable': 'the D1 migration plan could not be read',
  'do-migration': 'a Durable Object migration: Cloudflare refuses a rollback across it',
  'do-tag-unknown': 'the live Durable Object migration tag could not be read',
  'do-tag-foreign': 'the live Durable Object migration tag is not in this release\'s list',
  'binding-removed': 'a binding the live version has is gone from this release: its resource may be retired',
  'bindings-unknown': 'the live version\'s bindings could not be read',
  'classifier-error': 'the classifier itself failed, so nothing is known',
  'previous-version-unknown': 'no previous Worker version is recorded to roll back to',
  'split-deployment': 'the live deployment splits traffic across versions, so there is no single rollback target',
});

// ── SQL ────────────────────────────────────────────────────────────────────

/**
 * The statements of a migration, comments removed, each with the 1-based line
 * it starts on. Quotes are respected, so a `;` or `--` inside a string or a
 * quoted name neither splits nor comments; a trigger body is kept whole.
 */
export function sqlStatements(sql) {
  const src = String(sql ?? '');
  const out = [];
  let buf = '';
  let line = 1;
  let start = null;
  const push = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, line: start });
    buf = '';
    start = null;
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '-' && next === '-') {
      while (i < src.length && src[i] !== '\n') i += 1;
      buf += ' ';
      if (src[i] === '\n') line += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line += 1; i += 1; }
      i += 1;
      buf += ' ';
      continue;
    }
    const close = { "'": "'", '"': '"', '`': '`', '[': ']' }[ch];
    if (close) {
      if (start === null) start = line;
      let j = i + 1;
      for (;;) {
        if (j >= src.length) break;
        if (src[j] === close) {
          if (close !== ']' && src[j + 1] === close) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      const lit = src.slice(i, j + 1);
      for (const c of lit) if (c === '\n') line += 1;
      buf += lit;
      i = j;
      continue;
    }
    if (ch === ';') {
      const so = buf.replace(/\s+/g, ' ').trim();
      if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(so) && !/\bEND$/i.test(so)) { buf += ch; continue; }
      push();
      continue;
    }
    if (ch === '\n') line += 1;
    if (start === null && !/\s/.test(ch)) start = line;
    buf += ch;
  }
  push();
  return out;
}

const NAME = String.raw`((?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+))?)`;
const IFNE = String.raw`(?:IF\s+NOT\s+EXISTS\s+)?`;

/** `"main"."Deals"` → `deals`. */
export function tableName(raw) {
  const parts = String(raw).split('.').map((p) => p.trim().replace(/^["`[]|["`\]]$/g, '').toLowerCase());
  return parts.length === 2 && (parts[0] === 'main' || parts[0] === 'temp') ? parts[1] : parts.join('.');
}

/** A column definition with every parenthesised part blanked, so a CHECK body cannot trip a rule. */
function topLevel(text) {
  let depth = 0;
  let out = '';
  for (const ch of String(text)) {
    if (ch === '(') { depth += 1; out += ' '; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); out += ' '; continue; }
    out += depth === 0 ? ch : ' ';
  }
  return out;
}

/** The name a column definition starts with, unquoted and lower-cased. */
function columnName(def) {
  return tableName((new RegExp(`^\\s*${NAME}`).exec(String(def)) || [])[1] ?? '');
}

// Words a CHECK body may use that name no column.
const CHECK_WORDS = new Set(['is', 'null', 'not', 'and', 'or', 'in', 'between', 'like', 'glob', 'escape', 'case', 'when',
  'then', 'else', 'end', 'as', 'collate', 'nocase', 'binary', 'rtrim', 'true', 'false', 'integer', 'int', 'text', 'real',
  'numeric', 'blob', 'current_timestamp', 'current_date', 'current_time']);

/**
 * Whether a new column's constraints concern that column alone, or columns
 * this same release added to the table (`alsoNew`), which the previous Worker
 * never writes either. A CHECK that names an older column refuses the previous Worker's writes to THAT column
 * (762's `close_reason` check reads `board_column` and `status`), and a
 * foreign key with a non-NULL default holds every row the previous Worker
 * inserts to a parent it never chose. Either is manual.
 */
export function columnConstraintsSelfContained(def, alsoNew = new Set()) {
  const text = String(def);
  const col = columnName(text);
  const bare = text.replace(/'(?:[^']|'')*'/g, "''");
  if (/\bREFERENCES\b/i.test(bare) && /\bDEFAULT\s+(?!NULL\b)/i.test(bare)) return false;
  const re = /\bCHECK\s*\(/gi;
  let m;
  while ((m = re.exec(bare))) {
    let depth = 1;
    let j = m.index + m[0].length;
    const from = j;
    while (j < bare.length && depth > 0) { if (bare[j] === '(') depth += 1; else if (bare[j] === ')') depth -= 1; j += 1; }
    const body = bare.slice(from, j - 1);
    const ids = body.match(/"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|\b[A-Za-z_][\w$]*\b(?![\w$]|\s*\()/g) || [];
    for (const id of ids) {
      const name = tableName(id);
      if (name !== col && !alsoNew.has(name) && !CHECK_WORDS.has(name)) return false;
    }
  }
  return true;
}

/**
 * One statement's verdict: `{ additive: true, kind }` or `{ additive: false, rule }`.
 * `created` is the set of tables this release creates before the statement,
 * and `added` maps a table to the columns this release added to it before.
 */
export function classifyStatement(text, created = new Set(), added = new Map()) {
  const s = String(text).trim();
  let m;
  if ((m = new RegExp(String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+${IFNE}${NAME}`, 'i').exec(s))) {
    created.add(tableName(m[1]));
    return { additive: true, kind: 'create-table' };
  }
  if ((m = new RegExp(String.raw`^CREATE\s+VIRTUAL\s+TABLE\s+${IFNE}${NAME}`, 'i').exec(s))) {
    created.add(tableName(m[1]));
    return { additive: true, kind: 'create-table' };
  }
  if ((m = new RegExp(String.raw`^CREATE\s+UNIQUE\s+INDEX\s+${IFNE}${NAME}\s+ON\s+${NAME}`, 'i').exec(s))) {
    return created.has(tableName(m[2])) ? { additive: true, kind: 'create-index' } : { additive: false, rule: 'unique-index' };
  }
  if (new RegExp(String.raw`^CREATE\s+INDEX\s+${IFNE}${NAME}\s+ON\s+${NAME}`, 'i').test(s)) {
    return { additive: true, kind: 'create-index' };
  }
  if (new RegExp(String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?VIEW\s+${IFNE}${NAME}`, 'i').test(s)) {
    return { additive: true, kind: 'create-view' };
  }
  if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(s)) {
    m = new RegExp(String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\s+${IFNE}${NAME}\s+(?:(?:BEFORE|AFTER|INSTEAD\s+OF)\s+)?(?:DELETE|INSERT|UPDATE(?:\s+OF\s+[^;]*?)?)\s+ON\s+${NAME}`, 'i').exec(s);
    return m && created.has(tableName(m[2])) ? { additive: true, kind: 'trigger-on-new-table' } : { additive: false, rule: 'trigger' };
  }
  if ((m = new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+ADD\s+(?!CONSTRAINT\b)(?:COLUMN\s+)?(.*)$`, 'i').exec(s))) {
    const def = topLevel(m[2]);
    if (/\bNOT\s+NULL\b/i.test(def) && !/\bDEFAULT\b/i.test(def)) return { additive: false, rule: 'not-null-no-default' };
    const table = tableName(m[1]);
    const cols = added.get(table) ?? new Set();
    if (!created.has(table) && !columnConstraintsSelfContained(m[2], cols)) return { additive: false, rule: 'cross-column-check' };
    const col = columnName(m[2]);
    if (col) added.set(table, cols.add(col));
    return { additive: true, kind: 'add-column' };
  }
  if (new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+RENAME\b`, 'i').test(s)) return { additive: false, rule: 'rename' };
  if (new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+DROP\b`, 'i').test(s)) return { additive: false, rule: 'drop' };
  if (/^DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)\b/i.test(s)) return { additive: false, rule: 'drop' };
  if ((m = new RegExp(String.raw`^(?:UPDATE(?:\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK))?|DELETE\s+FROM)\s+${NAME}`, 'i').exec(s))) {
    return created.has(tableName(m[1])) ? { additive: true, kind: 'rows-of-new-table' } : { additive: false, rule: 'data-rewrite' };
  }
  if ((m = new RegExp(String.raw`^(?:INSERT(?:\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK))?|REPLACE)\s+INTO\s+${NAME}`, 'i').exec(s))) {
    return created.has(tableName(m[1])) ? { additive: true, kind: 'seed-new-table' } : { additive: false, rule: 'data-write' };
  }
  return { additive: false, rule: 'unrecognised' };
}

/**
 * Every pending migration, in apply order. `files` are `{ name, sql }`, and
 * `sql: null` means the file could not be read. Returns the blocking reasons
 * (with file and line) and the additive statements seen.
 */
export function classifyMigrations(files) {
  const created = new Set();
  const added = new Map();
  const reasons = [];
  const additive = [];
  for (const f of files) {
    if (typeof f.sql !== 'string') {
      reasons.push({ rule: 'migration-unreadable', file: f.name, line: null, text: MANUAL_RULES['migration-unreadable'] });
      continue;
    }
    for (const st of sqlStatements(f.sql)) {
      const v = classifyStatement(st.text, created, added);
      const where = { file: f.name, line: st.line, statement: st.text.slice(0, 160) };
      if (v.additive) additive.push({ kind: v.kind, ...where });
      else reasons.push({ rule: v.rule, ...where, text: MANUAL_RULES[v.rule] });
    }
  }
  return { reasons, additive };
}

/**
 * The files `migrate-d1.mjs --remote --dry-run` says it would apply, from its
 * log. `null` when the log holds no plan (a refused or foreign ledger, an
 * empty-ledger warning, a crash) or an action other than apply and skip.
 */
export function pendingFromPlan(log) {
  const text = String(log ?? '');
  if (/would REFUSE|No plan can be made/.test(text)) return null;
  const at = text.indexOf('[migrate-d1] Plan:');
  if (at < 0) return null;
  const pending = [];
  for (const raw of text.slice(at).split('\n').slice(1)) {
    if (!raw.trim()) continue;
    const m = /^\s+(apply|skip|mark)\s+(\S+\.sql)\s*$/.exec(raw);
    if (!m || m[1] === 'mark') return null;
    if (m[1] === 'apply') pending.push(m[2]);
  }
  return pending;
}

// ── wrangler.toml ─────────────────────────────────────────────────────────

const unquote = (v) => {
  try { return JSON.parse(v); } catch { return String(v).replace(/^['"]|['"]$/g, ''); }
};

// Tables under [env.production] that declare no binding of the Worker.
const NOT_BINDINGS = new Set(['vars', 'routes', 'triggers', 'migrations', 'queues.consumers', 'tail_consumers',
  'observability', 'observability.logs', 'observability.traces', 'rules', 'build', 'limits', 'placement', 'dev']);

/**
 * The production environment of a `wrangler.toml`: its Durable Object
 * migration tags in order, and the names of its bindings (vars excluded:
 * they live in the version itself and have no resource to retire).
 */
export function productionConfig(tomlSrc, env = 'production') {
  const { sections } = parseToml(String(tomlSrc));
  const prefix = `env.${env}.`;
  const migrationTags = [];
  const bindings = new Set();
  for (const sec of sections) {
    if (!sec.name.startsWith(prefix)) continue;
    const kind = sec.name.slice(prefix.length);
    if (kind === 'migrations') {
      if (sec.kv.has('tag')) migrationTags.push(unquote(sec.kv.get('tag')));
      continue;
    }
    if (NOT_BINDINGS.has(kind) || kind.startsWith('observability')) continue;
    const name = sec.kv.get('binding') ?? sec.kv.get('name');
    if (name != null) bindings.add(unquote(name));
  }
  return { migrationTags, bindings: [...bindings] };
}

// ── the live version ──────────────────────────────────────────────────────

// Binding types that carry a value inside the version and no resource behind it.
const VERSION_ONLY_TYPES = new Set(['plain_text', 'json', 'secret_text', 'inherit']);

/**
 * What the release needs from `wrangler deployments list --json`: the version
 * live now, which a rollback would return to. `null` id when there is none or
 * the list is unreadable; `split` when traffic is shared between versions.
 */
export function previousVersion(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) return { id: null, split: false, versions: [] };
  const live = [...deployments].sort((a, b) => String(a?.created_on ?? '').localeCompare(String(b?.created_on ?? ''))).at(-1);
  const versions = Array.isArray(live?.versions) ? live.versions.map((v) => ({ id: v?.version_id ?? null, percentage: v?.percentage ?? null })) : [];
  if (versions.length === 1 && versions[0].id && Number(versions[0].percentage) === 100) return { id: versions[0].id, split: false, versions };
  return { id: null, split: versions.length > 1, versions };
}

/**
 * The parts of `wrangler versions view <id> --json` the classifier reads,
 * reduced so the evidence carries no author email or variable value: binding
 * names and types, the Durable Object migration tag if the API reports one,
 * and the commit the version was deployed from (`WORKER_DEPLOY_VERSION`).
 */
export function reduceVersion(version) {
  if (!version || typeof version !== 'object' || !Array.isArray(version?.resources?.bindings)) return null;
  const bindings = version.resources.bindings
    .filter((b) => b && typeof b.name === 'string')
    .map((b) => ({ name: b.name, type: String(b.type ?? 'unknown') }));
  const tag = version.resources.script_runtime?.migration_tag ?? version.resources.script?.migration_tag ?? null;
  const stamp = version.resources.bindings.find((b) => b?.name === 'WORKER_DEPLOY_VERSION' && b?.type === 'plain_text');
  const commit = /^[0-9a-f]{40}$/.test(String(stamp?.text ?? '')) ? stamp.text : null;
  return { id: version.id ?? null, bindings, migrationTag: typeof tag === 'string' && tag ? tag : null, commit };
}

/** Bindings of the live version this release drops. */
export function removedBindings(deployed, candidateNames) {
  const have = new Set(candidateNames);
  return deployed.filter((b) => !VERSION_ONLY_TYPES.has(b.type) && !have.has(b.name));
}

/** Durable Object migration tags this release would add after `deployedTag`. */
export function pendingDoTags(candidateTags, deployedTag) {
  if (!deployedTag) return candidateTags.length ? null : [];
  const at = candidateTags.indexOf(deployedTag);
  return at < 0 ? null : candidateTags.slice(at + 1);
}

// ── the class ─────────────────────────────────────────────────────────────

/**
 * The release's class.
 *
 *   plan          `pendingFromPlan` output: file names, or null if unreadable
 *   migrations    `{ name, sql }` for every pending file (`sql: null` unreadable)
 *   candidate     `productionConfig(wrangler.toml)` of this release
 *   deployed      `reduceVersion(...)` of the live version, or null
 *   deployedTag   the live Durable Object migration tag, or null if unknown
 *   previous      `previousVersion(...)`
 */
export function classifyRelease({ plan, migrations = [], candidate, deployed, deployedTag, previous }) {
  const reasons = [];
  const add = (rule, extra = {}) => reasons.push({ rule, file: null, line: null, ...extra, text: extra.text ?? MANUAL_RULES[rule] });

  let additive = [];
  if (plan == null) add('plan-unreadable');
  else {
    const m = classifyMigrations(migrations);
    reasons.push(...m.reasons);
    additive = m.additive;
  }

  const tags = candidate?.migrationTags ?? [];
  let doTags = [];
  if (!deployedTag) {
    if (tags.length) { add('do-tag-unknown'); doTags = null; }
  } else {
    doTags = pendingDoTags(tags, deployedTag);
    if (doTags == null) add('do-tag-foreign', { text: `${MANUAL_RULES['do-tag-foreign']}: \`${deployedTag}\`` });
    else for (const t of doTags) add('do-migration', { text: `${MANUAL_RULES['do-migration']}: \`${t}\`` });
  }

  let removed = [];
  if (!deployed) add('bindings-unknown');
  else {
    removed = removedBindings(deployed.bindings, candidate?.bindings ?? []);
    for (const b of removed) add('binding-removed', { text: `${MANUAL_RULES['binding-removed']}: \`${b.name}\` (${b.type})` });
  }

  if (previous?.split) add('split-deployment');
  else if (!previous?.id) add('previous-version-unknown');

  const pendingCount = plan == null ? null : plan.length;
  const cls = reasons.length ? 'manual' : pendingCount > 0 ? 'auto-additive' : 'auto';
  return {
    class: cls,
    reportOnly: true,
    previousVersionId: previous?.id ?? null,
    pendingMigrations: plan,
    pendingDoTags: doTags,
    deployedDoTag: deployedTag ?? null,
    removedBindings: removed,
    reasons,
    additive,
  };
}

const cell = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The job-summary section for a result. */
export function renderSummary(r) {
  const out = [];
  out.push(`### Rollback class: \`${r.class}\` (report only, D7151)`, '');
  out.push(`- Rollback target (the version live before this release): ${r.previousVersionId ? `\`${r.previousVersionId}\`` : 'not recorded'}`);
  out.push(`- Pending D1 migrations: ${r.pendingMigrations == null ? 'unknown (plan unreadable)' : r.pendingMigrations.length}`);
  out.push(`- Durable Object migration tag live: ${r.deployedDoTag ? `\`${r.deployedDoTag}\`` : 'unknown'}; pending: ${r.pendingDoTags == null ? 'unknown' : r.pendingDoTags.length ? r.pendingDoTags.map((t) => `\`${t}\``).join(', ') : 'none'}`);
  out.push(`- Bindings removed: ${r.removedBindings.length ? r.removedBindings.map((b) => `\`${b.name}\``).join(', ') : 'none'}`);
  out.push('');
  if (r.reasons.length) {
    out.push('| Rule | Where | Why |', '| --- | --- | --- |');
    for (const x of r.reasons) {
      const where = x.file ? `${x.file}${x.line ? `:${x.line}` : ''}` : '';
      out.push(`| \`${x.rule}\` | ${cell(where)} | ${cell(x.text)}${x.statement ? ` — \`${cell(x.statement.slice(0, 100))}\`` : ''} |`);
    }
  } else if (r.class === 'auto-additive') {
    out.push(`Every pending statement only adds (${r.additive.length} statement(s)); the previous Worker never names what they add.`);
  } else {
    out.push('Nothing in this release changes what the previous Worker runs against.');
  }
  out.push('', 'This class changes nothing in the release; automatic rollback is #7152.');
  return out.join('\n') + '\n';
}
