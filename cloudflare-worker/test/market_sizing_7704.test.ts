/**
 * D7704 (#7704) — market sizing versions on real SQLite: the baseline plus
 * every migration above the cutoff (so 202611191932 too), `routes/market_sizing.ts`
 * and `routes/projects.ts` mounted on a bare Hono, and the pure formula in
 * `services/marketSizing.ts`. Everyone here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/market_sizing_7704.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import projects from '../src/routes/projects.ts';
import marketSizing from '../src/routes/market_sizing.ts';
import { marketFigureHistory } from '../src/services/marketFigures.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import { readFigure, recomputesToStored, sizeMarket } from '../src/services/marketSizing.ts';

const FOUNDER = 1, OTHER = 3, ADMIN = 900;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin' };

/** The inputs every case starts from. TAM 741,600,000; SAM 103,824,000; SOM by win rate 8,305,920; by capacity 1,360,800. */
const BASE = {
  population: '41,200 firms', acv: '$18,000 / year', samPct: '14', winRate: '8',
  capacity: '4', horizonMonths: '24', salesCycleMonths: '3', retentionPct: '90',
  targetYear: '2027', runway: '18', geography: 'Europe',
};

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
      (1,'founder','Fay Founder','founder@example.com',11,1,'studio'),(3,'founder','Bo Other','other@example.com',33,1,'studio'),
      (900,'admin','Ada Admin','admin@example.com',NULL,1,'studio');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11),(2,'synthetic-two','Other venture',33);
    INSERT INTO market_sources(id,project_id,title,url,kind,added_by) VALUES
      (7,1,'Synthetic industry report 2026','https://example.com/report','Report',1);`);
  const real = d1Over(db);
  const forced = { at: -1, sizes: [] as number[] };
  const DB = {
    ...real,
    async batch(stmts: any[]) {
      forced.sizes.push(stmts.length);
      const list = forced.at < 0 ? stmts : stmts.map((s, i) => (i === forced.at ? { runSync() { throw new Error('forced failure'); } } : s));
      return real.batch(list);
    },
  };
  const env: any = { DB, JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/projects', projects).route('/api/market-sizing', marketSizing);
  app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, e?.message === 'Unauthorized' ? 401 : 500)));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, ROLE[who])}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const save = (assumptions: Record<string, unknown>, extra: Record<string, unknown> = {}, who = FOUNDER, pid = 1) =>
    call(who, 'POST', `/api/market-sizing/projects/${pid}/versions`, { assumptions, ...extra });
  /** Everything a save may touch, read back from the store. */
  const snapshot = () => JSON.stringify({
    projects: db.prepare('SELECT id, tam, sam, som FROM projects ORDER BY id').all(),
    figures: db.prepare('SELECT * FROM market_figures ORDER BY id').all(),
    versions: db.prepare('SELECT * FROM market_sizing_versions ORDER BY id').all(),
    inputs: db.prepare('SELECT * FROM market_sizing_version_inputs ORDER BY id').all(),
    assumptions: db.prepare('SELECT * FROM project_market_assumptions ORDER BY id').all(),
    admin: db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'market_figures_set'").all(),
  });
  return { db, env, call, save, snapshot, forced };
}

const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;

test('a version saves inputs, figures, history and assumptions together, computed by formula version 2', async () => {
  const { db, save } = fixture(); try {
    const r = await save(BASE);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const v = r.body.version;
    assert.equal(v.version_number, 1);
    assert.equal(v.formula_version, 2);
    assert.deepEqual([v.computed_tam, v.tam, v.sam, v.som, v.som_limit], [741_600_000, 741_600_000, 103_824_000, 1_360_800, 'capacity']);
    assert.equal(r.body.result.som_by_win_rate, 8_305_920);
    assert.match(r.body.result.formula.join(' '), /SOM is set by sales capacity/);
    assert.equal(v.current, true);
    assert.equal(v.recomputes, true);
    assert.deepEqual({ ...one(db, 'SELECT tam, sam, som FROM projects WHERE id = 1') }, { tam: 741_600_000, sam: 103_824_000, som: 1_360_800 });
    // '41,200 firms' is read as 41200 and the text is kept.
    const pop = one(db, "SELECT value, typed_text, unit, label FROM market_sizing_version_inputs WHERE input_key = 'population'");
    assert.deepEqual({ ...pop }, { value: 41200, typed_text: '41,200 firms', unit: 'accounts', label: 'entered' });
    assert.equal(one(db, "SELECT value FROM market_sizing_version_inputs WHERE input_key = 'acv'").value, 18000);
    // The assumptions row holds what was typed, the new columns included.
    const a = one(db, 'SELECT population, horizon_months, sales_cycle_months, retention_pct, runway FROM project_market_assumptions WHERE project_id = 1');
    assert.deepEqual({ ...a }, { population: '41,200 firms', horizon_months: '24', sales_cycle_months: '3', retention_pct: '90', runway: '18' });
  } finally { db.close(); }
});

test('a 0% serviceable share saves SAM 0 and SOM 0, never a default share', async () => {
  const { db, save } = fixture(); try {
    const r = await save({ ...BASE, samPct: '0' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.version.tam, r.body.version.sam, r.body.version.som], [741_600_000, 0, 0]);
    assert.deepEqual({ ...one(db, 'SELECT sam, som FROM projects WHERE id = 1') }, { sam: 0, som: 0 });
  } finally { db.close(); }
});

test('a blank required input is refused by name and nothing is written', async () => {
  const { db, save, snapshot } = fixture(); try {
    const before = snapshot();
    for (const [key, code] of [['population', 'missing_population'], ['acv', 'missing_acv'], ['samPct', 'missing_sam_pct'], ['winRate', 'missing_win_rate'],
      ['capacity', 'missing_capacity'], ['horizonMonths', 'missing_horizon_months'], ['salesCycleMonths', 'missing_sales_cycle_months'], ['retentionPct', 'missing_retention_pct']]) {
      const r = await save({ ...BASE, [key]: '  ' });
      assert.equal(r.status, 400, key);
      assert.equal(r.body.error, code);
      assert.equal(r.body.field, key);
    }
    // An override needs its reason; with it, eligible accounts are no longer required.
    const noReason = await save({ ...BASE, population: '', tamOverride: '500' });
    assert.equal(noReason.body.error, 'missing_tam_override_reason');
    assert.equal(snapshot(), before, 'a refused save changed the store');
  } finally { db.close(); }
});

test('a well-formed figure with a unit is read; a malformed or negative one is refused by name, never cut short', async () => {
  assert.deepEqual(readFigure('41,200 firms', 'count'), { state: 'ok', value: 41200, text: '41,200 firms' });
  assert.deepEqual(readFigure('$18,000 / year', 'money'), { state: 'ok', value: 18000, text: '$18,000 / year' });
  assert.deepEqual(readFigure('14%', 'percent'), { state: 'ok', value: 14, text: '14%' });
  assert.deepEqual(readFigure('0', 'percent'), { state: 'ok', value: 0, text: '0' });
  assert.deepEqual(readFigure('', 'count'), { state: 'blank' });
  for (const bad of ['40k firms', '40k', '41,20 firms', '1e6', '12.5.3', '40 million', '41,200 - 52,000', 'about 40', '$14', 'NaN']) {
    assert.equal(readFigure(bad, bad === '$14' ? 'percent' : 'count').state, 'malformed', bad);
  }
  assert.equal(readFigure('-5', 'count').state, 'negative');
  assert.equal(readFigure('101', 'percent').state, 'out_of_range');

  const { db, save, snapshot } = fixture(); try {
    const before = snapshot();
    const r = await save({ ...BASE, population: '40k firms' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_population');
    const neg = await save({ ...BASE, winRate: '-3' });
    assert.equal(neg.body.error, 'invalid_win_rate');
    const pct = await save({ ...BASE, retentionPct: '140' });
    assert.equal(pct.body.error, 'invalid_retention_pct');
    assert.equal(snapshot(), before);
  } finally { db.close(); }
});

test('a forced failure of any one statement in the batch leaves figures, history, assumptions and versions unchanged', async () => {
  const { db, save, snapshot, forced } = fixture(); try {
    assert.equal((await save(BASE)).status, 201);
    const size = forced.sizes.at(-1) as number;
    assert.ok(size >= 14, `the save is one batch of every write (got ${size})`);
    const before = snapshot();
    for (let i = 0; i < size; i += 1) {
      forced.at = i;
      const r = await save({ ...BASE, capacity: '40' });
      assert.equal(r.status, 500, `statement ${i}`);
      assert.equal(r.body.error, 'sizing_not_saved');
      assert.equal(snapshot(), before, `statement ${i} failing left a partial write`);
    }
  } finally { db.close(); }
});

test('a stored version recomputes to its stored figures from its own rows', async () => {
  const { db, call, save } = fixture(); try {
    const r = await save({ ...BASE, tamOverride: '500', tamOverrideReason: 'Analyst consensus' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.version.tam_override, r.body.version.computed_tam, r.body.version.tam], [500_000_000, 741_600_000, 500_000_000]);
    const got = await call(FOUNDER, 'GET', `/api/market-sizing/projects/1/versions/${r.body.version.uid}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.version.recomputes, true);
    const v = one(db, 'SELECT * FROM market_sizing_versions WHERE uid = ?', r.body.version.uid);
    const rows = db.prepare('SELECT input_key, value FROM market_sizing_version_inputs WHERE version_id = ?').all(v.id) as any[];
    assert.equal(recomputesToStored(v, rows), true);
    // A row that disagrees with its version does not recompute.
    assert.equal(recomputesToStored(v, rows.map((x) => (x.input_key === 'samPct' ? { ...x, value: 15 } : x))), false);
  } finally { db.close(); }
});

