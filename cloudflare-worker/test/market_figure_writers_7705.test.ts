/** D7705 (#7705): real SQLite create/answer history, rollback and a source-level market-writer inventory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import ts from 'typescript';
import projects from '../src/routes/projects.ts';
import { routeAnswer } from '../src/services/advisor/writeRouter.ts';
import { REQUIRED_OFFICIAL_INPUTS } from '../src/services/scoreIntegrity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
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
for (const value of ['0', '100']) test(`D7705 Eadwyn SOM ${value} writes the figure and actor history together`, async () => {
  const f = fixture(); try {
    const result = await f.answer(value);
    assert.equal(result.saved_to?.column, 'som', JSON.stringify(result));
    assert.equal(f.db.prepare('SELECT som FROM projects WHERE id=1').get()?.som, Number(value));
    assert.deepEqual(f.rows(1), [{ figure: 'som', value: Number(value), method: 'typed', source_title: null, source_url: null, market_source_id: null, set_by: 1, sizing_version_id: null }]);
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
  const file = ts.createSourceFile('writer.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.Node[]>();
  const add = (name: string, node: ts.Node) => declarations.set(name, [...declarations.get(name) ?? [], node]);
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) add(node.name.text, node.initializer);
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) for (const d of node.initializer.declarations) {
      if (ts.isIdentifier(d.name)) add(d.name.text, node.expression);
      else for (const part of d.name.elements) if (ts.isBindingElement(part) && ts.isIdentifier(part.name)) add(part.name.text, node.expression);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'push' && ts.isIdentifier(node.expression.expression)) {
      for (const arg of node.arguments) add(node.expression.expression.text, arg);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  function expand(node: ts.Node, seen = new Set<string>()): string {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return '';
      const next = new Set([...seen, node.text]);
      return (declarations.get(node.text) ?? []).map(n => expand(n, next)).join(' ');
    }
    if (ts.isPropertyAccessExpression(node)) return expand(node.expression, seen);
    let text = ''; ts.forEachChild(node, child => { text += ' ' + expand(child, seen); }); return text;
  }
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const text = node.getText(file);
      const columns = /\bUPDATE\s+projects\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(text)?.[1]
        ?? /\bINSERT\s+INTO\s+projects\s*\(([\s\S]*?)\)\s*VALUES/i.exec(text)?.[1];
      if (columns != null) {
        let resolved = columns;
        if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) {
          if (columns.includes('${' + span.expression.getText(file) + '}')) resolved += ' ' + expand(span.expression);
        }
        if (/\b(?:tam|sam|som)\b/.test(resolved)) found.push(resolved);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file); return found;
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
