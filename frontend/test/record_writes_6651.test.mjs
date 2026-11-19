/** D6651: synthetic typed source fixtures prove the record-write guard fails on a route that writes or deletes a record key outside its helper. No bucket is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRecordWrites, recordViolations } from '../../scripts/check-record-writes.mjs';

const declarations = `interface R2Bucket {put(key:string,body:unknown,o?:unknown):Promise<unknown>;delete(key:string|string[]):Promise<void>}
interface Env {FILES:R2Bucket}`;
const WRITER = 'src/services/recordStore.ts', ERASER = 'src/services/recordErasure.ts';
const helpers = {
  [WRITER]: 'export async function putRecord(files:R2Bucket,key:string,body:unknown){return files.put(key,body,{onlyIf:{etagDoesNotMatch:"*"}});}',
  [ERASER]: 'export async function eraseRecordObjects(bucket:R2Bucket,keys:string|string[],reason:string){await bucket.delete(keys);}',
  // A service that already uses both, so each helper's bucket and prefix resolve in every fixture.
  'src/services/archive.ts': 'import {putRecord} from "./recordStore";\nimport {eraseRecordObjects} from "./recordErasure";\nexport async function keep(env:Env){await putRecord(env.FILES,"records/kept.pdf","x");await eraseRecordObjects(env.FILES,"records/old.pdf","purge");}',
};
const row = (id, prefix, kind) => ({ id, bucket: 'synthetic-files', prefix, class: kind, purpose: 'Synthetic fixture', retention_period: 'not recorded', retention_basis: 'not recorded', retention_days: null, locked_copy: 'no' });

function fixture(t, route, references = []) {
  const root = mkdtempSync(join(tmpdir(), 'record-writes-6651-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/services'), { recursive: true }); mkdirSync(join(root, 'src/routes'));
  writeFileSync(join(root, 'wrangler.toml'), 'main="src/index.ts"\n[[r2_buckets]]\nbinding="FILES"\nbucket_name="synthetic-files"\n');
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', types: [], skipLibCheck: true }, include: ['src/**/*.ts'] }));
  writeFileSync(join(root, 'src/env.d.ts'), declarations);
  for (const [file, body] of Object.entries(helpers)) writeFileSync(join(root, file), body);
  writeFileSync(join(root, 'src/routes/files.ts'), route);
  const registry = { version: 1, classes: [row('record', 'records/', 'record'), row('media', 'media/', 'replaceable')], key_references: references };
  return (baseline = []) => checkRecordWrites(root, { configPaths: ['tsconfig.json'], registry, baseline, writer: WRITER, eraser: ERASER });
}
const IMPORTS = 'import {putRecord} from "../services/recordStore";\nimport {eraseRecordObjects} from "../services/recordErasure";\n';

test('a route that deletes a record key directly fails the guard; through the erasure path it passes', (t) => {
  const direct = fixture(t, `${IMPORTS}export async function remove(env:Env,id:string){await env.FILES.delete(\`records/\${id}.pdf\`);}`);
  const { violations } = direct();
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^src\/routes\/files\.ts:\d+: delete of a record prefix \(record\) .*use eraseRecordObjects/);
  const viaPath = fixture(t, `${IMPORTS}export async function remove(env:Env,id:string){await eraseRecordObjects(env.FILES,\`records/\${id}.pdf\`,"owner_removed");}`);
  assert.deepEqual(viaPath().violations, []);
});

test('a route that puts a record key directly fails; through putRecord it passes', (t) => {
  const direct = fixture(t, `${IMPORTS}export async function save(env:Env,id:string){await env.FILES.put(\`records/\${id}.pdf\`,"x");}`);
  assert.match(direct().violations.join('\n'), /put of a record prefix \(record\) .*use putRecord/);
  const viaHelper = fixture(t, `${IMPORTS}export async function save(env:Env,id:string){await putRecord(env.FILES,\`records/\${id}.pdf\`,"x");}`);
  assert.deepEqual(viaHelper().violations, []);
});

test('a stored-key delete of a record prefix fails as well, and replaceable media may still be overwritten and deleted', (t) => {
  const site = 'src/routes/files.ts | remove | delete | row.key';
  const check = fixture(t, `${IMPORTS}export async function remove(env:Env,row:{key:string},id:string){await env.FILES.put(\`media/\${id}\`,"x");await env.FILES.delete(\`media/\${id}\`);await env.FILES.delete(row.key);}`,
    [{ site, classes: ['record'], evidence: 'Synthetic records writer' }]);
  const { violations } = check();
  assert.equal(violations.length, 1, violations.join('\n'));
  assert.match(violations[0], /delete of a record prefix .* with key row\.key/);
});

test('the baseline tolerates a listed site, reports a stale one, and the committed baseline is empty', (t) => {
  const check = fixture(t, `${IMPORTS}export async function remove(env:Env,id:string){await env.FILES.delete(\`records/\${id}.pdf\`);}`);
  const site = 'src/routes/files.ts | remove | delete | `records/${id}.pdf`';
  assert.deepEqual(check([site]), { violations: [], stale: [], sites: 3 });
  assert.deepEqual(check([site, 'gone | x | delete | k']).stale, ['gone | x | delete | k']);
  const committed = JSON.parse(readFileSync(new URL('../../scripts/record-writes-baseline.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed.sites, []);
});

test('the rule itself: writes belong in the writer, deletes in the eraser, never the other way round', () => {
  const registry = { classes: [row('record', 'records/', 'record'), row('media', 'media/', 'replaceable')] };
  const at = (file, method, classes = ['record']) => ({ file, method, classes, line: 1, scope: 's', key: 'k' });
  const { violations } = recordViolations([
    at(WRITER, 'put'), at(ERASER, 'delete'), at(WRITER, 'delete'), at(ERASER, 'put'), at('src/routes/x.ts', 'createMultipartUpload'), at('src/routes/x.ts', 'put', ['media']),
  ], registry, { writer: WRITER, eraser: ERASER });
  assert.deepEqual(violations.map((v) => v.split(':')[0] + ' ' + v.split(': ')[1].split(' ')[0]), [
    `${WRITER} delete`, `${ERASER} put`, 'src/routes/x.ts createMultipartUpload',
  ]);
});
