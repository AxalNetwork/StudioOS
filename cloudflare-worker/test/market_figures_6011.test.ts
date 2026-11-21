/**
 * D6011 (#6011) — market figures carry a source, a date and a history, on real
 * SQLite: the baseline and every migration above the cutoff (so migration
 * 202611150130 too), `routes/projects.ts` (the sizing save) and
 * `routes/cycle_validate.ts` (the market card, the module's History part and
 * the sizing page's read) mounted on a bare Hono. Everyone here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/market_figures_6011.test.ts
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
  for (const n of above) db.exec(readFileSync(new URL(n, MIGRATIONS), 'utf8'));
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[])
    .map((r) => r.sql).join(';\n');
  db.close();
  return ddl;
})();

const FOUNDER = 1, OTHER = 3, ADMIN = 900;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(schema);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
      (1,'founder','Fay Founder','founder@example.com',11,1,'studio'),(3,'founder','Bo Other','other@example.com',33,1,'studio'),
      (900,'admin','Ada Admin','admin@example.com',NULL,1,'studio');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11),(2,'synthetic-two','Other venture',33);
    INSERT INTO market_sources(id,project_id,title,url,kind,added_by) VALUES
      (7,1,'Synthetic industry report 2026','https://example.com/report','Report',1),
      (8,2,'Another venture''s source',NULL,'Report',3);`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/projects', projects).route('/api/cycles/validate', cycleValidate);
  app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, e?.message === 'Unauthorized' ? 401 : 500)));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, ROLE[who])}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const rows = (pid = 1) => db.prepare('SELECT figure, value, method, source_title, source_url, market_source_id, set_by FROM market_figures WHERE project_id = ? ORDER BY id').all(pid) as any[];
  const series = async (who = FOUNDER) => {
    const r = await call(who, 'GET', '/api/cycles/validate/overview?project=1');
    assert.equal(r.status, 200);
    return r.body.cards.find((c: any) => c.slug === 'market-intelligence').series;
  };
  return { db, call, rows, series };
}

/** The day a row was stamped with, read back from the store (never this test's clock). */
const dayOf = (db: DatabaseSync, figure: string) => String((db.prepare('SELECT set_at FROM market_figures WHERE figure = ? ORDER BY id DESC LIMIT 1').get(figure) as any).set_at).slice(0, 10);

test('a figure saved before market_figures existed falls back to projects.* and says no source is recorded', async () => {
  const { db, rows, series } = fixture(); try {
    db.exec('UPDATE projects SET tam = 4200000000, sam = 600000000 WHERE id = 1');
    assert.deepEqual(rows(), []);
    const m = await series();
    assert.deepEqual(m.tam, { value: 4200000000, source: null, reason: 'No source recorded for this figure', as_of: null, source_url: null, method: null });
    assert.equal(m.sam.reason, 'No source recorded for this figure');
    assert.equal(m.som.value, null, 'a figure never entered is null, never 0');
    assert.equal(m.som.reason, 'No figure entered');
  } finally { db.close(); }
});

test('the sizing save writes one row per figure with the source copied from the venture\'s own row, and keeps projects in step', async () => {
  const { db, call, rows, series } = fixture(); try {
    const r = await call(FOUNDER, 'PUT', '/api/projects/1', {
      tam: 5_000_000_000, sam: 700_000_000, som: 77_000_000,
      market_figure_source: { method: 'bottom_up', market_source_id: 7 },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.market_figures, { recorded: ['tam', 'sam', 'som'] });
    const p = db.prepare('SELECT tam, sam, som FROM projects WHERE id = 1').get() as any;
    assert.deepEqual({ ...p }, { tam: 5_000_000_000, sam: 700_000_000, som: 77_000_000 });
    assert.deepEqual(rows().map((x) => ({ ...x })), ['tam', 'sam', 'som'].map((figure, i) => ({
      figure, value: [5_000_000_000, 700_000_000, 77_000_000][i], method: 'bottom_up',
      source_title: 'Synthetic industry report 2026', source_url: 'https://example.com/report', market_source_id: 7, set_by: FOUNDER,
    })));
    const m = await series();
    assert.deepEqual(m.tam, { value: 5_000_000_000, source: 'Synthetic industry report 2026', reason: null, as_of: dayOf(db, 'tam'), source_url: 'https://example.com/report', method: 'bottom_up' });

    // The page echoes the same figures with no provenance: nothing changed, nothing is written.
    const echo = await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 5_000_000_000, sam: 700_000_000, som: 77_000_000, name: 'Synthetic venture' });
    assert.equal(echo.status, 200);
    assert.deepEqual(echo.body.market_figures, { recorded: [] });
    assert.equal(rows().length, 3);
    assert.equal((await series()).tam.source, 'Synthetic industry report 2026', 'an echo keeps the source');

    // A changed TAM, typed with no source: one new row, the others stay.
    const typed = await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 6_000_000_000 });
    assert.deepEqual(typed.body.market_figures, { recorded: ['tam'] });
    const m2 = await series();
    assert.deepEqual(m2.tam, { value: 6_000_000_000, source: null, reason: 'No source named when this figure was saved', as_of: dayOf(db, 'tam'), source_url: null, method: 'typed' });
    assert.equal(m2.sam.source, 'Synthetic industry report 2026');
  } finally { db.close(); }
});

