/** D7705 (#7705): real SQLite create/answer history, rollback and a source-level market-writer inventory.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7705: real-SQLite create/answer actor
 * history, zero preservation, refused-answer fallback, atomic rollback and literal/dynamic writer
 * inventory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { stripTypeScriptTypes } from 'node:module';
import { parse } from 'acorn';
import projects from '../src/routes/projects.ts';
import { routeAnswer } from '../src/services/advisor/writeRouter.ts';
import { REQUIRED_OFFICIAL_INPUTS } from '../src/services/scoreIntegrity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { schemaPath, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';

const schema = schemaPath();
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'market-writers-7705-'));
  const file = join(dir, 'fixture.sqlite');
  copyFileSync(schema, file);
  const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  const close = db.close.bind(db);
  db.close = () => { try { close(); } finally { rmSync(dir, { recursive: true, force: true }); } };
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
    (1,'founder','Synthetic Founder','founder@example.test',11,1,'studio'),
    (900,'admin','Synthetic Admin','admin@example.test',NULL,1,'studio');
    INSERT INTO founders(id,name,email) VALUES (11,'Synthetic Founder','founder@example.test');
    INSERT INTO projects(id,name,founder_id,tam,sam,som) VALUES (1,'Existing venture',11,1000,100,20);`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/projects', projects);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  return { db, env, async create(path: string, body: unknown) {
    const response = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(900, 'admin')}` }, body: JSON.stringify(body) }, env);
    return { status: response.status, body: await response.json() as any };
  }, rows(id: number) {
    return db.prepare('SELECT figure,value,method,source_title,source_url,market_source_id,set_by,sizing_version_id FROM market_figures WHERE project_id=? ORDER BY figure').all(id).map(r => ({ ...r }));
  }, answer(value: string) {
    return routeAnswer(env, { id: 1, role: 'founder', founder_id: 11, email: 'founder@example.test', name: 'Synthetic Founder' } as any, 'founder.project.som_usd', value, 'Synthetic source');
  } };
}
const intake = { ...Object.fromEntries(REQUIRED_OFFICIAL_INPUTS.map(k => [k, 0])), name: 'Synthetic intake', founder_name: 'Synthetic applicant', founder_email: 'applicant@example.test', tam: 1000, sam: 0 };
for (const path of ['/api/projects', '/api/projects/submit']) {
  test(`D7705 ${path} records stored figures, including zero, with the acting user and no supplied source`, async () => {
    const f = fixture(); try {
      const response = await f.create(path, { ...intake, market_figure_source: { method: 'document', market_source_id: 999 } });
      assert.equal(response.status, path.endsWith('/submit') ? 200 : 201, JSON.stringify(response.body));
      const project = response.body.project ?? response.body;
      assert.deepEqual(f.rows(project.id), ['sam', 'tam'].map((figure, i) => ({ figure, value: [0, 1000][i], method: 'typed', source_title: null, source_url: null, market_source_id: null, set_by: 900, sizing_version_id: null })));
      assert.deepEqual(response.body.market_figures, { recorded: ['tam', 'sam'] });
      assert.equal(f.db.prepare('SELECT sam FROM projects WHERE id=?').get(project.id)?.sam, 0);
    } finally { f.db.close(); }
  });
  test(`D7705 ${path} keeps the created project and reports a failed history write`, async () => {
    const f = fixture(); try {
      f.db.exec("CREATE TRIGGER refuse_history BEFORE INSERT ON market_figures BEGIN SELECT RAISE(ABORT,'synthetic history fault'); END");
      const response = await f.create(path, intake);
      assert.equal(response.status, path.endsWith('/submit') ? 200 : 201, JSON.stringify(response.body));
      const project = response.body.project ?? response.body;
      assert.equal(f.db.prepare('SELECT tam FROM projects WHERE id=?').get(project.id)?.tam, 1000);
      assert.deepEqual(response.body.market_figures, { recorded: null, reason: 'The figures were saved; where they came from was not.' });
      assert.deepEqual(f.rows(project.id), []);
    } finally { f.db.close(); }
  });
}
for (const value of ['', false]) test(`D7705 ordinary create keeps ${JSON.stringify(value)} absent rather than inventing a zero figure`, async () => {
  const f = fixture(); try {
    const response = await f.create('/api/projects', { ...intake, tam: value, sam: value });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.tam, null); assert.equal(response.body.sam, null);
    assert.deepEqual(response.body.market_figures, { recorded: [] });
    assert.deepEqual(f.rows(response.body.id), []);
  } finally { f.db.close(); }
});
for (const value of ['0', '100']) test(`D7705 Eadwyn SOM ${value} writes the figure and actor history together`, async () => {
  const f = fixture(); try {
    const result = await f.answer(value);
    assert.equal(result.saved_to?.column, 'som', JSON.stringify(result));
    assert.equal(f.db.prepare('SELECT som FROM projects WHERE id=1').get()?.som, Number(value));
    assert.deepEqual(f.rows(1), [{ figure: 'som', value: Number(value), method: 'typed', source_title: null, source_url: null, market_source_id: null, set_by: 1, sizing_version_id: null }]);
  } finally { f.db.close(); }
});
test('D7705 an unrecorded SAM imposes no invented SOM ceiling', async () => {
  const f = fixture(); try {
    f.db.exec('UPDATE projects SET sam=NULL WHERE id=1');
    const result = await f.answer('500');
    assert.equal(result.saved_to?.column, 'som', JSON.stringify(result));
    assert.equal(f.db.prepare('SELECT som FROM projects WHERE id=1').get()?.som, 500);
    assert.equal(f.rows(1)[0]?.value, 500);
  } finally { f.db.close(); }
});
for (const value of ['-1', '101', 'not a number']) test(`D7705 refused SOM ${value} remains a chat note and writes no figure history`, async () => {
  const f = fixture(); try {
    const result = await f.answer(value);
    assert.equal(result.saved_to?.column, 'advisor_extras_json', JSON.stringify(result));
    assert.equal(f.db.prepare('SELECT som FROM projects WHERE id=1').get()?.som, 20);
    assert.deepEqual(f.rows(1), []);
  } finally { f.db.close(); }
});
test('D7705 Eadwyn history failure rolls back SOM while preserving the chat-note fallback', async () => {
  const f = fixture(); try {
    f.db.exec("CREATE TRIGGER refuse_history BEFORE INSERT ON market_figures BEGIN SELECT RAISE(ABORT,'synthetic history fault'); END");
    const result = await f.answer('50');
    assert.equal(result.saved_to?.column, 'advisor_extras_json', JSON.stringify(result));
    assert.equal(f.db.prepare('SELECT som FROM projects WHERE id=1').get()?.som, 20);
    assert.deepEqual(f.rows(1), []);
  } finally { f.db.close(); }
});

/** Inventory SQL literals plus their local construction dependencies (baseFields, colMap and pushed sets).
 * This is a source guard, not a general SQL/JavaScript proof: generated SQL must remain in reviewed writers.
 */
