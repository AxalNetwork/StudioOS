#!/usr/bin/env node
// D5614: reject new real-clock test reads; existing exceptions can only shrink.
import { readFileSync, globSync, statSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { stripTypeScriptTypes } from 'node:module';
const parse = Parser.extend(jsx());

export const ALLOWLIST = 'scripts/test-clock-allowlist.txt';
const REASONS = new Set(['relative', 'deadline', 'unique-id', 'duration']);
const SUITES = ['test:frontend', 'test:worker', 'test:meeting-bot', 'test:retention'];
const nameOf = (node) => {
  if (!node) return [];
  if (node.type === 'ChainExpression') return nameOf(node.expression);
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'MemberExpression') return [...nameOf(node.object), node.computed ? node.property.value : node.property.name];
  return [];
};

export function scanSource(source, path = 'fixture.test.mjs') {
  // Node's strip mode preserves offsets and comments. TypeScript 7 has no JS parser API.
  const code = path.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'strip' }) : source;
  const comments = [];
  let ast;
  try { ast = parse.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments }); }
  catch (error) { throw new Error(`${path}:${error.loc?.line || 1}: cannot parse test: ${error.message}`); }
  const clocks = new Set();
  const constants = new Map();
  const promiseTimers = new Set();
  const namespaces = new Set();
  const calls = [];
  const visit = (node, ancestors = []) => {
    if (node.type === 'VariableDeclaration' && node.kind === 'const') for (const d of node.declarations) if (d.id.type === 'Identifier' && d.init) constants.set(d.id.name, d.init);
    if (node.type === 'ImportDeclaration' && /^(node:)?timers\/promises$/.test(node.source.value)) {
      for (const binding of node.specifiers) {
        if (binding.type === 'ImportSpecifier' && binding.imported.name === 'setTimeout') promiseTimers.add(binding.local.name);
        if (binding.type === 'ImportNamespaceSpecifier') namespaces.add(binding.local.name);
      }
    }
    if (node.type === 'CallExpression') {
      const names = nameOf(node.callee);
      if (names.slice(-3).join('.') === 'mock.timers.enable') {
        const argument = node.arguments[0];
        const apis = argument?.type === 'ObjectExpression' ? argument.properties.find((p) => (p.key?.name || p.key?.value) === 'apis')?.value : argument;
        if (apis?.type === 'ArrayExpression') for (const api of apis.elements) if (api?.type === 'Literal') clocks.add(api.value);
      }
      calls.push({ node, ancestors });
    }
    if (node.type === 'NewExpression') calls.push({ node, ancestors });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child, [...ancestors, node]);
      } else if (value?.type) visit(value, [...ancestors, node]);
    }
  };
  visit(ast);
  const optouts = new Set();
  const findings = [];
  for (const comment of comments) {
    if (comment.type !== 'Line') continue;
    const match = /^\s*clock-ok:\s*(.*?)\s*$/.exec(comment.value);
    if (!match) continue;
    const line = comment.loc.start.line;
    if (REASONS.has(match[1])) optouts.add(line);
    else findings.push({ rule: 'opt-out', path, line, reason: `unknown clock-ok reason: ${match[1]}` });
  }
  const fixed = (node, seen = new Set()) => {
    if (!node) return false;
    if (node.type === 'Literal') return typeof node.value === 'number';
    if (node.type === 'UnaryExpression') return fixed(node.argument, seen);
    if (node.type === 'BinaryExpression') return fixed(node.left, new Set(seen)) && fixed(node.right, new Set(seen));
    if (node.type === 'Identifier' && constants.has(node.name) && !seen.has(node.name)) { seen.add(node.name); return fixed(constants.get(node.name), seen); }
    return false;
  };
  for (const { node, ancestors } of calls) {
    const names = nameOf(node.callee);
    const name = names.join('.');
    const line = node.loc.start.line;
    if (optouts.has(line)) continue;
    const date = node.type === 'NewExpression' ? name === 'Date' && !node.arguments.length : name === 'Date' || (name === 'Date.now' && !node.arguments.length);
    if (date && !clocks.has('Date')) findings.push({ rule: 'date', path, line });
    if (node.type !== 'CallExpression' || clocks.has('setTimeout')) continue;
    const promiseTimer = promiseTimers.has(name) || (names.length === 2 && namespaces.has(names[0]) && names[1] === 'setTimeout');
    const timer = name === 'setTimeout' || promiseTimer;
    const delay = promiseTimer ? node.arguments[0] : node.arguments[1];
    const awaitAt = ancestors.findLastIndex((p) => p.type === 'AwaitExpression');
    const functionAt = ancestors.findLastIndex((p) => ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(p.type));
    const promiseAt = ancestors.findLastIndex((p) => p.type === 'NewExpression' && nameOf(p.callee).join('.') === 'Promise');
    // A callback merely stored beneath await (Promise.resolve(() => ...)) is not a sleep.
    const awaited = awaitAt >= 0 && (functionAt < awaitAt || promiseAt > awaitAt);
    const deadlinePoll = ancestors.some((p) => ['WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(p.type) && p.test && /\b(?:deadline|expiresAt|until)\b/i.test(source.slice(p.test.start, p.test.end)) && /[<>]/.test(source.slice(p.test.start, p.test.end)));
    if (timer && fixed(delay) && awaited && !deadlinePoll) findings.push({ rule: 'sleep', path, line });
  }
  return findings;
}

export function suiteFiles(root) {
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const files = new Set();
  const dirs = new Set();
  for (const key of SUITES) {
    const command = scripts[key];
    const at = command?.indexOf(' --test ');
    if (at == null || at < 0) throw new Error(`cannot find test globs for ${key}`);
    const patterns = command.slice(at + 8).split(' && ')[0].match(/'[^']*'|"[^"]*"|\S+/g) || [];
    const matches = patterns.flatMap((p) => [...globSync(p.replace(/^['"]|['"]$/g, ''), { cwd: root })]);
    if (!matches.length) throw new Error(`no test files for ${key}`);
    for (const file of matches) { files.add(file); dirs.add(posix.dirname(file)); }
  }
  for (const dir of dirs) for (const file of globSync(`${dir}/_*`, { cwd: root })) if (/\.(?:mjs|js|ts)$/.test(file) && statSync(resolve(root, file)).isFile()) files.add(file);
  return [...files].sort();
}

export function scanTree(root) {
  return suiteFiles(root).flatMap((file) => scanSource(readFileSync(resolve(root, file), 'utf8'), file));
}

export const entriesOf = (findings) => [...new Set(findings.filter((f) => f.rule !== 'opt-out').map((f) => `${f.rule} ${f.path}`))].sort();
export function parseAllowlist(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) if (!/^(date|sleep) [^\s]+$/.test(line)) throw new Error(`invalid allowlist entry: ${line}`);
  if (JSON.stringify(lines) !== JSON.stringify([...new Set(lines)].sort())) throw new Error('allowlist must be sorted with no duplicates');
  return lines;
}

export function compareAllowlist(findings, allowed) {
  const active = new Set(entriesOf(findings));
  const list = new Set(allowed);
  return [
    ...findings.filter((f) => f.rule === 'opt-out' || !list.has(`${f.rule} ${f.path}`)).map((f) => `${f.path}:${f.line} [${f.rule}] ${f.reason || 'new real-clock dependency'}`),
    ...allowed.filter((entry) => !active.has(entry)).map((entry) => `stale or missing-file allowlist entry: ${entry}`),
  ];
}

export function compareGrowth(current, base) {
  const original = new Set(base);
  return current.filter((entry) => !original.has(entry)).map((entry) => `allowlist growth is forbidden: ${entry}`);
}

export const needsBaseCheck = (env) => /^(?:true|1)$/i.test(env.CI || env.GITHUB_ACTIONS || '') && !(env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main');

export function readMainAllowlist(root) {
  const fetch = spawnSync('git', ['fetch', 'origin', '+main:refs/remotes/origin/main', '--depth=1'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (fetch.status !== 0) throw new Error('cannot fetch origin/main to verify allowlist growth');
  const show = spawnSync('git', ['show', `origin/main:${ALLOWLIST}`], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (show.status !== 0) throw new Error('cannot read origin/main allowlist; merge the reviewed seed inventory first');
  return parseAllowlist(show.stdout);
}

export function main(root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), env = process.env) {
  const findings = scanTree(root);
  const allowed = parseAllowlist(readFileSync(resolve(root, ALLOWLIST), 'utf8'));
  const problems = compareAllowlist(findings, allowed);
  if (needsBaseCheck(env)) problems.push(...compareGrowth(allowed, readMainAllowlist(root)));
  if (problems.length) { for (const p of problems) console.error(`✖ test-clock: ${p}`); return 1; }
  console.log(`✓ test-clock: ${suiteFiles(root).length} tests/helpers, ${allowed.length} existing rule/file exceptions; no new or stale entries.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`✖ test-clock: ${error.message}`); process.exitCode = 1; }
}
