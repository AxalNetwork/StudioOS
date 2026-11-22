/**
 * #7741 (D7741) — private research payloads stay out of git.
 *
 * The `.gitignore` block headed "D7741 (#7741)" is the prevention. This file is
 * the check that runs after a commit exists: it feeds `git ls-files -z` to a
 * pure name matcher (and, once #7742 adds one, a content marker read from each
 * tracked file's first bytes) and fails on a tracked match, printing the path
 * only. A tripped check is an incident (D7741): the branch is already public.
 *
 * Every payload-style name below is invented. Reader cases use only synthetic
 * bytes in temporary directories, removed afterward. No private payload is
 * committed, as a fixture or otherwise.
 *
 * Run alone:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/private_payload_guard_7741.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The `.gitignore` block, line for line (the test below holds them equal). */
export const PRIVATE_PAYLOAD_PATTERNS = Object.freeze([
  '*.private.*',
  'private-payloads/',
  '*import-package*.json',
  '*import_package*.json',
  '*four-source*',
  '*four_source*',
  '*4-source*',
  '*4_source*',
  '*capture*.zip',
  '*capture*.tar',
  '*capture*.tar.gz',
  '*capture*.tgz',
  '*capture*.7z',
]);

/**
 * Byte strings that mark a private payload by its content, so a renamed file
 * is still caught. Empty for now: #7742 adds the package format's marker.
 */
export const PRIVATE_PAYLOAD_CONTENT_MARKERS = Object.freeze([]);

/** How much of each tracked file the content check reads. */
export const CONTENT_HEAD_BYTES = 4096;

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * A `.gitignore` pattern with no slash but a trailing one, as a regular
 * expression over a repository path. `*` never crosses a `/`; a pattern
 * matches a name at any depth; a trailing `/` matches a directory, so any path
 * below it. Case-insensitive on purpose: stricter than git on Linux.
 */
export function patternToRegExp(pattern) {
  const dir = pattern.endsWith('/');
  const body = (dir ? pattern.slice(0, -1) : pattern).split('*').map(escapeRe).join('[^/]*');
  return new RegExp(dir ? `(^|/)${body}/` : `(^|/)${body}$`, 'i');
}

/** True when a path is named like a private payload. */
export function matchesPrivatePayloadName(path, patterns = PRIVATE_PAYLOAD_PATTERNS) {
  return patterns.some((p) => patternToRegExp(p).test(path));
}

/** True when a file's first bytes carry one of the content markers. */
export function headHasMarker(head, markers = PRIVATE_PAYLOAD_CONTENT_MARKERS) {
  if (!head || markers.length === 0) return false;
  const buf = Buffer.isBuffer(head) ? head : Buffer.from(String(head));
  return markers.some((m) => buf.includes(Buffer.from(m)));
}

/**
 * The paths among `paths` that are private payloads, by name or, when markers
 * exist, by the first bytes `readHead(path)` returns. Returns paths only.
 */
export function findPrivatePayloads(paths, { patterns = PRIVATE_PAYLOAD_PATTERNS, markers = PRIVATE_PAYLOAD_CONTENT_MARKERS, readHead = () => null } = {}) {
  const found = [];
  for (const path of paths) {
    if (matchesPrivatePayloadName(path, patterns)) found.push(path);
    else if (markers.length > 0 && headHasMarker(readHead(path), markers)) found.push(path);
  }
  return found;
}

/** The failure text: one fixed sentence, then each path on its own line. */
export function formatFindings(paths) {
  return [
    `${paths.length} tracked path(s) named or marked like a private payload. This is an incident (D7741): open a private security advisory under SECURITY.md; a follow-up commit does not fix it.`,
    ...paths,
  ].join('\n');
}

function findGitEntry(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return join(dir, '.git');
    if (dirname(dir) === dir) return null;
  }
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  return env;
}

function runGit(cwd, args) {
  const r = spawnSync('git', args, { cwd, env: cleanGitEnv(), encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, error: r.error ?? null, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? '').trim() };
}

/**
 * Lists the tracked paths under `root`. Outside any git checkout it returns
 * `{ status: 'no-checkout' }` so the caller skips and says so. Inside one, a
 * git that cannot list files throws with the reason: the check never passes
 * because it could not look.
 */
export function listTrackedFiles(root, { gitEntry = findGitEntry, run = runGit } = {}) {
  const entry = gitEntry(root);
  if (!entry) return { status: 'no-checkout', reason: `no git checkout at or above ${root}` };
  const r = run(root, ['ls-files', '-z']);
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : r.stderr || `git exited ${r.status}`;
    throw new Error(`git cannot list tracked files inside the checkout at ${root} (${entry}): ${why}`);
  }
  return { status: 'listed', paths: r.stdout.toString('utf8').split('\0').filter(Boolean) };
}

