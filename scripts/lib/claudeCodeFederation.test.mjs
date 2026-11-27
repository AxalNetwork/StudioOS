// D5530: the @claude workflow uses its own federation rule and stores no API key.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readClaudeCodeFederation, CLAUDE_CODE_VARIABLES } from './claudeCodeFederation.mjs';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/claude-code.yml', ROOT), 'utf8');
const code = WORKFLOW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CHECK = new URL('scripts/check-claude-code-federation.mjs', ROOT).pathname;

const RULE = 'fdrl_01AbCdEfGh';
const ORG = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const good = { CLAUDE_CODE_FEDERATION_RULE_ID: RULE, CLAUDE_CODE_ORGANIZATION_ID: ORG };

test('D5530: a rule and organization are enough; the optional IDs are read when present', () => {
  assert.deepEqual(readClaudeCodeFederation(good), {
    federation: { ruleId: RULE, organizationId: ORG, serviceAccountId: null, workspaceId: null }, errors: [],
  });
  const full = readClaudeCodeFederation({ ...good, CLAUDE_CODE_SERVICE_ACCOUNT_ID: 'svac_01AbCdEfGh', CLAUDE_CODE_WORKSPACE_ID: 'wrkspc_01AbCdEfGh' });
  assert.equal(full.federation.serviceAccountId, 'svac_01AbCdEfGh');
  assert.equal(full.federation.workspaceId, 'wrkspc_01AbCdEfGh');
});

test('D5530: a missing rule, a rule without its organization, or a malformed ID is refused by its own name', () => {
  assert.deepEqual(readClaudeCodeFederation({}).errors, ['CLAUDE_CODE_FEDERATION_RULE_ID is not set']);
  assert.match(readClaudeCodeFederation({ CLAUDE_CODE_FEDERATION_RULE_ID: RULE }).errors.join(), /CLAUDE_CODE_ORGANIZATION_ID is not/);
  const bad = readClaudeCodeFederation({ ...good, CLAUDE_CODE_WORKSPACE_ID: 'ws-1' });
  assert.equal(bad.federation, null);
  assert.match(bad.errors.join(), /^CLAUDE_CODE_WORKSPACE_ID does not look like/);
  assert.doesNotMatch(bad.errors.join(), /ANTHROPIC_/, 'errors name the workflow\'s own variables');
});

test('D5530: the review\'s variables never satisfy the @claude check', () => {
  const r = readClaudeCodeFederation({ ANTHROPIC_FEDERATION_RULE_ID: RULE, ANTHROPIC_ORGANIZATION_ID: ORG, ANTHROPIC_API_KEY: 'sk-ant-x' });
  assert.equal(r.federation, null);
});

test('D5530: the preflight exits 1 with a remediation, and 0 without printing an ID', () => {
  const env = (extra) => ({ PATH: process.env.PATH, ...extra });
  const missing = spawnSync(process.execPath, [CHECK], { env: env({}), encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /CLAUDE_CODE_FEDERATION_RULE_ID is not set/);
  assert.match(missing.stderr, /section 4b/);
  const ok = spawnSync(process.execPath, [CHECK], { env: env(good), encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(!ok.stdout.includes(RULE) && !ok.stdout.includes(ORG), 'identifiers are not echoed');
});

test('D5530: claude-code.yml stores no API key and passes its own federation variables', () => {
  assert.doesNotMatch(code, /ANTHROPIC_API_KEY|anthropic_api_key|claude_code_oauth_token|secrets\./, 'no long-lived credential');
  // D8505: the workflow holds no token by default; the model job asks for id-token: write itself.
  assert.match(code, /^permissions: \{\}$/m, 'no token at the top');
  assert.match(code, /^ {2}claude:\n(?: {4}.*\n)*? {4}permissions:\n(?: {6}\S.*\n)*? {6}id-token: write$/m, 'the exchange needs id-token: write');
  for (const [ours, theirs] of Object.entries(CLAUDE_CODE_VARIABLES)) {
    const input = theirs.toLowerCase();
    assert.match(code, new RegExp(`^ {10}${input}: \\$\\{\\{ vars\\.${ours} \\}\\}$`, 'm'), input);
    assert.match(code, new RegExp(`^ {10}${ours}: \\$\\{\\{ vars\\.${ours} \\}\\}$`, 'm'), `preflight env ${ours}`);
  }
  const preflight = code.indexOf('node scripts/check-claude-code-federation.mjs');
  const action = code.indexOf('uses: anthropics/claude-code-action@');
  assert.ok(preflight > 0 && action > preflight, 'the preflight runs before the action');
  assert.match(code, /anthropics\/claude-code-action@[0-9a-f]{40} /, 'the action stays pinned to a commit');
});
