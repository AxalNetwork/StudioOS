/** D5608 — opt-in dependency and timing evidence from Node test-file processes. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const TRACE_IMPORT = `--import=${import.meta.url}`;

function start() {
  if (!process.env.TEST_TRACE_DIR) return;
  const root = resolve(process.env.TEST_TRACE_ROOT || process.cwd());
  const traceDir = resolve(root, process.env.TEST_TRACE_DIR);
  const isTest = !process.env.TEST_TRACE_TEST && process.env.NODE_TEST_CONTEXT === 'child-v8';
  const test = inRepo(process.env.TEST_TRACE_TEST || (isTest ? process.argv[1] : null), root);
  if (!test) return;

  const fs = process.getBuiltinModule('node:fs');
  const modules = process.getBuiltinModule('node:module');
  const subprocess = process.getBuiltinModule('node:child_process');
  const { mkdirSync, writeFileSync } = fs;
  const nativeRealpath = fs.realpath.native;
  const nativeRealpathSync = fs.realpathSync.native;
  const reads = new Set();
  const directories = new Set();
  const resolvedModules = new Set();
  const hits = new Set();
  const misses = new Set();
  const sqlite = new Set();
  const children = new Set();
  let opaque = false;
  const cwd = () => process.cwd();
  const collect = (set, input) => {
    try {
      const path = inRepo(input, root, cwd());
      if (path !== null) set.add(path);
    } catch { /* The observed operation owns its argument validation. */ }
  };
  const wrap = (target, name, observe) => {
    const original = target?.[name];
    if (typeof original !== 'function') return;
    const observed = function (...args) {
      return observe(original, this, args);
    };
    const properties = Object.getOwnPropertyDescriptors(original);
    const custom = properties[promisify.custom];
    if (typeof custom?.value === 'function') {
      const promiseCall = custom.value;
      custom.value = function (...args) { return observe(promiseCall, this, args); };
    }
    Object.defineProperties(observed, properties);
    target[name] = observed;
  };
  const record = (set, paths = (args) => [args[0]]) => (original, self, args) => {
    try {
      for (const input of paths(args)) collect(set, input);
    } catch { /* Preserve the original call even for an invalid input. */ }
    return Reflect.apply(original, self, args);
  };

  process.once('exit', (exitCode) => {
    try {
      mkdirSync(traceDir, { recursive: true });
      const output = {
        test, isTest, wallMs: Math.round(performance.now()), exitCode, opaque,
        reads: sorted(reads), directories: sorted(directories), modules: sorted(resolvedModules),
        probes: { hits: sorted(hits), misses: sorted(misses) },
        sqlite: sorted(sqlite), children: sorted(children),
      };
      writeFileSync(resolve(traceDir, `${process.pid}-${performance.timeOrigin}.trace.json`), JSON.stringify(output));
    } catch { /* Trace output is advisory. */ }
  });

  for (const name of ['readFile', 'readFileSync', 'createReadStream', 'readlink', 'readlinkSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync']) {
    wrap(fs, name, record(reads));
  }
  for (const name of ['readFile', 'readlink', 'copyFile', 'cp']) wrap(fs.promises, name, record(reads));
  for (const name of ['open', 'openSync']) wrap(fs, name, record(reads, readOpen));
  wrap(fs.promises, 'open', record(reads, readOpen));
  for (const name of ['readdir', 'readdirSync', 'opendir', 'opendirSync']) wrap(fs, name, record(directories));
  for (const name of ['readdir', 'opendir']) wrap(fs.promises, name, record(directories));
  for (const name of ['glob', 'globSync']) wrap(fs, name, record(directories, globRoots));
  wrap(fs.promises, 'glob', record(directories, globRoots));

  const probe = (input, found) => collect(found ? hits : misses, input);
  for (const name of ['existsSync', 'statSync', 'lstatSync', 'accessSync', 'realpathSync']) {
    wrap(fs, name, (original, self, args) => {
      try {
        const result = Reflect.apply(original, self, args);
        probe(args[0], name === 'accessSync' || Boolean(result));
        return result;
      } catch (error) {
        probe(args[0], false);
        throw error;
      }
    });
  }
  for (const name of ['exists', 'stat', 'lstat', 'access', 'realpath']) {
    wrap(fs, name, (original, self, args) => {
      const last = args.length - 1;
      const callback = args[last];
      if (typeof callback === 'function') {
        args[last] = function (...result) {
          probe(args[0], name === 'exists' ? result[0] : !result[0]);
          return Reflect.apply(callback, this, result);
        };
      }
      return Reflect.apply(original, self, args);
    });
    wrap(fs.promises, name, (original, self, args) => Reflect.apply(original, self, args).then(
      (result) => { probe(args[0], true); return result; },
      (error) => { probe(args[0], false); throw error; },
    ));
  }

  // fs.realpath and realpathSync expose an additional native implementation.
  // Preserve it and record its calls through the same wrappers.
  fs.realpath.native = function (input, ...args) {
    collect(reads, input);
    return Reflect.apply(nativeRealpath, this, [input, ...args]);
  };
  fs.realpathSync.native = function (input, ...args) {
    collect(reads, input);
    return Reflect.apply(nativeRealpathSync, this, [input, ...args]);
  };

  let sqliteWrapped = false;
  modules.registerHooks?.({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (result.url?.startsWith('file:')) collect(resolvedModules, result.url);
      if (result.url === 'node:sqlite' && !sqliteWrapped) {
        sqliteWrapped = true;
        try {
          const sqliteModule = process.getBuiltinModule('node:sqlite');
          sqliteModule.DatabaseSync = new Proxy(sqliteModule.DatabaseSync, {
            construct(target, args, newTarget) {
              if (args[0] !== ':memory:') collect(sqlite, args[0]);
              return Reflect.construct(target, args, newTarget);
            },
          });
          modules.syncBuiltinESMExports();
        } catch { opaque = true; }
      }
      return result;
    },
  });

  const childEnv = (env) => ({
    ...env,
    TEST_TRACE_TEST: test,
    TEST_TRACE_ROOT: root,
    TEST_TRACE_DIR: traceDir,
    NODE_OPTIONS: withTrace(env.NODE_OPTIONS),
  });
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
    wrap(subprocess, name, (original, self, args) => {
      try {
        const index = Array.isArray(args[1]) ? 2 : 1;
        const options = args[index];
        const validOptions = options == null || typeof options === 'object';
        const command = name === 'fork' ? options?.execPath ?? process.execPath : args[0];
        const node = typeof command === 'string' && (command === process.execPath || /(?:^|[\\/])node(?:\.exe)?$/.test(command));
        children.add(typeof command === 'string' ? command.split(/[\\/]/).at(-1) : 'unknown');
        if (!node || options?.shell) opaque = true;
        if (node && (validOptions || typeof options === 'function')) {
          const traced = { ...options, env: childEnv(options?.env ?? process.env) };
          if (typeof options === 'function') args.splice(index, 0, traced);
          else args[index] = traced;
        }
      } catch { opaque = true; }
      return Reflect.apply(original, self, args);
    });
  }
  for (const name of ['exec', 'execSync']) {
    wrap(subprocess, name, (original, self, args) => {
      opaque = true;
      children.add('shell');
      return Reflect.apply(original, self, args);
    });
  }
  // Indirect Node children may inherit the environment from a shell. The
  // direct shell itself remains opaque because its other reads are invisible.
  process.env.TEST_TRACE_TEST = test;
  process.env.TEST_TRACE_ROOT = root;
  process.env.TEST_TRACE_DIR = traceDir;
  modules.syncBuiltinESMExports();
}