function readHeadFrom(root, { flags = constants, open = openSync, stat = fstatSync, read = readSync } = {}) {
  return (path) => {
    if (!Number.isInteger(flags.O_RDONLY) || [flags.O_NOFOLLOW, flags.O_NONBLOCK].some((flag) => !Number.isInteger(flag) || flag <= 0)) {
      throw new Error('content-head reads require O_RDONLY, O_NOFOLLOW and O_NONBLOCK');
    }
    let fd;
    try {
      fd = open(join(root, path), flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EISDIR'].includes(error?.code)) return null;
      throw error;
    }
    try {
      if (!stat(fd).isFile()) return null;
      const buf = Buffer.alloc(CONTENT_HEAD_BYTES);
      return buf.subarray(0, read(fd, buf, 0, CONTENT_HEAD_BYTES, 0));
    } finally {
      closeSync(fd);
    }
  };
}

/** The lines of the D7741 block in `.gitignore`, comments and blanks dropped. */
function gitignoreBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('# D7741 (#7741)'));
  assert.ok(start >= 0, '.gitignore has no block headed "# D7741 (#7741)"');
  const out = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === '') break;
    if (!line.startsWith('#')) out.push(line.trim());
  }
  return out;
}

// ---- The matcher, on invented path lists --------------------------------

test('the matcher flags invented paths named like a private payload, at any depth and in any case', () => {
  const named = [
    'funds.private.json',
    'research/imports/sample.private.csv',
    'notes.PRIVATE.txt',
    'private-payloads/anything.bin',
    'research/private-payloads/nested/sample.json',
  ];
  for (const path of named) assert.deepEqual(findPrivatePayloads([path]), [path], path);
});

test('the matcher flags the shapes of the two delivered files: the import-package JSON and the four-source capture archive', () => {
  const delivered = [
    'funds-import-package-2026-11-19.json',
    'research/funds_import_package.json',
    'Research-Import-Package.JSON',
    'four-source-capture-2026-11-19.zip',
    'downloads/funds_four_source_capture.tar.gz',
    'research-4-source-capture.7z',
    'fund_4_source.json',
    'funds-capture-2026-11-19.zip',
    'funds_capture.tar',
    'funds_capture.tgz',
    'Funds-Capture.ZIP',
  ];
  for (const path of delivered) assert.deepEqual(findPrivatePayloads([path]), [path], path);
});

test('the matcher passes the tracked near misses it must not catch', () => {
  const clean = [
    'frontend/public/og/private.png',
    'cloudflare-worker/src/routes/private-data.ts',
    'backend/app/api/routes/private_data.py',
    'cloudflare-worker/src/services/channels/whatsappCapture.ts',
    'documentation/audits/portfolio-ux-2026-11-09/capture.mjs',
    'cloudflare-worker/sql/migrations/497_whatsapp_capture_import.sql',
    'documentation/import-package.md',
    'documentation/private-payloads.md',
    'cloudflare-worker/test/deck_payload_wiring_guard.test.mjs',
  ];
  assert.deepEqual(findPrivatePayloads(clean), []);
});

test('the content markers are an exported list, empty until #7742 adds the package format marker', () => {
  assert.ok(Array.isArray(PRIVATE_PAYLOAD_CONTENT_MARKERS));
  assert.deepEqual([...PRIVATE_PAYLOAD_CONTENT_MARKERS], []);
  let reads = 0;
  findPrivatePayloads(['a.json', 'b.txt'], { readHead: () => { reads += 1; return 'x'; } });
  assert.equal(reads, 0, 'with no markers no tracked file is read');
});

test('with a marker, a renamed payload is caught by its first bytes and nothing else is', () => {
  const marker = 'INVENTED-FORMAT-MARKER-7741';
  const heads = { 'renamed.json': `{"format":"${marker}","rows":[]}`, 'plain.json': '{"format":"other"}' };
  const found = findPrivatePayloads(['renamed.json', 'plain.json'], { markers: [marker], readHead: (p) => heads[p] });
  assert.deepEqual(found, ['renamed.json']);
});