test('History lists every change, newest first, with who and when; another writer\'s change reads as unsourced', async () => {
  const { db, call, series } = fixture(); try {
    await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 5_000_000_000, market_figure_source: { method: 'top_down', market_source_id: 7 } });
    await call(ADMIN, 'PUT', '/api/projects/1', { tam: 5_500_000_000 });
    const mod = await call(FOUNDER, 'GET', '/api/cycles/validate/modules/market-intelligence?project=1');
    assert.equal(mod.status, 200);
    const h = mod.body.parts.market_history.rows;
    assert.deepEqual(h.map((r: any) => [r.figure, r.value, r.method, r.source_title, r.set_by_name]), [
      ['tam', 5_500_000_000, 'typed', null, 'Ada Admin'],
      ['tam', 5_000_000_000, 'top_down', 'Synthetic industry report 2026', 'Fay Founder'],
    ]);
    assert.ok(h.every((r: any) => /^\d{4}-\d{2}-\d{2}/.test(String(r.set_at))), 'each change has its date');
    assert.ok(!JSON.stringify(h).includes('@example.com'), 'a name, never an address');
    // An admin's write on the venture's behalf is in the admin log.
    const logged = db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'market_figures_set'").get() as any;
    assert.equal(logged.n, 1);

    // A writer that records no row yet (intake, the Eadwyn SOM answer) moves projects.tam.
    db.exec('UPDATE projects SET tam = 9000000000 WHERE id = 1');
    const m = await series();
    assert.equal(m.tam.value, 9_000_000_000);
    assert.equal(m.tam.source, null);
    assert.equal(m.tam.reason, 'No source recorded for this figure', 'the old source is never pinned on a new number');
  } finally { db.close(); }
});

test('a source from another venture, or a method off the list, is refused before anything is written', async () => {
  const { db, call, rows } = fixture(); try {
    const r = await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 5_000_000_000, market_figure_source: { method: 'top_down', market_source_id: 8 } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_market_source');
    const bad = await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 5_000_000_000, market_figure_source: { method: 'guessed' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_market_method');
    assert.equal((db.prepare('SELECT tam FROM projects WHERE id = 1').get() as any).tam, null, 'projects untouched');
    assert.deepEqual(rows(), []);
    const stranger = await call(OTHER, 'PUT', '/api/projects/1', { tam: 1 });
    assert.equal(stranger.status, 403);
    assert.deepEqual(rows(), []);
  } finally { db.close(); }
});

test('market_figures is append-only: a row is never rewritten, and a removed source leaves its title', async () => {
  const { db, call, rows } = fixture(); try {
    await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 5_000_000_000, market_figure_source: { method: 'top_down', market_source_id: 7 } });
    assert.throws(() => db.exec('UPDATE market_figures SET value = 1'), /append-only/);
    assert.throws(() => db.exec("UPDATE market_figures SET source_title = 'Other'"), /append-only/);
    db.exec('UPDATE market_figures SET market_source_id = NULL'); // what ON DELETE SET NULL does
    assert.equal(rows()[0].source_title, 'Synthetic industry report 2026');
  } finally { db.close(); }
});

test('the sizing page\'s read carries each current figure\'s method and named source', async () => {
  const { db, call } = fixture(); try {
    await call(FOUNDER, 'PUT', '/api/projects/1', { tam: 5_000_000_000, sam: 500_000_000, market_figure_source: { method: 'bottom_up', market_source_id: 7 } });
    const r = await call(FOUNDER, 'GET', '/api/cycles/validate/market-readiness?project=1');
    assert.equal(r.status, 200);
    assert.equal(r.body.figures.tam.market_source_id, 7);
    assert.equal(r.body.figures.tam.method, 'bottom_up');
    assert.equal(r.body.figures.som, null);
  } finally { db.close(); }
});
