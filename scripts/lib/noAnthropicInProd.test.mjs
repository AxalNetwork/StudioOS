import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { auditNoAnthropicInProduction } from './noAnthropicInProd.mjs';

const gate = `
app.use('/api/assistant/*', async (c, next) => {
  const env = c.env;
  const prod = env.STAGE === 'production' || env.ENVIRONMENT === 'production';
  if (prod || env.ENABLE_ANTHROPIC_DEV !== '1') return c.json({ error: 'not_found' }, 404);
  await next();
});
app.route('/api/assistant', assistantRoutes);
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'no-anthropic-prod-'));
  const src = join(root, 'cloudflare-worker/src');
  const put = (path, source) => {
    const file = join(src, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, source);
    return file;
  };
  put('index.ts', gate);
  const entry = put('routes/advisor.ts', "import { safe } from '../services/advisor/safe';\nvoid safe;\n");
  put('services/advisor/safe.ts', "import { run } from '../aiRouter';\nexport const safe = run;\n");
  put('services/aiRouter.ts', 'export const run = 1;\n');
  const provider = put('services/ai/providers/anthropic.ts', "export const endpoint = 'https://api.anthropic.com/v1/messages';\n");
  return { root, entry, provider, put };
}

const kinds = (findings) => findings.map((finding) => finding.kind);
const allowed = new Set([
  'cloudflare-worker/src/index.ts',
  'cloudflare-worker/src/services/ai/providers/anthropic.ts',
]);

test('D5339: the reviewed tree passes and removing the provider allowlist entry fails', () => {
  const f = fixture();
  assert.deepEqual(auditNoAnthropicInProduction({ root: f.root, entries: [f.entry], allowlist: allowed }), []);
  assert.ok(kinds(auditNoAnthropicInProduction({ root: f.root, entries: [f.entry], allowlist: new Set(['cloudflare-worker/src/index.ts']) })).includes('reference'));
});

test('D5339: the Advisor graph rejects both the provider service and a transitive adapter import', () => {
  for (const target of ['../aiProviders', '../ai/providers/anthropic']) {
    const f = fixture();
    f.put('services/advisor/safe.ts', `import '${target}';\nexport const safe = 1;\n`);
    if (target === '../aiProviders') f.put('services/aiProviders.ts', 'export const provider = 1;\n');
    const findings = auditNoAnthropicInProduction({ root: f.root, entries: [f.entry], allowlist: allowed });
    assert.ok(kinds(findings).includes('advisor_import'), target);
  }
});

test('D5339: a new Anthropic endpoint or key name outside the reviewed list fails', () => {
  for (const source of ["export const endpoint = 'https://api.anthropic.com/v1/messages';", "export const key = 'AI_PROVIDER_ANTHROPIC_KEY';"]) {
    const f = fixture();
    f.put('services/newProvider.ts', source);
    const findings = auditNoAnthropicInProduction({ root: f.root, entries: [f.entry], allowlist: allowed });
    assert.ok(kinds(findings).includes('reference'), source);
  }
});

test('D5339: mounting the assistant without the explicit flag check fails', () => {
  const f = fixture();
  f.put('index.ts', gate.replace("env.ENABLE_ANTHROPIC_DEV !== '1'", 'false'));
  const findings = auditNoAnthropicInProduction({ root: f.root, entries: [f.entry], allowlist: allowed });
  assert.ok(kinds(findings).includes('assistant_gate'));
});
