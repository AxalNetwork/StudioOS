/**
 * Signals — founder decision-engine API. Mounted at /api/signals.
 *
 * Surfaces the ranked, filtered founder-actionable signals derived from PUBLIC
 * company data. This is NOT a markets/trading API — there are no price or quote
 * endpoints here by design. See services/signals/* for the engine, ranking and
 * source-adapter layer, and sql/migrations/134_signals.sql for the schema.
 *
 * Endpoints:
 *   GET  /                 → ranked + filtered signal cards (list view)
 *   GET  /filters          → available filter facets + controlled vocabularies
 *   GET  /kpis             → KPI-strip payload
 *   GET  /sources          → source registry (confidence transparency)
 *   GET  /meta             → signal-type catalog + rank-weight explanation
 *   GET  /:id              → single signal detail (evidence, companies, sources)
 *   POST /refresh          → trigger background ingestion refresh (admin only)
 *
 * Access: any authenticated Axal member (founder / mentor / advisor / partner /
 * investor / admin) can read signals — the same engine powers Founder and
 * Advisor/Mentor modes. Refresh is admin-gated.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import type { SignalFilters } from '../services/signals/types';
import {
  SIGNAL_TYPES,
  SIGNAL_TYPE_LABELS,
  MARKET_CAP_BANDS,
  EMPLOYEE_BANDS,
  MATURITY_STAGES,
  CUSTOMER_TYPES,
  REGIONS,
  EVIDENCE_KINDS,
} from '../services/signals/types';
import { SOURCE_REGISTRY } from '../services/signals/sources';
import { RANK_WEIGHTS } from '../services/signals/ranking';
import {
  getRankedSignals,
  getSignalDetail,
  getKpis,
  getFacets,
  runRefresh,
} from '../services/signals/engine';

const r = new Hono<{ Bindings: Env }>();

function readMode(c: any): 'founder' | 'advisor' {
  return c.req.query('mode') === 'advisor' ? 'advisor' : 'founder';
}

function isAdmin(u: User): boolean {
  return (u.role || '').toLowerCase() === 'admin';
}

// GET /api/signals — ranked, filtered list.
r.get('/', async (c) => {
  try {
    await requireAuth(c);
    const q = c.req.query.bind(c.req);
    const filters: SignalFilters = {
      region: q('region') || undefined,
      country: q('country') || undefined,
      sector: q('sector') || undefined,
      industry: q('industry') || undefined,
      niche: q('niche') || undefined,
      market_cap_band: q('market_cap_band') || undefined,
      employee_band: q('employee_band') || undefined,
      customer_type: q('customer_type') || undefined,
      maturity_stage: q('maturity_stage') || undefined,
      type: q('type') || undefined,
      q: q('q') || undefined,
      mode: readMode(c),
      limit: q('limit') ? Number(q('limit')) : undefined,
    };
    const result = await getRankedSignals(c.env, filters);
    return c.json(result);
  } catch (e) {
    return mapError(c, e);
  }
});

// GET /api/signals/filters — facets + controlled vocabularies for the filter bar.
r.get('/filters', async (c) => {
  try {
    await requireAuth(c);
    const facets = await getFacets(c.env);
    return c.json({
      facets,
      vocab: {
        signal_types: SIGNAL_TYPES.map((t) => ({ value: t, label: SIGNAL_TYPE_LABELS[t] })),
        market_cap_bands: MARKET_CAP_BANDS,
        employee_bands: EMPLOYEE_BANDS,
        maturity_stages: MATURITY_STAGES,
        customer_types: CUSTOMER_TYPES,
        regions: REGIONS,
        evidence_kinds: EVIDENCE_KINDS,
      },
    });
  } catch (e) {
    return mapError(c, e);
  }
});

// GET /api/signals/kpis — dashboard KPI strip.
r.get('/kpis', async (c) => {
  try {
    await requireAuth(c);
    const kpis = await getKpis(c.env, readMode(c));
    return c.json(kpis);
  } catch (e) {
    return mapError(c, e);
  }
});

// GET /api/signals/sources — source registry (why a signal is credible).
r.get('/sources', async (c) => {
  try {
    await requireAuth(c);
    return c.json({ sources: SOURCE_REGISTRY });
  } catch (e) {
    return mapError(c, e);
  }
});

// GET /api/signals/meta — signal-type catalog + rank-weight explanation, so the
// UI and docs can render "how ranking works" without hardcoding it.
r.get('/meta', async (c) => {
  try {
    await requireAuth(c);
    return c.json({
      signal_types: SIGNAL_TYPES.map((t) => ({ value: t, label: SIGNAL_TYPE_LABELS[t] })),
      rank_weights: RANK_WEIGHTS,
      evidence_kinds: EVIDENCE_KINDS,
      principle:
        'Ranking favours practical, buildable startup opportunities — not the largest companies or the noisiest headlines. Confidence rewards multiple independent, high-quality, recent sources agreeing.',
    });
  } catch (e) {
    return mapError(c, e);
  }
});

// POST /api/signals/refresh — background ingestion (admin only).
r.post('/refresh', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) throw new Error('Forbidden');
    const result = await runRefresh(c.env);
    return c.json(result);
  } catch (e) {
    return mapError(c, e);
  }
});

// GET /api/signals/:id — single signal detail. Registered LAST so the static
// sub-paths above (filters/kpis/sources/meta) win over the param route.
r.get('/:id', async (c) => {
  try {
    await requireAuth(c);
    const detail = await getSignalDetail(c.env, c.req.param('id'), readMode(c));
    if (!detail) return c.json({ detail: 'Signal not found' }, 404);
    return c.json(detail);
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
