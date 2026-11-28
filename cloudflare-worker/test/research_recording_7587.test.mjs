/** #7587: a cancelled cold request cannot strand the next recording behind its promise. Real Workers requests, synthetic database only.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7587: real Workers requests prove an
 * abandoned bootstrap cannot strand the next request, with per-binding readiness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const root = new URL('../', import.meta.url).pathname;
const source = readFileSync(root + 'src/index.ts', 'utf8');
const advisor = source.slice(source.indexOf('const ADVISOR_SCHEMA_READY'), source.indexOf('/**\n * Role-schema repairs'));
const entry = `
import { bindingKey } from './src/util/schemaBootstrap';
import { ensureInvestorSchema, rebuildUsersRoleCheckForAdvisor } from './src/util/usersRoleRebuild';
import { ensureExploringSchema } from './src/services/exploringSchema';
${advisor}
const databases = new Map();
function database(key, abandon) {
  if (!databases.has(key)) databases.set(key, {
    calls: 0,
    exec() { this.calls++; return abandon && this.calls === 1 ? new Promise(() => {}) : Promise.resolve({ success: true }); },
    prepare() { return { bind() { return this; },
      first: async () => ({ sql: 'CREATE TABLE users(role TEXT)' }),
      all: async () => ({ results: [{ name: 'investor_id' }, { name: 'needs_assessment_completed' }] }),
      run: async () => ({ success: true }) }; }
  });
  return databases.get(key);
}
export default { async fetch(request) {
  const [, kind, action] = new URL(request.url).pathname.split('/');
  const db = database(kind + (action === 'fresh' ? '-fresh' : ''), action !== 'fresh');
  const run = { investor: ensureInvestorSchema, advisor: ensureAdvisorSchema, exploring: ensureExploringSchema }[kind];
  const work = run({ DB: db });
  if (action === 'abandon') {
    work.catch(() => {});
    while (db.calls === 0) await new Promise(resolve => setTimeout(resolve, 0));
    return Response.json({ calls: db.calls });
  }
  await work;
  return Response.json({ calls: db.calls });
}};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
for (const kind of ['investor', 'advisor', 'exploring']) test(`${kind}: next request bootstraps after the creator ended; success stays per binding`, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-04-01', compatibilityFlags: ['nodejs_compat', 'handle_cross_request_promise_resolution'] }));
  try {
    const abandoned = await mf.dispatchFetch(`https://fixture/${kind}/abandon`);
    assert.equal(abandoned.status, 200);
    assert.equal((await abandoned.json()).calls, 1);
    const next = await mf.dispatchFetch(`https://fixture/${kind}/resume`, { signal: AbortSignal.timeout(2000) });
    assert.equal(next.status, 200, 'a new request must not await the ended request promise');
    const completed = (await next.json()).calls;
    assert.ok(completed > 1, 'the second request performs its own work');
    const ready = await mf.dispatchFetch(`https://fixture/${kind}/resume`);
    assert.equal((await ready.json()).calls, completed, 'completed readiness is reused');
    const fresh = await mf.dispatchFetch(`https://fixture/${kind}/fresh`);
    assert.equal(fresh.status, 200);
    assert.ok((await fresh.json()).calls > 0, 'another database must bootstrap independently');
  } finally { await mf.dispose(); }
});
