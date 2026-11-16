/**
 * D6010 (#6010) — Validate › Market intelligence opens market sizing to every
 * founder of the venture, on real SQLite (the baseline, then every migration
 * above the cutoff) with the two routers the sizing page writes through mounted
 * on a bare Hono. All people and ventures are synthetic.
 *
 *   · a founder who is NOT in the Spin-Out Lab saves total, serviceable and
 *     obtainable market (PUT /api/projects/:id), the assumptions behind them,
 *     the positioning and assumptions marks and a source, for their own venture;
 *   · a partner seated on that venture, an investor and another venture's
 *     founder each write none of it, and the stored rows do not change;
 *   · the market card's next step is the sizing door, for that venture.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_market_sizing_6010.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import projects from '../src/routes/projects.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';

const MIGRATIONS = new URL('../sql/migrations/', import.meta.url);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const above = readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);
const schema = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline);
  for (const name of above) db.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close(); return ddl;
})();

const FOUNDER = 1, PARTNER = 2, INVESTOR = 3, OTHER = 4;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [PARTNER]: 'partner', [INVESTOR]: 'investor', [OTHER]: 'founder' };
const P = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(schema);
  // The founder is not in the Lab (spinout_lab_active 0): Validate is their only door.
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,spinout_lab_active,subscription_tier) VALUES
      (1,'founder','Synthetic founder','founder@example.com',11,1,0,'studio'),
      (2,'partner','Synthetic partner','partner@example.com',NULL,1,0,'studio'),
      (3,'investor','Synthetic investor','investor@example.com',NULL,1,0,'studio'),
      (4,'founder','Other founder','other@example.com',44,1,0,'studio');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11),(2,'synthetic-two','Other venture',44);`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/projects', projects).route('/api/cycles/validate', cycleValidate);
  app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, e?.message === 'Unauthorized' ? 401 : 500)));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, ROLE[who])}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  return { db, call };
}

const sizing = (db: DatabaseSync) => ({ ...(db.prepare('SELECT tam, sam, som FROM projects WHERE id = ?').get(P) as any) });
const stored = (db: DatabaseSync) => ({
  sizing: sizing(db),
  assumptions: (db.prepare('SELECT COUNT(*) AS n FROM project_market_assumptions WHERE project_id = ?').get(P) as any).n,
  marks: (db.prepare('SELECT COUNT(*) AS n FROM market_readiness_marks WHERE project_id = ?').get(P) as any).n,
  sources: (db.prepare('SELECT COUNT(*) AS n FROM market_sources WHERE project_id = ?').get(P) as any).n,
});

/** Every write the sizing page makes, for venture P, as `who`. */
async function writeAll(call: any, who: number) {
  return {
    figures: (await call(who, 'PUT', `/api/projects/${P}`, { tam: 1_000_000_000, sam: 140_000_000, som: 24_000_000 })).status,
    assumptions: (await call(who, 'PUT', `/api/projects/${P}/market-assumptions`, { population: '20000', acv: '50000' })).status,
    positioning: (await call(who, 'PUT', `/api/cycles/validate/market-marks/positioning_map?project=${P}`, { done: true })).status,
    reviewed: (await call(who, 'PUT', `/api/cycles/validate/market-marks/assumptions_reviewed?project=${P}`, { done: true })).status,
    source: (await call(who, 'POST', `/api/cycles/validate/market-sources?project=${P}`, { title: 'Synthetic industry report', kind: 'Report' })).status,
  };
}

test('D6010: a founder who is not in the Lab saves the three figures, the assumptions, both marks and a source for their own venture', async () => {
  const { db, call } = fixture(); try {
    assert.deepEqual(await writeAll(call, FOUNDER), { figures: 200, assumptions: 200, positioning: 200, reviewed: 200, source: 201 });
    assert.deepEqual(sizing(db), { tam: 1_000_000_000, sam: 140_000_000, som: 24_000_000 });
    const back = await call(FOUNDER, 'GET', `/api/projects/${P}/market-assumptions`);
    assert.equal(back.status, 200);
    assert.equal(back.body.assumptions.population, '20000');
    const r = await call(FOUNDER, 'GET', `/api/cycles/validate/market-readiness?project=${P}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.positioning_map && r.body.assumptions_reviewed, 'both marks read back as stored');
    assert.deepEqual(r.body.sources.map((s: any) => s.title), ['Synthetic industry report']);
  } finally { db.close(); }
});

test('D6010: a partner seated on the venture, an investor and another venture\'s founder write nothing', async () => {
  const { db, call } = fixture(); try {
    // The partner is an accepted advisor of the venture: they may read the board, never write it.
    db.exec(`INSERT INTO project_members(project_id,user_id,role,status) VALUES (${P},${PARTNER},'advisor','accepted')`);
    const before = stored(db);
    for (const who of [PARTNER, INVESTOR, OTHER]) {
      const out = await writeAll(call, who);
      for (const [write, status] of Object.entries(out)) assert.equal(status, 403, `${ROLE[who]} #${who}: ${write} is refused`);
    }
    assert.deepEqual(stored(db), before, 'no row changed');
    // The partner still reads the stored checks (the board's audience); the investor does not.
    assert.equal((await call(PARTNER, 'GET', `/api/cycles/validate/market-readiness?project=${P}`)).status, 200);
    assert.equal((await call(INVESTOR, 'GET', `/api/cycles/validate/market-readiness?project=${P}`)).status, 403);
  } finally { db.close(); }
});

test('D6010: the market card\'s next step lands on the sizing door for this venture', async () => {
  const { db, call } = fixture(); try {
    const next = async () => (await call(FOUNDER, 'GET', `/api/cycles/validate/overview?project=${P}`)).body.cards.find((c: any) => c.slug === 'market-intelligence').next;
    const door = `/validate/market-intelligence/sizing?project=${P}`;
    assert.deepEqual(await next(), { text: 'Add the total market, with its source', href: door });
    assert.equal((await call(FOUNDER, 'PUT', `/api/projects/${P}`, { tam: 1_000_000_000 })).status, 200);
    assert.deepEqual(await next(), { text: 'Add the serviceable market', href: door });
    assert.equal((await call(FOUNDER, 'PUT', `/api/projects/${P}`, { sam: 140_000_000, som: 24_000_000 })).status, 200);
    assert.deepEqual(await next(), { text: 'Track 3 more competitors', href: door });
  } finally { db.close(); }
});