test('capacity and horizon change SOM, a sales cycle as long as the horizon gives SOM 0, and SOM never exceeds SAM', () => {
  const base = sizeMarket(BASE);
  assert.equal(base.som, 1_360_800);
  assert.equal(sizeMarket({ ...BASE, capacity: '2' }).som, 680_400);
  assert.equal(sizeMarket({ ...BASE, horizonMonths: '12' }).som, 583_200);
  const roomy = sizeMarket({ ...BASE, capacity: '40' });
  assert.deepEqual([roomy.som, roomy.som_limit], [8_305_920, 'win_rate']);
  const stuck = sizeMarket({ ...BASE, salesCycleMonths: '24' });
  assert.deepEqual([stuck.som, stuck.selling_months, stuck.som_limit], [0, 0, 'capacity']);
  assert.match(stuck.notes.join(' '), /as long as the time horizon .* SOM is 0/);
  // Runway is context, never an input (owner question 4, A).
  assert.equal(sizeMarket({ ...BASE, runway: '2' }).som, base.som);
  for (const winRate of ['0', '50', '100']) for (const capacity of ['0', '1', '1000']) for (const samPct of ['0', '37', '100']) {
    const r = sizeMarket({ ...BASE, winRate, capacity, samPct, horizonMonths: '120' });
    assert.ok(r.som <= r.sam && r.sam <= r.tam, JSON.stringify({ winRate, capacity, samPct }));
  }
});

