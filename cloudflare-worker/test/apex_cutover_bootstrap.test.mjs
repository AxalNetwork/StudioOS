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

test('both deploy targets preserve the explicit apex route table', async () => {
  const toml = await readFile(resolve(workspaceRoot, 'wrangler.toml'), 'utf8');
  const topLevel = toml.slice(0, toml.indexOf('\n[assets]'));
  const productionStart = toml.indexOf('[env.production]');
  const productionEnd = toml.indexOf('[env.production.vars]');
  const production = toml.slice(productionStart, productionEnd);
  const patterns = (source) => [...source.matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((match) => match[1]).sort();

  const topPatterns = patterns(topLevel);
  const productionPatterns = patterns(production);

  assert.equal(topPatterns.includes('axal.vc/*'), false);
  assert.equal(productionPatterns.includes('axal.vc/*'), false);
  // A floor, not an equality. The rollback plan restores "the saved
  // version/67-route table", so the table must never SHRINK below what was
  // saved — but growing it is how coverage gaps get closed, and pinning an
  // exact count turns every legitimate addition into a failing test that gets
  // fixed by bumping the number, which teaches the number to mean nothing.
  //
  // The count alone was always weak: 68 stays 68 if a route is swapped for a
  // different one. Per-route truth lives in
  // frontend/test/apex_route_coverage.test.mjs, which checks that every
  // prerendered route is actually served and that the legal pages are among
  // them. This assertion's job is only to catch the table being gutted.
  assert.ok(
    topPatterns.length >= 68,
    `apex route table shrank to ${topPatterns.length}; the saved rollback table has 68 entries`,
  );
  assert.ok(topPatterns.includes('app.axal.vc'), 'the Workers Custom Domain must stay bound');
  assert.deepEqual(productionPatterns, topPatterns);
});