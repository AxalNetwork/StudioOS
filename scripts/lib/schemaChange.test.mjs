// #6326: the schema-change skill's naming, SQL and runtime-DDL rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  utcStamp, newMigrationName, nameFindings, changedBaseFindings, sqlFindings, runtimeDdlFindings, addedLines, summarise, SCHEMA_CHECKS,
} from './schemaChange.mjs';

const NOW = new Date('2026-11-14T09:07:42Z');

test('utcStamp is the UTC minute, whatever the local zone', () => {
  assert.equal(utcStamp(NOW), '202611140907');
  assert.equal(utcStamp('2026-11-14T23:59:59.999-05:00'), '202611150459');
  assert.throws(() => utcStamp('not a date'));
});

test('newMigrationName stamps the minute and the issue', () => {
  assert.deepEqual(newMigrationName({ now: NOW, issue: 6326, slug: 'widget_rows' }), {
    name: '202611140907_6326_widget_rows.sql',
    path: 'cloudflare-worker/sql/migrations/202611140907_6326_widget_rows.sql',
  });
});

test('newMigrationName refuses a bad issue or slug', () => {
  assert.match(newMigrationName({ now: NOW, issue: '0123', slug: 'x' }).problem, /issue/);
  assert.match(newMigrationName({ now: NOW, issue: '', slug: 'x' }).problem, /issue/);
  assert.match(newMigrationName({ now: NOW, issue: 6326, slug: 'Widget' }).problem, /slug/);
  assert.match(newMigrationName({ now: NOW, issue: 6326, slug: '1st' }).problem, /slug/);
  assert.match(newMigrationName({ now: NOW, issue: 6326, slug: 'a-b' }).problem, /slug/);
});

test('newMigrationName refuses an identity already taken, and allows another issue in the same minute', () => {
  const existing = ['202611140907_6326_other.sql'];
  assert.match(newMigrationName({ now: NOW, issue: 6326, slug: 'widget_rows', existing }).problem, /already holds 202611140907_6326/);
  assert.equal(newMigrationName({ now: NOW, issue: 6327, slug: 'widget_rows', existing }).name, '202611140907_6327_widget_rows.sql');
});

test('nameFindings: a clean new file has no finding', () => {
  assert.deepEqual(nameFindings({ added: ['202611140900_6326_a.sql'], onBase: ['766_x.sql'], now: NOW, issue: '6326' }), []);
});

