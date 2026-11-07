/**
 * D4558 (#4558) — the independent encrypted copy, on the owner's answers (A on
 * Q1–Q4, 2026-11-07): scripts/dr-second-copy.sh encrypts each export with age
 * to the owner's public key and puts it, write-once, in a bucket outside the
 * production account; dr-drill.sh's owner-run `DR_SOURCE=independent` mode
 * restores one. Run against a fake `aws` that keeps objects on disk and
 * refuses as S3 does (If-None-Match, a bad checksum), and the real `age`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dr_second_copy_d4558.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { describe } from '../../scripts/d1-backup-manifest.mjs';

const COPY = resolve(process.cwd(), 'scripts/dr-second-copy.sh');
const DRILL = resolve(process.cwd(), 'scripts/dr-drill.sh');
const WF = readFileSync(resolve(process.cwd(), '.github/workflows/backup-d1.yml'), 'utf8');
const SECRET = 'SENTINEL-ROW-CONTENT';
const SQL = `CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO users VALUES(1,'${SECRET}');\nINSERT INTO users VALUES(2,'b');\n`;
const KEY = 'd1/studioos-db/backup-2026-11-07.sql';
const sha = (b) => createHash('sha256').update(b).digest('hex');

function keypair(dir) {
  const id = join(dir, 'owner.key');
  execFileSync('age-keygen', ['-o', id], { stdio: 'ignore' });
  const recipient = readFileSync(id, 'utf8').match(/public key: (age1[0-9a-z]+)/)[1];
  return { id, recipient };
}

function manifest(sql, { ageHours = 2 } = {}) {
  const d = describe(sql);
  return {
    version: 1, key: KEY, database: 'studioos-db',
    exported_at: new Date(Date.now() - ageHours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    time_travel_bookmark: null, size_bytes: Buffer.byteLength(sql), sha256: sha(sql),
    statements: d.statements, tables: d.tables, migrations: d.migrations,
  };
}

/** A fake `aws s3api`: objects on disk under store/, every call in calls.log. */
function fakeAws(dir) {
  const src = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, JSON.stringify(a) + '\\n');
