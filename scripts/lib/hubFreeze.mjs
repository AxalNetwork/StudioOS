/**
 * The hub freeze (D5615, #5615): five files that still collect entries for the
 * whole product take no new ones.
 *
 * WHY. In the seven days to 2026-11-11, `frontend/src/lib/api.js` changed in 29
 * commits, `CycleRoute.jsx` in 26, `routes/advisors.ts` in 26,
 * `cloudflare-worker/src/index.ts` in 17 and `frontend/src/App.jsx` in 13.
 * #4105 gave a new router, a new API module and a new route area a home of
 * their own, but nothing failed a PR that added to the old files anyway, so
 * they kept growing and kept colliding. `documentation/architecture/HUBS.md`
 * says, for each hub, what still lives there and where a new entry goes.
 *
 * THE RULE. `scripts/hub-freeze.json` holds, per hub, the sorted names found
 * in it on `main` when the freeze landed. Every name found in the hub now must
 * be on its list. The list is a SET, not a count: a name that leaves the hub
 * stays listed harmlessly, so moving entries out (the follow-up parts) never
 * edits the list, and nothing can be "traded" — a removal does not make room
 * for an addition.
 *
 * THE NAMES, per hub:
 *   - `frontend/src/lib/api.js`: every export (`export <name>`, `export * from
 *     <spec>`) and every key of an exported object literal (`api.<key>`,
 *     `dd.<key>`, …), parsed with acorn;
 *   - `frontend/src/App.jsx` and `frontend/src/pages/cycles/CycleRoute.jsx`:
 *     every import specifier, static or dynamic (`lazy(() => import(…))`,
 *     `lazyStep(() => import(…))`), parsed with acorn-jsx;
 *   - `cloudflare-worker/src/index.ts`: every static import or re-export
 *     (`import <spec>`) and every registration on its Hono app, `ROUTE <path>
 *     <router>`, `USE <path> <middleware>`, `GET <path>`, …; dynamic imports
 *     (the cron jobs `scheduled()` loads) stay unfrozen, because cron has no
 *     other home yet;
 *   - `cloudflare-worker/src/routes/advisors.ts`: every registration on its
 *     Hono router, method plus path (`GET /advisors/me`, `ROUTE / <router>`).
 * The two TypeScript files are read with a small lexer (comments, strings,
 * template literals and regex literals), because TypeScript 7's native
 * compiler has no JS API and acorn does not read types.
 *
 * It runs from `frontend/test/hub_freeze_5615.test.mjs`, under `npm run
 * test:frontend`, which names every unlisted entry and its `HUBS.md` section.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

export const LIST_FILE = 'scripts/hub-freeze.json';
export const HUBS_DOC = 'documentation/architecture/HUBS.md';

/** Each hub: its file, its `HUBS.md` section heading, and how its names are read. */
export const HUBS = [
  { file: 'frontend/src/lib/api.js', kind: 'apiModule' },
  { file: 'frontend/src/App.jsx', kind: 'imports' },
  { file: 'frontend/src/pages/cycles/CycleRoute.jsx', kind: 'imports' },
  { file: 'cloudflare-worker/src/index.ts', kind: 'worker' },
  { file: 'cloudflare-worker/src/routes/advisors.ts', kind: 'router' },
].map((h) => ({ ...h, section: `\`${h.file}\`` }));

const JsxParser = Parser.extend(jsx());
const parse = (src) => JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });

