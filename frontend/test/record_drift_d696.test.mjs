/** D696: the three new clients must be checked against the mounted D690 factory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = readFileSync('scripts/check-api-drift.mjs', 'utf8');
function check(source = script, route = true, mountedFactory = 'makeRecords') {
  const root = mkdtempSync(resolve(tmpdir(), 'record-drift-d696-'));
  const put = (path, content) => { const target = resolve(root, path); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, content); };
  try {
    put('scripts/check-api-drift.mjs', source);
    put('scripts/lib/apiModules.mjs', readFileSync('scripts/lib/apiModules.mjs', 'utf8'));
    put('scripts/api-drift-baseline.json', readFileSync('scripts/api-drift-baseline.json', 'utf8'));
    put('frontend/src/lib/api.js', "export const api = { record: () => request(`/cycles/${cycle}/modules/${slug}/records/${id}`) };\n// api-modules:begin\n// api-modules:end\n");
    mkdirSync(resolve(root, 'frontend/src/lib/api'), { recursive: true });
    put('cloudflare-worker/src/index.ts', "import records from './routes/records';\napp.route('/api/cycles', records);\n");
    put('cloudflare-worker/src/routes/records.ts', `import { Hono } from 'hono';
export function makeRecords(registry = {}) {
  const router = new Hono();
  ${route ? "router.get('/:cycle/modules/:slug/records/:id', c => c.json({}));" : ''}
  return router;
}
export function otherFactory() {
  const router = new Hono();
  router.get('/:cycle/modules/:slug/records/:id', c => c.json({}));
  return router;
}
const notMounted = new Hono();
notMounted.get('/not-a-real-route', c => c.json({}));
const records = ${mountedFactory}();
export default records;
`);
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/check-api-drift.mjs')], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('the guard follows a mounted factory, and refuses an absent route or an unknown factory', () => {
  { const result = check(); assert.equal(result.status, 0, result.output); }
  assert.equal(check(script, false).status, 1);
  assert.match(check(script, false).output, /GET \/api\/cycles\/:p\/modules\/:p\/records\/:p/);
  assert.equal(check(script, true, 'notDeclared').status, 1);
  // Mutation and restoration: losing the factory resolution must lose the route.
  const mutant = script.replace('const router = mounted && factoryRouter(src, mounted);', 'const router = { ident: mounted, source: src };');
  assert.notEqual(mutant, script);
  assert.equal(check(mutant).status, 1);
  { const result = check(); assert.equal(result.status, 0, result.output); }
});
