/** D7905/D8010: the trace exporter streams a bounded USTAR archive into a private, completed offer; it never extracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTraceExporter, ustarReader, EXPORT_LIMITS } from '../../scripts/ci/runners/trace-exporter.mjs';

const CID = 'b'.repeat(64), NOW = 1800000000000;
const receipt = () => ({ version: 1, repository: 'AxalNetwork/StudioOS', profile: 'linux-x64', requestId: '00000000-0000-4000-8000-000000000001', logicalShard: 'worker-1-of-6', childRunId: 202, childAttempt: 1, generation: 1, executionDeadline: NOW + 600000, event: 'push', sourceSha: 'e'.repeat(40) });
const TRACE = 'traces/123-1795283662320.83.trace.json';

/** One USTAR header block; `patch` overrides raw fields to build hostile members. */
function header({ name, size = 0, type = '0', mode = 0o644, uid = 10000, gid = 10000, linkname = '', prefix = '', magic = 'ustar\0', version = '00', checksum = null }) {
  const b = Buffer.alloc(512);
  const put = (at, len, value) => b.write(value, at, len, 'latin1');
  const oct = (at, len, n) => put(at, len, n.toString(8).padStart(len - 1, '0') + '\0');
  put(0, 100, name); oct(100, 8, mode); oct(108, 8, uid); oct(116, 8, gid); oct(124, 12, size); oct(136, 12, 1700000000);
  b[156] = type.charCodeAt(0); put(157, 100, linkname); put(257, 6, magic); put(263, 2, version); put(345, 155, prefix);
  b.fill(32, 148, 156);
  let sum = 0; for (const byte of b) sum += byte;
  put(148, 8, (checksum ?? sum).toString(8).padStart(6, '0') + '\0 ');
  return b;
}
const pad = data => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
const END = Buffer.alloc(1024);
const file = (name, data, opts = {}) => Buffer.concat([header({ name, size: data.length, ...opts }), pad(data)]);
const dir = (name = 'traces/') => header({ name, type: '5', mode: 0o755 });
const trace = (n = 1) => Buffer.from(JSON.stringify({ isTest: true, file: `t${n}.test.mjs`, exitCode: 0 }));
const archive = (...parts) => Buffer.concat([...parts, END]);
const valid = () => archive(dir(), file(TRACE, trace()), file('traces/124-1795283662419.369.trace.json', trace(2)));

function read(bytes, limits) {
  const files = [];
  const r = ustarReader({ onFile: f => files.push(f), limits });
  for (let i = 0; i < bytes.length; i += 333) r.push(bytes.subarray(i, i + 333)); // arbitrary chunking
  return { ...r.end(), files };
}

test('D8010 the reader admits one traces/ directory and direct candidate-owned trace files, in any chunking', () => {
  const result = read(valid());
  assert.deepEqual([result.files.length, result.expandedBytes], [2, trace().length + trace(2).length]);
  assert.deepEqual(result.files.map(f => [f.name, f.uid, f.gid, f.mode]), [[TRACE, 10000, 10000, 0o644], ['traces/124-1795283662419.369.trace.json', 10000, 10000, 0o644]]);
  assert.deepEqual(read(archive(dir(), file(TRACE, trace(), { mode: 0o600 }))).files[0].mode, 0o600);
  assert.equal(read(Buffer.concat([valid(), Buffer.alloc(5120)])).files.length, 2, 'bounded zero padding after the end markers');
  assert.equal(read(archive(file(TRACE, trace()))).files.length, 1, 'the traces/ directory header is optional (D8010)');
});

