// D849 (#2472): `scripts/check-secret-logging.mjs` finds a credential in a log
// line or an activity row, and passes prose, field names and comments. The
// whole Worker tree passes it, and `test:guards` runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { scan } from '../../scripts/check-secret-logging.mjs';

const names = (src) => scan(src).map((f) => f.name);

test('D849 a bearer, a secret or an axk_ value in a log or an activity row is found', () => {
  assert.deepEqual(names("console.warn('auth', bearer);"), ['bearer']);
  assert.deepEqual(names('console.error(`token ${bearerToken} bad`);'), ['bearerToken']);
  assert.deepEqual(names('console.log(c.env.JWT_SECRET);'), ['JWT_SECRET']);
  assert.deepEqual(names("console.info('axk_' + prefix);"), ['axk_']);
  assert.deepEqual(names("await logActorAct(env, user, 'key.made', { raw: secret });"), ['secret']);
  assert.deepEqual(names("await logActorAct(env, user, 'key.made', { secret });"), ['secret'], 'a shorthand key is its value');
  assert.deepEqual(names("await env.DB.prepare('INSERT INTO activity_logs (details) VALUES (?)').bind(JSON.stringify({ k: rawSecret })).run();"), ['rawSecret']);
  assert.deepEqual(names("console.log(ok ? secret : 'none');"), ['secret'], 'a ternary branch is a value, not a key');
});

test('D849 prose, a field name, a safe value and a comment pass', () => {
  assert.deepEqual(names("console.warn('[auth] the JWT secret is not set');"), []);
  assert.deepEqual(names("await logActorAct(env, user, 'support.start', { bearer_user_id: id });"), []);
  assert.deepEqual(names("await env.DB.prepare('INSERT INTO activity_logs (details) VALUES (?)').bind(JSON.stringify({ k: prefix })).run();"), []);
  assert.deepEqual(names('// console.log(secret)'), []);
  assert.deepEqual(names('const bearer = x; console.log(id);'), [], 'a name outside the call is not read');
});

test('D849 the Worker tree passes, and test:guards runs the guard', () => {
  execFileSync(process.execPath, [new URL('../../scripts/check-secret-logging.mjs', import.meta.url).pathname], { stdio: 'pipe' });
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['test:guards'], /node scripts\/check-secret-logging\.mjs/);
});
