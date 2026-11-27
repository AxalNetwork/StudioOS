/**
 * D4357 (#4357), extended by D6707 (#6707) — the Incorporate quote, line by
 * line: `GET /api/legal/incorporation/itemised-quote`, read on the review step
 * before the founder confirms, and `POST /api/legal/incorporation/cases/:uid/itemised-quote`,
 * which quotes a formation case and snapshots its lines on the case.
 *
 *   GET /api/legal/incorporation/itemised-quote?jurisdiction_id=us_de_ccorp
 *       → { jurisdiction_id, label,
 *           lines: [{ key, label, amount_cents | null, currency, interval, optional, paid, source, source_url,
 *                     checked_on, payee, payee_name, collected_by, timing, billed_by }],
 *           total: { amount_cents | null, currency, complete, unknown },
 *           totals: [{ amount_cents | null, currency, complete, unknown }],   one per currency, never summed across
 *           charge: { currency, amount_cents | null, lines } }               what Axal VC collects with the order
 *
 *   POST /api/legal/incorporation/cases/:uid/itemised-quote
 *       → { case_uid, quote_uid, form_key, …the same quote }, the lines written to
 *         `formation_case_fee_lines` under `quote_uid`. The case's founder only
 *         (its venture's founder, or an editor of its company), on an open
 *         HQ (v2) case before payment that has chosen a form.
 *
 * The lines come from `services/incorporationQuote.ts` `quoteOf`: the form's
 * government fee lines from the formation catalogue, Axal VC's service fee
 * from the catalog price the order charges (`resolveIncorporationPrice`), the
 * partner's founder price (the case's assigned partner, or the default one),
 * the registered agent and any optional add-ons from the catalog. A fee that
 * is not known is null, never 0, and a partner's cost is never read. A partner
 * line collected by Axal on a form that does not allow it is refused with 409
 * `partner_collection_not_allowed`. Who reads: anyone signed in, as the
 * one-price quote. Mounted before `legal.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import legal, { JURISDICTIONS, resolveIncorporationPrice, resolveRegisteredAgentOffer } from './legal';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { branchOf } from '../util/branch';
import { canEdit } from '../services/companyAccess';
import { isVentureFounder } from '../services/ventureFounder';
import { catalogPriceOf } from '../services/formationGates';
import {
  addOnsOf, catalogOrNone, collectionRefusal, productOfPrice, quoteInputs, quoteOf, snapshotStatements, type CatalogLine,
} from '../services/incorporationQuote';

const legalIncorporationQuote = new Hono<{ Bindings: Env }>();

/** The quote for one form: its catalogue lines, its partner (the case's when given) and the catalog's prices. */
async function quoteForForm(env: Env, formKey: string, opts: { caseId?: number | null; legacyPrice: boolean }) {
  const [inputs, agent, products] = await Promise.all([
    quoteInputs(env, formKey, { caseId: opts.caseId ?? null }),
    resolveRegisteredAgentOffer(env),
    catalogOrNone(env),
  ]);
  let service: CatalogLine | null = null;
  if (opts.legacyPrice || inputs.legacy) {
    const price = await resolveIncorporationPrice(env, formKey).catch(() => null);
    if (price) service = { amount_cents: price.amountCents, currency: price.currency, synced_at: productOfPrice(products, price.priceId)?.synced_at ?? null };
  } else {
    const price = await catalogPriceOf(env, { form_key: formKey, legacy: false }).catch(() => null);
    if (price) service = { amount_cents: price.amount_minor, currency: price.currency };
  }
  const quote = quoteOf({
    jurisdictionId: formKey,
    service,
    agent: agent ? { amount_cents: agent.amount_cents, currency: agent.currency, interval: agent.interval, name: agent.product_name, synced_at: productOfPrice(products, agent.price_id)?.synced_at ?? null } : null,
    addOns: addOnsOf(products),
    feeLines: inputs.feeLines, vocabulary: inputs.vocabulary, partner: inputs.partner,
  });
  return { quote, inputs };
}

legalIncorporationQuote.get('/incorporation/itemised-quote', async (c) => {
  await requireAuth(c);
  const jurisdictionId = String(c.req.query('jurisdiction_id') || '');
  const j = JURISDICTIONS.find((x) => x.id === jurisdictionId);
  if (!j) return c.json({ error: 'unknown_jurisdiction', message: 'That jurisdiction cannot be formed here.' }, 400);
  const { quote, inputs } = await quoteForForm(c.env, j.id, { legacyPrice: true });
  const refused = collectionRefusal(quote, inputs.allowAxalCollection);
  if (refused) return refuse(c, refused.status, { code: refused.code, message: refused.message });
  return c.json({ jurisdiction_id: j.id, label: j.label, ...quote });
});

const QUOTABLE = ['draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted'];

legalIncorporationQuote.post('/incorporation/cases/:uid/itemised-quote', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  if (branchOf(c.env)) return refuse(c, 403, { code: 'formation_hq_only', message: 'This formation flow is available at Axal VC HQ.' });
  const row = await c.env.DB.prepare(
    `SELECT id, uid, project_id, company_id, stage, form_key, closed_at FROM formation_cases WHERE uid = ? AND track = 'v2'`,
  ).bind(c.req.param('uid')).first<{ id: number; uid: string; project_id: number | null; company_id: number | null; stage: string; form_key: string | null; closed_at: string | null }>();
  const owns = row && (row.project_id != null
    ? await isVentureFounder(c.env, user, Number(row.project_id))
      && !!await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(Number(row.project_id)).first()
    : row.company_id != null && await canEdit(c.env, { id: Number(row.company_id) }, user));
  if (!row || !owns) return refuse(c, 404, { code: 'formation_case_not_found', message: 'That formation case is not available to you.' });
  if (row.closed_at || !QUOTABLE.includes(row.stage)) return refuse(c, 409, { code: 'formation_case_quote_locked', message: 'This case is past payment, so its quote is kept as it was.' });
  if (!row.form_key) return refuse(c, 409, { code: 'formation_case_no_form', message: 'Choose a company form before the case can be quoted.' });

  const { quote, inputs } = await quoteForForm(c.env, row.form_key, { caseId: Number(row.id), legacyPrice: false });
  if (!inputs.catalogueVersionId) return refuse(c, 409, { code: 'formation_case_no_form', message: 'The chosen company form is not in the current catalogue, so it cannot be quoted.' });
  const refused = collectionRefusal(quote, inputs.allowAxalCollection);
  if (refused) return refuse(c, refused.status, { code: refused.code, message: refused.message });

  const quoteUid = `fq_${crypto.randomUUID()}`;
  await c.env.DB.batch(snapshotStatements(c.env, Number(row.id), quoteUid, quote, {
    partnerId: inputs.partner?.formation_partner_id ?? null, versionId: inputs.catalogueVersionId, userId: Number(user.id),
  }));
  return c.json({ case_uid: row.uid, quote_uid: quoteUid, form_key: row.form_key, ...quote });
});

export default legalIncorporationQuote;

export const mount: RouteMount = { path: '/api/legal', router: legalIncorporationQuote, before: [legal] };
