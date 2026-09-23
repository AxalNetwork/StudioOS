/**
 * The two RPC entrypoints, checked against who actually calls them (D207).
 *
 * WHY THIS IS STRUCTURAL AND NOT A PINNED STRING. A branch's `HQ` binding
 * named `HqEntrypoint` — the class a BRANCH exports for HQ to call, which has
 * no `escalate` — and `branchConfig.test.mjs` pinned that wrong value, because
 * it pinned what the generator wrote rather than what the far side exports.
 * A pinned literal is how the defect survived, so this file pins nothing it
 * can derive: it reads `cloudflare-worker/src/rpc/index.ts` as text, takes
 * each entrypoint class's one-line doc (which says who calls it) and its
 * declared methods, harvests every call that crosses the tier boundary from
 * the worker source, and asserts:
 *
 *   1. the branch config's `HQ` binding names the class documented as "called
 *      by a branch over its `HQ` binding", and that class declares every
 *      method a branch calls through `HQ`;
 *   2. the link PR's `BRANCH_<CODE>` binding names the class documented as
 *      "called by HQ over `BRANCH_<CODE>`", and that class declares every
 *      method HQ calls on a branch;
 *   3. the harvest cannot pass empty: each call shape must still find the
 *      sites that exist today, named below, so a regex that stops matching
 *      fails here instead of reporting "every call is declared" over nothing;
 *   4. after a link PR adds HQ's line to a branch, every branch config still
 *      binds HQ and only HQ, and the guard in `check-branch-config.mjs` still
 *      passes — the half that keeps CI green on the first real provisioning.
 *
 * It asserts that each class DECLARES everything called through it, never that
 * everything declared is CALLED: four methods have no caller today
 * (`revenueSummary`, `licence`, `reportUsage`, `promoCeiling`), and that is a
 * separate finding, not a wiring defect.
 *
 * Run with:
 *   node --test scripts/lib/rpcEntrypoints.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';

import {
  BRANCH_CALLS_HQ, HQ_CALLS_BRANCH, renderBranchConfig, checkRendered, parseToml, validateBranch, hqIds,
} from './branchConfig.mjs';
import { addServiceBinding } from '../open-branch-link-pr.mjs';

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'cloudflare-worker/src');
const RPC = readFileSync(join(SRC, 'rpc/index.ts'), 'utf8');
const TOML = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
const EXAMPLE = JSON.parse(readFileSync(resolve(ROOT, 'infra/branches/_example.json'), 'utf8'));

const entryFor = (code, name) => ({
  ...structuredClone(EXAMPLE), code, hostname: `${code}.axal.vc`, name, status: 'provisioning',
});

// ── the classes, read off their own file ───────────────────────────────────

/** Who calls each class, in the words its own doc line uses. */
const ROLE = {
  branchCallsHq: 'called by a branch over its `HQ` binding',
  hqCallsBranch: 'called by HQ over `BRANCH_<CODE>`',
};

/**
 * Each `export class X extends WorkerEntrypoint<Env>` with the single-line doc
 * above it and the methods declared at class-body indent. The region of a
 * class runs to the next class head, so a method is attributed to the class
 * it sits in without having to balance braces through comments that quote
 * code.
 */
