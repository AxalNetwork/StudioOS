/**
 * #9045 (D9045): the account data inventory covers every store that names a person, agrees with D8530, and puts every
 * undecided answer to the owner.
 *
 * Fails when a D1 table names a person (a `user_id`/`*_user_id` column, an `email`/`*_email` column, or a foreign key
 * to `users`) and is not in `accountDataInventory.ts`, is listed and no longer names one, or names them by columns the
 * inventory does not list; when Worker source builds an R2 key under a user id or an email under a prefix not listed;
 * when a KV write names a person in a namespace not listed; when the data export reads a table not marked as exported
 * (or the reverse); when a store D8530 also lists answers account erasure differently; and when an unspecified
 * answer's question is missing from D9045.md. What each erasure answer claims is checked by
 * `account_data_erasure_9045.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import {
  ACCOUNT_STORES, NOT_STORES, QUESTIONS, personColumnsOf, unlistedTables, unspecifiedAnswers,
} from '../src/services/accountDataInventory.ts';
import { VENTURE_SPACE_STORES } from '../src/services/ventureSpaceDataInventory.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const DFILE = readFileSync(new URL('../../documentation/architecture/decisions/D9045.md', import.meta.url), 'utf8');

const schema = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  try {
    loadSchema(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map((r) => r.name as string);
    return names.map((name) => ({
      name,
      columns: (db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as any[]).map((c) => c.name as string),
      userForeignKeys: (db.prepare('SELECT "from" AS c, "table" AS t FROM pragma_foreign_key_list(?)').all(name) as any[]).filter((f) => f.t === 'users').map((f) => f.c as string),
    }));
  } finally { db.close(); }
})();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.ts$/.test(n) && !/\.generated\.ts$|_registry\.ts$/.test(n) ? [p] : [];
  });
}
const SOURCES = sourceFiles(SRC).map((p) => ({ path: p.slice(SRC.length), text: readFileSync(p, 'utf8') }));
/** An interpolation that names a person: `${user.id}`, `${userId}`, `${s.user.id}`, `${email}`, `${Number(user.id)}`. */
const PERSON_EXPR = /user|email/i;

