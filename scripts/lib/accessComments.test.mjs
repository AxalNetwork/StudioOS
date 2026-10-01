/**
 * Which Worker comments may say "Cloudflare Access" (accessComments.mjs).
 *
 * The guard exists because seventeen comments went on describing an Access
 * perimeter Task #33 had removed. Every test here is a way the check could
 * pass while that happens again, or fail on something that is not a comment:
 *
 *   · a `//` inside a string, or a `/*` inside a regex, read as a comment
 *   · a `${}` inside a template literal throwing the lexer off for the rest
 *     of the file
 *   · an identifier on a code line (`requireCfAccess()`) flagged as a claim
 *   · a sentence wrapped over two comment lines, seen as two halves
 *   · an entry that vouches for nothing, or for a sentence that is gone
 *   · a walk over no files reporting a pass
 *
 * The last test holds the ledger against the code: the mounts the
 * middleware's own header quotes are the mounts index.ts actually makes.
 * That header once named three mounts that did not exist.
 *
 * Run with:
 *   node --test scripts/lib/accessComments.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { commentLines, commentBlocks, auditAccessComments, normalisePhrase } from './accessComments.mjs';

const ROOT = process.cwd();
const REASON = 'A reason long enough to pass the twenty-character floor.';

test('a // inside a string, a /* inside a regex and a template body are not comments', () => {
  const src = [
    "const url = 'https://cf-access.example/path'; // real comment one",
    'const re = /a\\/*b/g; const x = 1;',
    'const t = `// not a comment ${inner({ a: 1 })} /* still not */`;',
    '/* real comment two */',
    'const y = x / 2; // real comment three',
  ].join('\n');
  const texts = commentLines(src).map((c) => c.text.trim());
  assert.deepEqual(texts, ['real comment one', 'real comment two', 'real comment three']);
});

test('the lexer comes back out of a nested template expression', () => {
  const src = [
    'const a = `x ${fn(`y ${z} w`)} v`;',
    '// after the template',
  ].join('\n');
  const lines = commentLines(src);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].line, 2);
  assert.equal(lines[0].text.trim(), 'after the template');
});

test('a trailing comment on a code line is marked trailing; a whole-line comment is not', () => {
  const lines = commentLines('foo(); // trailing\n// alone\n');
  assert.deepEqual(lines.map((l) => [l.line, l.trailing]), [[1, true], [2, false]]);
});

test('a sentence wrapped over two comment lines is one block', () => {
  const src = [
    '// Sits behind the /api/admin/* Cloudflare',
    '// Access perimeter applied in index.ts.',
    'code();',
    '/**',
    ' * Doc comment line one,',
    ' * line two.',
    ' */',
  ].join('\n');
  const blocks = commentBlocks(src);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, 'Sits behind the /api/admin/* Cloudflare Access perimeter applied in index.ts.');
  assert.equal(blocks[1].text, 'Doc comment line one, line two.');
});

test('a mention no entry quotes fails, with its file and line', () => {
  const files = [{ path: 'routes/x.ts', src: 'code();\n// Sits behind the /api/admin/* Cloudflare Access perimeter.\n' }];
  const { findings, mentions } = auditAccessComments(files, []);
  assert.equal(mentions, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'unlisted');
  assert.equal(findings[0].file, 'routes/x.ts');
  assert.equal(findings[0].line, 2);
});

test('the mention is found even when it is split across the wrap', () => {
  const files = [{ path: 'r.ts', src: '// behind the CF\n// Access perimeter\n' }];
  const { findings } = auditAccessComments(files, []);
  assert.deepEqual(findings.map((f) => f.kind), ['unlisted']);
});

test('an Access identifier on a code line, or in a log string, is not a claim', () => {
  const src = [
    "import { requireCfAccess } from './middleware/cfAccess';",
    "app.use('/api/kyc/admin/:userId/document', requireCfAccess());",
    "console.warn('[cfAccess] verify failed:', e);",
    'const cfAccessEmail = c.get("cfAccessEmail");',
  ].join('\n');
  const { findings, mentions } = auditAccessComments([{ path: 'index.ts', src }], []);
  assert.equal(mentions, 0);
  assert.deepEqual(findings, []);
});

test('an entry covers a mention only when the mention sits inside its phrase', () => {
  const src = '// There is NO Cf-Access perimeter here. But this one sits behind the CF Access perimeter.\n';
  const entries = [{ file: 'a.ts', phrase: 'There is NO Cf-Access perimeter here.', reason: REASON }];
  const { findings } = auditAccessComments([{ path: 'a.ts', src }], entries);
  assert.deepEqual(findings.map((f) => [f.kind, f.match]), [['unlisted', 'CF Access']]);
});

test('an entry matches however the comment wraps', () => {
  const src = '// There is NO Cf-Access\n// perimeter here.\n';
  const entries = [{ file: 'a.ts', phrase: 'There is NO Cf-Access   perimeter here.', reason: REASON }];
  assert.deepEqual(auditAccessComments([{ path: 'a.ts', src }], entries).findings, []);
  assert.equal(normalisePhrase('a \n  b'), 'a b');
});

test('an entry only covers its own file', () => {
  const src = '// There is NO Cf-Access perimeter here.\n';
  const entries = [{ file: 'a.ts', phrase: 'There is NO Cf-Access perimeter here.', reason: REASON }];
  const { findings } = auditAccessComments(
    [{ path: 'a.ts', src }, { path: 'b.ts', src }],
    entries,
  );
  assert.deepEqual(findings.map((f) => [f.kind, f.file]), [['unlisted', 'b.ts']]);
});

test('an entry whose phrase is in no comment of its file is stale — including one that only appears in code', () => {
  const src = "// Nothing about the gate here.\nconst s = 'There is NO Cf-Access perimeter here.';\n";
  const entries = [{ file: 'a.ts', phrase: 'There is NO Cf-Access perimeter here.', reason: REASON }];
  const { findings } = auditAccessComments([{ path: 'a.ts', src }], entries);
  assert.deepEqual(findings.map((f) => f.kind), ['stale']);
});

test('an entry for a file that was not scanned is stale', () => {
  const entries = [{ file: 'gone.ts', phrase: 'the CF Access gate', reason: REASON }];
  const { findings } = auditAccessComments([{ path: 'a.ts', src: 'code();\n' }], entries);
  assert.deepEqual(findings.map((f) => [f.kind, f.file]), [['stale', 'gone.ts']]);
});

test('an entry that names no Access mention vouches for nothing, and is refused', () => {
  const entries = [{ file: 'a.ts', phrase: 'the', reason: REASON }];
  const { findings } = auditAccessComments([{ path: 'a.ts', src: '// the\n' }], entries);
  assert.deepEqual(findings.map((f) => f.kind), ['vacuous']);
});

test('a duplicate entry and an entry with no real reason are refused', () => {
  const src = '// the CF Access gate\n';
  const good = { file: 'a.ts', phrase: 'the CF Access gate', reason: REASON };
  const { findings } = auditAccessComments(
    [{ path: 'a.ts', src }],
    [good, { ...good }, { file: 'a.ts', phrase: 'CF Access', reason: 'true' }],
  );
  assert.deepEqual(findings.map((f) => f.kind).sort(), ['duplicate', 'invalid-entry']);
});

test('a walk over no files fails rather than passing over nothing', () => {
  for (const files of [[], undefined, null]) {
    const { findings, scanned } = auditAccessComments(files, []);
    assert.equal(scanned, 0);
    assert.deepEqual(findings.map((f) => f.kind), ['nothing-scanned']);
  }
});

test('the mounts the middleware header quotes are the mounts index.ts makes', () => {
  const ledger = JSON.parse(readFileSync(resolve(ROOT, 'scripts/access-comment-allowlist.json'), 'utf8'));
  const MOUNT = /app\.use\('([^']+)', requireCfAccess\(\)\);/;

  const quoted = ledger.entries
    .filter((e) => e.file === 'middleware/cfAccess.ts')
    .map((e) => MOUNT.exec(e.phrase)?.[1])
    .filter(Boolean)
    .sort();

  // The code lines, not the comments: a mount only exists if it runs.
  const index = readFileSync(resolve(ROOT, 'cloudflare-worker/src/index.ts'), 'utf8');
  const commented = new Set(commentLines(index).map((c) => c.line));
  const mounted = index
    .split('\n')
    .map((text, k) => ({ text, line: k + 1 }))
    .filter(({ line }) => !commented.has(line))
    .map(({ text }) => MOUNT.exec(text)?.[1])
    .filter(Boolean)
    .sort();

  assert.ok(mounted.length >= 2, `expected the two KYC mounts in index.ts, found ${mounted.length}`);
  assert.deepEqual(quoted, mounted);
});