function sorted(values) {
  return [...values].sort();
}

function inRepo(input, root, cwd = root) {
  if (input instanceof URL || (typeof input === 'string' && input.startsWith('file:'))) input = fileURLToPath(input);
  if (Buffer.isBuffer(input)) input = input.toString();
  if (typeof input !== 'string' || !input) return null;
  const path = relative(root, resolve(cwd, input));
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) return null;
  const parts = path.split(sep);
  if (parts.includes('node_modules')) return null;
  return parts.join('/') || '.';
}

function readOpen(args) {
  const flags = args[1];
  return (typeof flags === 'number' ? (flags & 3) !== 1 : flags == null || /^[r]|\+/.test(flags)) ? [args[0]] : [];
}

function globRoots([patterns, options]) {
  const cwd = options?.cwd instanceof URL ? fileURLToPath(options.cwd) : options?.cwd ?? process.cwd();
  return [patterns].flat().filter((pattern) => typeof pattern === 'string').map((pattern) => {
    const segments = pattern.split('/');
    const wildcard = segments.findIndex((part) => /[*?\[\]{}()]/.test(part));
    const prefix = segments.slice(0, wildcard < 0 ? -1 : wildcard).join('/');
    return resolve(cwd, prefix || (isAbsolute(pattern) ? '/' : '.'));
  });
}

function withTrace(options = '') {
  return options.includes(TRACE_IMPORT) ? options : [options, TRACE_IMPORT].filter(Boolean).join(' ');
}

try { start(); } catch { /* Tracing must never make a test fail. */ }