/** Every key prefix the Worker builds as `` `<prefix>/${<a person>}` ``, with where it was found. */
function personKeyPrefixes(sources: ReadonlyArray<{ path: string; text: string }>): Map<string, string> {
  const found = new Map<string, string>();
  for (const { path, text } of sources) {
    for (const m of text.matchAll(/`([a-z0-9][a-z0-9/_.-]*\/)\$\{([^}]*)\}/g)) {
      if (PERSON_EXPR.test(m[2]) && !found.has(m[1])) found.set(m[1], path);
    }
  }
  return found;
}

test('every D1 table that names a person is in the inventory, by the columns that name them, and every listed table exists', () => {
  assert.deepEqual(unlistedTables(schema), []);
  const byName = new Map(schema.map((t) => [t.name, t]));
  const wrong: string[] = [];
  for (const s of ACCOUNT_STORES.filter((x) => x.kind === 'd1_table')) {
    const t = byName.get(s.name);
    if (!t) { wrong.push(`${s.id}: no such table`); continue; }
    if (s.keyed_by[0].startsWith('via ')) {
      const [table, column] = s.keyed_by[0].slice(4).split('.');
      if (!byName.get(table)?.columns.includes(column)) wrong.push(`${s.id}: ${s.keyed_by[0]} does not exist`);
      if (personColumnsOf(t).length) wrong.push(`${s.id}: names a person itself; list its columns`);
      continue;
    }
    const cols = personColumnsOf(t);
    if (cols.join(' ') !== s.keyed_by.join(' ')) wrong.push(`${s.id}: keyed_by '${s.keyed_by.join(' ')}', the schema says '${cols.join(' ')}'`);
  }
  assert.deepEqual(wrong, []);
  // The check itself: a new table with a user id, an email or a foreign key to users, and no entry, is caught.
  const planted = [
    { name: 'synthetic_9045_notes', columns: ['id', 'user_id', 'body'] },
    { name: 'synthetic_9045_reviews', columns: ['id', 'reviewer_user_id'] },
    { name: 'synthetic_9045_contacts', columns: ['id', 'contact_email'] },
    { name: 'synthetic_9045_grants', columns: ['id', 'granted_by'], userForeignKeys: ['granted_by'] },
    { name: 'synthetic_9045_other', columns: ['id', 'project_id', 'body'] },
  ];
  assert.deepEqual(unlistedTables([...schema, ...planted]), planted.slice(0, 4).map((t) => t.name));
});

test('every R2 key prefix built under a person is in the inventory', () => {
  const listed = new Set(ACCOUNT_STORES.filter((s) => s.kind === 'r2_prefix' && s.name.includes('{user_id}')).map((s) => s.name.slice(0, s.name.indexOf('{'))));
  const found = personKeyPrefixes(SOURCES);
  assert.ok(found.has('kyc/'), 'the scan finds the KYC document prefix');
  const unlisted = [...found].filter(([prefix]) => !listed.has(prefix) && !(prefix in NOT_STORES)).map(([p, where]) => `${p} (${where})`);
  assert.deepEqual(unlisted, []);
  const unused = [...listed, ...Object.keys(NOT_STORES)].filter((p) => !found.has(p));
  assert.deepEqual(unused, [], 'a listed prefix no source builds any more');
  // The compute objects the erasure reaches through its rows: the prefix is still the one the bridge writes.
  assert.ok(SOURCES.some((s) => s.text.includes('`agent-compute/${')), 'agent-compute/ is still written');
  // The check itself: a new prefix under a person is caught.
  const planted = personKeyPrefixes([{ path: 'synthetic.ts', text: 'const k = `voice-notes/${user.id}/${uid}`; const j = `x/${email}`;' }]);
  assert.deepEqual([...planted.keys()], ['voice-notes/', 'x/']);
});

test('a KV write that names a person goes to a namespace the inventory lists', () => {
  const listed = new Set(ACCOUNT_STORES.filter((s) => s.kind === 'kv_namespace').map((s) => s.id.slice(3)));
  const scan = (sources: ReadonlyArray<{ path: string; text: string }>) => sources.flatMap(({ path, text }) => [...text.matchAll(/\b(TOKENS|RATE_LIMITS|OAUTH_KV)\??\.put\(\s*`([^`]*)`/g)]
    .filter((m) => [...m[2].matchAll(/\$\{([^}]*)\}/g)].some((x) => PERSON_EXPR.test(x[1])) && !listed.has(m[1])).map((m) => `${path}: ${m[1]} ${m[2]}`));
  assert.deepEqual(scan(SOURCES), [], 'list the namespace in the inventory and its answer');
  assert.deepEqual(scan([{ path: 'synthetic.ts', text: 'await env.TOKENS.put(`seen:${user.id}`, "1");' }]), ['synthetic.ts: TOKENS seen:${user.id}']);
});

test('every store answers erasure and export once, in a known form', () => {
  const ids = ACCOUNT_STORES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'store ids are unique');
  for (const s of ACCOUNT_STORES) {
    const a = s.account_erasure;
    assert.ok(['removed', 'changed', 'kept', 'unspecified'].includes(a.is), s.id);
    if (a.is === 'kept') assert.ok(a.reason.trim(), `${s.id}: a reason`);
    if (a.is === 'removed' || a.is === 'changed') assert.ok(a.by.trim(), `${s.id}: the code path`);
    if (a.is === 'unspecified') {
      assert.ok(a.question in QUESTIONS, `${s.id}: ${a.question}`);
      if (a.today === 'unknown') assert.equal(s.kind, 'other', `${s.id}: a D1, R2 or KV store is read by the erasure test`);
    }
    assert.ok(s.data_export.is === 'not_included' || (s.data_export.is === 'included' && s.data_export.what.trim()), `${s.id}: export`);
    assert.ok(s.keyed_by.length && s.keyed_by.every((k) => k.trim()), `${s.id}: keyed_by`);
  }
});

test('a store D8530 also lists gives the same account-erasure answer there', () => {
  const venture = new Map(VENTURE_SPACE_STORES.map((s) => [s.id, s.answers.account_erasure]));
  const shared = ACCOUNT_STORES.filter((s) => venture.has(s.id));
  assert.ok(shared.length > 100, `${shared.length} stores in both`);
  /** The answer without the question id: each file numbers its own questions. */
  const shape = (a: any) => (a.is === 'unspecified' ? { is: a.is, today: a.today } : a.is === 'removed' || a.is === 'changed' ? { is: a.is, by: a.by.split(' ')[0] } : { is: a.is });
  const differ = shared.filter((s) => JSON.stringify(shape(s.account_erasure)) !== JSON.stringify(shape(venture.get(s.id)))).map((s) => `${s.id}: ${JSON.stringify(shape(s.account_erasure))} here, ${JSON.stringify(shape(venture.get(s.id)))} in D8530`);
  assert.deepEqual(differ, []);
});

/** The tables a piece of source reads, by `FROM` and `JOIN`. */
const tablesRead = (text: string) => new Set([...text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]));
const between = (text: string, from: string, to: string) => { const a = text.indexOf(from); assert.ok(a >= 0, from); const b = text.indexOf(to, a + from.length); return text.slice(a, b < 0 ? undefined : b); };
/** Tables the export reads only to decide which agents the member can see; nothing of them is in the file. */
const EXPORT_FILTERS: Readonly<Record<string, string>> = { user_company_links: 'the member\'s companies, a filter', projects: 'the ventures the member runs, a filter' };

test('the data export carries exactly the stores marked as exported', () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const exportPath = [
    between(read('routes/settings.ts'), "settings.get('/data-export'", '\nsettings.'),
    between(read('services/agents/memory.ts'), 'export async function exportAgentData', '\nexport '),
    between(read('services/agents/teams.ts'), 'export async function bookRows', '\nexport '),
  ].join('\n');
  const readByExport = [...tablesRead(exportPath)].filter((t) => !(t in EXPORT_FILTERS)).sort();
  const marked = ACCOUNT_STORES.filter((s) => s.data_export.is === 'included').map((s) => s.name).sort();
  assert.deepEqual(readByExport, marked);
  assert.ok(marked.includes('users') && marked.includes('agent_memory_notes'));
});

test('every unspecified answer is put to the owner in D9045.md', () => {
  const open = unspecifiedAnswers();
  assert.ok(open.length > 800, `${open.length} open answers`);
  const asked = new Set(open.map(([, q]) => q));
  const missing = [...asked].filter((q) => !DFILE.includes(`\n### ${q} — ${QUESTIONS[q]}\n`)).map((q) => `${q}: no "### ${q} — ${QUESTIONS[q]}" heading`);
  assert.deepEqual(missing, []);
  // Every question the module defines is asked by at least one store, so the decision file asks nothing idle.
  assert.deepEqual(Object.keys(QUESTIONS).filter((q) => !asked.has(q as any)), []);
});
