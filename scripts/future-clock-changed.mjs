#!/usr/bin/env node
/**
 * D7124: a pull request's added or edited test files, run with the clock moved
 * ahead, so a date-bound test is caught before it reaches main.
 *
 * On 2026-11-17 a test merged two days earlier wrote a report stamped with a
 * fixed `NOW` while the code it tested read the real clock against a 48-hour
 * threshold. 48 hours later it failed on every merge candidate and nothing
 * merged for 6 h 25 min (#7108). check-test-clock (D5614) passed it, correctly
 * by its own rule: the test file itself never read the clock.
 *
 *   node scripts/future-clock-changed.mjs                 changed files against $FUTURE_CLOCK_BASE (CI)
 *   node scripts/future-clock-changed.mjs --list          print the files it would run (none: nothing)
 *   node scripts/future-clock-changed.mjs --offset +7d <file>...   reproduce one file at one offset
 *
 * Each file runs with its suite's own command from package.json, under
 * libfaketime as the nightly runs it (D5398): the operating system's clock
 * moves, so `Date`, node:sqlite and a shell agree, and scripts/future-clock.mjs
 * carries the clock into children (and keeps it out of workerd).
 * scripts/future-clock-check.mjs proves the clock moved first. Two offsets:
 * +7d, and +9d 11h, which changes the weekday and the time of day (+7d keeps
 * the weekday and cannot catch "fails every Saturday", #4770).
 *
 * A file that fails ahead runs once more on the real clock. Fails ahead and
 * passes now: the step fails and names the file, the test, the offset and the
 * fix. Fails on both: exit 0, the suite itself reports it.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannedCommand, readFailures, suiteFiles, withFailureReporter } from './test-drift-parts.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');

/** The suites whose test files run here: the ones check-test-clock reads. */
export const SUITES = Object.freeze(['test:frontend', 'test:worker', 'test:meeting-bot', 'test:retention']);

/** The two offsets: `faketime` is what libfaketime reads (it misparses "+9d 11h"), `days` what the clock check expects. */
export const OFFSETS = Object.freeze([
  Object.freeze({ label: '+7d', faketime: '+7d', days: 7 }),
  Object.freeze({ label: '+9d 11h', faketime: '+227h', days: 227 / 24 }),
]);

/** Above this many changed test files the nightly covers them; the step runs none. */
export const MAX_FILES = 40;

export const LIBFAKETIME = '/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1';

export const FIX = "Freeze the clock in the test (`t.mock.timers.enable({ apis: ['Date'], now })`) or pass `nowMs` into the code under test.";

/** `+7d` or `+9d 11h` (or `+<n>h`, `+<n>d`) as an offset; anything else is null. */
export function parseOffset(text) {
  const known = OFFSETS.find((o) => o.label === text || o.faketime === text);
  if (known) return known;
  const m = /^\+(\d{1,3})([dh])$/.exec(String(text || ''));
  if (!m || Number(m[1]) === 0) return null;
  const days = m[2] === 'd' ? Number(m[1]) : Number(m[1]) / 24;
  return { label: text, faketime: text, days };
}

/** Each suite's test-file command (the part before any `&&`), keyed by script name; suites missing from package.json are left out. */
export function suiteCommands(scripts, suites = SUITES) {
  return suites.filter((key) => typeof scripts?.[key] === 'string').map((key) => ({ key, cmd: scripts[key].split(' && ')[0] }));
}

/** Changed files that some suite runs, each with its suite command, in suite order; helpers (`_*`) are not tests. */
export function groupBySuite(files, commands, root) {
  const groups = [];
  const left = new Set(files);
  for (const { key, cmd } of commands) {
    const owned = new Set(suiteFiles(cmd, root));
    const mine = [...left].filter((f) => owned.has(f) && !/(^|\/)_[^/]*$/.test(f)).sort();
    for (const f of mine) left.delete(f);
    if (mine.length) groups.push({ key, cmd, files: mine });
  }
  return groups;
}

