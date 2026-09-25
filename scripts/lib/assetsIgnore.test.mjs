/**
 * docs/.assetsignore keeps the build's own bookkeeping off the public hosts
 * (D271). Four questions, each answered against the thing itself rather than
 * a restatement of it:
 *
 *   1. What the file says — one literal, anchored name per line, exactly the
 *      three files meant, and never `_headers`.
 *   2. What wrangler does with it — the real `ignore` matcher, fed wrangler's
 *      own three defaults plus this text, decides which paths are skipped, so
 *      a line that would also hide `/.well-known/security.txt` or a page fails
 *      here rather than on a host.
 *   3. Whether wrangler still behaves that way — its bundled CLI is read for
 *      the default list and for the `_worker.js` refusal that the presence of
 *      this file switches off. A wrangler upgrade that changes either fails
 *      this test and names the version, because D271 rests on both.
 *   4. Whether the build obeys the rule — every file build-frontend.mjs writes
 *      into docs/ is named through lib/assetsIgnore.mjs and listed there, and
 *      the file is written after Vite and the prerender, before the stamp.
 *
 * `ignore` is the matcher wrangler bundles (5.3.x). It is not a declared
 * dependency here: it reaches the root node_modules through eslint, which the
 * root devDependencies pin. Declaring it churned 93 unrelated lockfile lines,
 * so the import is left transitive and fails loudly if eslint ever drops it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ignore from 'ignore';

import {
  ASSETS_IGNORE_ENTRIES,
  ASSETS_IGNORE_FILENAME,
  BUILD_STAMP_FILENAME,
  RETENTION_LEDGER_FILENAME,
  assetsIgnoreText,
} from './assetsIgnore.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const docsDir = join(root, 'docs');

/** Wrangler's own defaults, as `createAssetsIgnoreFunction` builds them. */
const WRANGLER_DEFAULTS = ['/.assetsignore', '/_redirects', '/_headers'];

/** The non-comment, non-blank lines of a gitignore-syntax text. */
const patternLines = (text) =>
  text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** The matcher wrangler would build for this docs/: its defaults, then the file. */
const matcherFor = (text) => {
  const ig = ignore().add([...WRANGLER_DEFAULTS, ...text.split('\n')]);
  return (p) => ig.test(p).ignored;
};

// ---------- 1. What the file says ----------

test('every line names one literal file at the root of docs/', () => {
  const lines = patternLines(assetsIgnoreText());
  assert.ok(lines.length > 0, 'the text holds no pattern at all');
  for (const line of lines) {
    assert.match(line, /^\/[A-Za-z0-9._-]+$/, `"${line}" is not one anchored, literal file name`);
  }
});

test('it lists exactly the two bookkeeping files and _worker.js, and never _headers', () => {
  const names = patternLines(assetsIgnoreText()).map((l) => l.slice(1)).sort();
  assert.deepEqual(names, [RETENTION_LEDGER_FILENAME, BUILD_STAMP_FILENAME, '_worker.js'].sort());
  for (const never of ['_headers', '_redirects', ASSETS_IGNORE_FILENAME]) {
    assert.ok(!names.includes(never), `${never} is listed; wrangler already skips it, and a line for _headers could switch the security headers off`);
  }
});

test('every entry carries its reason into the file as a comment', () => {
  const text = assetsIgnoreText();
  for (const { file, reason } of ASSETS_IGNORE_ENTRIES) {
    const at = text.indexOf(`\n/${file}\n`);
    assert.ok(at > 0, `/${file} is missing`);
    const before = text.slice(0, at).split('\n').pop();
    assert.equal(before, `# ${reason}`, `/${file} is not preceded by its own reason`);
  }
});

