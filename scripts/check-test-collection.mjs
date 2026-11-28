#!/usr/bin/env node
/**
 * #9035: fail on a test file or browser spec that nothing runs. A file counts
 * as run when it is:
 *
 *   · collected by a path or glob in a package.json script (`test:frontend`'s
 *     `frontend/test/*.test.mjs`, the meeting-bot package's `test/*.test.ts`);
 *   · named by a `run:` step in `.github/workflows/*.yml`, directly or through
 *     the `npm run` script the step calls, or collected by the step's
 *     `playwright test` config (testDir and testMatch) or its
 *     `python -m unittest discover -s <dir> -p <pattern>`;
 *   · imported by a file that is run (the `frontend/test` wrappers that import
 *     `scripts/**` tests), or, for a Python test, started by a run JS test
 *     that calls python with its path, or its module name and folder.
 *
 * Anything else must be listed in `scripts/baselines/test-collection.json`
 * with a one-line reason, keys in order (D4134). A listed file that no longer
 * exists, or that something now runs, fails as stale, so the list only holds
 * files that really run nowhere.
 *
 * Test files are `*.test.*` and `*.spec.*` (JS/TS) and `test_*.py` and
 * `*_test.py`, as git lists them (tracked and untracked, not ignored).
 *
 *   node scripts/check-test-collection.mjs           check (runs in test:guards)
 *   node scripts/check-test-collection.mjs --unrun   print every file nothing runs, listed or not
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { posix, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const LIST = 'scripts/baselines/test-collection.json';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-results', 'playwright-report', '.wrangler', '__pycache__']);

/** A test file by name: JS/TS `*.test.*` / `*.spec.*`, Python `test_*.py` / `*_test.py`. */
export function isTestFile(path) {
  const base = posix.basename(path);
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /^test_[^/]*\.py$/.test(base) || /_test\.py$/.test(base);
}