test('D8010 the reader refuses every hostile member, encoding and stream shape before anything is written', () => {
  const cases = [
    ['symlink', archive(dir(), header({ name: TRACE, type: '2', linkname: '/home/listener/.credentials' })), 'archive_member_type_refused'],
    ['hardlink', archive(dir(), header({ name: TRACE, type: '1', linkname: 'traces/x' })), 'archive_member_type_refused'],
    ['regular file carrying a link name', archive(dir(), file(TRACE, trace(), { linkname: '/etc/shadow' })), 'archive_link_refused'],
    ['gzip transport', Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), 'archive_compressed_refused'],
    ['device', archive(dir(), header({ name: TRACE, type: '3' })), 'archive_member_type_refused'],
    ['fifo', archive(dir(), header({ name: TRACE, type: '6' })), 'archive_member_type_refused'],
    ['pax', archive(dir(), file('traces/PaxHeader', Buffer.from('30 path=x\n'), { type: 'x' })), 'archive_member_type_refused'],
    ['gnu long name', archive(dir(), file('././@LongLink', Buffer.from('x'), { type: 'L' })), 'archive_member_type_refused'],
    ['sparse', archive(dir(), file(TRACE, trace(), { type: 'S' })), 'archive_member_type_refused'],
    ['gnu magic', archive(header({ name: 'traces/', type: '5', magic: 'ustar ', version: ' \0' })), 'archive_format_unsupported'],
    ['traversal', archive(dir(), file('traces/../123-1795283662320.trace.json', trace())), 'archive_path_refused'],
    ['absolute', archive(dir(), file('/traces/123-1795283662320.trace.json', trace())), 'archive_path_refused'],
    ['backslash', archive(dir(), file('traces\\123-1795283662320.trace.json', trace())), 'archive_path_refused'],
    ['nested', archive(dir(), file('traces/a/123-1795283662320.trace.json', trace())), 'archive_path_refused'],
    ['not a trace name', archive(dir(), file('traces/notes.txt', trace())), 'archive_path_refused'],
    ['prefix field', archive(dir(), file(TRACE, trace(), { prefix: 'x' })), 'archive_prefix_refused'],
    ['second directory', archive(dir(), dir('traces/a/')), 'archive_directory_refused'],
    ['duplicate path', archive(dir(), file(TRACE, trace()), file(TRACE, trace(2))), 'archive_duplicate_path'],
    ['wrong owner', archive(dir(), file(TRACE, trace(), { uid: 10001 })), 'archive_source_identity_refused'],
    ['wrong mode', archive(dir(), file(TRACE, trace(), { mode: 0o4755 })), 'archive_source_identity_refused'],
    ['bad checksum', archive(dir(), file(TRACE, trace(), { checksum: 1 })), 'archive_header_checksum'],
    ['empty file', archive(dir(), header({ name: TRACE, size: 0 })), 'archive_file_size_limit'],
    ['zero block inside', Buffer.concat([dir(), Buffer.alloc(512), file(TRACE, trace()), END]), 'archive_zero_block_inside'],
    ['concatenated', Buffer.concat([valid(), valid()]), 'archive_trailing_data'],
    ['trailing nonzero', Buffer.concat([valid(), Buffer.from('x')]), 'archive_trailing_data'],
    ['truncated', valid().subarray(0, 1100), 'archive_truncated'],
    ['no end markers', Buffer.concat([dir(), file(TRACE, trace())]), 'archive_truncated'],
    ['no files', archive(dir()), 'archive_missing_traces'],
  ];
  for (const [name, bytes, code] of cases) {
    const written = [];
    assert.throws(() => { const r = ustarReader({ onFile: f => written.push(f) }); r.push(bytes); r.end(); }, e => e.code === code, name);
    // Earlier well-formed members may have been read; the refused member itself never is, and the exporter publishes nothing.
    assert.ok(written.every(f => /^traces\/12[34]-[0-9.]+\.trace\.json$/.test(f.name) && f.uid === 10000 && f.type !== '2'), `${name}: the hostile member is never admitted`);
  }
});

test('D8010 the reader enforces the declared and actual file, count, expanded and archive limits', () => {
  const small = { ...EXPORT_LIMITS, files: 1, fileBytes: 64, totalBytes: 100, archiveBytes: 4096 };
  assert.throws(() => read(archive(dir(), file(TRACE, Buffer.alloc(65, 'a'))), small), e => e.code === 'archive_file_size_limit');
  assert.throws(() => read(archive(dir(), file(TRACE, trace()), file('traces/124-1795283662320.trace.json', trace())), small), e => e.code === 'archive_file_count_limit');
  assert.throws(() => read(archive(dir(), file(TRACE, Buffer.alloc(60, 'a')), file('traces/124-1795283662320.trace.json', Buffer.alloc(60, 'a'))), { ...small, files: 9 }), e => e.code === 'archive_expanded_size_limit');
  assert.throws(() => read(Buffer.concat([valid(), Buffer.alloc(8192)]), { ...EXPORT_LIMITS, archiveBytes: 4096 }), e => e.code === 'archive_size_limit');
  // A declared size larger than the bytes that follow is truncation, never a short file.
  assert.throws(() => read(Buffer.concat([dir(), header({ name: TRACE, size: 4000 }), Buffer.alloc(512, 1), END])), e => e.code === 'archive_padding_invalid' || e.code === 'archive_truncated');
});