test('an entry that is not one literal root file, or has no reason, is refused', () => {
  const bad = [
    { file: '*.json', reason: 'a glob' },
    { file: '.well-known/security.txt', reason: 'a nested path' },
    { file: '..', reason: 'a parent reference' },
    { file: '.', reason: 'the directory itself' },
    { file: '', reason: 'nothing' },
    { file: '/.build-source', reason: 'already anchored' },
    { file: 'a b', reason: 'whitespace' },
    { file: '.build-source', reason: '   ' },
    { file: '.build-source' },
  ];
  for (const entry of bad) {
    assert.throws(() => assetsIgnoreText([entry]), /assetsIgnore:/, `accepted ${JSON.stringify(entry)}`);
  }
});

// ---------- 2. What wrangler does with it ----------

test('the matcher skips the bookkeeping and nothing a visitor should reach', () => {
  const skipped = matcherFor(assetsIgnoreText());
  for (const p of ['.asset-retention.json', '.build-source', '_worker.js', '_worker.js/index.js', '.assetsignore', '_headers', '_redirects']) {
    assert.equal(skipped(p), true, `${p} would be uploaded`);
  }
  for (const p of [
    'index.html',
    'about/index.html',
    'assets/index-abc123.js',
    'assets/.build-source',
    'assets/.asset-retention.json',
    '.well-known/security.txt',
    'sw.js',
    'CHANGELOG-user.md',
    'manifest.webmanifest',
  ]) {
    assert.equal(skipped(p), false, `${p} would be withheld from the public hosts`);
  }
});

test('without the file, wrangler would publish both bookkeeping files', () => {
  // The defect, stated as a measurement: wrangler's defaults alone hide neither.
  const skipped = matcherFor('');
  assert.equal(skipped('.asset-retention.json'), false);
  assert.equal(skipped('.build-source'), false);
});

// ---------- 3. Whether wrangler still behaves that way ----------

