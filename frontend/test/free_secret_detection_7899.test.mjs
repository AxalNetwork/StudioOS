/** D7899: detect complete Axal API bearers and ordinary JWTs without exempting a public header shared by real credentials.
 *
 * From frontend/test/README.md (moved by #6472): D7899 dedicated Axal bearer detection,
 * public-prefix/placeholder exclusions and refusal of blanket JWT exemptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ORIGINAL = readFileSync(new URL('../../.gitleaks.toml', import.meta.url), 'utf8');
const active = source => source.replace(/^\s*#.*$/gm, '');
const keyId = 'a1'.repeat(6);
const bearer = (secret, id = keyId) => ['axk', id, secret].join('_');
const syntheticSecret = createHash('sha256').update('D7899 synthetic API bearer fixture').digest('base64url');
const enumCollision = 'a'.repeat(40) + '_v4';
const nameCollision = 'A'.repeat(15) + '-entity_key-' + 'B'.repeat(15) + 'A';
const namePattern = String.raw`\b(obligation_key|REPROMPT_KEY|fileKey|file_key|entity_key)\b`;
const enumPattern = String.raw`\b[a-z][a-z0-9_]*_v\d+\b`;
const AXAL_PATTERN = /(?:^|[^A-Za-z0-9_-])(axk_[a-z0-9]{12}_[A-Za-z0-9_-]{43})(?:$|[^A-Za-z0-9_-])/;
const AXAL_PATTERN_SOURCE = AXAL_PATTERN.source;

// These targeted readers cover the literal TOML fields used by the rules.
// Real Gitleaks v8.21.2 also exercises the config against synthetic files in
// D7899's validation; the normal drift suite needs no downloaded executable.
function ruleBlock(source, id) {
  const blocks = active(source).split(/^\[\[rules\]\]\s*$/m).slice(1)
    .map(block => block.split(/^\[(?!\[)/m)[0]);
  return blocks.find(item => /^id\s*=\s*"([\w-]+)"\s*$/m.exec(item)?.[1] === id);
}

function axalRule(source) {
  const block = ruleBlock(source, 'axal-member-api-key');
  assert.ok(block, 'complete Axal bearers need their dedicated rule');
  const pattern = /^regex\s*=\s*'''([^\n]+)'''\s*$/m.exec(block)?.[1];
  assert.ok(pattern, 'read the active rule expression');
  const group = Number(/^secretGroup\s*=\s*(\d+)\s*$/m.exec(block)?.[1]);
  assert.ok(Number.isInteger(group), 'extract only the credential, not delimiters');
  const keywords = /^keywords\s*=\s*(\[[^\n]+\])\s*$/m.exec(block)?.[1];
  assert.ok(keywords, 'read the prefilter used by Gitleaks');
  assert.doesNotMatch(block, /^entropy\s*=/m, 'a precise bearer format needs no probabilistic threshold');
  // Pinned rather than compiled from the file: the rule must be exactly the
  // reviewed expression, and any edit to it fails here as a regression.
  assert.equal(pattern, AXAL_PATTERN_SOURCE, 'the Axal bearer rule is the reviewed expression');
  return { regex: AXAL_PATTERN, group, keywords: JSON.parse(keywords) };
}

function regexesIn(block) {
  const expressions = /^regexes\s*=\s*\[([\s\S]*?)^\]/m.exec(block)?.[1] || '';
  return [...expressions.matchAll(/'''([^\n]+)'''/g)].map(([, pattern]) =>
    pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern));
}

function globalExemptions(source) {
  return regexesIn(active(source).split(/^\[allowlist\]\s*$/m)[1]?.split(/^\[/m)[0] || '');
}

function matches(source, text) {
  const rule = axalRule(source);
  if (!rule.keywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()))) return null;
  const secret = rule.regex.exec(text)?.[rule.group] || null;
  return secret && !globalExemptions(source).some(regex => regex.test(secret)) ? secret : null;
}

function assertAxalDetection(source) {
  for (const secret of [syntheticSecret, 'a'.repeat(43), 'A'.repeat(42) + '_', '9'.repeat(42) + '-', enumCollision, nameCollision]) {
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
  const ordinary = syntheticJwt('test');
  for (const token of [
    ordinary, syntheticJwt('D7899 unrelated synthetic signing seed'),
    // Invented signature bytes exercise identifier-shaped JWT segments;
    // scanners inspect format, not signature validity or live credentials.
    ...[enumCollision, nameCollision].map(signature => ordinary.slice(0, ordinary.lastIndexOf('.') + 1) + signature),
  ]) {
    assert.equal(globalExemptions(source).some(regex => regex.test(token)), false,
      'a public JWT header does not prove which signing key or fixture produced a token');
  }
}

function assertGenericConfinement(source) {
  const block = ruleBlock(source, 'generic-api-key');
  assert.ok(block, 'retain the identifier exemptions on the inherited generic rule');
  const [definition, allowlist] = block.split(/^\[\[rules\.allowlists\]\]\s*$/m);
  assert.ok(allowlist, 'use a rule-level allowlist');
  assert.doesNotMatch(definition, /^(?:regex|entropy|secretGroup|keywords)\s*=/m, 'inherit the upstream detector unchanged');
  assert.match(allowlist, /^regexTarget\s*=\s*"secret"\s*$/m, 'exempt the identifier value, not an entire line');
  const exemptions = regexesIn(allowlist);
  for (const name of ['obligation_key', 'REPROMPT_KEY', 'fileKey', 'file_key', 'entity_key',
    'investor_nda_v1', 'mentor_disclaimer_v1', 'kyc_v1', 'investor_signals_reprompt_dismissed_v1']) {
    assert.equal(exemptions.some(regex => regex.test(name)), true, 'known nonsecret identifier values remain exempt from the generic heuristic');
  }
  for (const value of [bearer(enumCollision), bearer(nameCollision)]) {
    assert.equal(exemptions.some(regex => regex.test(value)), true, 'the collision fixture must exercise the original exemption');
    assert.equal(matches(source, value), value, 'generic exemptions cannot suppress dedicated Axal detection');
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
    ...[enumPattern, namePattern].map(pattern => ['regexes = [', `regexes = [\n  '''${pattern}''',`]),
  ]);
});

test('D7899: standard HS256 JWTs keep upstream detection regardless of their signing seed', () => {
  mutationCheck(assertJwtDetection, [
    ['useDefault = true', 'useDefault = false'],
    ['useDefault = true', 'useDefault = true\ndisabledRules = ["jwt"]'],
    ['regexes = [', "regexes = [\n  '''eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+''',"],
    ...[enumPattern, namePattern].map(pattern => ['regexes = [', `regexes = [\n  '''${pattern}''',`]),
  ]);
});

test('D7899: enum and field-name exemptions retain generic false-positive handling without masking dedicated credentials', () => {
  mutationCheck(assertGenericConfinement, [
    ['id = "generic-api-key"', 'id = "other-rule"'],
    ['[[rules.allowlists]]', '[[rules.other-table]]'],
    ['regexTarget = "secret"', 'regexTarget = "match"'],
    ['id = "generic-api-key"', 'id = "generic-api-key"\nregex = "disabled-detector"'],
    ...[enumPattern, namePattern].map(pattern => [`  '''${pattern}''',\n`, '']),
  ]);
});
