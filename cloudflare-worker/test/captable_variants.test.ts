/**
 * Task #29 — cap-table scenario variants (Worker / D1 path).
 *
 * Locks the invariant that lets teams compare multiple cap-table scenarios per
 * project WITHOUT breaking the one-cap-table-per-project rule the Demo Day deck
 * Slide 08 depends on:
 *
 *   - A draft variant (is_variant=1) is a fresh INSERT — creating one NEVER
 *     trips the project_has_cap_table (409) guard, even when the project already
 *     has a canonical cap table.
 *   - The canonical-only lookups (GET by-project, POST upsert) ignore variants,
 *     so the project's "one cap table" stays the canonical row even when a NEWER
 *     variant exists (the deck reads the same canonical-filtered SELECT).
 *   - GET compare returns the canonical row PLUS every variant.
 *   - Investors (project read, but no project write) cannot create a variant.
 *
 * The deck's own canonical filter is locked separately in spinoutDeckData.test.ts.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_variants.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import captable from '../src/routes/captable.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const ADMIN_ID = 1;
const INVESTOR_ID = 2;
const PROJECT_ID = 1;

const INPUTS_CANON = { founders: [{ name: 'Ada', shares: 8_000_000 }], option_pool_pct: 10 };
const INPUTS_VARIANT = {
  founders: [
    { name: 'Ada', shares: 6_000_000 },
    { name: 'Grace', shares: 4_000_000 },
  ],
  option_pool_pct: 15,
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
  is_variant: number | null;
};

/**
 * Stateful in-memory D1 stub that HONORS is_variant — the difference from the
 * upsert test's stub. INSERTs whose column list mentions `is_variant` land a
 * variant row (=1); the canonical-only SELECTs (COALESCE(is_variant,0)=0) skip
 * variants; the compare SELECT returns everything canonical-first.
 */