test('D8010 a real `tar --format=ustar` archive is accepted; the same files in GNU format are refused', t => {
  const root = mkdtempSync(join(tmpdir(), 'tar-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'traces'));
  writeFileSync(join(root, TRACE), trace()); writeFileSync(join(root, 'traces/124-1795283662419.369.trace.json'), trace(2));
  const make = format => spawnSync('tar', ['-C', root, `--format=${format}`, '--owner=10000', '--group=10000', '--numeric-owner', '--mode=u=rw,go=r', '-cf', '-', 'traces'], { maxBuffer: 1 << 20 });
  const ustar = make('ustar'); assert.equal(ustar.status, 0);
  assert.deepEqual(read(ustar.stdout).files.map(f => f.name).sort(), [TRACE, 'traces/124-1795283662419.369.trace.json'].sort());
  const gnu = make('gnu'); assert.equal(gnu.status, 0);
  assert.throws(() => read(gnu.stdout), e => e.code === 'archive_format_unsupported');
});

const clocked = new WeakSet();
function exporterFixture(t, { bytes = valid(), copy = null, pauseFails = false, stageMode = null } = {}) {
  if (!clocked.has(t)) { t.mock.timers.enable({ apis: ['Date'], now: NOW }); clocked.add(t); }
  const root = mkdtempSync(join(tmpdir(), 'export-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const stagingRoot = join(root, 'trace-export'), tarFile = join(root, 'archive.tar'); writeFileSync(tarFile, bytes);
  if (stageMode !== null) { mkdirSync(stagingRoot, { mode: 0o700 }); chmodSync(stagingRoot, stageMode); }
  const calls = [];
  const engine = args => { calls.push(args); if (args[0] === 'pause' && pauseFails) throw new Error('engine down'); return ''; };
  const spawnCopy = args => { calls.push(args); return copy ? copy(tarFile) : spawn('/bin/cat', [tarFile], { stdio: ['ignore', 'pipe', 'ignore'] }); };
  const exporter = createTraceExporter({ stagingRoot, engine, spawnCopy });
  const go = (extra = {}) => exporter({ receipt: receipt(), container: { id: CID, owner: '202-1-1' }, observedTest: { phase: 'test', status: 'success', exitCode: 0 }, deadline: NOW + 60000, ...extra });
  return { root, stagingRoot, calls, go, ready: join(stagingRoot, '202-1-1', 'ready') };
}

test('D8010 export: pause, real streamed copy, private 0400 files, COMPLETE.json written last, published as ready', async t => {
  const f = exporterFixture(t);
  const result = await f.go();
  assert.deepEqual([result.state, result.files], ['complete', 2]);
  assert.deepEqual(f.calls.map(c => c[0]), ['pause', 'cp'], 'quiesced before the copy; never stopped (tmpfs would be lost)');
  assert.deepEqual(f.calls[1], ['cp', `${CID}:/work/traces`, '-']);
  assert.deepEqual(readdirSync(f.ready).sort(), ['COMPLETE.json', 'traces']);
  assert.equal(existsSync(join(f.stagingRoot, '202-1-1', 'pending')), false);
  for (const path of [join(f.stagingRoot), join(f.stagingRoot, '202-1-1'), f.ready, join(f.ready, 'traces')]) assert.equal(statSync(path).mode & 0o777, 0o700, path);
  const bytes = readFileSync(join(f.ready, 'COMPLETE.json'));
  const envelope = JSON.parse(bytes);
  assert.equal(bytes.toString(), JSON.stringify(envelope) + '\n', 'compact JSON plus one LF, round-trips');
  assert.deepEqual(Object.keys(envelope).sort(), ['container', 'evidenceClass', 'files', 'observedTest', 'receipt', 'schema', 'transport']);
  assert.deepEqual([envelope.schema, envelope.evidenceClass, envelope.container, envelope.receipt.childRunId, envelope.observedTest.status], ['studioos.trace-export.v1', 'native-unqualified', { id: CID, owner: '202-1-1' }, 202, 'success']);
  assert.deepEqual(envelope.transport, { format: 'uncompressed-ustar', complete: true, archiveBytes: valid().length, expandedBytes: trace().length + trace(2).length });
  for (const entry of envelope.files) {
    const data = readFileSync(join(f.ready, entry.path));
    assert.equal(entry.digest, 'sha256:' + createHash('sha256').update(data).digest('hex'));
    assert.deepEqual([entry.type, entry.sourceUid, entry.sourceGid, entry.sourceLinks, entry.sourceMode, entry.bytes], ['file', 10000, 10000, 1, 0o644, data.length]);
    assert.equal(statSync(join(f.ready, entry.path)).mode & 0o777, 0o400);
  }
  assert.equal(statSync(join(f.ready, 'COMPLETE.json')).mode & 0o777, 0o400);
});

test('D8010 every failed export leaves no ready offer and reports the stage that failed', async t => {
  const checks = [
    [{ bytes: archive(dir(), header({ name: TRACE, type: '2', linkname: '/etc/shadow' })) }, 'copy', 'archive_member_type_refused'],
    [{ bytes: valid().subarray(0, 1100) }, 'copy', 'archive_truncated'],
    [{ pauseFails: true }, 'quiesce', 'export_unexpected'],
    [{ copy: tar => spawn('/bin/sh', ['-c', `cat '${tar}'; exit 3`], { stdio: ['ignore', 'pipe', 'ignore'] }) }, 'copy', 'export_engine_copy_failed'],
    [{ stageMode: 0o755 }, 'stage', 'export_stage_unsafe'],
  ];
  for (const [options, phase, reason] of checks) {
    const f = exporterFixture(t, options);
    assert.deepEqual(await f.go(), { state: 'failed', phase, reason }, reason);
    assert.equal(existsSync(f.ready), false, reason);
  }
  const hang = exporterFixture(t, { copy: () => spawn('/bin/sleep', ['30'], { stdio: ['ignore', 'pipe', 'ignore'] }) });
  const controller = new AbortController(); setTimeout(() => controller.abort(), 50);
  assert.deepEqual(await hang.go({ signal: controller.signal }), { state: 'failed', phase: 'copy', reason: 'export_cancelled' });
  const slow = exporterFixture(t, { copy: () => spawn('/bin/sleep', ['30'], { stdio: ['ignore', 'pipe', 'ignore'] }) });
  assert.deepEqual(await slow.go({ deadline: NOW + 50 }), { state: 'failed', phase: 'copy', reason: 'export_budget_exhausted' });
  const late = exporterFixture(t);
  assert.deepEqual(await late.go({ deadline: NOW - 1 }), { state: 'failed', phase: 'stage', reason: 'export_budget_exhausted' });
  assert.deepEqual(late.calls, [], 'no pause or copy without budget');
});

test('D8010 one offer per context: a second export, even identical, is a competing offer; the owner must match the receipt', async t => {
  const f = exporterFixture(t);
  assert.equal((await f.go()).state, 'complete');
  assert.deepEqual(await f.go(), { state: 'failed', phase: 'stage', reason: 'export_competing_offer' });
  assert.deepEqual(await f.go({ container: { id: CID, owner: '202-1-2' } }), { state: 'failed', phase: 'stage', reason: 'export_container_invalid' });
  assert.deepEqual(await f.go({ container: { id: 'name', owner: '202-1-1' } }), { state: 'failed', phase: 'stage', reason: 'export_container_invalid' });
});

test('D8010 staged files are created exclusively, never through a link, and end private 0400', async t => {
  const { writeExclusive } = await import('../../scripts/ci/runners/trace-exporter.mjs');
  const { symlinkSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'excl-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  await writeExclusive(join(root, 'a'), Buffer.from('x'), 0o400);
  assert.equal(statSync(join(root, 'a')).mode & 0o777, 0o400);
  await assert.rejects(writeExclusive(join(root, 'a'), Buffer.from('y'), 0o400), /EEXIST/);
  writeFileSync(join(root, 'target'), 'listener secret'); symlinkSync(join(root, 'target'), join(root, 'link'));
  await assert.rejects(writeExclusive(join(root, 'link'), Buffer.from('y'), 0o400), /EEXIST|ELOOP/);
  assert.equal(readFileSync(join(root, 'target'), 'utf8'), 'listener secret');
});

test('S32 E1: a pause that outlives the budget, or an abort during or before the copy, never publishes an offer', async t => {
  // Pause advances the clock past the export deadline; the copy itself would succeed instantly.
  let f = exporterFixture(t);
  const late = createTraceExporter({ stagingRoot: f.stagingRoot, now: () => clock.now, engine: args => { if (args[0] === 'pause') clock.now += 61_000; return ''; },
    spawnCopy: () => spawn('/bin/cat', [join(f.root, 'archive.tar')], { stdio: ['ignore', 'pipe', 'ignore'] }) });
  const clock = { now: NOW };
  assert.deepEqual(await late({ receipt: receipt(), container: { id: CID, owner: '202-1-1' }, observedTest: null, deadline: NOW + 60_000 }), { state: 'failed', phase: 'copy', reason: 'export_budget_exhausted' });
  assert.equal(existsSync(f.ready), false);
  // The pause itself aborts the signal: the copy must not start, and nothing is published.
  f = exporterFixture(t);
  const controller = new AbortController(); let copies = 0;
  const aborted = createTraceExporter({ stagingRoot: f.stagingRoot, now: () => NOW, engine: args => { if (args[0] === 'pause') controller.abort(); return ''; },
    spawnCopy: () => { copies++; return spawn('/bin/cat', [join(f.root, 'archive.tar')], { stdio: ['ignore', 'pipe', 'ignore'] }); } });
  assert.deepEqual(await aborted({ receipt: receipt(), container: { id: CID, owner: '202-1-1' }, observedTest: null, signal: controller.signal, deadline: NOW + 60_000 }), { state: 'failed', phase: 'copy', reason: 'export_cancelled' });
  assert.equal(copies, 0);
  assert.equal(existsSync(f.ready), false);
  // The budget runs out while the archive is sealed: no ready offer either.
  f = exporterFixture(t);
  let tick = NOW;
  const sealing = createTraceExporter({ stagingRoot: f.stagingRoot, now: () => tick, engine: () => '',
    spawnCopy: () => { const c = spawn('/bin/cat', [join(f.root, 'archive.tar')], { stdio: ['ignore', 'pipe', 'ignore'] }); c.once('close', () => { tick = NOW + 60_000; }); return c; } });
  assert.deepEqual(await sealing({ receipt: receipt(), container: { id: CID, owner: '202-1-1' }, observedTest: null, deadline: NOW + 60_000 }), { state: 'failed', phase: 'seal', reason: 'export_budget_exhausted' });
  assert.equal(existsSync(f.ready), false);
});

test('S32 E1 whole phase: a hung write, fsync or pause cannot hold the export past its deadline, and nothing publishes later', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const hang = () => { let release; const p = new Promise(resolve => { release = resolve; }); return { p, release: () => release() }; };
  const setup = options => {
    const root = mkdtempSync(join(tmpdir(), 'phase-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const tarFile = join(root, 'archive.tar'); writeFileSync(tarFile, valid());
    const stagingRoot = join(root, 'trace-export');
    const exporter = createTraceExporter({ stagingRoot, engine: () => '', spawnCopy: () => spawn('/bin/cat', [tarFile], { stdio: ['ignore', 'pipe', 'ignore'] }), ...options });
    return { ready: join(stagingRoot, '202-1-1', 'ready'), go: extra => exporter({ receipt: receipt(), container: { id: CID, owner: '202-1-1' }, observedTest: null, deadline: NOW + 200, ...extra }) };
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  // A write that never returns: the export fails at the deadline; releasing it afterwards publishes nothing.
  const { writeExclusive } = await import('../../scripts/ci/runners/trace-exporter.mjs');
  let gate = hang();
  let f = setup({ write: async (...args) => { await gate.p; return writeExclusive(...args); } });
  const started = performance.now();
  assert.deepEqual(await f.go(), { state: 'failed', phase: 'seal', reason: 'export_budget_exhausted' });
  assert.ok(performance.now() - started < 2000, 'returned at the deadline, not when the write finished');
  gate.release(); await settle();
  assert.equal(existsSync(f.ready), false, 'a late write never leads to a ready offer');
  // A directory fsync that never returns.
  gate = hang();
  f = setup({ sync: async () => { await gate.p; } });
  assert.deepEqual(await f.go(), { state: 'failed', phase: 'seal', reason: 'export_budget_exhausted' });
  gate.release(); await settle();
  assert.equal(existsSync(f.ready), false);
  // An abort while a write hangs is a cancellation, reported at once.
  gate = hang(); const controller = new AbortController();
  f = setup({ write: async (...args) => { setTimeout(() => controller.abort(), 10); await gate.p; return writeExclusive(...args); } });
  assert.deepEqual(await f.go({ signal: controller.signal, deadline: NOW + 60_000 }), { state: 'failed', phase: 'seal', reason: 'export_cancelled' });
  gate.release(); await settle();
  assert.equal(existsSync(f.ready), false);
  // A pause that hangs: the engine call is given the export budget, and the phase stops at the deadline anyway.
  const seen = [];
  f = setup({ engine: (args, options) => { seen.push(options); return new Promise(() => {}); } });
  assert.deepEqual(await f.go(), { state: 'failed', phase: 'quiesce', reason: 'export_budget_exhausted' });
  assert.ok(seen[0].timeout > 0 && seen[0].timeout <= 200, JSON.stringify(seen));
  // A stop that lands after the rename says the offer is published but not yet durable.
  let syncs = 0; gate = hang();
  f = setup({ sync: async () => { if (++syncs === 3) await gate.p; } });
  assert.deepEqual(await f.go(), { state: 'failed', phase: 'publish', reason: 'export_budget_exhausted', offer: 'published_unsynced' });
  assert.equal(existsSync(f.ready), true);
  gate.release();
});

test('S32 f13 recheck: a terminal fsync that returns after the deadline or after an abort is never reported complete', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const setup = options => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-7905-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const tarFile = join(root, 'archive.tar'); writeFileSync(tarFile, valid());
    const stagingRoot = join(root, 'trace-export');
    const exporter = createTraceExporter({ stagingRoot, engine: () => '', spawnCopy: () => spawn('/bin/cat', [tarFile], { stdio: ['ignore', 'pipe', 'ignore'] }), ...options });
    return { ready: join(stagingRoot, '202-1-1', 'ready'), go: extra => exporter({ receipt: receipt(), container: { id: CID, owner: '202-1-1' }, observedTest: null, deadline: NOW + 60_000, ...extra }) };
  };
  // The leaf fsync (the third directory sync, after the rename) crosses the deadline but returns normally.
  let syncs = 0;
  let f = setup({ sync: async () => { if (++syncs === 3) t.mock.timers.tick(60_000); } });
  assert.deepEqual(await f.go(), { state: 'failed', phase: 'publish', reason: 'export_budget_exhausted', offer: 'published' });
  assert.equal(existsSync(join(f.ready, 'COMPLETE.json')), true, 'the offer exists; the report says it was late, not complete');
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['Date'], now: NOW });
  // The run is cancelled while the leaf fsync is in flight, which then returns normally.
  syncs = 0; const controller = new AbortController();
  f = setup({ sync: async () => { if (++syncs === 3) controller.abort(); } });
  const result = await f.go({ signal: controller.signal });
  assert.deepEqual([result.state, result.phase, result.reason], ['failed', 'publish', 'export_cancelled']);
  assert.ok(['published', 'published_unsynced'].includes(result.offer), JSON.stringify(result));
  assert.equal(existsSync(join(f.ready, 'COMPLETE.json')), true);
  // Control: the same seam with no late event still completes.
  syncs = 0;
  f = setup({ sync: async () => { ++syncs; } });
  assert.equal((await f.go()).state, 'complete');
  assert.equal(syncs, 3);
});