test('wrangler still skips only its three defaults, and only refuses _worker.js with no .assetsignore', () => {
  const pkgDir = join(root, 'cloudflare-worker', 'node_modules', 'wrangler');
  assert.ok(existsSync(pkgDir), 'cloudflare-worker/node_modules/wrangler is missing — run `npm ci` in cloudflare-worker/; this is the wrangler that deploys');
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  const cli = readFileSync(join(pkgDir, 'wrangler-dist', 'cli.js'), 'utf8');
  const recheck = `wrangler ${version} changed how it reads .assetsignore; re-verify D271 against its createAssetsIgnoreFunction before trusting docs/.assetsignore`;

  const consts = {};
  for (const [, name, value] of cli.matchAll(/\b(CF_ASSETS_IGNORE_FILENAME|REDIRECTS_FILENAME|HEADERS_FILENAME) = "([^"]+)"/g)) {
    consts[name] = value;
  }
  assert.deepEqual(consts, {
    CF_ASSETS_IGNORE_FILENAME: '.assetsignore',
    REDIRECTS_FILENAME: '_redirects',
    HEADERS_FILENAME: '_headers',
  }, recheck);

  const start = cli.indexOf('async function createAssetsIgnoreFunction(');
  assert.ok(start > 0, recheck);
  const body = cli.slice(start, cli.indexOf('\n}\n', start));
  const defaults = [...body.matchAll(/`\/\$\{(\w+)\}`/g)].map((m) => `/${consts[m[1]]}`);
  assert.deepEqual(defaults, WRANGLER_DEFAULTS, recheck);
  assert.match(body, /\.split\("\\n"\)/, recheck);

  // The presence of the file is what switches the _worker.js refusal off —
  // which is why the list carries /_worker.js.
  assert.match(cli, /function errorOnLegacyPagesWorkerJSAsset\((\w+), (\w+)\) \{\s*if \(!\2\) \{/, recheck);
});

// ---------- 4. Whether the build obeys the rule ----------

/** build-frontend.mjs with its comments removed, so prose cannot satisfy or trip a check. */
function buildCode() {
  return readFileSync(join(root, 'scripts', 'build-frontend.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

test('every file the build writes into docs/ is named through lib/assetsIgnore.mjs and listed there', () => {
  const code = buildCode();
  const imported = /import\s*\{([^}]*)\}\s*from\s*'\.\/lib\/assetsIgnore\.mjs'/.exec(code);
  assert.ok(imported, 'build-frontend.mjs no longer imports lib/assetsIgnore.mjs');
  const names = new Set(imported[1].split(',').map((s) => s.trim()).filter(Boolean));
  const values = { ASSETS_IGNORE_FILENAME, BUILD_STAMP_FILENAME, RETENTION_LEDGER_FILENAME };
  const listed = new Set(ASSETS_IGNORE_ENTRIES.map((e) => e.file));

  const joins = [...code.matchAll(/path\.join\(\s*docsDir\s*,\s*([^)]+?)\s*\)/g)].map((m) => m[1]);
  assert.ok(joins.length >= 4, `expected the assets dir and three bookkeeping paths, found ${joins.length}`);
  const pathVars = new Map();
  for (const m of code.matchAll(/const\s+(\w+)\s*=\s*path\.join\(\s*docsDir\s*,\s*([^)]+?)\s*\)/g)) pathVars.set(m[1], m[2]);
  for (const arg of joins) {
    if (arg === "'assets'") continue;
    assert.ok(names.has(arg) && arg in values, `path.join(docsDir, ${arg}) names a file in docs/ that lib/assetsIgnore.mjs does not`);
    if (arg !== 'ASSETS_IGNORE_FILENAME') {
      assert.ok(listed.has(values[arg]), `${arg} (${values[arg]}) is written into docs/ and not listed, so the upload would publish it`);
    }
  }

  const writes = [...code.matchAll(/fs\.writeFileSync\(\s*(\w+)\s*,/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ['ignorePath', 'ledgerPath', 'stampPath']);
  for (const w of writes) assert.ok(pathVars.has(w), `${w} is not a path built from docsDir and a name the module owns`);

  for (const literal of ['.asset-retention.json', '.build-source', '.assetsignore']) {
    assert.ok(!code.includes(literal), `build-frontend.mjs spells ${literal} itself instead of importing it`);
  }
});

test('the file is written after Vite and the prerender, and before the stamp', () => {
  const code = buildCode();
  const write = 'fs.writeFileSync(ignorePath, assetsIgnoreText())';
  assert.equal(code.split(write).length - 1, 1, 'the .assetsignore write must happen exactly once');
  const at = code.indexOf(write);
  const vite = code.indexOf("execSync('npm run build'");
  const og = code.indexOf('scripts/prerender-og.mjs');
  const stamp = code.indexOf('fs.writeFileSync(stampPath');
  assert.ok(vite > 0 && og > 0 && stamp > 0, 'an anchor this order check reads has moved');
  assert.ok(at > vite, 'written before Vite, which empties docs/ and deletes it');
  assert.ok(at > og, 'written before the prerender');
  assert.ok(at < stamp, 'written after the stamp, which is meant to be the last write');
});

// ---------- The committed build ----------

/** Every file under docs/, relative with forward slashes, dotfiles included — what wrangler reads. */
function docsFiles(dir = docsDir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) docsFiles(p, out);
    else out.push(relative(docsDir, p).split(sep).join('/'));
  }
  return out;
}

test('the committed docs/ carries this exact file, and it withholds only the bookkeeping', () => {
  const file = join(docsDir, ASSETS_IGNORE_FILENAME);
  assert.ok(existsSync(file), 'docs/.assetsignore is missing — rebuild with the root `npm run build`');
  assert.equal(readFileSync(file, 'utf8'), assetsIgnoreText(), 'docs/.assetsignore differs from what the build writes — rebuild');

  const skipped = matcherFor(assetsIgnoreText());
  const withheld = docsFiles().filter(skipped).sort();
  const expected = ['.assetsignore', '.build-source', '_headers'];
  if (existsSync(join(docsDir, RETENTION_LEDGER_FILENAME))) expected.push(RETENTION_LEDGER_FILENAME);
  assert.deepEqual(withheld, expected.sort(), 'the upload would withhold a file nobody chose to hide, or publish one it should not');
});