/** Added, modified or renamed files between `base` and HEAD; null when the base cannot be read even after fetching it. */
export function changedFiles(root, base, run = spawnSync) {
  if (!/^[0-9a-f]{40}$/.test(base || '')) return null;
  const diff = () => run('git', ['diff', '--name-only', '--diff-filter=AMR', '--no-renames', base, 'HEAD'], { cwd: root, encoding: 'utf8' });
  let r = diff();
  if (r.status !== 0) {
    run('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], { cwd: root, encoding: 'utf8' });
    r = diff();
  }
  return r.status === 0 ? String(r.stdout).split('\n').filter(Boolean) : null;
}

/** The env a run gets: libfaketime at `offset`, or the real clock with every libfaketime variable emptied. */
export function clockEnv(env, offset, lib = LIBFAKETIME) {
  const loader = `--import=${join(here, 'future-clock.mjs')}`;
  const preload = String(env.LD_PRELOAD || '').split(/[\s:]+/).filter((p) => p && !/faketime/.test(p));
  const options = String(env.NODE_OPTIONS || '').split(/\s+/).filter((o) => o && o !== loader);
  const out = { ...env };
  delete out.NODE_TEST_CONTEXT;
  // Emptied rather than deleted: the loader in a parent running under libfaketime puts missing ones back (withClock).
  for (const k of Object.keys(out)) if (k.startsWith('FAKETIME')) out[k] = '';
  out.FUTURE_CLOCK_DAYS = '';
  out.LD_PRELOAD = preload.join(' ');
  out.NODE_OPTIONS = options.join(' ');
  if (!offset) return out;
  return {
    ...out,
    LD_PRELOAD: [lib, ...preload].join(' '),
    FAKETIME: offset.faketime,
    FAKETIME_DONT_FAKE_MONOTONIC: '1',
    FAKETIME_DONT_RESET: '1',
    FUTURE_CLOCK_DAYS: String(offset.days),
    NODE_OPTIONS: [...options, loader].join(' '),
  };
}

/**
 * Failed tests of a run of `files`, as `file\u0000test` keys. A run that failed and recorded no test of these files
 * (it crashed, or the reporter did not load) counts every file it ran as failed whole.
 */
export function failureKeys(result, files) {
  const keys = new Set(result.failures.filter((f) => files.includes(f.file)).map((f) => `${f.file}\u0000${f.test}`));
  if (result.status !== 0 && keys.size === 0) for (const f of files) keys.add(`${f}\u0000${f}`);
  return keys;
}

/**
 * Which failures ahead are the clock's: those that do not also fail now. A file that fails whole on the real clock
 * (its name is the file) fails every one of its tests now.
 */
export function dateBound(ahead, now) {
  const wholeNow = new Set([...now].map((k) => k.split('\u0000')).filter(([f, t]) => f === t).map(([f]) => f));
  return [...ahead].filter((k) => !now.has(k) && !wholeNow.has(k.split('\u0000')[0])).map((k) => {
    const [file, test] = k.split('\u0000');
    return { file, test };
  });
}

/** One run of `files` with `cmd` at `offset` (null: the real clock); `{ status, failures: [{ file, test }] }`. */
function runFiles({ cmd, files, offset, root, env, sh, reporter, lib }) {
  const dir = mkdtempSync(join(tmpdir(), 'future-clock-changed-'));
  try {
    const out = join(dir, 'failed.jsonl');
    const command = withFailureReporter(plannedCommand(cmd, files), out, reporter);
    const r = sh(command, clockEnv(env, offset, lib));
    return { status: r.status ?? 1, failures: existsSync(out) ? readFailures(out) : [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The whole step. Returns the exit status; prints as it goes. `sh(command, env)` runs one shell command in `root`
 * and returns `{ status }`; `check(env)` runs future-clock-check.mjs and returns `{ status }`.
 */
export function main(argv, {
  root = resolve(here, '..'), env = process.env, log = console.log, error = console.error,
  sh = (command, e) => spawnSync('sh', ['-c', command], { cwd: root, stdio: 'inherit', env: e }),
  check = (e) => spawnSync(process.execPath, [join(here, 'future-clock-check.mjs')], { cwd: root, stdio: 'inherit', env: e }),
  diff = (base) => changedFiles(root, base),
  lib = env.FUTURE_CLOCK_LIBFAKETIME || LIBFAKETIME,
  reporter = join(here, 'lib', 'failedTestsReporter.mjs'),
} = {}) {
  const args = [...argv];
  const list = args.includes('--list');
  const offsets = [];
  const named = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') continue;
    if (args[i] === '--offset') {
      const o = parseOffset(args[++i]);
      if (!o) { error(`::error::unknown offset "${args[i]}": use +7d, +9d 11h, +<n>d or +<n>h`); return 2; }
      offsets.push(o);
    } else named.push(args[i]);
  }
  const files = named.length ? named : diff(env.FUTURE_CLOCK_BASE);
  if (!files) { error('::error::future-clock-changed: could not list the files this pull request changed (FUTURE_CLOCK_BASE unreadable)'); return 1; }
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const groups = groupBySuite(files, suiteCommands(scripts), root);
  const tests = groups.flatMap((g) => g.files);
  if (named.length && tests.length !== new Set(named).size) {
    error(`::error::not a test file of ${SUITES.join(', ')}: ${named.filter((f) => !tests.includes(f)).join(', ')}`);
    return 2;
  }
  if (!tests.length) { (list ? error : log)('future-clock-changed: no changed tests'); return 0; }
  if (tests.length > MAX_FILES) {
    (list ? error : log)(`future-clock-changed: ${tests.length} changed test files, over the cap of ${MAX_FILES}; the nightly future-clock run covers them (D7124)`);
    return 0;
  }
  if (list) { log(tests.join('\n')); return 0; }

  const found = [];
  for (const offset of offsets.length ? offsets : OFFSETS) {
    const proof = check(clockEnv(env, offset, lib));
    if (proof.status !== 0) {
      error(`::error::the clock did not move ${offset.label} for every reader; nothing was tested (D7124)`);
      return 1;
    }
    for (const g of groups) {
      log(`\nfuture-clock-changed: ${g.files.length} file(s) of ${g.key}, clock ${offset.label}`);
      const ahead = runFiles({ ...g, offset, root, env, sh, reporter, lib });
      if (ahead.status === 0) continue;
      const aheadKeys = failureKeys(ahead, g.files);
      const failedFiles = g.files.filter((f) => [...aheadKeys].some((k) => k.startsWith(`${f}\u0000`)));
      log(`future-clock-changed: ${failedFiles.length} file(s) failed ${offset.label} ahead; running them on today's clock`);
      const nowKeys = failureKeys(runFiles({ ...g, files: failedFiles, offset: null, root, env, sh, reporter, lib }), failedFiles);
      const bound = dateBound(aheadKeys, nowKeys);
      const boundKeys = new Set(bound.map((f) => `${f.file}\u0000${f.test}`));
      for (const k of [...aheadKeys].filter((key) => !boundKeys.has(key))) {
        log(`future-clock-changed: fails on today's clock too, left to the suite: ${k.replace('\u0000', ' › ')}`);
      }
      for (const f of bound) found.push({ ...f, offset: offset.label });
    }
  }
  if (!found.length) { log('\nfuture-clock-changed: every changed test passes with the clock moved ahead'); return 0; }
  const lines = found.map((f) => `${f.file} › ${f.test}: fails with the clock ${f.offset} ahead and passes on today's clock.`);
  for (const f of found) error(`::error file=${f.file},title=date-bound test (D7124)::${f.test} fails with the clock ${f.offset} ahead and passes today. ${FIX}`);
  log(`\n${lines.join('\n')}\n${FIX}\nReproduce: node scripts/future-clock-changed.mjs --offset '<offset>' <file>`);
  if (env.GITHUB_STEP_SUMMARY) {
    const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f`<>&\\|]/g, ' ').replaceAll('@', ' at ').slice(0, 200);
    const rows = found.map((f) => `| \`${f.file}\` | ${clean(f.test)} | ${f.offset} | \`node scripts/future-clock-changed.mjs --offset '${f.offset}' ${f.file}\` |`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Date-bound tests (D7124)\n\nThese fail with the clock moved ahead and pass today, so they would break main on that date.\n\n| File | Test | Offset | Reproduce |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n${FIX}\n\n`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
