/** D7899: detect complete Axal API bearers and ordinary JWTs without exempting a public header shared by real credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ORIGINAL = readFileSync(new URL('../../.gitleaks.toml', import.meta.url), 'utf8');
const active = source => source.replace(/^\s*#.*$/gm, '');
const keyId = 'a1'.repeat(6);
const bearer = (secret, id = keyId) => ['axk', id, secret].join('_');
const syntheticSecret = createHash('sha256').update('D7899 synthetic API bearer fixture').digest('base64url');

// These targeted readers cover the literal TOML fields used by the rules.
// Real Gitleaks v8.21.2 also exercises the config against synthetic files in
// D7899's validation; the normal drift suite needs no downloaded executable.
function axalRule(source) {
  const blocks = active(source).split(/^\[\[rules\]\]\s*$/m).slice(1)
    .map(block => block.split(/^\[(?!\[)/m)[0]);
  const block = blocks.find(item => /^id\s*=\s*"axal-member-api-key"\s*$/m.test(item));
  assert.ok(block, 'complete Axal bearers need their dedicated rule');
  const pattern = /^regex\s*=\s*'''([^\n]+)'''\s*$/m.exec(block)?.[1];
  assert.ok(pattern, 'read the active rule expression');
  const group = Number(/^secretGroup\s*=\s*(\d+)\s*$/m.exec(block)?.[1]);
  assert.ok(Number.isInteger(group), 'extract only the credential, not delimiters');
  const keywords = /^keywords\s*=\s*(\[[^\n]+\])\s*$/m.exec(block)?.[1];
  assert.ok(keywords, 'read the prefilter used by Gitleaks');
  assert.doesNotMatch(block, /^entropy\s*=/m, 'a precise bearer format needs no probabilistic threshold');
  return { regex: new RegExp(pattern), group, keywords: JSON.parse(keywords) };
}

function globalExemptions(source) {
  const block = active(source).split(/^\[allowlist\]\s*$/m)[1]?.split(/^\[/m)[0] || '';
  const expressions = /^regexes\s*=\s*\[([\s\S]*?)^\]/m.exec(block)?.[1] || '';
  return [...expressions.matchAll(/'''([^\n]+)'''/g)].map(([, pattern]) =>
    pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern));
}

function matches(source, text) {
  const rule = axalRule(source);
  if (!rule.keywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()))) return null;
  const secret = rule.regex.exec(text)?.[rule.group] || null;
  return secret && !globalExemptions(source).some(regex => regex.test(secret)) ? secret : null;
}

function assertAxalDetection(source) {
  for (const secret of [syntheticSecret, 'a'.repeat(43), 'A'.repeat(42) + '_', '9'.repeat(42) + '-']) {
    const value = bearer(secret);
    for (const text of [value, `"${value}"`, `Authorization: Bearer ${value}\n`, `config = '${value}';`, `\n${value}\n`]) {
      assert.equal(matches(source, text), value, 'complete standalone and delimited bearers are detected');
    }
  }
  const value = bearer(syntheticSecret);
  for (const text of [
    `axk_${keyId}`, 'axk_000000000000_placeholder',
    bearer(syntheticSecret, keyId.slice(1)), bearer(syntheticSecret, keyId + 'a'),
    bearer(syntheticSecret, keyId.toUpperCase()),
    bearer(syntheticSecret.slice(1)), bearer(syntheticSecret + 'a'),
    `x${value}`, `_${value}`, `-${value}`, `${value}x`, `${value}_`, `${value}-`,
  ]) assert.equal(matches(source, text), null, 'public prefixes, placeholders and malformed larger identifiers are not credentials');
}

function syntheticJwt(seed) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = [encode({ alg: 'HS256', typ: 'JWT' }), encode({ sub: 'D7899 synthetic fixture', exp: 2_000_000_000 })].join('.');
  return `${input}.${createHmac('sha256', seed).update(input).digest('base64url')}`;
}

function assertJwtDetection(source) {
  const extend = active(source).split(/^\[extend\]\s*$/m)[1]?.split(/^\[/m)[0] || '';
  assert.match(extend, /^useDefault\s*=\s*true\s*$/m, 'retain upstream JWT and provider rules');
  assert.doesNotMatch(extend, /^disabledRules\s*=.*["']jwt["']/m, 'do not silently disable the upstream JWT rule');
  for (const seed of ['test', 'D7899 unrelated synthetic signing seed']) {
    const token = syntheticJwt(seed);
    assert.equal(globalExemptions(source).some(regex => regex.test(token)), false,
      'a public JWT header does not prove which signing key or fixture produced a token');
  }
}

function mutationCheck(check, changes) {
  check(ORIGINAL);
  for (const [from, to] of changes) {
    assert.ok(ORIGINAL.includes(from), 'the mutation targets active configuration');
    assert.throws(() => check(ORIGINAL.replace(from, to)), { name: 'AssertionError' }, 'the regression is rejected');
  }
  check(ORIGINAL); // Each mutant is in memory; the original checkout stays untouched.
}

test('D7899: complete Axal API keys are detected without flagging public key prefixes or placeholders', () => {
  mutationCheck(assertAxalDetection, [
    ['id = "axal-member-api-key"', 'id = "retired-axal-member-api-key"'],
    ['axk_[a-z0-9]{12}', 'axk_[a-z0-9]{11}'],
    ['[A-Za-z0-9_-]{43}', '[A-Za-z0-9_-]{42}'],
    ['axk_[a-z0-9]{12}', 'axk_[A-Za-z0-9]{12}'],
    ['(?:^|[^A-Za-z0-9_-])', ''],
    ['(?:$|[^A-Za-z0-9_-])', ''],
    ['secretGroup = 1', 'secretGroup = 0'],
    ['keywords = ["axk_"]', 'keywords = ["other-prefix_"]'],
    ['secretGroup = 1', 'secretGroup = 1\nentropy = 4'],
    ['regexes = [', "regexes = [\n  '''axk_''',"],
  ]);
});

test('D7899: standard HS256 JWTs keep upstream detection regardless of their signing seed', () => {
  mutationCheck(assertJwtDetection, [
    ['useDefault = true', 'useDefault = false'],
    ['useDefault = true', 'useDefault = true\ndisabledRules = ["jwt"]'],
    ['regexes = [', "regexes = [\n  '''eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+''',"],
  ]);
});
