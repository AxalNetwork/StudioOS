import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(root, '..');

async function read(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8');
}

test('static, health, and verified anonymous public reads bypass blocking role-schema repairs', async () => {
  const source = await read('src/index.ts');

  assert.match(
    source,
    /if \(!pathname\.startsWith\('\/api\/'\)\) \{\s*return app\.fetch\(request, env, ctx\);/s,
    'non-API requests must reach the asset/SPA handler before role-schema work',
  );
  assert.match(
    source,
    /const ROLE_SCHEMA_SAFE_ANONYMOUS_READS: readonly \(string \| RegExp\)\[\] = \[/,
    'the public bypass must remain an explicit route allowlist',
  );
  for (const endpoint of [
    '/api/public/stats',
    '/api/public/events',
    '/api/public/jobs',
    '/api/public/verify',
    '/api/public/team',
  ]) {
    assert.match(source, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  assert.match(
    source,
    /typeof route === 'string' \? route === pathname : route\.test\(pathname\)/,
    'dynamic public reads must be explicitly pattern-matched',
  );
  assert.match(
    source,
    /return !\(method === 'GET' && isSafeAnonymousRead\);/,
    'the public-read bypass must remain read-only',
  );
  assert.doesNotMatch(
    source,
    /pathname\.startsWith\('\/api\/public\/'\)/,
    'public mutations and auth-dependent public routes must retain the blocking guard',
  );
  assert.match(
    source,
    /if \(requiresBlockingRoleSchemaBootstrap\(pathname, request\.method\) && env\.DB\)/,
    'only role-dependent API requests may block on the role-schema safety net',
  );
});

test('cold-isolate role-schema repairs are single-flight', async () => {
  const index = await read('src/index.ts');
  const exploring = await read('src/services/exploringSchema.ts');

  for (const [source, marker] of [
    [index, '_investorSchemaBootstrap'],
    [index, '_advisorSchemaBootstrap'],
    [exploring, '_exploringSchemaBootstrap'],
  ]) {
    assert.match(source, new RegExp(`if \\(${marker}\\) return ${marker};`));
    assert.match(source, new RegExp(`${marker} = \\(async \\(\\) => \\{`));
    assert.match(source, new RegExp(`${marker} = null;`));
  }
});

test('public production reads never run lazy schema DDL', async () => {
  for (const relativePath of [
    'src/services/eventsSchema.ts',
    'src/services/jobBoardSchema.ts',
    'src/services/circlesSchema.ts',
    'src/routes/public.ts',
    'src/services/profileExpansion.ts',
    'src/routes/follows.ts',
    'src/services/teamSchema.ts',
    'src/services/networkProfilesSchema.ts',
    'src/routes/spinout_certificates.ts',
  ]) {
    const source = await read(relativePath);
    assert.match(
      source,
      /if \(env\.ENVIRONMENT === 'production'\) \{\s*(?:_[A-Za-z_]+|migrated) = true;\s*return(?: true)?;\s*\}/s,
      `${relativePath} must let production migrations, not request-time DDL, own its schema`,
    );
  }
});

test('both deploy targets keep the apex route table to the audited allowlist', async () => {
  const toml = await readFile(resolve(workspaceRoot, 'wrangler.toml'), 'utf8');
  const topLevel = toml.slice(0, toml.indexOf('\n[assets]'));
  const productionStart = toml.indexOf('[env.production]');
  const productionEnd = toml.indexOf('[env.production.vars]');
  const production = toml.slice(productionStart, productionEnd);
  const patterns = (source) => [...source.matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((match) => match[1]).sort();

  const topPatterns = patterns(topLevel);
  const productionPatterns = patterns(production);

  // This assertion was INVERTED on 2026-08-31, and the inversion is the whole
  // point. It used to enforce a FLOOR (">= 68 entries; the table must never
  // shrink"), because the Worker served apex HTML and a missing route was a
  // 404. Cloudflare Pages now owns the apex frontend, so a small table is
  // correct and GROWING it is the hazard: re-adding a page or asset route
  // pairs Pages-served HTML with a different Worker asset build, the entry
  // module 404s, and the boot watchdog spins on `?__reboot=`. That is not
  // hypothetical — it is what took the apex down before this was rewritten.
  //
  // So: an exact allowlist, not a bound in either direction. The floor also
  // carried a hardcoded 68 that was 166 by the time it mattered, which is the
  // other reason it earned no trust.
  const ALLOWED = [
    'app.axal.vc',      // Workers Custom Domain — the Worker serves this whole host
    'axal.vc/api/*',    // the API
    'axal.vc/landing/*',// Worker-rendered landing pages
    'axal.vc/p/*',      // Worker-rendered public pages
  ].sort();

  assert.deepEqual(topPatterns, ALLOWED);
  assert.deepEqual(productionPatterns, ALLOWED);
  assert.equal(topPatterns.includes('axal.vc/*'), false);
  assert.equal(topPatterns.includes('axal.vc/assets/*'), false);
});