test('every versioned save leaves three history rows naming that version; a typed PUT afterwards leaves a row with none', async () => {
  const { db, env, call, save } = fixture(); try {
    await save(BASE);
    await save({ ...BASE, capacity: '40' });
    const h1 = await marketFigureHistory(env, 1);
    assert.deepEqual(h1.map((r) => [r.figure, r.sizing_version]), [['som', 2], ['sam', 2], ['tam', 2], ['som', 1], ['sam', 1], ['tam', 1]]);
    assert.ok(h1.every((r) => r.method === 'bottom_up'), 'a computed save with no method named reads as bottom-up');
    const put = await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 900_000_000 });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const h2 = await marketFigureHistory(env, 1);
    assert.deepEqual([h2[0].figure, h2[0].value, h2[0].sizing_version, h2[0].method], ['tam', 900_000_000, null, 'typed']);
    const list = await call(FOUNDER, 'GET', '/api/market-sizing/projects/1/versions');
    assert.deepEqual(list.body.versions.map((v: any) => [v.version_number, v.current]), [[2, false], [1, false]],
      'a typed TAM means no version is the venture\'s current sizing');
  } finally { db.close(); }
});

test('a named source is copied onto the three figure rows as PUT does, and a stranger\'s source is refused before any write', async () => {
  const { db, save, snapshot } = fixture(); try {
    const r = await save(BASE, { market_figure_source: { method: 'top_down', market_source_id: 7 } });
    assert.equal(r.status, 201);
    const rows = db.prepare('SELECT figure, method, source_title, source_url, market_source_id FROM market_figures ORDER BY id').all() as any[];
    assert.deepEqual(rows.map((x) => ({ ...x })), ['tam', 'sam', 'som'].map((figure) => ({
      figure, method: 'top_down', source_title: 'Synthetic industry report 2026', source_url: 'https://example.com/report', market_source_id: 7,
    })));
    const before = snapshot();
    const bad = await save(BASE, { market_figure_source: { method: 'top_down', market_source_id: 999 } });
    assert.equal(bad.body.error, 'invalid_market_source');
    assert.equal(snapshot(), before);
  } finally { db.close(); }
});