const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
const store = ${JSON.stringify(join(dir, 'store'))};
const at = (k) => path.join(store, arg('--bucket'), k);
if (a[0] !== 's3api') { console.error('unexpected'); process.exit(64); }
const op = a[1]; const key = arg('--key');
if (op === 'put-object') {
  const f = at(key);
  if (arg('--if-none-match') === '*' && fs.existsSync(f)) { console.error('An error occurred (PreconditionFailed) when calling the PutObject operation (412)'); process.exit(254); }
  const body = fs.readFileSync(arg('--body'));
  if (arg('--checksum-sha256') !== crypto.createHash('sha256').update(body).digest('base64')) { console.error('An error occurred (BadDigest) when calling the PutObject operation'); process.exit(254); }
  const meta = Object.fromEntries((arg('--metadata') || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body); fs.writeFileSync(f + '.meta', JSON.stringify(meta));
  console.log('{}'); process.exit(0);
}
if (op === 'head-object') {
  const f = at(key);
  if (!fs.existsSync(f)) { console.error('An error occurred (404) when calling the HeadObject operation: Not Found'); process.exit(254); }
  const meta = JSON.parse(fs.readFileSync(f + '.meta', 'utf8'));
  if (process.env.CORRUPT_HEAD && key.endsWith('.age')) meta.sha256 = '0'.repeat(64);
  console.log(JSON.stringify({ ContentLength: fs.statSync(f).size, Metadata: meta })); process.exit(0);
}
if (op === 'get-object') {
  const f = at(key); const out = a[a.indexOf(key) + 1];
  if (!fs.existsSync(f)) { console.error('An error occurred (NoSuchKey)'); process.exit(254); }
  fs.copyFileSync(f, out); console.log('{}'); process.exit(0);
}
console.error('fake aws: unexpected ' + op); process.exit(64);
`;
  writeFileSync(join(dir, 'aws'), src);
  chmodSync(join(dir, 'aws'), 0o755);
}

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'd4558c-'));
  fakeAws(dir);
  writeFileSync(join(dir, 'calls.log'), '');
  const { id, recipient } = keypair(dir);
  const sqlPath = join(dir, 'backup.sql');
  writeFileSync(sqlPath, SQL);
  const m = manifest(SQL);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  const env = {
    PATH: `${dir}:${process.env.PATH}`, HOME: dir, DR_COPY_ENDPOINT: 'https://store.example.test', DR_COPY_BUCKET: 'axal-d1-recovery',
    DR_AGE_RECIPIENT: recipient, AWS_ACCESS_KEY_ID: 'AKIDFAKEWRITEONLY', AWS_SECRET_ACCESS_KEY: 'fake-secret-value',
  };
  const copy = (extra = {}, sql = sqlPath) => {
    const r = spawnSync('bash', [COPY, 'upload', sql, join(dir, 'manifest.json')], { env: { ...env, ...extra }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr, last: r.stdout.trim().split('\n').at(-1) };
  };
  const calls = () => readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const store = (k) => join(dir, 'store', 'axal-d1-recovery', k);
  return { dir, id, recipient, m, env, copy, calls, store };
}
const stamp = (m) => m.exported_at.replace(/:/g, '-');

test('upload: the export is encrypted on the runner, put daily and monthly with its copy manifest, and only the owner\'s key opens it', () => {
  const w = world();
  const r = w.copy();
  assert.equal(r.status, 0, r.out);
  const daily = `d1/studioos-db/daily/${stamp(w.m)}`;
  const monthly = `d1/studioos-db/monthly/${w.m.exported_at.slice(0, 7)}`;
  assert.equal(r.last, daily);
  for (const k of [`${daily}/backup.sql.age`, `${daily}/manifest.json`, `${monthly}/backup.sql.age`, `${monthly}/manifest.json`]) assert.ok(existsSync(w.store(k)), k);
  const ct = readFileSync(w.store(`${daily}/backup.sql.age`));
  assert.ok(!ct.includes(SECRET), 'the stored object is ciphertext');
  const plain = execFileSync('age', ['-d', '-i', w.id, w.store(`${daily}/backup.sql.age`)]).toString();
  assert.equal(plain, SQL, 'the owner\'s key decrypts it to the export');
  const cm = JSON.parse(readFileSync(w.store(`${daily}/manifest.json`), 'utf8'));
  assert.equal(cm.sha256, w.m.sha256);
  assert.deepEqual(cm.independent_copy, { encryption: 'age', recipient: w.recipient, ciphertext_sha256: sha(ct), ciphertext_size_bytes: ct.length });
  assert.ok(!r.out.includes(SECRET) && !r.out.includes('fake-secret-value'), 'no content and no credential in the output');
});

test('upload: the credential is used to put and to head, never to read, list or delete', () => {
  const w = world();
  assert.equal(w.copy().status, 0);
  const ops = new Set(w.calls().map((c) => c[1]));
  assert.deepEqual([...ops].sort(), ['head-object', 'put-object']);
  for (const c of w.calls().filter((x) => x[1] === 'put-object')) {
    assert.equal(c[c.indexOf('--if-none-match') + 1], '*', 'every put is write-once');
    assert.equal(c[c.indexOf('--checksum-algorithm') + 1], 'SHA256');
    assert.ok(c.includes('--endpoint-url'));
  }
  assert.doesNotMatch(readFileSync(COPY, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'), /delete-object|delete-objects|list-objects|get-object|s3 rm|s3 cp/);
});

test('upload: a retried attempt of the same export is accepted; another export at the same recovery point is refused and nothing is replaced', () => {
  const w = world();
  assert.equal(w.copy().status, 0);
  const daily = `d1/studioos-db/daily/${stamp(w.m)}/backup.sql.age`;
  const first = readFileSync(w.store(daily));
  const again = w.copy();
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /already stored .* for this export/);
  assert.deepEqual(readFileSync(w.store(daily)), first, 'the stored copy is untouched');
  // A different export claiming the same recovery point.
  const other = SQL.replace("'b'", "'c'");
  writeFileSync(join(w.dir, 'other.sql'), other);
  writeFileSync(join(w.dir, 'manifest.json'), JSON.stringify({ ...w.m, sha256: sha(other), size_bytes: Buffer.byteLength(other) }));
  const clash = w.copy({}, join(w.dir, 'other.sql'));
  assert.equal(clash.status, 3, clash.out);
  assert.match(clash.out, /already holds different bytes; nothing was replaced/);
  assert.deepEqual(readFileSync(w.store(daily)), first);
});

test('upload: this month\'s point is kept once; a later day adds only its daily point', () => {
  const w = world();
  assert.equal(w.copy().status, 0);
  const later = { ...w.m, exported_at: w.m.exported_at.replace(/T\d\d/, (t) => `T${String((Number(t.slice(1)) + 1) % 24).padStart(2, '0')}`) };
  writeFileSync(join(w.dir, 'manifest.json'), JSON.stringify(later));
  const r = w.copy();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /this month's point is already kept/);
  assert.equal(readdirSync(w.store('d1/studioos-db/daily')).length, 2);
  assert.equal(readdirSync(w.store('d1/studioos-db/monthly')).length, 1);
});

test('upload: misconfigured, mismatched or unverifiable copies fail closed with their own exit code', () => {
  const w = world();
  const missing = w.copy({ DR_AGE_RECIPIENT: 'not-a-key', AWS_SECRET_ACCESS_KEY: '' });
  assert.equal(missing.status, 1);
  assert.match(missing.out, /DR_AGE_RECIPIENT .*the write-only credential/);
  assert.equal(w.copy({ DR_COPY_ENDPOINT: 'http://plain.example.test' }).status, 1, 'https only');
  writeFileSync(join(w.dir, 'tampered.sql'), SQL.replace('b', 'x'));
  assert.equal(w.copy({}, join(w.dir, 'tampered.sql')).status, 1, 'an export that is not the manifest\'s');
  const corrupt = world().copy({ CORRUPT_HEAD: '1' });
  assert.equal(corrupt.status, 3, corrupt.out);
  assert.match(corrupt.out, /size or sha256 differs/);
});

test('workflow: the copy runs only when enabled, with no Cloudflare credential, and its heartbeat is written by a separate step', () => {
  const step = WF.slice(WF.indexOf('- name: Independent encrypted copy (D4558)'), WF.indexOf('- name: Write the independent copy\'s heartbeat'));
  assert.match(step, /if: vars\.DR_SECOND_COPY_ENABLED == 'true'/);
  assert.doesNotMatch(step, /CLOUDFLARE_/);
  assert.match(step, /AWS_ACCESS_KEY_ID: \$\{\{ secrets\.DR_COPY_ACCESS_KEY_ID \}\}/);
  assert.match(step, /DR_AGE_RECIPIENT: \$\{\{ vars\.DR_AGE_RECIPIENT \}\}/);
  assert.doesNotMatch(WF, /DR_AGE_IDENTITY|AGE-SECRET-KEY/, 'the private key never appears in CI');
  const hb = WF.slice(WF.indexOf('- name: Write the independent copy\'s heartbeat'), WF.indexOf('- name: Notify on failure'));
  assert.match(hb, /if: vars\.DR_SECOND_COPY_ENABLED == 'true'/);
  assert.match(hb, /heartbeat-d1-independent\.json/);
});

// ── The drill ───────────────────────────────────────────────────────────────

/** dr-drill.sh with a fake wrangler (the shape dr_drill_d263's uses) and the fake aws. */
function fakeWrangler(dir, manifestJson, sql, indepHeartbeat) {
  const src = `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2); const e = process.env;
