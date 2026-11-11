/**
 * D5337 (#5337) — the fakes the D1 recovery tests share, moved here from
 * dr_second_copy_d4558.test.mjs so restore_d1_d5337.test.mjs restores the
 * independent copy from the same store D4558's upload writes.
 *
 * `keypair(dir)` makes a real `age` identity; `fakeAws(dir)` writes an `aws`
 * on disk that answers `s3api put-object`, `head-object` and `get-object`
 * from `dir/store/<bucket>/<key>` and refuses as S3 does (If-None-Match, a
 * bad checksum). Every call is appended to `dir/calls.log`.
 */
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function keypair(dir) {
  const id = join(dir, 'owner.key');
  execFileSync('age-keygen', ['-o', id], { stdio: 'ignore' });
  const recipient = readFileSync(id, 'utf8').match(/public key: (age1[0-9a-z]+)/)[1];
  return { id, recipient };
}

/** A fake `aws s3api`: objects on disk under store/, every call in calls.log. */
export function fakeAws(dir) {
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