test('a version, an input or the version reference cannot be rewritten; a project\'s hard delete still removes them', async () => {
  const { db, env, save } = fixture(); try {
    assert.equal((await save(BASE)).status, 201);
    assert.throws(() => db.exec('UPDATE market_sizing_versions SET som = 1'), /append-only/);
    assert.throws(() => db.exec('UPDATE market_sizing_versions SET version_number = 9'), /append-only/);
    assert.throws(() => db.exec("UPDATE market_sizing_version_inputs SET value = 1 WHERE input_key = 'population'"), /append-only/);
    assert.throws(() => db.exec("UPDATE market_sizing_version_inputs SET typed_text = 'x'"), /append-only/);
    db.exec(`INSERT INTO market_sizing_versions (uid, project_id, version_number, formula_version, tam, sam, som, som_limit, horizon_months)
      VALUES ('other-v', 2, 1, 2, 10, 5, 1, 'win_rate', 12)`);
    assert.throws(() => db.exec("UPDATE market_figures SET sizing_version_id = (SELECT id FROM market_sizing_versions WHERE uid = 'other-v')"), /never rewritten/);
    // Only references may go NULL.
    db.exec('UPDATE market_sizing_versions SET author_id = NULL');
    db.exec('UPDATE market_figures SET sizing_version_id = NULL WHERE figure = \'tam\'');
    db.exec('PRAGMA foreign_keys = ON');
    await hardDeleteProject(env, 1);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM market_sizing_versions WHERE project_id = 1').n, 0);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM market_sizing_version_inputs').n, 0);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM market_figures WHERE project_id = 1').n, 0);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM market_sizing_versions WHERE project_id = 2').n, 1, 'another venture\'s version stays');
  } finally { db.close(); }
});

test('a caller who may not edit the venture is refused on all four routes with nothing written; another project\'s uid is not found', async () => {
  const { db, call, save, snapshot } = fixture(); try {
    const mine = await save(BASE);
    const theirs = await save(BASE, {}, OTHER, 2);
    assert.equal(theirs.status, 201);
    const before = snapshot();
    for (const [method, path, body] of [
      ['POST', '/api/market-sizing/projects/1/preview', { assumptions: BASE }],
      ['POST', '/api/market-sizing/projects/1/versions', { assumptions: BASE }],
      ['GET', '/api/market-sizing/projects/1/versions', undefined],
      ['GET', `/api/market-sizing/projects/1/versions/${mine.body.version.uid}`, undefined],
    ] as const) {
      const r = await call(OTHER, method, path, body);
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal(r.body.error, 'not_project_editor');
      assert.ok(!JSON.stringify(r.body).includes('741600000'), 'a refusal leaks no figure');
    }
    assert.equal(snapshot(), before);
    const cross = await call(FOUNDER, 'GET', `/api/market-sizing/projects/1/versions/${theirs.body.version.uid}`);
    assert.equal(cross.status, 404);
    assert.equal(cross.body.error, 'sizing_version_not_found');
    // The preview computes and stores nothing.
    const preview = await call(FOUNDER, 'POST', '/api/market-sizing/projects/1/preview', { assumptions: { ...BASE, capacity: '40' } });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.result.som, 8_305_920);
    assert.equal(snapshot(), before, 'a preview wrote');
  } finally { db.close(); }
});

test('an admin\'s save on another person\'s venture is in the admin log; the founder\'s own is not', async () => {
  const { db, save } = fixture(); try {
    assert.equal((await save(BASE)).status, 201);
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'market_figures_set'").n, 0);
    const r = await save({ ...BASE, capacity: '40' }, {}, ADMIN);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const row = one(db, "SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'market_figures_set'");
    assert.equal(row.admin_user_id, ADMIN);
    assert.equal(JSON.parse(row.filters_json).sizing_version, r.body.version.uid);
  } finally { db.close(); }
});