/** Every node under `node`, depth first. */
function* walk(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) for (const x of v) yield* walk(x);
    else if (v && typeof v === 'object' && typeof v.type === 'string') yield* walk(v);
  }
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** `api.js`: its exports and the keys of each exported object literal. */
export function apiModuleNames(src) {
  const names = new Set();
  const text = (n) => squash(src.slice(n.start, n.end));
  for (const node of parse(src).body) {
    if (node.type === 'ExportAllDeclaration') {
      names.add(`export * from ${node.source.value}`);
    } else if (node.type === 'ExportDefaultDeclaration') {
      names.add('export default');
    } else if (node.type === 'ExportNamedDeclaration') {
      for (const s of node.specifiers || []) names.add(`export ${s.exported.name ?? s.exported.value}`);
      const d = node.declaration;
      if (!d) continue;
      if (d.type === 'VariableDeclaration') {
        for (const v of d.declarations) {
          if (v.id.type !== 'Identifier') { names.add(`export ${text(v.id)}`); continue; }
          names.add(`export ${v.id.name}`);
          if (v.init?.type !== 'ObjectExpression') continue;
          for (const p of v.init.properties) {
            if (p.type === 'SpreadElement') names.add(`${v.id.name}....${text(p.argument)}`);
            else if (p.computed) names.add(`${v.id.name}.[${text(p.key)}]`);
            else names.add(`${v.id.name}.${p.key.type === 'Identifier' ? p.key.name : String(p.key.value)}`);
          }
        }
      } else if (d.id) {
        names.add(`export ${d.id.name}`);
      }
    }
  }
  return names;
}

/** `App.jsx`, `CycleRoute.jsx`: every module specifier imported, statically or dynamically. */
export function importSpecifiers(src) {
  const names = new Set();
  for (const node of walk(parse(src))) {
    const source = (node.type === 'ImportDeclaration' || node.type === 'ImportExpression'
      || ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source))
      ? node.source : null;
    if (!source) continue;
    names.add(source.type === 'Literal' ? String(source.value) : squash(src.slice(source.start, source.end)));
  }
  return names;
}

/**
 * The source twice, at the same offsets: `noComments` with every comment
 * blanked (newlines kept), and `code` with string, template and regex bodies
 * blanked as well, delimiters kept. A match is found in `code`, so text inside
 * a string or a comment is never a registration or an import, and its
 * arguments are read back out of `noComments`.
 */
export function maskSource(src) {
  const noc = src.split('');
  const code = src.split('');
  const blank = (arr, from, to) => { for (let k = from; k < to; k += 1) if (arr[k] !== '\n') arr[k] = ' '; };
  const n = src.length;
  const braces = [];
  let depth = 0;
  let prev;
  let i = 0;
  const templateBody = () => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { blank(code, i, i + 2); i += 2; continue; }
      if (c === '`') { i += 1; prev = '`'; return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; braces.push(depth); depth += 1; prev = '{'; return; }
      blank(code, i, i + 1);
      i += 1;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      blank(noc, i, stop); blank(code, i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close < 0 ? n : close + 2;
      blank(noc, i, stop); blank(code, i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && !(prev !== undefined && /[\w$)\]]/.test(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (inClass) { if (d === ']') inClass = false; } else if (d === '[') inClass = true; else if (d === '/') break;
        j += 1;
      }
      if (src[j] === '/') { blank(code, i + 1, j); i = j + 1; prev = '/'; continue; }
      i += 1; prev = '/';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j += 1; j += 1; }
      blank(code, i + 1, Math.min(j, n));
      i = Math.min(j + 1, n); prev = c;
      continue;
    }
    if (c === '`') { i += 1; templateBody(); continue; }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (braces.length && braces[braces.length - 1] === depth) { braces.pop(); i += 1; templateBody(); continue; }
    }
    prev = c;
    i += 1;
  }
  return { noComments: noc.join(''), code: code.join('') };
}

/** The top-level arguments of the call whose `(` is at `open`, as text without comments. */
function callArgs({ noComments, code }, open) {
  const args = [];
  let depth = 0;
  let from = open + 1;
  for (let k = open; k < code.length; k += 1) {
    const c = code[k];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) { args.push(noComments.slice(from, k)); break; }
    } else if (c === ',' && depth === 1) { args.push(noComments.slice(from, k)); from = k + 1; }
  }
  return args.map(squash).filter((a, idx, all) => a || idx < all.length - 1);
}

