/**
 * Task #30 — one-cap-table-per-project, end-to-end (Worker / D1 path).
 *
 * Drives the real Hono captable app via captable.request() with a minted JWT
 * and a *stateful* in-memory D1 stub (it persists cap_table_scenarios rows so
 * the upsert SELECT→UPDATE/INSERT logic actually round-trips). This locks in
 * the user-visible guarantee from Task #28: selecting a project, saving a
 * scenario, then editing and saving again UPSERTS a single row — never a
 * duplicate — and the ?project= deep-link bootstrap endpoint
 * (GET /scenarios/by-project/:id) returns that one row.
 *
 * The FastAPI dev path has a parallel regression in
 * tests/test_captable_project_upsert.py.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_project_upsert.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import captable from '../src/routes/captable.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const ADMIN_ID = 1;
const PROJECT_ID = 1;

// Two valid, distinct inputs (pass validateInputs): a single founder, then a
// co-founder added on the "edit" save so the second save changes content.
const INPUTS_V1 = { founders: [{ name: 'Ada', shares: 8_000_000 }], option_pool_pct: 10 };
const INPUTS_V2 = {
  founders: [
    { name: 'Ada', shares: 8_000_000 },
    { name: 'Grace', shares: 2_000_000 },
  ],
  option_pool_pct: 10,
};

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

type ScenarioRow = {
  id: number; uid: string; owner_user_id: number; project_id: number | null;
  name: string; inputs_json: string; result_json: string | null;
  computed_at: string | null; created_at: string; updated_at: string;
};

/**
 * Stateful in-memory D1 stub. Maintains a real `cap_table_scenarios` array so
 * SELECT/UPDATE/INSERT actually mutate shared state, plus the auth-user and
 * project lookups the routes need. Returns the rows array so tests can assert
 * exactly how many scenarios exist.
 */
function makeEnv(
  user: any,
  opts: { project?: any; scenarios?: ScenarioRow[] } = {},
): { env: any; rows: ScenarioRow[] } {
  const project = opts.project ?? null;
  const rows: ScenarioRow[] = (opts.scenarios ?? []).map((r) => ({ ...r }));
  let nextId = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;

  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        if (s.includes('from users where id')) return { results: user ? [user] : [] };
        if (s.includes('from cap_table_scenarios')) return { results: rows };
        return { results: [] };
      },
      async first() {
        if (s.includes('from mi_pro_subscriptions')) return null;
        if (s.includes('from projects') && s.includes('where id')) return project;
        if (s.includes('from cap_table_scenarios')) {
          if (s.includes('where uid')) {
            return rows.find((r) => r.uid === bound[0]) ?? null;
          }
          if (s.includes('where project_id')) {
            // PUT clash guard: "... WHERE project_id = ? AND uid != ? LIMIT 1".
            if (s.includes('uid !=')) {
              return rows.find((r) => r.project_id === bound[0] && r.uid !== bound[1]) ?? null;
            }
            // by-project / upsert lookup: latest row for the project.
            const matches = rows
              .filter((r) => r.project_id === bound[0])
              .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
            return matches[0] ?? null;
          }
        }
        return null;
      },
      async run() {
        if (s.includes('insert into cap_table_scenarios')) {
          // bound: uid, owner_user_id, project_id, name, inputs_json,
          //        result_json, computed_at, created_at, updated_at
          rows.push({
            id: nextId++,
            uid: bound[0], owner_user_id: bound[1], project_id: bound[2],
            name: bound[3], inputs_json: bound[4], result_json: bound[5],
            computed_at: bound[6], created_at: bound[7], updated_at: bound[8],
          });
        } else if (s.includes('update cap_table_scenarios')) {
          // POST upsert: SET name, inputs_json, result_json, computed_at,
          //              updated_at WHERE id = ?
          // PUT:         SET name, inputs_json, result_json, computed_at,
          //              updated_at, project_id WHERE uid = ?
          const key = bound[bound.length - 1];
          const row = s.includes('where uid')
            ? rows.find((r) => r.uid === key)
            : rows.find((r) => r.id === key);
          if (row) {
            row.name = bound[0]; row.inputs_json = bound[1]; row.result_json = bound[2];
            row.computed_at = bound[3]; row.updated_at = bound[4];
            if (s.includes('project_id = ?')) row.project_id = bound[5];
          }
        } else if (s.includes('delete from cap_table_scenarios')) {
          const idx = rows.findIndex((r) => r.uid === bound[0]);
          if (idx >= 0) rows.splice(idx, 1);
        }
        return { meta: { changes: 1 } };
      },
    };
    return api;
  };

  const env = {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
  return { env, rows };
}

