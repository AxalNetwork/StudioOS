import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { stripTypeScriptTypes } from 'node:module';
import { parse } from 'acorn';
import { Hono } from 'hono';
import activity from '../src/routes/activity.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = readFileSync(resolve(root, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const secret = 'synthetic-activity-test-'.repeat(3);
const roles = ['admin', 'partner', 'investor', 'founder', 'exploring', 'advisor'];

for (const role of [null, ...roles]) {
  test(`retired activity publishing endpoint: ${role ?? 'anonymous'} gets 404 without data access or network`, async () => {
    let databaseCalls = 0;
    let networkCalls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => { networkCalls++; throw new Error('unexpected network request'); };
    try {
      const token = role ? await new SignJWT({ user_id: 1, role }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) : null;
      const env: any = {
        JWT_SECRET: secret, ENVIRONMENT: 'development',
        GITHUB_ACCESS_TOKEN: 'synthetic-only', GITHUB_REPO_OWNER: 'example', GITHUB_REPO_NAME: 'synthetic',
        DB: { prepare() { databaseCalls++; throw new Error('unexpected database access'); } },
      };
      const app = new Hono().route('/api/activity', activity);
      const response = await app.request('/api/activity/sync-github', {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
      }, env);
      assert.equal(response.status, 404);
      assert.equal(databaseCalls, 0);
      assert.equal(networkCalls, 0);
    } finally { globalThis.fetch = original; }
  });
}

test('private activity reads remain available and scoped to the caller', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  try {
    for (const name of ['users', 'activity_logs', 'super_admins', 'user_personas', 'mi_pro_subscriptions']) {
      db.exec(tableFromBaseline(baseline, name));
    }
    for (let i = 0; i < roles.length; i++) {
      db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)')
        .run(i + 1, `person${i + 1}@example.invalid`, 'Synthetic member', roles[i]);
      db.prepare('INSERT INTO activity_logs(user_id,action,actor) VALUES(?,?,?)')
        .run(i + 1, `synthetic-${i + 1}`, `person${i + 1}@example.invalid`);
    }
    const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
    const app = new Hono().route('/api/activity', activity);
    for (let i = 0; i < roles.length; i++) {
      const token = await new SignJWT({ user_id: i + 1 }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
      for (const path of ['', '/recent', '/summary']) {
        const response = await app.request(`/api/activity${path}`, { headers: { Authorization: `Bearer ${token}` } }, env);
        assert.equal(response.status, 200, `${roles[i]} ${path}`);
        const body: any = await response.json();
        const rows = body.items ?? body.recent;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].action, `synthetic-${i + 1}`);
      }
    }
  } finally { db.close(); }
});

/** Conservative source guard: inspect executable string/method nodes, not comments.
 * Catches the original aliased URL/path writer even after relocation to a helper.
 */
function userContentsWriter(source: string): boolean {
  const ast = parse(stripTypeScriptTypes(source), { ecmaVersion: 'latest', sourceType: 'module' });
  const strings: string[] = [];
  let writes = false;
  function visit(node: any) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string') strings.push(node.value);
    if (node.type === 'TemplateElement') strings.push(node.value.cooked ?? node.value.raw);
    if (node.type === 'Property' && (node.key.name ?? node.key.value) === 'method'
      && node.value.type === 'Literal' && typeof node.value.value === 'string'
      && ['PUT', 'POST', 'PATCH'].includes(node.value.value.toUpperCase())) writes = true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return writes && strings.some(s => s.includes('/contents/'))
    && strings.some(s => s === 'users' || s.startsWith('users/') || s.includes('/contents/users/'));
}
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
test('no Worker route or helper publishes under users/ through GitHub contents', () => {
  const offenders = sourceFiles(resolve(root, 'cloudflare-worker/src'))
    .filter(path => userContentsWriter(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});
test('source guard catches aliased and direct writes, permits reads and unrelated repository writes', () => {
  assert.equal(userContentsWriter("const path = `users/${id}/activity.md`; const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`; fetch(url, {method: 'PUT'});"), true);
  assert.equal(userContentsWriter("fetch('https://api.github.com/repos/example/repo/contents/users/1/activity.md', {method: 'PUT'});"), true);
  assert.equal(userContentsWriter("fetch('https://api.github.com/repos/example/repo/contents/users/1/activity.md', {method: 'GET'});"), false);
  assert.equal(userContentsWriter("fetch('https://api.github.com/repos/example/repo/contents/README.md', {method: 'PUT'});"), false);
  assert.equal(userContentsWriter("// users/ and /contents/ must never receive activity\nconst method = 'PUT';"), false);
});
test('client and dev mirror cannot revive activity publishing', () => {
  assert.doesNotMatch(readFileSync(resolve(root, 'frontend/src/lib/api.js'), 'utf8'), /activitySyncGithub|\/activity\/sync-github/);
  assert.doesNotMatch(readFileSync(resolve(root, 'backend/app/api/routes/activity.py'), 'utf8'), /sync-github|sync_activity_logs_to_github/);
  assert.doesNotMatch(readFileSync(resolve(root, 'backend/app/services/github_service.py'), 'utf8'), /sync_activity_logs_to_github/);
});