test('the failure text prints only the paths, never a byte of the file', () => {
  const marker = 'INVENTED-FORMAT-MARKER-7741';
  const secret = 'invented-contact@example.com';
  const found = findPrivatePayloads(['x/renamed.bin', 'funds.private.json'], {
    markers: [marker],
    readHead: () => `${marker} ${secret}`,
  });
  const text = formatFindings(found);
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(1), ['x/renamed.bin', 'funds.private.json']);
  assert.ok(!text.includes(secret) && !text.includes(marker), text);
  assert.match(lines[0], /incident \(D7741\)/);
});

// ---- Listing tracked files ------------------------------------------------

test('outside any git checkout the listing says so, and the live run skips', () => {
  const r = listTrackedFiles('/invented/export', { gitEntry: () => null, run: () => assert.fail('git must not run') });
  assert.equal(r.status, 'no-checkout');
  assert.match(r.reason, /no git checkout/);
});

test('inside a checkout, a git that cannot list files fails the check with the reason', () => {
  assert.throws(
    () => listTrackedFiles('/invented/checkout', {
      gitEntry: () => '/invented/checkout/.git',
      run: () => ({ status: 128, error: null, stdout: Buffer.alloc(0), stderr: 'fatal: invented index failure' }),
    }),
    /cannot list tracked files.*fatal: invented index failure/,
  );
  assert.throws(
    () => listTrackedFiles('/invented/checkout', {
      gitEntry: () => '/invented/checkout/.git',
      run: () => ({ status: null, error: new Error('spawn git ENOENT'), stdout: Buffer.alloc(0), stderr: '' }),
    }),
    /cannot list tracked files.*spawn git ENOENT/,
  );
});