/** A path argument read as its value when it is a plain string; otherwise its text. */
function pathOf(arg = '') {
  const m = /^(['"`])([^'"`$]*)\1$/.exec(arg);
  return m ? m[2] : arg;
}

/** A handler argument read as the name it is called by, or `(inline)` for a function written in place. */
function headOf(arg = '') {
  if (/^(async\b|function\b|\()/.test(arg)) return '(inline)';
  return /^[\w$.]+/.exec(arg)?.[0] ?? '(inline)';
}

const VERBS = new Set(['route', 'use', 'on', 'get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);

/** Every registration on a Hono instance the file creates (`const x = new Hono…`). */
export function registrations(src) {
  const masked = maskSource(src);
  const names = new Set();
  const routers = [...masked.code.matchAll(/\b(?:const|let)\s+([\w$]+)\s*=\s*new\s+Hono\b/g)].map((m) => m[1]);
  for (const r of routers) {
    const re = new RegExp(`(?<![\\w$.])${r.replace(/\$/g, '\\$')}\\s*\\.\\s*([a-z]+)\\s*\\(`, 'g');
    for (const m of masked.code.matchAll(re)) {
      const verb = m[1];
      if (!VERBS.has(verb)) continue;
      const args = callArgs(masked, m.index + m[0].length - 1);
      const method = verb.toUpperCase();
      if (verb === 'route' || verb === 'use') names.add(`${method} ${pathOf(args[0])} ${headOf(args[1])}`);
      else if (verb === 'on') names.add(`${method} ${args[0] ?? ''} ${pathOf(args[1])}`);
      else names.add(`${method} ${pathOf(args[0])}`);
    }
  }
  return names;
}

/** Every static import or re-export of a TypeScript file (`import <spec>`); `import(…)` is not one. */
export function staticImports(src) {
  const { code, noComments } = maskSource(src);
  const names = new Set();
  const re = /^[ \t]*(?:import(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{))[^;'"`]*?(['"])/gm;
  for (const m of code.matchAll(re)) {
    const q = m.index + m[0].length - 1;
    const close = noComments.indexOf(m[1], q + 1);
    const before = code.slice(m.index, q);
    // `export { a, b };` with no `from` is not an import.
    if (/^\s*export\b/.test(before) && !/\bfrom\s*$/.test(before)) continue;
    names.add(`import ${noComments.slice(q + 1, close)}`);
  }
  return names;
}

/** The names a hub holds now, as a Set. */
export function hubNames(hub, src) {
  switch (hub.kind) {
    case 'apiModule': return apiModuleNames(src);
    case 'imports': return importSpecifiers(src);
    case 'worker': return new Set([...staticImports(src), ...registrations(src)]);
    case 'router': return registrations(src);
    default: throw new Error(`hubFreeze: unknown hub kind ${hub.kind}`);
  }
}

/** The sorted list a hub's names would be written as. */
export const sortedNames = (names) => [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Everything wrong, as readable lines: a hub with no list, a list that is not
 * sorted and unique, a hub with no section in `HUBS.md`, and every name in a
 * hub that its list does not hold. `sources` is `{ [file]: text }`.
 */
export function freezeProblems(lists, sources, hubsDoc = '') {
  const problems = [];
  for (const hub of HUBS) {
    const list = lists?.[hub.file];
    if (!Array.isArray(list)) {
      problems.push(`${LIST_FILE} has no list for ${hub.file}.`);
      continue;
    }
    if (JSON.stringify(list) !== JSON.stringify(sortedNames(new Set(list)))) {
      problems.push(`${LIST_FILE}: the list for ${hub.file} is not sorted and unique.`);
    }
    if (!hubsDoc.includes(`\n## ${hub.section}`)) {
      problems.push(`${HUBS_DOC} has no section "## ${hub.section}".`);
    }
    const listed = new Set(list);
    for (const name of sortedNames(hubNames(hub, sources[hub.file]))) {
      if (!listed.has(name)) {
        problems.push(
          `${hub.file}: "${name}" is a new entry in a frozen hub (D5615). It goes where`
          + ` ${HUBS_DOC} § ${hub.section} says, not here.`,
        );
      }
    }
  }
  return problems;
}

/** The repository's own lists, sources and `HUBS.md`. */
export function readFreeze(root = process.cwd()) {
  const read = (p) => readFileSync(resolve(root, p), 'utf8');
  return {
    lists: JSON.parse(read(LIST_FILE)),
    sources: Object.fromEntries(HUBS.map((h) => [h.file, read(h.file)])),
    hubsDoc: read(HUBS_DOC),
  };
}

