/**
 * D6693 (#6693, plan key C3 of #6680): the founder flow's read of the published
 * formation catalogue, mounted at /api/formation/catalogue.
 *
 *   GET /    signed in. The current published version and each of its forms
 *            that is offered at all, with:
 *              - `availability`: `orderable` when its offer mode is orderable
 *                and every gate passes (`services/formationGates.ts`);
 *                `guided` when its offer mode is guided; otherwise
 *                `information_only`. A form switched `off` is not listed.
 *              - its facts, each with its status, source and the day it was
 *                checked, and whether it is fresh;
 *              - its fee lines (amount null when not recorded, never 0);
 *              - `quote`: the default partner's current founder price, when
 *                the form is orderable and one is recorded.
 *            With no published version the answer is `{ version: null, forms: [] }`.
 *
 * NEVER RETURNED: a partner's identity, its cost (`cost_minor`), HQ's notes on
 * a version, or which gate failed. The gates are HQ's; the founder reads the
 * collapsed availability. Nothing is cached, so a pause shows on the next read.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { currentVersion } from '../services/formationCatalogue';
import { factMaxAgeDays, freshSince, gatesForForm, versionForms, type GateOptions } from '../services/formationGates';

const r = new Hono<{ Bindings: Env }>();

export type Availability = 'orderable' | 'guided' | 'information_only';
export function availabilityOf(offerMode: string, orderable: boolean): Availability | null {
  if (offerMode === 'off') return null;
  if (offerMode === 'orderable') return orderable ? 'orderable' : 'information_only';
  return offerMode === 'guided' ? 'guided' : 'information_only';
}

/** The catalogue as the signed-in founder reads it. `opts` is for tests (a fixed day, a price lookup). */
export async function readCatalogue(env: Env, opts: GateOptions = {}) {
  const version = await currentVersion(env);
  if (!version) return { version: null, forms: [] as any[] };
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const since = freshSince(today, opts.maxAgeDays ?? factMaxAgeDays(env));
  const out: any[] = [];
  for (const form of await versionForms(env, version)) {
    if (form.offer_mode === 'off') continue;
    const g = await gatesForForm(env, version, form, { ...opts, today });
    const availability = availabilityOf(form.offer_mode, g.orderable);
    if (!availability) continue;
    const facts = ((await env.DB.prepare(
      `SELECT x.fact_key, x.value, x.status, x.blocking, x.checked_on, s.kind AS source_kind, s.title AS source_title, s.url AS source_url
         FROM formation_form_facts x LEFT JOIN formation_sources s ON s.id = x.source_id
        WHERE x.version_id = ? AND x.form_id = ? ORDER BY x.fact_key`,
    ).bind(version.id, form.id).all<any>()).results || []).map((f) => ({
      key: String(f.fact_key), value: f.value ?? null, status: String(f.status), blocking: Number(f.blocking) === 1,
      source: f.source_title ? { kind: String(f.source_kind), title: String(f.source_title), url: f.source_url ?? null } : null,
      checked_on: f.checked_on ?? null,
      fresh: !!f.source_title && !!f.checked_on && String(f.checked_on) >= since && f.status !== 'disputed',
    }));
    const fees = ((await env.DB.prepare(
      `SELECT line_key, label, payee, collected_by, currency, amount_cents, timing, checked_on
         FROM formation_fee_lines WHERE version_id = ? AND form_id = ? ORDER BY id`,
    ).bind(version.id, form.id).all<any>()).results || []).map((x) => ({
      key: String(x.line_key), label: String(x.label), payee: String(x.payee), collected_by: String(x.collected_by),
      currency: String(x.currency), amount_cents: x.amount_cents == null ? null : Number(x.amount_cents),
      timing: String(x.timing), checked_on: x.checked_on ?? null,
    }));
    let quote: { amount_minor: number; currency: string; cadence: string } | null = null;
    if (availability === 'orderable' && g.default_partner) {
      const p = await env.DB.prepare(
        `SELECT founder_price_minor, currency, cadence FROM formation_partner_prices
          WHERE coverage_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
          ORDER BY effective_from DESC, id DESC LIMIT 1`,
      ).bind(g.default_partner.coverage_id, today, today).first<any>();
      if (p) quote = { amount_minor: Number(p.founder_price_minor), currency: String(p.currency), cadence: String(p.cadence) };
    }
    out.push({
      key: form.form_key, label: form.label,
      jurisdiction: { country: form.country, subdivision: form.subdivision, registry_name: form.registry_name },
      availability, facts, fees, quote,
    });
  }
  return { version: { version: version.version, published_at: version.published_at }, forms: out };
}

// GET /api/formation/catalogue
r.get('/', async (c) => {
  await requireAuth(c);
  try {
    return c.json(await readCatalogue(c.env));
  } catch {
    return refuse(c, 503, { code: 'formation_catalogue_unreadable', message: 'The formation catalogue could not be read. Try again in a moment.' });
  }
});

export const mount: RouteMount = { path: '/api/formation/catalogue', router: r };
export default r;