function req(env: any, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return captable.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } },
    env,
  );
}

test('Worker: POST upsert keeps exactly one scenario per project across two saves + bootstrap', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const { env, rows } = makeEnv(
    { id: ADMIN_ID, role: 'admin', is_active: 1 },
    { project: { id: PROJECT_ID, founder_id: 7 } },
  );

  // 1. Deep-link bootstrap on first load: the project has no cap table yet.
  let res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).scenario, null);

  // 2. Save #1 — the frontend always saves through the POST upsert.
  res = await req(env, token, '/scenarios', {
    method: 'POST',
    body: JSON.stringify({ name: 'Seed plan', project_id: PROJECT_ID, inputs: INPUTS_V1 }),
  });
  assert.equal(res.status, 200);
  const created = (await res.json()) as any;
  const uid1 = created.uid;
  assert.equal(created.project_id, PROJECT_ID);
  assert.ok(created.result, 'create returns the computed result');
  assert.equal(rows.length, 1);

  // 3. Deep-link bootstrap reload now finds the saved table.
  res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}`);
  assert.equal(((await res.json()) as any).scenario.uid, uid1);

  // 4. Save #2 — edit (add a co-founder) and save again for the SAME project.
  res = await req(env, token, '/scenarios', {
    method: 'POST',
    body: JSON.stringify({ name: 'Seed plan v2', project_id: PROJECT_ID, inputs: INPUTS_V2 }),
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as any;

  // 5. Still exactly ONE row for the project; uid is stable; content updated.
  assert.equal(rows.length, 1);
  assert.equal(rows.filter((r) => r.project_id === PROJECT_ID).length, 1);
  assert.equal(updated.uid, uid1);
  assert.equal(updated.name, 'Seed plan v2');
  assert.equal(updated.inputs.founders.length, 2);

  // 6. by-project bootstrap returns the single, updated row.
  res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}`);
  const boot = ((await res.json()) as any).scenario;
  assert.equal(boot.uid, uid1);
  assert.equal(boot.name, 'Seed plan v2');
});

test('Worker: PUT refuses to bind a second scenario to a project that already has one (409)', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const NOW = '2026-06-28T00:00:00.000Z';
  const { env, rows } = makeEnv(
    { id: ADMIN_ID, role: 'admin', is_active: 1 },
    {
      project: { id: PROJECT_ID, founder_id: 7 },
      scenarios: [
        {
          id: 1, uid: 'uid-bound', owner_user_id: ADMIN_ID, project_id: PROJECT_ID,
          name: 'Bound', inputs_json: JSON.stringify(INPUTS_V1), result_json: '{}',
          computed_at: NOW, created_at: NOW, updated_at: NOW,
        },
        {
          id: 2, uid: 'uid-free', owner_user_id: ADMIN_ID, project_id: null,
          name: 'Free', inputs_json: JSON.stringify(INPUTS_V1), result_json: '{}',
          computed_at: NOW, created_at: NOW, updated_at: NOW,
        },
      ],
    },
  );

  const res = await req(env, token, '/scenarios/uid-free', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Free', project_id: PROJECT_ID, inputs: INPUTS_V1 }),
  });
  assert.equal(res.status, 409);
  const body = (await res.json()) as any;
  assert.equal(body.detail.code, 'project_has_cap_table');

  // No duplicate row, and the free scenario stayed unbound.
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.uid === 'uid-free')!.project_id, null);
});
