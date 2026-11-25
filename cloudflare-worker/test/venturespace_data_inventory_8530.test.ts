/**
 * #8530 (D8530): the VentureSpace data inventory covers every store, and every undecided answer is put to the owner.
 *
 * Fails when a D1 table with a `project_id` or `company_id` column is not in `ventureSpaceDataInventory.ts` (or is
 * listed and gone), when Worker source builds an R2 key under a venture's or a company's id under a prefix the
 * inventory does not list, when a KV key names a venture, and when an "unspecified" answer's question, or the store
 * it lists, is missing from D8530.md. What each answer claims is checked by `venturespace_data_lifecycle_8530.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import {
  LIFECYCLE_EVENTS, NOT_STORES, QUESTIONS, VENTURE_SPACE_STORES, unlistedTables, unspecifiedAnswers,
} from '../src/services/ventureSpaceDataInventory.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const DFILE = readFileSync(new URL('../../documentation/architecture/decisions/D8530.md', import.meta.url), 'utf8');

const schema = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  try {
    loadSchema(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map((r) => r.name as string);
    return names.map((name) => ({ name, columns: (db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as any[]).map((c) => c.name as string) }));
  } finally { db.close(); }
})();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.ts$/.test(n) && !/\.generated\.ts$|_registry\.ts$/.test(n) ? [p] : [];
  });
}
const SOURCES = sourceFiles(SRC).map((p) => ({ path: p.slice(SRC.length), text: readFileSync(p, 'utf8') }));
/** An interpolation that names a venture or a company: `${projectId}`, `${project.uid}`, `${venture.uid}`, `${pid}`, `${access.company.uid}`. */
const VENTURE_EXPR = /project|venture|compan|\bpid\b/i;

/** Every key prefix the Worker builds as `` `<prefix>/${<a venture or company>}` ``, with where it was found. */
function ventureKeyPrefixes(sources: ReadonlyArray<{ path: string; text: string }>): Map<string, string> {
  const found = new Map<string, string>();
  for (const { path, text } of sources) {
    for (const m of text.matchAll(/`([a-z0-9][a-z0-9/_.-]*\/)\$\{([^}]*)\}/g)) {
      if (VENTURE_EXPR.test(m[2]) && !found.has(m[1])) found.set(m[1], path);
    }
  }
  return found;
}

test('every D1 table with a project_id or company_id column is in the inventory, and every listed table exists', () => {
  assert.deepEqual(unlistedTables(schema), []);
  const keyed = new Set(schema.filter((t) => t.columns.includes('project_id') || t.columns.includes('company_id')).map((t) => t.name));
  const stale = VENTURE_SPACE_STORES.filter((s) => s.kind === 'd1_table' && !keyed.has(s.name)).map((s) => s.id);
  assert.deepEqual(stale, []);
  // The check itself: a new table with a project_id (or a company_id) and no entry is caught.
  assert.deepEqual(unlistedTables([...schema, { name: 'synthetic_8530_notes', columns: ['id', 'project_id', 'body'] }]), ['synthetic_8530_notes']);
  assert.deepEqual(unlistedTables([...schema, { name: 'synthetic_8530_company', columns: ['id', 'company_id'] }]), ['synthetic_8530_company']);
});

test('every R2 key prefix built under a venture\'s or a company\'s id is in the inventory', () => {
  const listed = new Set(VENTURE_SPACE_STORES.filter((s) => s.kind === 'r2_prefix').map((s) => s.name.slice(0, s.name.indexOf('{'))));
  const found = ventureKeyPrefixes(SOURCES);
  assert.ok(found.has('deck-images/'), 'the scan finds the deck image prefix');
  const unlisted = [...found].filter(([prefix]) => !listed.has(prefix) && !(prefix in NOT_STORES)).map(([p, where]) => `${p} (${where})`);
  assert.deepEqual(unlisted, []);
  const unused = [...listed, ...Object.keys(NOT_STORES)].filter((p) => !found.has(p));
  assert.deepEqual(unused, [], 'a listed prefix no source builds any more');
  // The check itself: a new prefix under a venture's id is caught.
  const planted = ventureKeyPrefixes([{ path: 'synthetic.ts', text: 'const k = `venture-notes/${projectId}/${uid}`;' }]);
  assert.deepEqual([...planted.keys()], ['venture-notes/']);
});

test('no KV key names a venture or a company (a new one must be listed first)', () => {
  const hits = SOURCES.flatMap(({ path, text }) => [...text.matchAll(/\b(?:TOKENS|RATE_LIMITS|OAUTH_KV)\??\.put\(\s*`([^`]*)`/g)]
    .filter((m) => [...m[1].matchAll(/\$\{([^}]*)\}/g)].some((x) => VENTURE_EXPR.test(x[1]))).map((m) => `${path}: ${m[1]}`));
  assert.deepEqual(hits, [], 'list the namespace in the inventory and its answers, then update this check');
});

test('every store answers every event, once, in one of the five forms', () => {
  const ids = VENTURE_SPACE_STORES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'store ids are unique');
  for (const s of VENTURE_SPACE_STORES) {
    assert.deepEqual(Object.keys(s.answers).sort(), [...LIFECYCLE_EVENTS].sort(), s.id);
    for (const e of LIFECYCLE_EVENTS) {
      const a = s.answers[e];
      assert.ok(['follows', 'removed', 'changed', 'kept', 'not_applicable', 'unspecified'].includes(a.is), `${s.id} ${e}`);
      if (a.is === 'kept' || a.is === 'not_applicable') assert.ok(a.reason.trim(), `${s.id} ${e}: a reason`);
      if (a.is === 'removed' || a.is === 'changed') assert.ok(a.by.trim(), `${s.id} ${e}: the code path`);
      if (a.is === 'unspecified') {
        assert.ok(a.question in QUESTIONS, `${s.id} ${e}: ${a.question}`);
        if (a.today === 'unknown') assert.equal(s.kind, 'other', `${s.id}: a D1 or R2 store is read by the lifecycle test`);
      }
    }
  }
});

test('every unspecified answer is put to the owner in D8530.md', () => {
  const open = unspecifiedAnswers();
  assert.ok(open.length > 0);
  const missing: string[] = [];
  /** The text of one question's section: from its heading to the next heading. */
  const section = (q: string) => { const at = DFILE.indexOf(`\n### ${q} `); return at < 0 ? '' : DFILE.slice(at + 1, (DFILE.indexOf('\n### ', at + 1) + 1 || DFILE.length + 1) - 1); };
  for (const q of new Set(open.map(([, , q]) => q))) if (!section(q)) missing.push(`${q}: no "### ${q} " heading`);
  // Q1 (account erasure) covers every store by rule; every other question names each store it covers in its section
  // (a D1 table or an R2 template by name, any other store by id).
  for (const [id, event, q] of open) {
    if (q === 'Q1') continue;
    const s = VENTURE_SPACE_STORES.find((x) => x.id === id)!;
    const name = s.kind === 'other' ? s.id : s.name;
    if (!section(q).includes(`\`${name}\``)) missing.push(`${q} ${event}: \`${name}\` is not named in its section`);
  }
  assert.deepEqual([...new Set(missing)], []);
});
