/** D7810 (#7810): every physical directory insert explicitly supplies both source fields, including constant-built SQL.
 *
 * From cloudflare-worker/test/README.md (moved by #6472):
 * `research_company_insert_guard_7810.test.ts` verifies the D7810 contract against synthetic
 * inputs and the canonical migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse } = require('acorn');
const { transformSync } = require('esbuild');
const MESSAGE =
  'Every writer of research_company_directory names both source fields: source_name and source_license';
function walk(
  node: any,
  visit: (n: any, parent: any) => void,
  parent: any = null,
) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value))
      for (const child of value) walk(child, visit, node);
    else if (value && typeof value === 'object') walk(value, visit, node);
  }
}
export function checkInserts(files: Record<string, string>) {
  const errors: string[] = [];
  for (const [path, source] of Object.entries(files)) {
    const sqls: string[] = [];
    if (/\.(?:sql|py|sh|bash)$/.test(path))
      sqls.push(source.replace(/--[^\n]*|^\s*#[^\n]*|\/\*[\s\S]*?\*\//gm, ''));
    else {
      const ast = parse(
        transformSync(source, {
          sourcefile: path,
          loader: path.endsWith('x') ? 'tsx' : 'ts',
          legalComments: 'none',
        }).code,
        { ecmaVersion: 'latest', sourceType: 'module' },
      );
      const constants = new Map<string, any>();
      walk(ast, (n) => {
        if (n.type === 'VariableDeclaration' && n.kind === 'const')
          for (const d of n.declarations)
            if (d.id.type === 'Identifier')
              constants.set(
                d.id.name,
                constants.has(d.id.name) ? null : d.init,
              );
      });
      function value(n: any, seen = new Set<string>()): any {
        if (!n) return '?';
        if (n.type === 'Literal') return n.value;
        if (
          n.type === 'Identifier' &&
          constants.has(n.name) &&
          !seen.has(n.name)
        )
          return value(constants.get(n.name), new Set([...seen, n.name]));
        if (n.type === 'ArrayExpression')
          return n.elements.map((e: any) => value(e, seen));
        if (n.type === 'BinaryExpression' && n.operator === '+')
          return String(value(n.left, seen)) + String(value(n.right, seen));
        if (n.type === 'TemplateLiteral')
          return n.quasis
            .map(
              (q: any, i: number) =>
                q.value.cooked +
                (i < n.expressions.length
                  ? String(value(n.expressions[i], seen))
                  : ''),
            )
            .join('');
        if (
          n.type === 'CallExpression' &&
          n.callee.type === 'MemberExpression'
        ) {
          if (
            n.callee.object.name === 'Object' &&
            n.callee.property.name === 'freeze'
          )
            return value(n.arguments[0], seen);
          if (n.callee.property.name === 'join') {
            const array = value(n.callee.object, seen);
            if (Array.isArray(array))
              return array.join(
                n.arguments.length ? value(n.arguments[0], seen) : ',',
              );
          }
        }
        return '?';
      }
      walk(ast, (n, parent) => {
        if (
          !['Literal', 'TemplateLiteral', 'BinaryExpression'].includes(n.type)
        )
          return;
        if (
          parent &&
          ((parent.type === 'BinaryExpression' && parent.operator === '+') ||
            parent.type === 'TemplateLiteral')
        )
          return;
        const text = value(n);
        if (typeof text === 'string' && /\bINSERT\b/i.test(text))
          sqls.push(text);
      });
    }
    for (const sql of sqls)
      for (const match of sql.matchAll(
        /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`\[]?research_company_directory["`\]]?\s*(\([^)]*\))?/gi,
      )) {
        const cols =
          (match[1] || '')
            .toLowerCase()
            .replace(/["`\[\]]/g, '')
            .match(/[a-z_]+/g) || [];
        if (!cols.includes('source_name') || !cols.includes('source_license'))
          errors.push(`${path}: ${MESSAGE}`);
      }
  }
  return [...new Set(errors)];
}
function files(dir: string): Record<string, string> {
  return Object.assign(
    {},
    ...readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          ![
            'node_modules',
            'test',
            'tests',
            'fixtures',
            '__fixtures__',
          ].includes(e.name),
      )
      .map((e) => {
        const path = resolve(dir, e.name);
        return e.isDirectory()
          ? files(path)
          : /\.(?:[cm]?[jt]sx?|sql|py|sh|bash)$/.test(e.name) &&
              !/\.d\.[cm]?ts$/.test(e.name)
            ? { [relative(process.cwd(), path)]: readFileSync(path, 'utf8') }
            : {};
      }),
  );
}
test('rejects literal, template and constant-built inserts without both source columns', () => {
  for (const source of [
    "const q='INSERT INTO research_company_directory(uid) VALUES(?)'",
    'const cols=["uid","source_name"]; const q=`INSERT INTO research_company_directory (${cols.join(",")}) VALUES (?)`;',
    "const q='INSERT INTO research_company_directory '+ '(uid,source_license) VALUES(?)';",
  ]) {
    assert.match(
      checkInserts({ 'scripts/new.mjs': source })[0],
      /Every writer.*source_name and source_license/,
    );
  }
  assert.deepEqual(
    checkInserts({
      'scripts/new.mjs':
        'const cols=Object.freeze(["uid","source_name","source_license"]); const q=`INSERT INTO research_company_directory (${cols.join(",")}) VALUES (?)`;',
    }),
    [],
  );
  assert.match(
    checkInserts({
      'scripts/writer.py':
        'sql = "INSERT INTO research_company_directory(uid) VALUES (?)"',
    })[0],
    /Every writer/,
  );
  assert.deepEqual(
    checkInserts({
      'migration.sql':
        "-- INSERT INTO research_company_directory(uid)\nINSERT INTO research_company_directory(uid,source_name,source_license) VALUES('a','b','c');",
    }),
    [],
  );
});
test('all committed scripts, Worker sources and migrations name their source fields', () => {
  const root = resolve(import.meta.dirname, '../..');
  assert.deepEqual(
    checkInserts(
      Object.assign(
        {},
        files(resolve(root, 'scripts')),
        files(resolve(root, 'cloudflare-worker/src')),
        files(resolve(root, 'cloudflare-worker/sql/migrations')),
      ),
    ),
    [],
  );
});
