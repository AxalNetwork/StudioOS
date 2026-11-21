/**
 * D6278 (#6278): a benchmark's "Ours" from a fund's recorded TVPI or DPI.
 *
 *   GET  /api/research/benchmarks/fund-figures         the funds the caller can
 *        read, with each one's recorded TVPI and DPI, or why it is not recorded
 *   POST /api/research/benchmarks/:uid/ours-from-fund  copy one of them onto the
 *        caller's own benchmark: { fund_id, metric: 'tvpi' | 'dpi', replace? }
 *
 * The fund list is the one fund performance reads (`services/readableFunds.ts`),
 * so a figure is never offered for a fund its reader could not open, and the
 * figure is the one `readFundPerformance` computes, never a second formula.
 * A figure that is not recorded is refused with the reason, never a zero. A
 * typed "Ours" is never overwritten without `replace: true` (owner answer,
 * 2026-11-15). Mounted ahead of `research.ts`, whose `/benchmarks/:uid` read
 * would otherwise take `fund-figures` for a uid.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { readableFunds } from '../services/readableFunds';
import { readFundPerformance } from '../services/fundPerformance';
import { BENCHMARK_NOT_FOUND, OURS_FUND_METRICS, type OursFundMetric, benchmarkDetail, ownedBenchmark } from '../services/researchBenchmarks';
import research from './research';

const r = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);
const METRIC_LABEL: Record<OursFundMetric, string> = { tvpi: 'TVPI', dpi: 'DPI' };
const UNREADABLE = 'Fund figures are Unreadable. Please retry.';

/** A recorded multiple as the benchmark row shows it, e.g. "1.40×". */
export const formatMultiple = (value: number) => `${value.toFixed(2)}×`;

type FundFigure = { value: number | null; display: string | null; reason: string | null };
const figure = (perf: any, metric: OursFundMetric): FundFigure => {
  const value = typeof perf[metric] === 'number' && Number.isFinite(perf[metric]) ? perf[metric] : null;
  return value === null
    ? { value: null, display: null, reason: perf.unavailable?.[metric] || 'This figure is not recorded for this fund.' }
    : { value, display: formatMultiple(value), reason: null };
};

r.get('/fund-figures', async (c) => {
  const user = await requireAuth(c);
  const asOf = today();
  try {
    const funds = await readableFunds(c, user);
    const items = [];
    for (const fund of funds) {
      const perf = await readFundPerformance(c.env, fund, asOf);
      items.push({ fund_id: Number(fund.id), name: fund.name, as_of: perf.as_of,
        tvpi: figure(perf, 'tvpi'), dpi: figure(perf, 'dpi') });
    }
    return c.json({ items, as_of: asOf, metrics: OURS_FUND_METRICS });
  } catch (error) {
    return refuse(c, 503, { code: 'fund_figures_unreadable', message: UNREADABLE, raw: error });
  }
});

r.post('/:uid/ours-from-fund', async (c) => {
  const user = await requireAuth(c);
  const row = await ownedBenchmark(c.env, user.id, c.req.param('uid'));
  if (!row) return refuse(c, 404, { code: 'benchmark_not_found', message: BENCHMARK_NOT_FOUND });
  const b = await c.req.json<any>().catch(() => ({}));
  const metric = String(b?.metric ?? '').trim().toLowerCase() as OursFundMetric;
  if (!OURS_FUND_METRICS.includes(metric)) {
    return refuse(c, 400, { code: 'fund_metric_invalid', message: 'Choose the fund’s TVPI or DPI.' });
  }
  const fundId = Number(b?.fund_id);
  if (!Number.isSafeInteger(fundId) || fundId <= 0) {
    return refuse(c, 400, { code: 'fund_required', message: 'Choose the fund whose figure to use.' });
  }
  let fund, perf;
  try {
    fund = (await readableFunds(c, user)).find((f) => Number(f.id) === fundId);
    // A fund the caller cannot read answers exactly as one that does not exist.
    if (!fund) return refuse(c, 404, { code: 'fund_not_found', message: 'Fund not found.' });
    perf = await readFundPerformance(c.env, fund, today());
  } catch (error) {
    return refuse(c, 503, { code: 'fund_figures_unreadable', message: UNREADABLE, raw: error });
  }
  const fig = figure(perf, metric);
  if (fig.value === null) {
    return refuse(c, 409, { code: 'figure_not_recorded', message: `Not recorded: ${fig.reason}` });
  }
  // A figure typed on the row is the writer's; it is replaced only when they confirm.
  const typed = Boolean(row.our_value) && !row.fund_id;
  if (typed && b?.replace !== true) {
    return refuse(c, 409, {
      code: 'typed_value',
      message: `This row has a figure typed by hand (${row.our_value}). Confirm to replace it with ${fund.name}’s recorded ${METRIC_LABEL[metric]} of ${fig.display}.`,
      extra: { typed_value: row.our_value, proposed: { fund_id: fundId, metric, display: fig.display, as_of: perf.as_of } },
    });
  }
  await c.env.DB.prepare(
    `UPDATE research_benchmarks
        SET our_value = ?, fund_id = ?, our_value_metric = ?, our_value_as_of = ?, updated_at = ?
      WHERE id = ? AND owner_user_id = ?`
  ).bind(fig.display, fundId, metric, perf.as_of, new Date().toISOString(), row.id, user.id).run();
  const fresh = await ownedBenchmark(c.env, user.id, row.uid);
  return c.json(await benchmarkDetail(c, user, fresh!));
});

export const mount: RouteMount = { path: '/api/research/benchmarks', router: r, before: [research] };

export default r;
