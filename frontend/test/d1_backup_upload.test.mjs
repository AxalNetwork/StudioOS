/**
 * From frontend/test/README.md (moved by #6472): Exercises large D1 exports with user and account
 * R2 credentials, failed uploads, and redacted output (#7127).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const upload = fileURLToPath(new URL('../../scripts/d1-backup-upload.sh', import.meta.url));
const token = 'synthetic-backup-credential';
const secret = createHash('sha256').update(token).digest('hex');
const tokenId = '0123456789abcdef'.repeat(2);
const account = 'fedcba9876543210'.repeat(2);
const sentinel = 'synthetic-export-row';
const key = 'd1/studioos-db/backup-2026-11-17.sql';
const exportBytes = 320588280; // The Nov 17 export that exceeded Wrangler's 300 MiB cap.

function exerciseUpload(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'd1-upload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'backup.sql');
  writeFileSync(file, sentinel);
  truncateSync(file, exportBytes); // Sparse file; no real backup or network access.
  writeFileSync(join(dir, 'calls'), '');
  writeFileSync(join(dir, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (fs.readFileSync(0, 'utf8').trim() !== 'Authorization: Bearer ${token}' ||
    args.some(arg => arg.includes('${token}'))) process.exit(65);
const user = args.includes('https://api.cloudflare.com/client/v4/user/tokens/verify');
const account = args.includes('https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify');
if (!user && !account) process.exit(66);
fs.appendFileSync('calls', (user ? 'user' : 'account') + '\\n');
if (process.env.MODE === 'account' && user) process.exit(22);
const status = process.env.MODE === 'inactive' ? 'expired' : 'active';
console.log(JSON.stringify({ success: true, result: { status, id: '${tokenId}' } }));
`, { mode: 0o755 });
  writeFileSync(join(dir, 'aws'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const cp = args.indexOf('cp');
if (!args.includes('s3') || cp < 0 || fs.statSync(args[cp + 1]).size !== ${exportBytes} ||
    args[cp + 2] !== 's3://studioos-backups/${key}' ||
    flag('--endpoint-url') !== 'https://${account}.r2.cloudflarestorage.com' ||
    flag('--content-type') !== 'application/sql' || flag('--region') !== 'auto' ||
    process.env.AWS_ACCESS_KEY_ID !== '${tokenId}' || process.env.AWS_SECRET_ACCESS_KEY !== '${secret}' ||
    process.env.CLOUDFLARE_API_TOKEN || process.env.AWS_SESSION_TOKEN ||
    args.some(arg => arg.includes('${token}') || arg.includes('${secret}'))) process.exit(67);
fs.appendFileSync('calls', 'upload\\n');
process.exit(process.env.MODE === 'upload-failure' ? 23 : 0);
`, { mode: 0o755 });
  const result = spawnSync('bash', [upload, file], {
    cwd: dir, encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, MODE: mode,
      CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token,
      BACKUP_BUCKET: 'studioos-backups', BACKUP_KEY: key, AWS_SESSION_TOKEN: 'unrelated-session' },
  });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  for (const value of [token, secret, sentinel]) assert.ok(!output.includes(value), 'sensitive input appeared in output');
  return { status: result.status, calls: readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') };
}

for (const scope of ['user', 'account']) {
  test(`large D1 backup uploads the original export using ${scope}-owned credentials`, t => {
    const result = exerciseUpload(t, scope);
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, scope === 'user' ? ['user', 'upload'] : ['user', 'account', 'upload']);
  });
}

test('an inactive token stops the backup before upload', t => {
  const result = exerciseUpload(t, 'inactive');
  assert.notEqual(result.status, 0);
  assert.ok(result.calls.includes('user'));
  assert.ok(!result.calls.includes('upload'));
});

test('a rejected transfer fails the workflow upload step', t => {
  const result = exerciseUpload(t, 'upload-failure');
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, ['user', 'upload']);
});
