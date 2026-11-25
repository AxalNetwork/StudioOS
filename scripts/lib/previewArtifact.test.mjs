/**
 * D7146 (#7146): the preview artifact is untrusted data. These build zips by
 * hand, so each refusal is exercised on the exact bytes an attacker would
 * send: a symlink, `../`, an absolute path, a control file, an executable
 * extension, a size lie, a bomb, too many files. Run:
 *
 *   node --test scripts/lib/previewArtifact.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { CONTROL_NAMES, LIMITS, nameProblem, readPreviewArchive } from './previewArtifact.mjs';

const CLI = new URL('../check-preview-artifact.mjs', import.meta.url).pathname;

/**
 * A zip from `{ name, data, mode, method, size, crc, localName }` entries. `mode` is the Unix
 * mode in the upper half of the external attributes (made-by Unix); the rest override what the
 * central directory says, so a test can lie about a size or a CRC.
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(e.name, 'utf8');
    const localName = Buffer.from(e.localName ?? e.name, 'utf8');
    const crc = e.crc ?? (crc32(data) >>> 0);
    const size = e.size ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = e.mode ?? (e.name.endsWith('/') ? 0o040755 : 0o100644);
    central.writeUInt32LE(((mode << 16) | (e.name.endsWith("/") ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + localName.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const INDEX = { name: 'index.html', data: '<!doctype html><title>x</title>' };
const refusal = (entries) => readPreviewArchive(zip(entries)).problems.join('\n');

test('a docs/ build of static files is accepted byte for byte', () => {
  const { files, problems } = readPreviewArchive(zip([
    INDEX,
    { name: 'assets/', data: '' },
    { name: 'assets/index-AbC_12.js', data: 'console.log(1)'.repeat(500) },
    { name: 'assets/__vite-browser-external-D2U8RZpp.js', data: 'export {}' },
    { name: 'login/index.html', data: '<p>login</p>', method: 0 },
    { name: '.well-known/', data: '' },
    { name: '.well-known/security.txt', data: 'Contact: x' },
    { name: 'manifest.webmanifest', data: '{}' },
    { name: 'og/company.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ]));
  assert.deepEqual(problems, []);
  assert.deepEqual([...files.keys()].sort(), ['.well-known/security.txt', 'assets/__vite-browser-external-D2U8RZpp.js', 'assets/index-AbC_12.js', 'index.html', 'login/index.html', 'manifest.webmanifest', 'og/company.png']);
  assert.equal(files.get('assets/index-AbC_12.js').toString(), 'console.log(1)'.repeat(500));
});

test('a symlink, or any entry that is not a regular file or directory, refuses the whole archive', () => {
  // Mutation checked: kindOf() returning 'file' for every mode.
  assert.match(refusal([INDEX, { name: 'evil.js', data: '/etc/passwd', mode: 0o120777 }]), /"evil\.js": a symlink/);
  assert.match(refusal([INDEX, { name: 'fifo.js', data: '', mode: 0o010644 }]), /not a regular file/);
  assert.equal(readPreviewArchive(zip([INDEX, { name: 'evil.js', data: 'x', mode: 0o120777 }])).files.size, 0, 'nothing is returned when anything is refused');
});

test('path traversal, absolute paths and odd names are refused', () => {
  // Mutation checked: removing the `.`/`..` segment check is equivalent (the segment charset already
  // refuses a leading dot); it stays as the explicit rule.
  for (const name of ['../escape.js', 'assets/../../escape.js', '/etc/cron.d/x.js', 'a\\b.js', 'a//b.js', './index.js', 'assets/.hidden.js', 'sp ace.js', 'semi;colon.js', 'ünï.js', '.well-known', 'x/.well-known/a.txt']) {
    assert.ok(nameProblem(name), `${name} must be refused`);
    assert.ok(refusal([INDEX, { name, data: 'x' }]), `${name} must refuse the archive`);
  }
  assert.equal(nameProblem('a/'.repeat(LIMITS.depth) + 'x.js'), 'deeper than ' + LIMITS.depth);
  assert.match(refusal([INDEX, { name: 'Index.HTML', data: 'x' }]), /duplicate name/);
  assert.match(refusal([INDEX, { name: 'ok.js', localName: '../ok.js', data: 'x' }]), /local header names another file/);
});

test('only static file types are accepted, and configuration files never come from the artifact', () => {
  // Mutation checked: 'sh' added to ALLOWED_EXTENSIONS; CONTROL_NAMES emptied.
  for (const name of ['run.sh', 'package.json.bak', 'worker.wasm', 'Makefile', 'x.cjs', 'x.ts', 'a/b/node', 'favicon']) {
    assert.match(nameProblem(name) ?? '', /not a static file type/, name);
  }
  for (const name of [...CONTROL_NAMES, 'nested/_worker.js']) {
    assert.ok(nameProblem(name), `${name} is configuration`);
  }
  assert.match(nameProblem('_headers'), /configuration/);
  assert.match(nameProblem('_redirects'), /configuration/);
  assert.match(nameProblem('_worker.js'), /configuration/);
});

test('every file the build copies from frontend/public is a type the preview accepts', () => {
  // #8468: eleven program-brief PDFs in frontend/public made every preview artifact refused, and no test
  // noticed, because each case named its own files. The build copies frontend/public into docs/ whole, so
  // every name there must pass; the configuration files are the trusted job's to write, not the artifact's.
  // Mutation checked: 'pdf' removed from ALLOWED_EXTENSIONS fails here naming the eleven briefs.
  const root = new URL('../../frontend/public/', import.meta.url).pathname;
  const walk = (dir, rel = '') => readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const name = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, name) : [name];
  });
  const files = walk(root).filter((name) => !CONTROL_NAMES.includes(name.split('/').at(-1)));
  assert.ok(files.length > 100, `${files.length} files under frontend/public`);
  assert.ok(files.some((name) => name.endsWith('.pdf')), 'the program briefs are still there');
  assert.deepEqual(files.map((name) => [name, nameProblem(name)]).filter(([, problem]) => problem), []);
});

test('size lies, CRC mismatches, encryption, odd methods and bombs are refused', () => {
  // Mutation checked: the CRC comparison removed; maxOutputLength removed.
  assert.match(refusal([INDEX, { name: 'a.js', data: 'hello', crc: 1 }]), /CRC mismatch/);
  assert.match(refusal([INDEX, { name: 'a.js', data: 'hello world', size: 3 }]), /does not inflate to its declared size|but the directory says/);
  assert.match(refusal([INDEX, { name: 'a.js', data: 'hello', method: 0, size: 2 }]), /but the directory says 2/);
  assert.match(refusal([INDEX, { name: 'a.js', data: 'x', flags: 1 }]), /encrypted/);
  assert.match(refusal([INDEX, { name: 'a.js', data: 'x', method: 12 }]), /compression method 12/);
  const bomb = Buffer.alloc(LIMITS.fileBytes + 1);
  assert.match(refusal([INDEX, { name: 'big.js', data: bomb }]), /per-file cap/);
  assert.match(refusal([INDEX, { name: 'small-claim.js', data: bomb, size: 10 }]), /does not inflate to its declared size/);
});

test('the file-count and total-size caps hold', () => {
  // Mutation checked: LIMITS.files raised to 1e9.
  const many = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ name: `f${i}.js`, data: '', method: 0 }));
  assert.match(refusal([INDEX, ...many]), new RegExp(`more than ${LIMITS.files} files`));
  const chunk = Buffer.alloc(LIMITS.fileBytes);
  const heavy = Array.from({ length: Math.ceil(LIMITS.totalBytes / LIMITS.fileBytes) + 1 }, (_, i) => ({ name: `h${i}.js`, data: chunk }));
  assert.match(refusal([INDEX, ...heavy]), /bytes uncompressed/);
});

test('not a zip, ZIP64 markers, and an archive without index.html are refused', () => {
  assert.match(readPreviewArchive(Buffer.from('not a zip at all, just some bytes here')).problems[0], /end-of-central-directory/);
  const z = zip([INDEX]);
  z.writeUInt32LE(0xffffffff, z.length - 6);
  assert.match(readPreviewArchive(z).problems[0], /ZIP64/);
  assert.match(refusal([{ name: 'a.js', data: 'x' }]), /no index\.html/);
});

test('the CLI unpacks an accepted archive into an empty directory, and writes nothing for a refused one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preview-artifact-'));
  try {
    const good = join(dir, 'good.zip');
    writeFileSync(good, zip([INDEX, { name: 'assets/a.js', data: 'ok' }]));
    const out = join(dir, 'docs');
    const ok = spawnSync(process.execPath, [CLI, '--zip', good, '--out', out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(join(out, 'assets/a.js'), 'utf8'), 'ok');
    const again = spawnSync(process.execPath, [CLI, '--zip', good, '--out', out], { encoding: 'utf8' });
    assert.equal(again.status, 1, 'a non-empty output directory is refused');
    assert.match(again.stderr, /not empty/);

    const bad = join(dir, 'bad.zip');
    writeFileSync(bad, zip([INDEX, { name: 'assets/a.js', data: 'ok' }, { name: '../../escape.js', data: 'x' }]));
    const out2 = join(dir, 'docs2');
    const refused = spawnSync(process.execPath, [CLI, '--zip', bad, '--out', out2], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /::error::preview artifact refused: "\.\.\/\.\.\/escape\.js"/);
    assert.equal(existsSync(out2), false, 'a refused archive writes nothing');
    assert.equal(existsSync(join(dir, '..', 'escape.js')), false);
    mkdirSync(join(dir, 'empty'));
    assert.deepEqual(readdirSync(join(dir, 'empty')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