fs.appendFileSync(${JSON.stringify(join(dir, 'wcalls.log'))}, JSON.stringify(a) + '\\n');
const fileArg = () => a[a.indexOf('--file') + 1];
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('/heartbeat-d1-independent.json')) {
  if (!${JSON.stringify(indepHeartbeat)}) { console.error('✘ [ERROR] The specified key does not exist.'); process.exit(1); }
  process.stdout.write(${JSON.stringify(indepHeartbeat ?? '')}); process.exit(0);
}
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('/heartbeat-d1.json')) { process.stdout.write(JSON.stringify({ key: ${JSON.stringify(KEY)} })); process.exit(0); }
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('.manifest.json')) { fs.writeFileSync(fileArg(), ${JSON.stringify(manifestJson)}); process.exit(0); }
if (a[0] === 'r2' && a[2] === 'get') { fs.writeFileSync(fileArg(), ${JSON.stringify(sql)}); process.exit(0); }
if (a[0] === 'r2' && a[2] === 'put') { fs.copyFileSync(fileArg(), ${JSON.stringify(join(dir, 'marker.json'))}); process.exit(0); }
if (a[0] === 'd1' && (a[1] === 'create' || a[1] === 'delete')) process.exit(0);
if (a[0] === 'd1' && a[1] === 'execute' && a.includes('--file')) { console.log('🚣 Executed 3 queries in 1ms (0 rows read, 3 rows written)'); process.exit(0); }
if (a[0] === 'd1' && a[1] === 'execute') {
  const sqlq = a[a.indexOf('--command') + 1];
  const m = JSON.parse(${JSON.stringify(manifestJson)});
  if (/ AS t, COUNT\\(\\*\\) AS n FROM /.test(sqlq)) {
    const asked = [...sqlq.matchAll(/SELECT '((?:[^']|'')*)' AS t/g)].map((x) => x[1]);
    console.log(JSON.stringify([{ results: asked.map((t) => ({ t, n: m.tables.find((x) => x.name === t)?.rows ?? 0 })) }])); process.exit(0);
  }
  if (/COUNT/.test(sqlq)) { console.log(JSON.stringify([{ results: [{ users: 2, projects: 1 }] }])); process.exit(0); }
  console.log(JSON.stringify([{ results: ['users', 'projects', 'deals', 'score_snapshots', 'activity_logs', 'documents'].map((name) => ({ name })) }])); process.exit(0);
}
console.error('fake wrangler: unexpected ' + a.join(' ')); process.exit(64);
`;
  writeFileSync(join(dir, 'wrangler'), src);
  chmodSync(join(dir, 'wrangler'), 0o755);
}

function drill(w, env, { manifestJson = JSON.stringify(w.m), indepHeartbeat = null } = {}) {
  fakeWrangler(w.dir, manifestJson, SQL, indepHeartbeat);
  const r = spawnSync('bash', [DRILL], { env: { PATH: w.env.PATH, HOME: w.dir, BACKUP_BUCKET: 'studioos-backups', DR_DRILL_PREVIEW: '0', ...env }, encoding: 'utf8' });
  const mp = join(w.dir, 'marker.json');
  return { status: r.status, out: r.stdout + r.stderr, marker: existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8')) : null };
}
const indepEnv = (w, extra = {}) => ({
  DR_SOURCE: 'independent', DR_INDEPENDENT_POINT: `d1/studioos-db/daily/${stamp(w.m)}`, DR_AGE_IDENTITY_FILE: w.id,
  DR_COPY_ENDPOINT: 'https://store.example.test', DR_COPY_BUCKET: 'axal-d1-recovery', ...extra,
});

test('owner-run drill: a recovery point of the independent copy is fetched, checked, decrypted with the owner\'s key and restored', () => {
  const w = world();
  assert.equal(w.copy().status, 0);
  const r = drill(w, indepEnv(w));
  assert.equal(r.status, 0, r.out);
  assert.equal(r.marker.copy, 'independent');
  assert.equal(r.marker.backup_key, KEY);
  assert.equal(r.marker.sha256, w.m.sha256);
  assert.equal(r.marker.outcome, 'passed');
  assert.ok(!r.out.includes(SECRET), 'no row in the log');
  assert.ok(!r.out.includes(readFileSync(w.id, 'utf8').match(/AGE-SECRET-KEY-[0-9A-Z]+/)[0]), 'the key is never printed');
});

test('owner-run drill: a wrong key, a tampered ciphertext or no key fails before any database exists', () => {
  const w = world();
  assert.equal(w.copy().status, 0);
  const other = keypair(mkdtempSync(join(tmpdir(), 'd4558k-')));
  const wrong = drill(w, indepEnv(w, { DR_AGE_IDENTITY_FILE: other.id }));
  assert.deepEqual([wrong.status, wrong.marker?.reason], [2, 'decrypt_failed'], wrong.out);
  const ct = w.store(`d1/studioos-db/daily/${stamp(w.m)}/backup.sql.age`);
  const bytes = readFileSync(ct); bytes[bytes.length - 1] ^= 1; writeFileSync(ct, bytes);
  const tampered = drill(w, indepEnv(w));
  assert.deepEqual([tampered.status, tampered.marker?.reason], [2, 'ciphertext_mismatch'], tampered.out);
  const nokey = drill(w, indepEnv(w, { DR_AGE_IDENTITY_FILE: join(w.dir, 'absent.key') }));
  assert.deepEqual([nokey.status, nokey.marker?.reason], [1, 'key_missing']);
  for (const r of [wrong, tampered, nokey]) assert.doesNotMatch(r.out, /creating throwaway DB/);
});

test('scheduled drill with the copy on: a missing or stale independent heartbeat fails; a fresh one passes', () => {
  const w = world();
  const on = { DR_SECOND_COPY_ENABLED: 'true' };
  const missing = drill(w, on);
  assert.deepEqual([missing.status, missing.marker?.reason], [1, 'independent_copy_missing'], missing.out);
  const old = new Date(Date.now() - 50 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const stale = drill(w, on, { indepHeartbeat: JSON.stringify({ kind: 'd1_independent', exported_at: old }) });
  assert.deepEqual([stale.status, stale.marker?.reason], [1, 'independent_copy_stale'], stale.out);
  const fresh = drill(w, on, { indepHeartbeat: JSON.stringify({ kind: 'd1_independent', exported_at: w.m.exported_at }) });
  assert.equal(fresh.status, 0, fresh.out);
  assert.equal(drill(w, {}).status, 0, 'with the copy off, no heartbeat is asked for');
});

test('the targets: RPO 24 h and RTO 4 h are in the marker; a passing run that missed one pages', () => {
  const w = world();
  const ok = drill(w, {});
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual([ok.marker.rpo_target_s, ok.marker.rto_target_s, ok.marker.rpo_met, ok.marker.rto_met, ok.marker.copy], [86400, 14400, true, true, 'primary']);
  const late = manifest(SQL, { ageHours: 26 });
  const missed = drill(w, {}, { manifestJson: JSON.stringify(late) });
  assert.equal(missed.status, 0, 'within the 30 h staleness limit, so it restores');
  assert.equal(missed.marker.rpo_met, false);
  assert.match(missed.out, /PAGE: rpo_target_missed/);
  const stale = drill(w, {}, { manifestJson: JSON.stringify(manifest(SQL, { ageHours: 31 })) });
  assert.deepEqual([stale.status, stale.marker?.reason], [2, 'stale'], 'past 30 h the drill is red');
});