/** Every file under root: git's list (tracked and untracked, ignores applied) in a checkout, else a walk. */
export function listFiles(root) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (top.status === 0 && resolve(top.stdout.trim()) === resolve(root)) {
    const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0) return r.stdout.split('\0').filter(Boolean).filter((f) => existsSync(posix.join(root, f)));
  }
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(posix.join(root, rel))) {
      if (SKIP_DIRS.has(name)) continue;
      const path = rel ? `${rel}/${name}` : name;
      const st = statSync(posix.join(root, path));
      if (st.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk('');
  return out;
}

/** A glob (`*`, `**`, `?`, `{a,b}`) as an anchored RegExp over a posix path. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += `(?:${glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Normalise `dir/token` to a repo path, or null when it leaves the repository. */
function repoPath(dir, token) {
  const p = posix.normalize(posix.join(dir || '.', token));
  return p.startsWith('..') || p.startsWith('/') ? null : p.replace(/^\.\//, '');
}

/** The shell words of a script that look like a file path or glob. */
function pathTokens(text) {
  return text.split(/[\s;&|()<>]+/)
    .map((t) => t.replace(/^['"]+|['"]+$/g, '').replace(/^--?[\w-]+=/, ''))
    .filter((t) => t && !t.startsWith('-') && !t.includes('${') && !t.includes('$(') && /[./*]/.test(t) && !/^[a-z]+:\/\//.test(t));
}

/** Script text with `\` continuations joined and whole-line shell comments dropped. */
const shellText = (text) => String(text).replace(/\\\r?\n/g, ' ').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** Test files a path or glob token names, read relative to the command's directory and to the root. */
function matchTokens(text, dir, tests) {
  const hit = new Set();
  for (const token of pathTokens(text)) {
    for (const base of new Set([dir, '.'])) {
      const p = repoPath(base, token);
      if (!p) continue;
      if (/[*?{]/.test(p)) {
        const re = globToRegExp(p);
        for (const f of tests) if (re.test(f)) hit.add(f);
      } else if (tests.has(p)) hit.add(p);
    }
  }
  return hit;
}

/** Playwright's own config default names, in its lookup order. */
const PW_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs', 'playwright.config.mts', 'playwright.config.cts'];

/** Specs a `playwright test` run collects from its config's testDir/testMatch/testIgnore (literals only). */
export function playwrightCollect(root, configPath, tests) {
  if (!configPath || !existsSync(posix.join(root, configPath))) return new Set();
  const src = readFileSync(posix.join(root, configPath), 'utf8');
  const dir = posix.dirname(configPath);
  const testDir = repoPath(dir, /testDir\s*:\s*['"]([^'"]+)['"]/.exec(src)?.[1] ?? '.') ?? dir;
  const literal = (key) => {
    const m = new RegExp(`${key}\\s*:\\s*(?:/((?:\\\\/|[^/\\n])+)/([a-z]*)|['"]([^'"]+)['"])`).exec(src);
    if (!m) return null;
    if (m[1] != null) return (p) => new RegExp(m[1], m[2]).test(p);
    const re = globToRegExp(m[3].includes('/') ? m[3] : `**/${m[3]}`);
    return (p) => re.test(p.slice(testDir === '.' ? 0 : testDir.length + 1));
  };
  const match = literal('testMatch') ?? ((p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p));
  const ignore = literal('testIgnore') ?? (() => false);
  const prefix = testDir === '.' ? '' : `${testDir}/`;
  return new Set([...tests].filter((f) => f.startsWith(prefix) && match(f) && !ignore(f)));
}

/** Test files one shell script collects when run from `dir` (workflow steps; package scripts the step runs). */
function collectScript(ctx, text, dir, depth = 0) {
  const hit = new Set();
  let cwd = dir;
  // One command at a time, so a `cd frontend` earlier in the step moves the paths after it.
  for (const command of shellText(text).split(/\n|&&|\|\||;/)) {
    const cd = /^\s*\(?\s*cd\s+['"]?([^\s'")]+)/.exec(command);
    if (cd) { cwd = repoPath(cwd, cd[1]) ?? cwd; continue; }
    for (const f of collectCommand(ctx, command, cwd, depth)) hit.add(f);
  }
  return hit;
}

/** Test files one command collects: the paths it names, its playwright config, unittest discovery, or the npm script it runs. */
function collectCommand(ctx, command, dir, depth) {
  const { root, tests, packages } = ctx;
  const hit = matchTokens(command, dir, tests);
  const pw = /\bplaywright\s+test\b(.*)/.exec(command);
  if (pw && !matchTokens(pw[1], dir, tests).size) { // a run that names specs runs only those
    const c = /(?:^|\s)(?:-c|--config)(?:\s+|=)['"]?([^\s'"]+)/.exec(pw[1])?.[1];
    const config = c ? repoPath(dir, c) : PW_CONFIGS.map((n) => repoPath(dir, n)).find((p) => p && existsSync(posix.join(root, p)));
    for (const f of playwrightCollect(root, config, tests)) hit.add(f);
  }
  const ud = /\bunittest\s+discover\b(.*)/.exec(command);
  if (ud) {
    const start = /(?:^|\s)(?:-s|--start-directory)\s+['"]?([^\s'"]+)/.exec(ud[1])?.[1] ?? '.';
    const pattern = /(?:^|\s)(?:-p|--pattern)\s+['"]?([^\s'"]+)/.exec(ud[1])?.[1] ?? 'test*.py';
    const base = repoPath(dir, start);
    const re = globToRegExp(pattern);
    for (const f of tests) if (base != null && (base === '.' || f.startsWith(`${base}/`)) && re.test(posix.basename(f))) hit.add(f);
  }
  const npm = /\bnpm\s+(.*)/.exec(command);
  if (npm && depth < 4) {
    const words = npm[1].trim().split(/\s+/);
    const prefix = /--prefix[ =](\S+)/.exec(npm[1])?.[1];
    const at = words.findIndex((w) => w === 'run' || w === 'run-script' || w === 'test');
    const name = at < 0 ? null : words[at] === 'test' ? 'test' : words.slice(at + 1).find((w) => !w.startsWith('-'));
    const pkgDir = repoPath(dir, prefix ?? '.');
    const script = name && packages.get(pkgDir)?.[name];
    if (script) for (const f of collectScript(ctx, script, pkgDir, depth + 1)) hit.add(f);
  }
  return hit;
}

/** Relative import specifiers of a JS/TS source. */
function importsOf(src) {
  const out = [];
  for (const re of [/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of src.matchAll(re)) if (m[1].startsWith('.')) out.push(m[1]);
  }
  return out;
}

/** JS source with block and line comments removed (approximate: enough to ignore a path a comment cites). */
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Every test file something runs, with how. */
export function collect(root, files) {
  const tests = new Set(files.filter(isTestFile));
  const packages = new Map();
  for (const f of files) {
    if (posix.basename(f) !== 'package.json' || f.includes('node_modules/')) continue;
    try { packages.set(posix.dirname(f), JSON.parse(readFileSync(posix.join(root, f), 'utf8')).scripts ?? {}); } catch { /* not ours to judge */ }
  }
  const ctx = { root, tests, packages };
  const how = new Map();
  const mark = (f, why) => { if (!how.has(f)) how.set(f, why); };

  for (const [dir, scripts] of packages) {
    for (const [name, text] of Object.entries(scripts)) {
      for (const f of matchTokens(shellText(text), dir, tests)) mark(f, `${dir === '.' ? '' : `${dir}/`}package.json ${name}`);
    }
  }

  const YAML = createRequire(posix.join(ROOT, 'package.json'))('yaml');
  const wfDir = '.github/workflows';
  for (const f of files.filter((p) => posix.dirname(p) === wfDir && /\.ya?ml$/.test(p)).sort()) {
    let doc;
    try { doc = YAML.parse(readFileSync(posix.join(root, f), 'utf8')); } catch { continue; }
    const wfWd = doc?.defaults?.run?.['working-directory'];
    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      const jobWd = job?.defaults?.run?.['working-directory'] ?? wfWd;
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== 'string') continue;
        const wd = String(step['working-directory'] ?? jobWd ?? '.').replace(/\$\{\{\s*github\.workspace\s*\}\}\/?/, '') || '.';
        for (const t of collectScript(ctx, step.run, wd)) mark(t, `${posix.basename(f)} › ${jobName} › ${step.name ?? 'run'}`);
      }
    }
  }

  // Imports and python launches from run JS/TS tests, to a fixed point.
  const python = [...tests].filter((t) => t.endsWith('.py'));
  const queue = [...how.keys()];
  const seen = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f) || f.endsWith('.py')) continue;
    seen.add(f);
    let src;
    try { src = readFileSync(posix.join(root, f), 'utf8'); } catch { continue; }
    for (const spec of importsOf(src)) {
      const target = repoPath(posix.dirname(f), spec);
      if (target && tests.has(target) && !how.has(target)) { mark(target, `imported by ${f}`); queue.push(target); }
    }
    const code = withoutComments(src);
    if (!/\bpython3?\b/.test(code)) continue;
    for (const py of python) {
      if (how.has(py)) continue;
      const stem = posix.basename(py, '.py');
      const folder = posix.basename(posix.dirname(py));
      if (code.includes(py) || (new RegExp(`['"]${stem}(?:\\.py)?['"]`).test(code) && code.includes(`${folder}/`))) mark(py, `started by ${f}`);
    }
  }
  return { tests, how };
}

/** Compare the unrun files with the reviewed list: unlisted, stale and out-of-order entries. */
export function compare(tests, how, list) {
  const errors = [];
  const entries = list && typeof list.files === 'object' && list.files ? list.files : {};
  const keys = Object.keys(entries);
  const sorted = [...keys].sort();
  const bad = keys.findIndex((k, i) => k !== sorted[i]);
  if (bad >= 0) errors.push(`${LIST}: "${keys[bad]}" is out of key order (D4134); insert each entry at its place`);
  for (const k of keys) {
    if (!tests.has(k)) errors.push(`${LIST}: stale entry "${k}": no such test file any more — delete the entry`);
    else if (how.has(k)) errors.push(`${LIST}: stale entry "${k}": now run (${how.get(k)}) — delete the entry`);
    if (typeof entries[k] !== 'string' || !entries[k].trim()) errors.push(`${LIST}: "${k}" has no reason`);
  }
  const unrun = [...tests].filter((t) => !how.has(t)).sort();
  for (const t of unrun) {
    if (!Object.hasOwn(entries, t)) errors.push(`${t} is run by no package.json suite, workflow step or run test — wire it in (a frontend/test wrapper import, a suite glob or a named step) or list it in ${LIST} with a reason`);
  }
  return { errors, unrun };
}

export function main(root = ROOT, argv = []) {
  const files = listFiles(root);
  const { tests, how } = collect(root, files);
  const listPath = posix.join(root, LIST);
  const list = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : { files: {} };
  const { errors, unrun } = compare(tests, how, list);
  if (argv.includes('--unrun')) {
    for (const t of unrun) console.log(t);
    return 0;
  }
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`check-test-collection: ${errors.length} problem(s) (#9035).`);
    return 1;
  }
  console.log(`✓ check-test-collection: ${tests.size} test files; ${how.size} run by a suite, a workflow step or a run test; ${unrun.length} listed with a reason in ${LIST}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(ROOT, process.argv.slice(2));
}