test('nameFindings: missing issue, future stamp, wrong issue, new number', () => {
  const f = nameFindings({
    added: ['202611140900_a.sql', '202611141000_6326_b.sql', '202611140800_5581_c.sql', '770_d.sql'],
    onBase: [], now: NOW, issue: '6326',
  });
  const by = (file) => f.filter((x) => x.file === file).map((x) => x.text).join(' | ');
  assert.match(by('202611140900_a.sql'), /names its issue/);
  assert.match(by('202611141000_6326_b.sql'), /later than now/);
  assert.match(by('202611140800_5581_c.sql'), /names issue 5581, the branch's issue is 6326/);
  assert.match(by('770_d.sql'), /UTC minute and issue/);
  assert.ok(f.every((x) => x.level === 'error'));
});

test('nameFindings: a backdated stamp is refused, with or without its issue (D5398)', () => {
  const f = nameFindings({ added: ['202611100000_probe_old.sql', '202611100000_6326_old.sql'], onBase: [], now: NOW, issue: '6326' });
  const by = (file) => f.filter((x) => x.file === file).map((x) => x.text).join(' | ');
  assert.match(by('202611100000_probe_old.sql'), /names its issue/);
  assert.match(by('202611100000_6326_old.sql'), /is before 202611110000/);
  assert.deepEqual(nameFindings({ added: ['202611110000_6326_edge.sql'], onBase: [], now: NOW, issue: '6326' }), []);
});

test('changedBaseFindings: an edit, delete or rename of a base file fails; an added file does not', () => {
  const dir = 'cloudflare-worker/sql/migrations/';
  const onBase = ['202611072301_company_profiles_field_triggers.sql', '766_x.sql', '767_y.sql'];
  const out = changedBaseFindings([
    `M\t${dir}202611072301_company_profiles_field_triggers.sql`,
    `D\t${dir}766_x.sql`,
    `R100\t${dir}767_y.sql\t${dir}767_z.sql`,
    `A\t${dir}202611140900_6326_a.sql`,
    `M\t${dir}202611140900_6326_a.sql`,
    'M\tcloudflare-worker/src/index.ts',
  ].join('\n'), onBase);
  assert.deepEqual(out.map((x) => x.file), ['202611072301_company_profiles_field_triggers.sql', '766_x.sql', '767_y.sql']);
  assert.match(out[0].text, /is edited/);
  assert.match(out[1].text, /is deleted/);
  assert.match(out[2].text, /renamed to/);
  assert.ok(out.every((x) => x.level === 'error' && /D269/.test(x.text)));
  assert.deepEqual(changedBaseFindings('', onBase), []);
});

test('nameFindings: the same minute and issue as a file on the base fails, naming both', () => {
  const f = nameFindings({ added: ['202611140007_5581_b.sql'], onBase: ['202611140007_5581_work_graph_revisions.sql'], now: NOW, issue: '5581' });
  assert.equal(f.length, 1);
  assert.match(f[0].text, /202611140007_5581_b\.sql and 202611140007_5581_work_graph_revisions\.sql share the stamp 202611140007 and the issue 5581/);
  assert.equal(f[0].file, '202611140007_5581_b.sql');
});

test('nameFindings: two issues in one minute do not collide (D5398)', () => {
  assert.deepEqual(nameFindings({ added: ['202611140007_6326_b.sql'], onBase: ['202611140007_5581_a.sql'], now: NOW }), []);
});

test('sqlFindings: a clean expand migration has no finding', () => {
  const sql = `-- D6326: rows.\nCREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')));\n` +
    `CREATE INDEX IF NOT EXISTS idx_widgets_created ON widgets(created_at);\nALTER TABLE users ADD COLUMN widget_count INTEGER NOT NULL DEFAULT 0;\n`;
  assert.deepEqual(sqlFindings('f.sql', sql), []);
});

test('sqlFindings: a trigger with IF NOT EXISTS passes, its BEGIN/END body is not a transaction', () => {
  const sql = `CREATE TABLE IF NOT EXISTS widgets (n INTEGER);\nCREATE TRIGGER IF NOT EXISTS t_ins BEFORE INSERT ON widgets\nWHEN NEW.n < 0\nBEGIN\n  SELECT RAISE(ABORT, 'widgets.n: negative');\nEND;\n`;
  assert.deepEqual(sqlFindings('f.sql', sql), []);
  const bare = sqlFindings('f.sql', sql.replace('TRIGGER IF NOT EXISTS', 'TRIGGER'));
  assert.equal(bare.length, 1);
  assert.match(bare[0].text, /CREATE TRIGGER without IF NOT EXISTS/);
});

test('sqlFindings: NOT NULL with no default, drop, rename and a transaction', () => {
  const f = sqlFindings('f.sql', [
    'ALTER TABLE widgets ADD COLUMN owner TEXT NOT NULL;',
    'DROP TABLE IF EXISTS old_widgets;',
    'ALTER TABLE widgets DROP COLUMN legacy;',
    'ALTER TABLE widgets RENAME COLUMN a TO b;',
    'BEGIN TRANSACTION;',
    'CREATE UNIQUE INDEX idx_w ON widgets(owner);',
  ].join('\n'));
  const texts = f.map((x) => `${x.level}:${x.text}`).join('\n');
  assert.match(texts, /error:ADD COLUMN NOT NULL with no DEFAULT/);
  assert.equal(f.filter((x) => /contract step/.test(x.text)).length, 2);
  assert.match(texts, /note:a rename takes two deploys/);
  assert.match(texts, /error:a transaction statement/);
  assert.match(texts, /note:CREATE INDEX without IF NOT EXISTS/);
});

test('sqlFindings: IS NOT NULL inside a CHECK is not a NOT NULL column', () => {
  assert.deepEqual(sqlFindings('f.sql', 'ALTER TABLE scope_tasks ADD COLUMN zz TEXT CHECK (zz IS NULL OR zz IS NOT NULL);'), []);
  assert.deepEqual(sqlFindings('f.sql', "ALTER TABLE t ADD COLUMN e TEXT CHECK (e IS NULL OR (s IS NOT NULL AND e >= s));"), []);
  const f = sqlFindings('f.sql', 'ALTER TABLE t ADD COLUMN k TEXT NOT NULL CHECK (length(k) > 0);');
  assert.equal(f.length, 1);
  assert.match(f[0].text, /ADD COLUMN NOT NULL with no DEFAULT/);
  assert.deepEqual(sqlFindings('f.sql', "ALTER TABLE t ADD COLUMN d TEXT NOT NULL DEFAULT (datetime('now'));"), []);
});

test('sqlFindings: prose in comments trips nothing', () => {
  assert.deepEqual(sqlFindings('f.sql', '-- DROP TABLE users; BEGIN;\n/* ALTER TABLE x ADD COLUMN y TEXT NOT NULL; */\nSELECT 1;'), []);
});

test('addedLines reads a -U0 diff with its line numbers', () => {
  const diff = [
    'diff --git a/cloudflare-worker/src/a.ts b/cloudflare-worker/src/a.ts',
    '--- a/cloudflare-worker/src/a.ts',
    '+++ b/cloudflare-worker/src/a.ts',
    '@@ -10,0 +11,2 @@ fn',
    "+  await env.DB.exec('ALTER TABLE w ADD COLUMN n INTEGER');",
    '+  // CREATE TABLE in a comment',
    '@@ -20 +22 @@',
    '-old',
    '+new',
    'diff --git a/x.ts b/x.ts',
    '--- a/x.ts',
    '+++ /dev/null',
  ].join('\n');
  assert.deepEqual(addedLines(diff), [
    { file: 'cloudflare-worker/src/a.ts', line: 11, text: "  await env.DB.exec('ALTER TABLE w ADD COLUMN n INTEGER');" },
    { file: 'cloudflare-worker/src/a.ts', line: 12, text: '  // CREATE TABLE in a comment' },
    { file: 'cloudflare-worker/src/a.ts', line: 22, text: 'new' },
  ]);
});

test('runtimeDdlFindings flags an ALTER and a CREATE, never a comment', () => {
  const f = runtimeDdlFindings([
    { file: 'a.ts', line: 3, text: "db.exec('ALTER TABLE w ADD COLUMN n INTEGER')" },
    { file: 'a.ts', line: 4, text: "'CREATE TABLE IF NOT EXISTS w (id TEXT)'," },
    { file: 'a.ts', line: 5, text: '// ALTER TABLE w ADD COLUMN n' },
    { file: 'a.ts', line: 6, text: 'const x = 1;' },
  ]);
  assert.deepEqual(f.map((x) => x.file), ['a.ts:3', 'a.ts:4']);
  assert.match(f[0].text, /runSchemaBootstrap/);
  assert.match(f[1].text, /D235/);
});

test('summarise passes only when every guard passed', () => {
  assert.equal(summarise([{ script: 'a', code: 0, ms: 1000 }]).ok, true);
  const s = summarise([{ script: 'a', code: 0, ms: 1000 }, { script: 'b', code: 1, ms: 2400 }]);
  assert.equal(s.ok, false);
  assert.deepEqual(s.lines, ['pass  a  (1s)', 'FAIL  b  (2s)  exit 1']);
  assert.equal(summarise([]).ok, false);
});

test('SCHEMA_CHECKS names guards that test:guards runs, in its order', async () => {
  const { readFileSync } = await import('node:fs');
  const guards = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts['test:guards'];
  let at = -1;
  for (const c of SCHEMA_CHECKS) {
    const i = guards.indexOf(`node ${c.flags.length ? `${c.flags.join(' ')} ` : ''}scripts/${c.script}`);
    assert.ok(i > at, `${c.script} with its flags, after the previous guard`);
    at = i;
  }
});
