/** #6178: recorded ARR/net retention, source proof, immutable sharing and investor isolation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import updates, { updateFigures } from '../src/routes/portfolio_updates.ts';
import insights from '../src/routes/deal_insights.ts';
import progress from '../src/routes/progress.ts';
import { buildMetrics, cleanMetrics, type Snapshot } from '../src/services/updateShare.ts';
import { assembleReport, figureFor } from '../src/services/reportFigures.ts';

const CLOCK = Date.UTC(2026, 10, 14, 12);
const SECRET = 'synthetic shared metrics signing fixture';
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({ snapshot_date: '2026-10-20', source: 'manual', mrr: 100,
  paying_accounts: 10, net_burn: 20, cash_balance: 200, ...extra });
const byKey = (metrics: any[]) => Object.fromEntries(metrics.map((m) => [m.key, m]));

function fixture(ctx: any) {
  ctx.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS }); loadSchema(db); ctx.after(() => db.close());
  db.exec(`INSERT INTO users (id, role, founder_id, name, email) VALUES
    (1, 'founder', 20, 'Synthetic Founder', 'founder@example.test'),
    (2, 'investor', NULL, 'Synthetic Investor', 'investor@example.test'),
    (3, 'investor', NULL, 'Other Investor', 'other@example.test');
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'project-6178', 'Synthetic Venture', 20), (8, 'other-6178', 'Other Venture', 30);
    INSERT INTO deals (id, project_id, status) VALUES (100, 7, 'active');
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (100, 2), (100, 3);
    INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (1, 2, 'active'), (1, 3, 'active');
    INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES ('prospect-6178', 7, 'Synthetic Investor', 'investor@example.test', 'contacted');
    INSERT INTO project_metrics (project_id, snapshot_date, mrr, arr, nrr_pct, source) VALUES
      (7, '2026-09-30', 20, 9999999, 999, 'stripe'),
      (7, '2026-10-20', 100, 123400, 112.5, 'manual'),
      (8, '2026-10-20', 9999, 8888888, 888, 'stripe');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>(); app.route('/api/portfolio-updates', updates); app.route('/api/deals', insights);
  app.route('/api/progress', progress);
  const call = async (method: string, path: string, body?: unknown, who = 1) => {
    const token = await new SignJWT({ user_id: who, role: who === 1 ? 'founder' : 'investor' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const context = () => call('GET', '/api/portfolio-updates/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31');
  const shared = (metrics: unknown[], { audience = '{"investors":true}', status = 'submitted', project = 7, period = '2026-10' } = {}) => {
    const uid = crypto.randomUUID();
    db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, status, audience_json, metrics_json, submitted_at)
      VALUES (?, ?, 1, ?, 'Synthetic share', ?, ?, ?, '2026-11-13T12:00:00Z')`).run(uid, project, period, status, audience, JSON.stringify(metrics));
    return uid;
  };
  return { db, env, call, context, shared };
}

test('ARR and canonical net_retention use recorded snapshot columns; zero stays zero and MRR is not annualised', () => {
  const values = byKey(buildMetrics([snap({ arr: 0, nrr_pct: 112.5 })], [], '2026-10-01'));
  assert.deepEqual([values.arr.value, values.arr.unit, values.arr.source, values.arr.as_of], [0, 'usd', 'manual', '2026-10-20']);
  assert.deepEqual([values.net_retention.value, values.net_retention.unit], [112.5, 'pct']);
  assert.equal(values.nrr, undefined);
  const absent = byKey(buildMetrics([snap()], [], '2026-10-01'));
  assert.equal(absent.arr.value, null); assert.equal(absent.net_retention.value, null);
  assert.match(absent.arr.reason, /no snapshot/);
  assert.equal(figureFor('nrr_pct')?.key, 'net_retention');
});

test('cleaning proves source claims and refuses invented metric keys and incompatible ARR/retention units', () => {
  const verified = buildMetrics([snap({ arr: 1200, nrr_pct: 0, source: 'stripe' })], [], '2026-10-01');
  const arr = verified.find((m) => m.key === 'arr')!;
  const retained = cleanMetrics([arr, { ...arr, value: 9999 }, { ...arr, as_of: '2026-10-19' }], verified);
  assert.deepEqual(retained.map((m) => m.source), ['stripe', 'typed', 'typed']);
  assert.deepEqual(cleanMetrics([{ ...arr, unit: 'pct' }, { key: 'net_retention', value: 112, unit: 'usd' }, { ...arr, key: 'nrr' }], verified), []);
  const missing = cleanMetrics([{ ...arr, value: null }, { ...arr, value: '1200' }, { ...arr, value: Infinity }], verified);
  assert.ok(missing.every((m) => m.value === null && m.source === null));
  assert.equal(cleanMetrics(verified, verified).find((m) => m.key === 'net_retention')?.value, 0);
  const read = updateFigures({ metrics_json: JSON.stringify([{ ...arr, unit: 'pct' }, { ...arr, key: 'nrr' }, { ...arr, source: null }]) });
  assert.deepEqual(read.figures, []);
});

test('the share context reuses existing founder snapshots and agrees with Report Figures, including source/as-of', async (ctx) => {
  const f = fixture(ctx);
  const r = await f.context(); assert.equal(r.status, 200, JSON.stringify(r.body));
  const metrics = byKey(r.body.metrics);
  assert.deepEqual([metrics.arr.value, metrics.net_retention.value, metrics.arr.source, metrics.arr.as_of], [123400, 112.5, 'manual', '2026-10-20']);
  const report = await assembleReport(f.env, 7, { start: '2026-10-01', end: '2026-10-31' }, '2026-11-14');
  const figures = byKey(report.figures);
  for (const key of ['arr', 'net_retention']) {
    assert.equal(metrics[key].value, figures[key].value);
    assert.equal(metrics[key].as_of, figures[key].as_of);
    assert.equal(figures[key].source.word, 'Typed');
  }
  assert.equal((await f.call('GET', '/api/portfolio-updates/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31', undefined, 2)).status, 403);
});

test('saved and sent ARR/retention retain snapshot provenance after live records change', async (ctx) => {
  const f = fixture(ctx);
  const input = { snapshot_date: '2026-10-21', arr: 123400, nrr_pct: 112.5 };
  assert.equal((await f.call('POST', '/api/progress/metrics/7', { ...input, source: 'stripe' })).status, 400, 'a typed entry cannot claim a connector');
  const recorded = await f.call('POST', '/api/progress/metrics/7', input);
  assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  assert.deepEqual([recorded.body.arr, recorded.body.nrr_pct, recorded.body.source], [123400, 112.5, 'manual']);
  const source = await f.context();
  const created = await f.call('POST', '/api/portfolio-updates', { project_id: 7, title: 'October', status: 'draft' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const uid = created.body.uid;
  const saved = await f.call('PUT', `/api/portfolio-updates/${uid}/share`, { period_start: '2026-10-01', period_end: '2026-10-31',
    metrics: source.body.metrics, highlights: [], lowlights: [], asks: [], audience: { investors: true, team: false, network: false } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual([byKey(saved.body.metrics).arr.source, byKey(saved.body.metrics).net_retention.value], ['manual', 112.5]);
  assert.equal((await f.call('POST', `/api/portfolio-updates/${uid}/send`)).status, 200);
  const read = await f.call('GET', '/api/deals/100/traction', undefined, 2);
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.arr.value, read.body.arr.source, read.body.arr.as_of], [123400, 'manual', '2026-10-21']);
  assert.equal(read.body.net_retention.value, 112.5);
  f.db.exec("UPDATE project_metrics SET arr = 7654321, nrr_pct = 777 WHERE project_id = 7");
  assert.equal((await f.call('GET', '/api/deals/100/traction', undefined, 2)).body.arr.value, 123400, 'sent history is not rebuilt from live snapshots');
});

test('NDA alone cannot disclose draft, unshared, another investor’s or another venture’s ARR/retention', async (ctx) => {
  const f = fixture(ctx);
  const metrics = buildMetrics([snap({ arr: 8765432, nrr_pct: 876 })], [], '2026-10-01');
  f.shared(metrics, { status: 'draft' }); f.shared(metrics, { audience: '{"investors":false}' });
  f.shared(metrics, { project: 8 });
  const uid = f.shared(metrics, { audience: '{"investors":false}' });
  f.db.prepare(`INSERT INTO update_recipients (update_id, user_id, audience)
    SELECT id, 3, 'investor' FROM portfolio_updates WHERE uid = ?`).run(uid);
  const hidden = await f.call('GET', '/api/deals/100/traction', undefined, 2);
  assert.equal(hidden.body.arr.value, null); assert.equal(hidden.body.net_retention.value, null);
  assert.match(hidden.body.arr.reason, /MRR is not annualised/);
  assert.doesNotMatch(JSON.stringify(hidden.body), /8765432/);
  const own = await f.call('GET', '/api/deals/100/traction', undefined, 3);
  assert.equal(own.body.arr.value, 8765432);
  f.db.exec('DELETE FROM pairwise_ndas');
  assert.equal((await f.call('GET', '/api/deals/100/traction', undefined, 3)).body.masked, true);
});

test('an empty newest shared revision hides old ARR, and a read failure stays unreadable', async (ctx) => {
  const f = fixture(ctx); f.shared(buildMetrics([snap({ arr: 1234, nrr_pct: 115 })], [], '2026-10-01')); f.shared([]);
  const empty = await f.call('GET', '/api/deals/100/traction', undefined, 2);
  assert.equal(empty.body.arr.value, null); assert.equal(empty.body.net_retention.value, null);
  assert.equal(empty.body.history.data.find((m: any) => m.month === '2026-10').state, 'not_reported');
  f.db.exec('DROP TABLE portfolio_updates');
  const failed = await f.call('GET', '/api/deals/100/traction', undefined, 2);
  assert.equal(failed.body.history.state, 'unreadable');
  assert.equal(failed.body.arr.state, 'unreadable');
  assert.equal(failed.body.net_retention.state, 'unreadable');
});