test('a real checkout whose .git is broken fails with git\'s own reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp7741-'));
  try {
    writeFileSync(join(dir, '.git'), 'gitdir: ./missing-git-dir\n');
    // git's wording differs by version ('not a git repository: …missing-git-dir' locally,
    // 'gitfile does not point to a valid repository' on the CI runner); its own 'fatal:' line is what must reach the message.
    assert.throws(() => listTrackedFiles(dir), /cannot list tracked files inside the checkout at .*: fatal: .*(not a git repository|valid repository|missing-git-dir)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Reading a bounded head from the opened file --------------------------

test('the reader returns at most 4096 bytes and closes regular, short and empty files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp7960-'));
  try {
    let fd;
    const readHead = readHeadFrom(dir, { open: (...args) => (fd = openSync(...args)) });
    const cases = [
      ['large.txt', Buffer.concat([Buffer.alloc(4096, 'a'), Buffer.from('outside the head')]), Buffer.alloc(4096, 'a')],
      ['short.txt', Buffer.from('synthetic bytes'), Buffer.from('synthetic bytes')],
      ['empty.txt', Buffer.alloc(0), Buffer.alloc(0)],
    ];
    for (const [name, content, expected] of cases) {
      writeFileSync(join(dir, name), content);
      assert.deepEqual(readHead(name), expected, name);
      assert.throws(() => fstatSync(fd), { code: 'EBADF' }, `${name}: descriptor closed`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reader ignores missing paths, non-files and final-component symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp7960-'));
  try {
    writeFileSync(join(dir, 'plain.txt'), 'synthetic target');
    mkdirSync(join(dir, 'folder'));
    symlinkSync('plain.txt', join(dir, 'link.txt'));
    let fd;
    const readHead = readHeadFrom(dir, { open: (...args) => (fd = openSync(...args)) });
    assert.equal(readHead('missing.txt'), null);
    assert.equal(readHead('plain.txt/child'), null);
    assert.equal(readHead('link.txt'), null);
    assert.equal(readHead('folder'), null);
    assert.throws(() => fstatSync(fd), { code: 'EBADF' }, 'non-file descriptor closed');
    assert.equal(readHeadFrom(dir, { open: () => { throw Object.assign(new Error('directory'), { code: 'EISDIR' }); } })('folder'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replacing the path after open does not replace the file being checked or read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp7960-'));
  try {
    writeFileSync(join(dir, 'candidate.txt'), 'the opened file');
    let fd;
    const readHead = readHeadFrom(dir, { open: (path, flags) => {
      fd = openSync(path, flags);
      renameSync(path, `${path}.opened`);
      mkdirSync(path);
      return fd;
    } });
    assert.equal(readHead('candidate.txt').toString(), 'the opened file');
    assert.throws(() => fstatSync(fd), { code: 'EBADF' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a FIFO without a writer is rejected without blocking', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp7960-'));
  try {
    const made = spawnSync('mkfifo', [join(dir, 'pipe')], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.error?.message ?? made.stderr);
    // Bound a regression in synchronous open in a child; use the actual reader.
    const script = `
      import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
      import { join } from 'node:path';
      const CONTENT_HEAD_BYTES = 4096;
      const readHeadFrom = ${readHeadFrom.toString()};
      if (readHeadFrom(process.argv[1])('pipe') !== null) process.exitCode = 1;
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir], {
      encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unexpected open errors fail the check instead of looking like absent content', () => {
  for (const code of ['EACCES', 'EIO']) {
    const error = Object.assign(new Error('synthetic open failure'), { code });
    assert.throws(() => readHeadFrom('/invented', { open: () => { throw error; } })('file'), (caught) => caught === error);
  }
});

test('metadata and read errors propagate after closing the opened descriptor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp7960-'));
  try {
    writeFileSync(join(dir, 'plain.txt'), 'synthetic bytes');
    for (const operation of ['stat', 'read']) {
      let fd;
      const error = Object.assign(new Error(`synthetic ${operation} failure`), { code: 'EIO' });
      const readHead = readHeadFrom(dir, {
        open: (...args) => (fd = openSync(...args)),
        [operation]: () => { throw error; },
      });
      assert.throws(() => readHead('plain.txt'), (caught) => caught === error);
      assert.throws(() => fstatSync(fd), { code: 'EBADF' }, `${operation}: descriptor closed`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unsupported secure-open flags fail before opening a path', () => {
  for (const name of ['O_RDONLY', 'O_NOFOLLOW', 'O_NONBLOCK']) {
    const flags = { ...constants, [name]: undefined };
    assert.throws(() => readHeadFrom('/invented', {
      flags,
      open: () => assert.fail('a path must not open without the required flags'),
    })('file'), /content-head reads require O_RDONLY, O_NOFOLLOW and O_NONBLOCK/);
  }
});

// ---- The live repository --------------------------------------------------

test('the .gitignore block holds exactly the matcher\'s patterns', () => {
  assert.deepEqual(gitignoreBlock(readFileSync(join(ROOT, '.gitignore'), 'utf8')), [...PRIVATE_PAYLOAD_PATTERNS]);
});

test('git check-ignore reports each pattern ignoring an invented sample name', (t) => {
  if (!findGitEntry(ROOT)) return t.skip(`no git checkout at or above ${ROOT}: skipped`);
  const samples = {
    '*.private.*': 'research/sample.private.json',
    'private-payloads/': 'private-payloads/sample.bin',
    '*import-package*.json': 'funds-import-package-sample.json',
    '*import_package*.json': 'funds_import_package_sample.json',
    '*four-source*': 'four-source-sample.zip',
    '*four_source*': 'four_source_sample.json',
    '*4-source*': 'sample-4-source.json',
    '*4_source*': 'sample_4_source.json',
    '*capture*.zip': 'funds-capture-sample.zip',
    '*capture*.tar': 'funds-capture-sample.tar',
    '*capture*.tar.gz': 'funds-capture-sample.tar.gz',
    '*capture*.tgz': 'funds-capture-sample.tgz',
    '*capture*.7z': 'funds-capture-sample.7z',
  };
  assert.deepEqual(Object.keys(samples), [...PRIVATE_PAYLOAD_PATTERNS], 'one sample per pattern');
  const r = runGit(ROOT, ['check-ignore', '--no-index', '-v', '-n', '--', ...Object.values(samples)]);
  assert.ok(r.status === 0 || r.status === 1, `git check-ignore failed: ${r.error?.message ?? r.stderr}`);
  const byPath = new Map(r.stdout.toString('utf8').split('\n').filter(Boolean).map((line) => {
    const [src, path] = line.split('\t');
    return [path, src];
  }));
  for (const [pattern, sample] of Object.entries(samples)) {
    const src = byPath.get(sample) ?? '';
    assert.match(src, /^\.gitignore:\d+:/, `${sample} is not ignored by .gitignore (${src || 'no answer'})`);
    assert.equal(src.replace(/^\.gitignore:\d+:/, ''), pattern, `${sample} is ignored by another line: ${src}`);
    assert.ok(matchesPrivatePayloadName(sample), `the matcher misses ${sample}`);
  }
});

test('no tracked file is named or marked like a private payload', (t) => {
  const listed = listTrackedFiles(ROOT);
  if (listed.status === 'no-checkout') return t.skip(`${listed.reason}: skipped, there is nothing to list`);
  assert.ok(listed.paths.length > 0, 'git listed no tracked files');
  const found = findPrivatePayloads(listed.paths, { readHead: readHeadFrom(ROOT) });
  assert.equal(found.length, 0, formatFindings(found));
});