function marketWrites(source: string) {
  if (!/\b(?:UPDATE\s+projects\s+SET|INSERT\s+INTO\s+projects\s*\()/i.test(source)) return [];
  const code = stripTypeScriptTypes(source, { mode: 'transform' });
  const file = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const children = (node: any): any[] => Object.values(node).flatMap(value =>
    Array.isArray(value) ? value.filter(v => v && typeof v.type === 'string') :
      value && typeof value === 'object' && 'type' in value ? [value] : []);
  const visit = (node: any, fn: (node: any) => void) => { fn(node); for (const child of children(node)) visit(child, fn); };
  const declarations = new Map<string, any[]>();
  const add = (name: string, node: any) => declarations.set(name, [...declarations.get(name) ?? [], node]);
  const names = (node: any): string[] => node?.type === 'Identifier' ? [node.name] :
    node?.type === 'ArrayPattern' ? node.elements.flatMap(names) : [];
  visit(file, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) add(node.id.name, node.init);
    if (node.type === 'ForOfStatement' && node.left.type === 'VariableDeclaration') for (const d of node.left.declarations) {
      for (const name of names(d.id)) add(name, node.right);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'push' && node.callee.object.type === 'Identifier') {
      for (const arg of node.arguments) add(node.callee.object.name, arg);
    }
  });
  function expand(node: any, seen = new Set<string>()): string {
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'Identifier') {
      if (seen.has(node.name)) return '';
      const next = new Set([...seen, node.name]);
      return (declarations.get(node.name) ?? []).map(n => expand(n, next)).join(' ');
    }
    if (node.type === 'MemberExpression') return expand(node.object, seen);
    return children(node).map(child => expand(child, seen)).join(' ');
  }
  const found: string[] = [];
  visit(file, node => {
    if (node.type !== 'Literal' && node.type !== 'TemplateLiteral') return;
    const text = code.slice(node.start, node.end);
    const columns = /\bUPDATE\s+projects\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(text)?.[1]
      ?? /\bINSERT\s+INTO\s+projects\s*\(([\s\S]*?)\)\s*VALUES/i.exec(text)?.[1];
    if (columns == null) return;
    let resolved = columns;
    if (node.type === 'TemplateLiteral') for (const expression of node.expressions) {
      if (columns.includes('${' + code.slice(expression.start, expression.end) + '}')) resolved += ' ' + expand(expression);
    }
    if (/\b(?:tam|sam|som)\b/.test(resolved)) found.push(resolved);
  });
  return found;
}
const writerFiles = new Set(['routes/projects.ts', 'routes/market_sizing.ts', 'services/advisor/writeRouter.ts']);
function violations(files: Map<string, string>) {
  return [...files].filter(([name, source]) => marketWrites(source).length > 0 &&
    (!writerFiles.has(name) || !/\b(?:recordMarketFigures|marketFigureStatement)\s*\(/.test(source))).map(([name]) => name).sort();
}
test('D7705 all Worker market writers are history-enabled reviewed writers, including dynamic column lists', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url)), files = new Map<string, string>();
  function walk(dir: string) { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name); if (entry.isDirectory()) walk(path);
    else if (/\.[cm]?[jt]s$/.test(entry.name)) files.set(relative(root, path), readFileSync(path, 'utf8'));
  } }
  walk(root);
  assert.deepEqual(violations(files), []);
  for (const file of writerFiles) assert.ok(marketWrites(files.get(file)!).length, file);
  const project = files.get('routes/projects.ts')!;
  assert.ok(marketWrites(project).some(sql => sql.includes('updates.join')));
  assert.ok(marketWrites(files.get('services/advisor/writeRouter.ts')!).some(sql => sql.includes('${column}')));
});
test('D7705 the guard rejects planted literal, runtime-list and colMap writers without history', () => {
  for (const source of [
    "db.prepare('UPDATE projects SET tam = ? WHERE id = ?')",
    "db.prepare('INSERT INTO projects (name, sam) VALUES (?, ?)')",
    "const baseFields=['name','som']; const fields=[...baseFields]; const updates=[]; for(const f of fields) updates.push(`${f} = ?`); db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id=?`)",
    "const colMap={answer:'som'}; const column=colMap[id]; db.prepare(`UPDATE projects SET ${column} = ? WHERE id=?`)",
  ]) assert.deepEqual(violations(new Map([['services/planted.ts', source]])), ['services/planted.ts']);
  assert.deepEqual(violations(new Map([['routes/projects.ts', "db.prepare('UPDATE projects SET som = ? WHERE id=?')"]])), ['routes/projects.ts']);
  assert.deepEqual(violations(new Map([['services/plain.ts', "db.prepare('UPDATE projects SET name = ? WHERE id=?')"]])), []);
});