function makeEnv(
  user: any,
  opts: { project?: any; scenarios?: ScenarioRow[] } = {},
): { env: any; rows: ScenarioRow[] } {
  const project = opts.project ?? null;
  const rows: ScenarioRow[] = (opts.scenarios ?? []).map((r) => ({ ...r }));
  let nextId = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;

  const byUpdatedDesc = (a: ScenarioRow, b: ScenarioRow) =>
    a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;

  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    const canonicalOnly = s.includes('coalesce(is_variant,0) = 0');
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        if (s.includes('from users where id')) return { results: user ? [user] : [] };
        if (s.includes('from cap_table_scenarios')) {
          let out = rows.slice();
          if (s.includes('where project_id')) {
            out = out.filter((r) => r.project_id === bound[0]);
            if (canonicalOnly) out = out.filter((r) => !r.is_variant);
            // compare: ORDER BY COALESCE(is_variant,0) ASC, updated_at DESC
            out.sort((a, b) => {
              const av = a.is_variant ? 1 : 0;
              const bv = b.is_variant ? 1 : 0;
              return av !== bv ? av - bv : byUpdatedDesc(a, b);
            });
          } else if (s.includes('where owner_user_id')) {
            out = out.filter((r) => r.owner_user_id === bound[0]);
          }
          return { results: out };
        }
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
            // PUT clash guard: "... WHERE project_id = ? AND uid != ? AND
            // COALESCE(is_variant,0) = 0 LIMIT 1".
            if (s.includes('uid !=')) {
              return rows.find(
                (r) => r.project_id === bound[0] && r.uid !== bound[1] && !r.is_variant,
              ) ?? null;
            }
            // by-project / upsert lookup: latest CANONICAL row for the project.
            let matches = rows.filter((r) => r.project_id === bound[0]);
            if (canonicalOnly) matches = matches.filter((r) => !r.is_variant);
            matches.sort(byUpdatedDesc);
            return matches[0] ?? null;
          }
        }
        return null;
      },
      async run() {
        if (s.includes('insert into cap_table_scenarios')) {
          // Column list mentions is_variant only on the variant INSERT path.
          const isVariant = s.includes('is_variant)') ? 1 : 0;
          rows.push({
            id: nextId++,
            uid: bound[0], owner_user_id: bound[1], project_id: bound[2],
            name: bound[3], inputs_json: bound[4], result_json: bound[5],
            computed_at: bound[6], created_at: bound[7], updated_at: bound[8],
            is_variant: isVariant,
          });
        } else if (s.includes('update cap_table_scenarios')) {
          const key = bound[bound.length - 1];
          const row = s.includes('where uid')
            ? rows.find((r) => r.uid === key)
            : rows.find((r) => r.id === key);
          if (row) {
            row.name = bound[0]; row.inputs_json = bound[1]; row.result_json = bound[2];
            row.computed_at = bound[3]; row.updated_at = bound[4];
            if (s.includes('project_id = ?')) row.project_id = bound[5];
            // is_variant is intentionally never updated — it is set once at
            // INSERT and preserved across edits.
          }
        } else if (s.includes('delete from cap_table_scenarios')) {
          const idx = rows.findIndex((r) => r.uid === bound[0]);
          if (idx >= 0) rows.splice(idx, 1);
        }
        // ALTER TABLE (is_variant self-heal) and anything else: no-op.
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

function canonRow(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
  const NOW = '2026-06-01T00:00:00.000Z';
  return {
    id: 1, uid: 'uid-canonical', owner_user_id: ADMIN_ID, project_id: PROJECT_ID,
    name: 'Canonical', inputs_json: JSON.stringify(INPUTS_CANON), result_json: '{}',
    computed_at: NOW, created_at: NOW, updated_at: NOW, is_variant: 0,
    ...overrides,
  };
}

test('Worker: creating a variant never trips the one-cap-table 409, and stays distinct', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const { env, rows } = makeEnv(
    { id: ADMIN_ID, role: 'admin', is_active: 1 },
    { project: { id: PROJECT_ID, founder_id: 7 }, scenarios: [canonRow()] },
  );

  const res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}/variants`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Aggressive raise', inputs: INPUTS_VARIANT }),
  });
  assert.equal(res.status, 200, 'variant create succeeds even though a canonical cap table exists');
  const variant = (await res.json()) as any;
  assert.equal(variant.is_variant, 1, 'serialized row marks it as a variant');
  assert.notEqual(variant.uid, 'uid-canonical', 'variant is a NEW row, not the canonical one');

  // Two rows now: the original canonical + the new variant.
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => !r.is_variant).length, 1);
  assert.equal(rows.filter((r) => r.is_variant).length, 1);
});

test('Worker: canonical lookups ignore a NEWER variant (deck-safe one-per-project)', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  // A variant updated AFTER the canonical row — a naive "latest row" lookup
  // would wrongly pick it. The canonical filter must still return the canonical.
  const { env } = makeEnv(
    { id: ADMIN_ID, role: 'admin', is_active: 1 },
    {
      project: { id: PROJECT_ID, founder_id: 7 },
      scenarios: [
        canonRow({ updated_at: '2026-06-01T00:00:00.000Z' }),
        canonRow({
          id: 2, uid: 'uid-variant', name: 'Newer variant', is_variant: 1,
          updated_at: '2026-06-28T00:00:00.000Z',
        }),
      ],
    },
  );

  // by-project (same canonical-filtered SELECT the deck's loadSimSegments uses).
  const res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}`);
  assert.equal(res.status, 200);
  const scen = ((await res.json()) as any).scenario;
  assert.equal(scen.uid, 'uid-canonical', 'by-project returns the canonical row, not the newer variant');
  assert.equal(scen.is_variant, 0);

  // POST upsert must UPDATE the canonical row in place — not the variant, and
  // not a brand-new row.
  const up = await req(env, token, '/scenarios', {
    method: 'POST',
    body: JSON.stringify({ name: 'Canonical edited', project_id: PROJECT_ID, inputs: INPUTS_CANON }),
  });
  assert.equal(up.status, 200);
  const upBody = (await up.json()) as any;
  assert.equal(upBody.uid, 'uid-canonical', 'upsert targets the canonical row');
  assert.equal(upBody.is_variant, 0);
});

test('Worker: compare returns the canonical row plus every variant', async () => {
  const token = await mintToken(ADMIN_ID, 'admin');
  const { env } = makeEnv(
    { id: ADMIN_ID, role: 'admin', is_active: 1 },
    {
      project: { id: PROJECT_ID, founder_id: 7 },
      scenarios: [
        canonRow(),
        canonRow({ id: 2, uid: 'uid-var-a', name: 'Variant A', is_variant: 1, updated_at: '2026-06-10T00:00:00.000Z' }),
        canonRow({ id: 3, uid: 'uid-var-b', name: 'Variant B', is_variant: 1, updated_at: '2026-06-20T00:00:00.000Z' }),
      ],
    },
  );

  const res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}/compare`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(body.canonical, 'canonical present');
  assert.equal(body.canonical.uid, 'uid-canonical');
  assert.equal(body.canonical.is_variant, 0);
  const variantUids = (body.variants as any[]).map((v) => v.uid).sort();
  assert.deepEqual(variantUids, ['uid-var-a', 'uid-var-b']);
  assert.ok((body.variants as any[]).every((v) => v.is_variant === 1));
});

test('Worker: an investor (project read, no project write) cannot create a variant', async () => {
  const token = await mintToken(INVESTOR_ID, 'investor');
  const { env, rows } = makeEnv(
    { id: INVESTOR_ID, role: 'investor', is_active: 1 },
    { project: { id: PROJECT_ID, founder_id: 7 }, scenarios: [canonRow()] },
  );

  const res = await req(env, token, `/scenarios/by-project/${PROJECT_ID}/variants`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Investor variant', inputs: INPUTS_VARIANT }),
  });
  assert.equal(res.status, 403, 'investor is blocked by project WRITE access');
  assert.equal(rows.length, 1, 'no variant row was created');
});
