/**
 * D9167 (#9167): `scripts/check-like-patterns.mjs` fails on a LIKE pattern built
 * outside `cloudflare-worker/src/util/likeSearch.ts`, and the Worker tree is
 * clean against it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, scanTree } from '../../scripts/check-like-patterns.mjs';

const rules = (src) => scanSource(src).map((f) => f.rule);

test('a raw wildcard bind is refused, quoted or not', () => {
  assert.deepEqual(rules("binds.push(`%${q}%`, `%${q}%`);"), ['raw-bind']);
  assert.deepEqual(rules('bind.push(`%"${tag}"%`);'), ['raw-bind']);
  assert.deepEqual(rules("const like = q ? `%${q.slice(0, 100).toLowerCase()}%` : null;"), ['raw-bind']);
});

test('a concatenated or SQL-built wildcard is refused', () => {
  assert.deepEqual(rules(".bind('%' + (user.email || '').toLowerCase() + '%')"), ['concat-bind']);
  assert.deepEqual(rules("WHERE (? = '' OR name LIKE '%' || ? || '%')"), ['sql-wrap']);
});

test('a local copy of the escaper is refused in each of its spellings', () => {
  assert.deepEqual(rules("const like = (s) => s.replace(/[\\\\%_]/g, (c) => `\\\\${c}`);"), ['local-escaper']);
  assert.deepEqual(rules("return '%' + q.replace(/[\\\\%_]/g, ch => '\\\\' + ch) + '%';"), ['concat-bind', 'local-escaper']);
  assert.deepEqual(rules("skill.replace(/[%_\\\\]/g, '')"), ['local-escaper']);
  assert.deepEqual(rules("search.replace(/[!%_]/g, (ch) => `!${ch}`)"), ['local-escaper']);
});

test('the helper, a fixed internal prefix, comments and unrelated regexes pass', () => {
  assert.deepEqual(rules("const like = likeNeedle(q, 1);"), []);
  assert.deepEqual(rules(".bind(integrationId, projectId, `raise:${projectId}:%`)"), []);
  assert.deepEqual(rules(" * fails on a raw `%${…}%` bind"), []);
  assert.deepEqual(rules("// binds.push(`%${q}%`)"), []);
  assert.deepEqual(rules("lower.replace(/[\\s_\\-.()$%]/g, '')"), []);
  assert.deepEqual(rules("if (terms.discount_bps != null) fields.DISCOUNT = (terms.discount_bps / 100) + '%';"), []);
});

test('the Worker source builds no LIKE pattern outside the helper', () => {
  assert.deepEqual(scanTree().map((f) => `${f.file}:${f.line}: ${f.rule}`), []);
});
