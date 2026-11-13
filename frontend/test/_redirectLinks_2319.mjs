// D2319 (#2319), #4415: navigation expressions, excluding comments, API requests and old-path comparisons.
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { stripTypeScriptTypes } from 'node:module';
import { transformSync } from 'esbuild';
import { isRetiredRedirect } from './_retiredRedirects_2319.mjs';
const parser = Parser.extend(jsx());
const fields = new Set(['to', 'href', 'page_target', 'path', 'route', 'link', 'sourceTo', 'backTo', 'redirectTo', 'returnUrl', 'success_url', 'cancel_url', 'url', 'page_url', 'open_url', 'pathname']);
const workerFields = new Set([...fields].filter((s) => s !== 'path'));
const name = (n) => n?.name ?? n?.value;

export function retiredNavigationLinks(source, fileName = 'fixture.jsx', { worker = false } = {}) {
  if (fileName.endsWith('.json')) source = `const data = ${source};`;
  if (fileName.endsWith('.tsx')) source = transformSync(source, { loader: 'tsx', jsx: 'preserve' }).code;
  else if (fileName.endsWith('.ts')) {
    try { source = stripTypeScriptTypes(source); } catch { source = stripTypeScriptTypes(source, { mode: 'transform' }); }
  }
  const tree = parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  // Keep each function/block's declarations separate: many handlers call their
  // destination `route` or `topRoute`, and one must not resolve through another.
  const scopes = new WeakMap();
  function bind(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Program' || node.type === 'BlockStatement' || /Function/.test(node.type)) scope = { parent: scope, bindings: new Map() };
    scopes.set(node, scope);
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') scope.bindings.set(node.id.name, node.init);
    if (/Function/.test(node.type)) for (const param of node.params ?? []) if (param.type === 'Identifier') scope.bindings.set(param.name, null);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach((child) => bind(child, scope)); else if (value?.type) bind(value, scope);
    }
  }
  bind(tree, null);
  function declaration(node) {
    let scope = scopes.get(node);
    while (scope && !scope.bindings.has(node.name)) scope = scope.parent;
    return scope?.bindings.get(node.name);
  }
  function values(n, seen = new Set()) {
    if (!n) return [];
    if (n.type === 'Literal') return typeof n.value === 'string' ? [n.value] : [];
    if (n.type === 'JSXExpressionContainer' || n.type === 'ChainExpression') return values(n.expression, seen);
    if (n.type === 'Identifier') {
      const value = declaration(n);
      if (value && !seen.has(value)) return values(value, new Set([...seen, value]));
    }
    if (n.type === 'LogicalExpression') return [...values(n.left, seen), ...values(n.right, seen)];
    if (n.type === 'ConditionalExpression') return [...values(n.consequent, seen), ...values(n.alternate, seen)];
    if (n.type === 'TemplateLiteral') {
      let out = [n.quasis[0].value.cooked];
      for (let i = 0; i < n.expressions.length; i++) {
        const options = values(n.expressions[i], seen);
        out = out.flatMap((prefix) => (options.length ? options : ['__dynamic__']).map((v) => prefix + v + n.quasis[i + 1].value.cooked)).slice(0, 64);
      }
      return out;
    }
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      const right = values(n.right, seen);
      return values(n.left, seen).flatMap((a) => (right.length ? right : ['__dynamic__']).map((b) => a + b)).slice(0, 64);
    }
    if (n.type === 'ObjectExpression') return n.properties.flatMap((p) => values(p.value, seen));
    if (n.type === 'MemberExpression') {
      const object = n.object.type === 'Identifier' ? declaration(n.object) : n.object;
      if (object?.type === 'ObjectExpression') {
        const wanted = n.computed ? values(n.property, seen)[0] : name(n.property);
        return object.properties.flatMap((p) => !wanted || name(p.key) === wanted ? values(p.value, seen) : []);
      }
    }
    // Query/scope builders receive their destination as the first argument.
    if (n.type === 'CallExpression') return values(n.arguments[0], seen);
    return [];
  }
  const out = [], keys = worker ? workerFields : fields;
  function descend(node, visit) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach((child) => descend(child, visit)); else if (value?.type) descend(value, visit);
    }
  }
  // A local factory may put its second/third argument into a link field.
  const factories = new Map();
  descend(tree, (node) => {
    const fn = node.type === 'FunctionDeclaration' ? node : node.type === 'VariableDeclarator' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type) ? node.init : null;
    const id = node.type === 'FunctionDeclaration' ? name(node.id) : node.type === 'VariableDeclarator' ? name(node.id) : null;
    if (!fn || !id) return;
    const positions = new Set();
    descend(fn.body, (entry) => {
      const expression = entry.type === 'Property' && workerFields.has(name(entry.key)) && !['path', 'route'].includes(name(entry.key)) ? entry.value
        : entry.type === 'JSXAttribute' && keys.has(name(entry.name)) ? entry.value : null;
      if (expression) descend(expression, (ref) => {
        if (ref.type === 'Identifier') fn.params.forEach((param, i) => {
          if (name(param.type === 'AssignmentPattern' ? param.left : param) === ref.name) positions.add(i);
        });
      });
    });
    if (positions.size) factories.set(id, positions);
  });
  function record(expression, node) {
    for (let path of values(expression)) {
      if (/^https?:\/\//.test(path)) {
        try { const url = new URL(path); if (!['axal.vc', 'app.axal.vc'].includes(url.hostname)) continue; path = url.pathname + url.search + url.hash; } catch { continue; }
      }
      if (path.startsWith('/') && !path.startsWith('//') && isRetiredRedirect(path)) out.push({ path, line: node.loc.start.line });
    }
  }
  function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXAttribute' && keys.has(name(node.name))) record(node.value, node);
    if (node.type === 'Property' && keys.has(name(node.key))) record(node.value, node);
    if (node.type === 'VariableDeclarator' && keys.has(name(node.id))) record(node.init, node);
    if (node.type === 'CallExpression') {
      const method = node.callee.type === 'Identifier' ? name(node.callee) : node.callee.type === 'MemberExpression' ? name(node.callee.property) : '';
      if (node.callee.type === 'Identifier') for (const i of factories.get(method) ?? []) record(node.arguments[i], node);
      const receiver = node.callee.type === 'MemberExpression' ? source.slice(node.callee.object.start, node.callee.object.end) : '';
      if (['navigate', 'navigateTo', 'redirect', 'redirectTo'].includes(method)
        || (['open', 'push', 'replace', 'assign'].includes(method) && /^(?:window(?:\.location)?|location|history|router)$/.test(receiver))) record(node.arguments[0], node);
    }
    if (!/(?:^|\/)lib\/api(?:\.js|\/)/.test(fileName) && node.type === 'ReturnStatement') record(node.argument, node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach(walk); else if (value?.type) walk(value);
    }
  }
  walk(tree);
  return [...new Map(out.map((r) => [`${r.line}:${r.path}`, r])).values()];
}

// Route-map fragments retain historical addresses only when explicitly retired.
// Canvas column 5 describes Worker endpoints, which have a separate /api mount.
export function retiredRouteMapLinks(source, fileName = '') {
  const hits = [];
  for (const [index, line] of source.split('\n').entries()) {
    const cells = fileName.includes('/canvases/') ? line.split(/(?<!\\)\|/).filter((_, i) => i !== 5) : [line];
    for (const cell of cells) for (const match of cell.matchAll(/`(\/[^`\s]+)`/g)) {
      if (isRetiredRedirect(match[1]) && !cell.slice(match.index + match[0].length).startsWith(' (retired D2319)')) hits.push({ path: match[1], line: index + 1 });
    }
  }
  return hits;
}
