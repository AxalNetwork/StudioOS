/**
 * D1508 (#3759): every deck store is in the retention inventory.
 *
 * `deckTables(files)` replays the schema the way a fresh build does
 * (`schema_baseline.sql`, then each migration after `BASELINE_CUTOFF`, in
 * number order): a CREATE TABLE adds a table, an ALTER TABLE … RENAME TO
 * moves it, a DROP TABLE removes it. What is left whose name starts `deck_`
 * or `pitch_deck` is a deck store.
 *
 * `deckRetentionProblems` compares those with the first column of
 * `documentation/operations/DATA_RETENTION.md`'s table (`| \`name\` | …`):
 *   · a deck store with no row;
 *   · a row for a table that does not exist;
 *   · a deck table created from migration 722 on with no ON DELETE CASCADE.
 */
export const DECK_TABLE = /^(deck_|pitch_deck)/;
export const CASCADE_FROM = 722;
/**
 * Deck tables made after 722 without a cascade, before this check existed.
 * Each is in DATA_RETENTION.md as "no cascade". A new table never joins this
 * list: it cascades from its parent.
 */
export const KNOWN_WITHOUT_CASCADE = Object.freeze(['deck_exports', 'deck_grants']);

const CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s*\(/gi;
const RENAME = /ALTER\s+TABLE\s+["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+RENAME\s+TO\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
const DROP = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)/gi;

/** SQL with its `--` line comments removed, so a commented-out statement does not count. */
const withoutComments = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

/** The body of the CREATE TABLE that starts at `from`: up to its matching close parenthesis. */
function bodyAt(sql, from) {
  let depth = 0;
  for (let i = sql.indexOf('(', from); i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

/**
 * The tables a fresh build ends with. `files` is `[{ name, number, sql }]` in
 * apply order (the baseline as number 0). Each table maps to the number of the
 * file that created it and that CREATE's text.
 */
export function deckTables(files) {
  const tables = new Map();
  for (const f of files) {
    const sql = withoutComments(f.sql);
    // Statement order within a file matters: walk the three patterns by position.
    const events = [];
    for (const m of sql.matchAll(CREATE)) events.push({ at: m.index, kind: 'create', name: m[1], body: bodyAt(sql, m.index) });
    for (const m of sql.matchAll(RENAME)) events.push({ at: m.index, kind: 'rename', name: m[1], to: m[2] });
    for (const m of sql.matchAll(DROP)) events.push({ at: m.index, kind: 'drop', name: m[1] });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === 'create') { if (!tables.has(e.name)) tables.set(e.name, { number: f.number, body: e.body }); }
      else if (e.kind === 'rename') { const t = tables.get(e.name); if (t) { tables.delete(e.name); tables.set(e.to, t); } }
      else tables.delete(e.name);
    }
  }
  return new Map([...tables].filter(([name]) => DECK_TABLE.test(name)));
}

/** The table names the inventory lists: the first column of its rows, in backticks. */
export function inventoryNames(markdown) {
  const out = new Set();
  for (const line of String(markdown).split('\n')) {
    const m = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Every problem, as a sentence; none when the inventory and the schema agree. */
export function deckRetentionProblems(files, markdown) {
  const tables = deckTables(files);
  const listed = inventoryNames(markdown);
  const problems = [];
  for (const [name, t] of tables) {
    if (!listed.has(name)) problems.push(`${name} is a deck store with no row in DATA_RETENTION.md`);
    if (t.number >= CASCADE_FROM && !KNOWN_WITHOUT_CASCADE.includes(name) && !/ON\s+DELETE\s+CASCADE/i.test(t.body)) problems.push(`${name} (migration ${t.number}) has no ON DELETE CASCADE`);
  }
  for (const name of listed) if (DECK_TABLE.test(name) && !tables.has(name)) problems.push(`DATA_RETENTION.md lists ${name}, which no migration leaves in place`);
  return problems;
}