function entrypointClasses(src) {
  const heads = [...src.matchAll(/\/\*\* ([^\n]*?) \*\/\nexport class ([A-Za-z_$][\w$]*) extends WorkerEntrypoint<Env> \{/g)];
  return heads.map((h, i) => {
    const body = src.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : src.length);
    return {
      name: h[2],
      doc: h[1],
      methods: new Set([...body.matchAll(/^ {2}([A-Za-z_$][\w$]*)\(/gm)].map((m) => m[1])),
    };
  });
}

function classFor(role) {
  const found = entrypointClasses(RPC).filter((c) => c.doc.includes(ROLE[role]));
  assert.equal(found.length, 1, `exactly one entrypoint class must be documented as "${ROLE[role]}"`);
  return found[0];
}

// ── the worker source, and every call that crosses the tier boundary ───────

function tsFiles(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...tsFiles(p));
    else if (d.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = tsFiles(SRC).sort().map((p) => ({
  file: relative(SRC, p).split(sep).join('/'),
  src: readFileSync(p, 'utf8'),
}));

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

/** The top-level argument texts of the call whose `(` is at `open`. */
function splitArgs(src, open) {
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
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return null;
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
 * A call whose method is computed cannot be checked, so it is reported and
 * this file fails until the call names its method.
 */
function hqToBranchCalls() {
  const calls = []; const computed = [];
  for (const { file, src } of FILES) {
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
function branchToHqCalls() {
  const calls = [];
  for (const { file, src } of FILES) {
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

// ── the sites that exist today — the floor under every harvest ────────────
//
// Each is one call this file must still find. A harvest that stops matching a
// shape (a generic it no longer skips, a method written on the next line, a
// `c.env` where it expected `env`, a binding read through an alias) loses a
// site here and fails, rather than passing over fewer calls than exist.

const HQ_TO_BRANCH_FLOOR = [
  ['fanOut', 'services/branchBenchmarks.ts', 'overview'],
  ['fanOut', 'services/branchBenchmarks.ts', 'applyBenchmarks'],
  ['fanOut', 'routes/admin_hq.ts', 'overview'],
  ['fanOut', 'routes/admin_hq.ts', 'searchAccounts'],
  // The method on the line after the generic.
  ['fanOut', 'routes/admin_deployments.ts', 'health'],
  // The method on the next line, and `c.env` rather than `env`.
  ['fanOut', 'routes/admin_contracts.ts', 'publishTemplate'],
  ['branchRead', 'routes/admin_hq.ts', 'overview'],
  // The method on the line after `branchRead<BranchAccountSearch>(`.
  ['branchRead', 'routes/admin_hq.ts', 'searchAccounts'],
  ['stub', 'services/licencePush.ts', 'applyLicence'],
  ['stub', 'routes/admin_support_sessions.ts', 'openSupportSession'],
  ['stub', 'routes/admin_support_sessions.ts', 'moveAccountOut'],
  ['stub', 'routes/admin_support_sessions.ts', 'inviteAccount'],
  ['stub', 'routes/admin_statements.ts', 'applyPromoCeiling'],
  ['stub', 'routes/admin_escalations.ts', 'applyEscalationAnswer'],
];

const BRANCH_TO_HQ_FLOOR = [
  ['alias', 'routes/branch_escalations.ts', 'escalate'],
];

const assertFloor = (calls, floor) => {
  for (const [shape, file, method] of floor) {
    assert.ok(
      calls.some((c) => c.shape === shape && c.file === file && c.method === method),
      `the ${shape} harvest no longer finds ${file} calling ${method}() — teach the harvest the shape it missed; `
      + 'a harvest that finds nothing proves nothing',
    );
  }
};

// ── the assertions ─────────────────────────────────────────────────────────

test('each entrypoint class says who calls it, and the two roles are two classes', () => {
  const classes = entrypointClasses(RPC);
  assert.equal(classes.length, 2, 'rpc/index.ts declares two entrypoint classes, each with a one-line doc above it');
  const branchSide = classFor('branchCallsHq');
  const hqSide = classFor('hqCallsBranch');
  assert.notEqual(branchSide.name, hqSide.name);
  // The generator's constants are the same two names, by role — so a swapped
  // doc line and a swapped constant both fail here.
  assert.equal(BRANCH_CALLS_HQ, branchSide.name, 'BRANCH_CALLS_HQ must be the class a branch calls over HQ');
  assert.equal(HQ_CALLS_BRANCH, hqSide.name, 'HQ_CALLS_BRANCH must be the class HQ calls over BRANCH_<CODE>');
});

test('the harvest still finds every call site measured today', () => {
  const { calls, computed } = hqToBranchCalls();
  assert.deepEqual(computed, [], 'a cross-tier call whose method is computed cannot be checked — name the method');
  assertFloor(calls, HQ_TO_BRANCH_FLOOR);
  assertFloor(branchToHqCalls(), BRANCH_TO_HQ_FLOOR);
});

test('a branch\'s HQ binding names the class that declares every method a branch calls on HQ', () => {
  const cls = classFor('branchCallsHq');
  const services = parseToml(renderBranchConfig(TOML, EXAMPLE)).sections.filter((s) => s.name === 'services');
  assert.equal(services.length, 1);
  assert.equal(services[0].kv.get('binding'), '"HQ"');
  assert.equal(
    services[0].kv.get('entrypoint'), JSON.stringify(cls.name),
    `a branch calls HQ over its HQ binding, which must name ${cls.name} — the class HQ exports for branches`,
  );
  const calls = branchToHqCalls();
  assert.ok(calls.length >= BRANCH_TO_HQ_FLOOR.length);
  for (const c of calls) {
    assert.ok(
      cls.methods.has(c.method),
      `${c.file}:${c.line} calls HQ.${c.method}(), which ${cls.name} does not declare — `
      + 'an RPC stub answers any name, so this throws on HQ and the branch records the item as undelivered',
    );
  }
});

test('HQ\'s line to a branch names the class that declares every method HQ calls on a branch', () => {
  const cls = classFor('hqCallsBranch');
  const linked = addServiceBinding(TOML, 'fr');
  const lines = parseToml(linked).sections.filter((s) => s.name === 'env.production.services' || s.name === 'services');
  assert.equal(lines.length, 2, 'the link PR writes one block into each table of wrangler.toml');
  for (const s of lines) {
    assert.equal(s.kv.get('binding'), '"BRANCH_FR"');
    assert.equal(s.kv.get('entrypoint'), JSON.stringify(cls.name), `HQ calls a branch over BRANCH_<CODE>, which must name ${cls.name}`);
  }
  const { calls } = hqToBranchCalls();
  assert.ok(calls.length >= HQ_TO_BRANCH_FLOOR.length);
  for (const c of calls) {
    assert.ok(
      cls.methods.has(c.method),
      `${c.file}:${c.line} calls ${c.method}() on a branch (${c.shape}), which ${cls.name} does not declare`,
    );
  }
});

test('after the link PRs, every branch still binds HQ and only HQ, and the guard still passes', () => {
  // The first branch's link PR puts `[[env.production.services]] BRANCH_FR`
  // into wrangler.toml, and the second puts BRANCH_DACH beside it. A renderer
  // that copied HQ's services table would hand every branch those lines —
  // `fr` a line to itself, `dach` a line to `fr` — and the guard, counting
  // services blocks, would go red on the very PR that linked the branch.
  const linked = addServiceBinding(addServiceBinding(TOML, 'fr'), 'dach');
  const hqLines = parseToml(linked).sections
    .filter((s) => s.name === 'env.production.services')
    .map((s) => s.kv.get('binding'));
  assert.deepEqual(hqLines, ['"BRANCH_FR"', '"BRANCH_DACH"'], 'the fixture must carry the lines a real link PR writes, or this test proves nothing');

  const ids = hqIds(linked);
  for (const e of [EXAMPLE, entryFor('fr', 'Axal VC France'), entryFor('dach', 'Axal VC DACH')]) {
    assert.deepEqual(validateBranch(e, ids), []);
    const rendered = renderBranchConfig(linked, e);
    const sections = parseToml(rendered).sections;
    const services = sections.filter((s) => s.name === 'services');
    assert.equal(services.length, 1, `${e.code}: a branch has one service binding, to HQ`);
    assert.equal(services[0].kv.get('binding'), '"HQ"');
    assert.equal(services[0].kv.get('service'), '"studioos"');
    assert.equal(services[0].kv.get('entrypoint'), JSON.stringify(BRANCH_CALLS_HQ));
    const toBranches = sections.filter((s) => /^"BRANCH_/.test(s.kv.get('binding') || ''));
    assert.deepEqual(toBranches.map((s) => s.kv.get('binding')), [], `${e.code}: no binding to any branch, itself included`);
    assert.deepEqual(checkRendered(linked, e, rendered), [], `${e.code}: the guard must pass on the config a linked HQ renders`);
  }
});
