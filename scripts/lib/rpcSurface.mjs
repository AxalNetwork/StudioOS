/**
 * The RPC surface between HQ and a branch, read off the source (D207, D209).
 *
 * WHAT THIS DECIDES. Which methods each entrypoint class DECLARES, what each
 * takes, and which of them anything in the Worker actually CALLS across the
 * tier boundary. Two readers need all three:
 *
 *   - `rpcEntrypoints.test.mjs` (D207) holds the generator's binding names
 *     against the class that has the methods, and every call against the
 *     class it goes to;
 *   - `cloudflare-worker/test/topology_d209.test.ts` holds HQ's topology page
 *     and the branch's "This deployment" zone to the same facts, so the page
 *     cannot list a method the class lacks or call one "unused" that
 *     something calls.
 *
 * It lived inside the D207 test until the second reader arrived; a second copy
 * of a harvest is how two readers come to disagree about what was harvested.
 *
 * WHY TEXT AND NOT AN IMPORT. `cloudflare-worker/src/rpc/index.ts` imports
 * `cloudflare:workers`, which exists only inside the Workers runtime, so no
 * `node --test` process can load it. Its own header says so. The classes are
 * read as text instead — and the harvest carries a floor of known call sites
 * (in the D207 test) so that a regex that stops matching fails rather than
 * reporting "every call is declared" over nothing.
 *
 * The one filesystem read here, `workerSources`, reads the thing being
 * described: the Worker's source tree.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Who calls each class, in the words its own doc line uses. */
export const ENTRYPOINT_ROLE = {
  branchCallsHq: 'called by a branch over its `HQ` binding',
  hqCallsBranch: 'called by HQ over `BRANCH_<CODE>`',
};

const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const skipSpace = (src, j) => { let k = j; while (k < src.length && /\s/.test(src[k])) k += 1; return k; };

/** Past a `<…>` type argument list; -1 when what follows `<` is not one. */
function skipGeneric(src, j) {
  let depth = 0;
  for (let k = j; k < src.length && k < j + 400; k += 1) {
    const c = src[k];
    if (c === '(' || c === ')') return -1;
    if (c === '<') depth += 1;
    else if (c === '>') { depth -= 1; if (depth === 0) return k + 1; }
  }
  return -1;
}

/**
 * The top-level argument texts of the call whose `(` is at `open`.
 *
 * `angles` is for a PARAMETER list, where `Record<string, unknown>` carries a
 * comma inside a type argument; a call's arguments leave it off, because there
 * `<` is a comparison and `=>` closes nothing. In a parameter list the `>` of
 * an arrow type (`=>`) is not a closing angle either.
 */
function splitArgs(src, open, { angles = false } = {}) {
  const args = [];
  let depth = 0; let quote = null; let cur = '';
  for (let k = open + 1; k < src.length && k < open + 4000; k += 1) {
    const c = src[k];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += src[k + 1] ?? ''; k += 1; } else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === ')' && depth === 0) { if (cur.trim()) args.push(cur.trim()); return args; }
    if ('([{'.includes(c) || (angles && c === '<')) depth += 1;
    else if (')]}'.includes(c) || (angles && c === '>' && src[k - 1] !== '=')) depth -= 1;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return null;
}

/**
 * Each `export class X extends WorkerEntrypoint<Env>` with the single-line doc
 * above it, the methods declared at class-body indent in declaration order,
 * and each method's parameter names. The region of a class runs to the next
 * class head, so a method is attributed to the class it sits in without having
 * to balance braces through comments that quote code.
 */
