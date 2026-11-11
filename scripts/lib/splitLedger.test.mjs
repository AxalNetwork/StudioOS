// D5613: split IO integrity, no-op writes and SQL comparison without changing the rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSplit, writeSplit, entryFile } from './splitLedger.mjs';
import { scan, compare, readBaseline, sqlLedgerFile } from '../check-sql-prepare.mjs';
const scratch = () => mkdtempSync(join(tmpdir(), 'split-ledger-'));

test('round trip, default naming, unchanged bytes and mtimes; only changed groups are rewritten', () => {
  const dir = scratch();
  try {
    const map = { 'x @ routes/a.ts': 1, 'y @ routes/a.ts': 2, 'x @ routes/b.ts': 3 };
    assert.equal(writeSplit(dir, map).length, 2);
    assert.deepEqual(readSplit(dir), map);
    const first = Object.fromEntries(readdirSync(dir).map((f) => [f, { bytes: readFileSync(join(dir, f), 'utf8'), mtime: statSync(join(dir, f)).mtimeMs }]));
    assert.deepEqual(writeSplit(dir, map), []);
    for (const [f, before] of Object.entries(first)) { assert.equal(readFileSync(join(dir, f), 'utf8'), before.bytes);assert.equal(statSync(join(dir, f)).mtimeMs, before.mtime); }
    assert.deepEqual(writeSplit(dir, { ...map, 'x @ routes/a.ts': 4 }), [join(dir, entryFile('routes/a.ts'))]);
    assert.equal(writeSplit(dir, { 'x @ routes/b.ts': 3 }).length, 1);
    assert.deepEqual(readSplit(dir), { 'x @ routes/b.ts': 3 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('duplicate and wrong-file entries throw with both paths before any rewrite', () => {
  const dir = scratch();
  try {
    writeSplit(dir, { a: 1 });
    writeFileSync(join(dir, 'b.json'), '{"a":2}\n');
    for (const call of [() => readSplit(dir), () => writeSplit(dir, { a: 1 })]) {
      assert.throws(call, (e) => /duplicate key a/.test(e.message) && e.message.includes(join(dir, 'a.json')) && e.message.includes(join(dir, 'b.json')));
    }
    writeFileSync(join(dir, 'b.json'), '{"c":2}\n');
    assert.throws(() => readSplit(dir), (e) => /wrong file/.test(e.message) && e.message.includes('b.json') && e.message.includes('c.json'));
    assert.throws(() => writeSplit(dir, { z: 1 }), /wrong file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('custom grouping works; unsafe paths and malformed maps are rejected', () => {
  const dir = scratch();
  try {
    const grouped = (key) => `${key[0]}.json`;
    writeSplit(dir, { ax: 1, ay: 2, bz: 3 }, grouped);
    assert.deepEqual(readSplit(dir, grouped), { ax: 1, ay: 2, bz: 3 });
    assert.throws(() => writeSplit(join(dir, 'new'), { a: 1 }, () => '../escape.json'), /invalid/);
    writeFileSync(join(dir, 'a.json'), '[]');assert.throws(() => readSplit(dir, grouped), /expected entry map/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SQL scan accepts a root, and new expressions fail naming the exact site', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'cloudflare-worker/src/routes'), { recursive: true });
    writeFileSync(join(root, 'cloudflare-worker/src/routes/x.ts'), 'db.prepare(`SELECT ${x}`);\n');
    const found = scan(root);
    assert.deepEqual(compare(found, {}).added, ['x @ routes/x.ts']);
    assert.deepEqual(compare(found, { 'x @ routes/x.ts': 99 }).added, [], 'counts are not a new guard rule');
    const dir = join(root, 'scripts/baselines/sql-prepare');writeSplit(dir, Object.fromEntries(found), sqlLedgerFile);
    assert.deepEqual(compare(found, readBaseline(root)), { added: [], gone: [] });
    writeFileSync(join(root, 'scripts', ['sql','prepare','baseline.json'].join('-')), '{}');
    assert.throws(() => readBaseline(root), /obsolete ledger restored/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('removing an entry file makes a real-tree SQL site new', () => {
  const found = scan();const baseline = readBaseline();
  const key = [...found.keys()][0];const filename = sqlLedgerFile(key);
  const without = Object.fromEntries(Object.entries(baseline).filter(([k]) => sqlLedgerFile(k) !== filename));
  assert.ok(compare(found, without).added.includes(key));
});