export function entrypointClasses(src) {
  const heads = [...src.matchAll(/\/\*\* ([^\n]*?) \*\/\nexport class ([A-Za-z_$][\w$]*) extends WorkerEntrypoint<Env> \{/g)];
  return heads.map((h, i) => {
    const start = h.index + h[0].length;
    const body = src.slice(start, i + 1 < heads.length ? heads[i + 1].index : src.length);
    const params = new Map();
    for (const m of body.matchAll(/^ {2}([A-Za-z_$][\w$]*)\(/gm)) {
      const args = splitArgs(body, m.index + m[0].length - 1, { angles: true }) || [];
      params.set(m[1], args.map((a) => (/^([A-Za-z_$][\w$]*)/.exec(a) || [])[1]).filter(Boolean));
    }
    return { name: h[2], doc: h[1], methods: new Set(params.keys()), params };
  });
}

/** The classes whose doc line names `role` — the caller asserts there is one. */
export function classesForRole(src, role) {
  return entrypointClasses(src).filter((c) => c.doc.includes(ENTRYPOINT_ROLE[role]));
}

/** Every `.ts` file under the Worker's source, as `{file, src}`, sorted. */
export function workerSources(srcDir) {
  const walk = (dir) => {
    const out = [];
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) out.push(...walk(p));
      else if (d.name.endsWith('.ts')) out.push(p);
    }
    return out;
  };
  return walk(srcDir).sort().map((p) => ({
    file: relative(srcDir, p).split(sep).join('/'),
    src: readFileSync(p, 'utf8'),
  }));
}

/**
 * Every call to the plain function `name` — `name(…)` or `name<T>(…)`, its
 * arguments on one line or several — with its arguments. The definition is
 * not a call, and neither is a mention in an import list or a comment, since
 * neither is followed by `(`.
 */
function callsTo(src, name) {
  const out = [];
  for (let from = 0; ;) {
    const i = src.indexOf(name, from);
    if (i < 0) return out;
    from = i + name.length;
    if (/[\w$.]/.test(src[i - 1] || '') || /[\w$]/.test(src[from] || '')) continue;
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, i - 20), i))) continue;
    let j = skipSpace(src, from);
    if (src[j] === '<') {
      j = skipGeneric(src, j);
      if (j < 0) continue;
      j = skipSpace(src, j);
    }
    if (src[j] !== '(') continue;
    const args = splitArgs(src, j);
    if (args) out.push({ line: lineOf(src, i), args });
  }
}

/** A method named by a string literal, or null when the name is computed. */
const literalMethod = (arg) => (/^'([A-Za-z_$][\w$]*)'$/.exec(arg || '') || [])[1] || null;

/**
 * Every method HQ calls on a branch. Three call shapes reach a branch:
 *   · `fanOut<T>(env, '<method>', args?)` — every branch at once;
 *   · `branchRead<T>(env, code, '<method>', args?)` — one branch, by code;
 *   · `<binding>.stub.<method>(…)` and `(<binding>.stub as any).<method>(…)`
 *     — one branch, after `branchBindings(env).find(…)`.
 * A call whose method is computed cannot be checked, so it is reported in
 * `computed` and the callers fail until the call names its method.
 */
export function hqToBranchCalls(files) {
  const calls = []; const computed = [];
  for (const { file, src } of files) {
    for (const [shape, at] of [['fanOut', 1], ['branchRead', 2]]) {
      for (const c of callsTo(src, shape)) {
        const method = literalMethod(c.args[at]);
        if (method) calls.push({ shape, file, line: c.line, method });
        else computed.push(`${file}:${c.line} ${shape}(… ${c.args[at]} …)`);
      }
    }
    for (const m of src.matchAll(/\.stub\b(?:\s+as\s+[A-Za-z_$][\w$]*\s*\))?\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      calls.push({ shape: 'stub', file, line: lineOf(src, m.index), method: m[1] });
    }
  }
  return { calls, computed };
}

/**
 * Every method a branch calls on HQ. The binding is read once into a local
 * (`const hq = (c.env as {…}).HQ;`) and called through it, so a pattern that
 * looks for `env.HQ.<method>(` finds nothing and passes vacuously. The alias
 * is taken from the assignment, then every `<alias>.<method>(` in that file
 * is a call; a direct `.HQ.<method>(` counts too.
 */
export function branchToHqCalls(files) {
  const calls = [];
  for (const { file, src } of files) {
    for (const m of src.matchAll(/\.HQ\??\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      calls.push({ shape: 'direct', file, line: lineOf(src, m.index), method: m[1] });
    }
    const aliases = new Set([...src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*?\.HQ\s*;/g)].map((a) => a[1]));
    if (!aliases.size) continue;
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\??\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (aliases.has(m[1])) calls.push({ shape: 'alias', file, line: lineOf(src, m.index), method: m[2] });
    }
  }
  return calls;
}
