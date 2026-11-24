/**
 * D7828 (#7828): a company's sourced business facts and its per-job completeness, two reads.
 *
 *   GET /api/research/company-directory/:uid/facts         current and superseded facts, conflicts
 *                                                          marked on both sides, each attribute's answer
 *   GET /api/research/company-directory/:uid/completeness  lookup, competitor research, partner
 *                                                          discovery and investment-firm discovery
 *
 * The Companies rule (researchCompaniesAccess.ts, D7178) is checked before the record is read, so a
 * refusal never says whether the company exists. The record is read through researchCompanyRead
 * (D7819): an unserved record (absent, excluded or withdrawn) returns no facts. #7824 registers both
 * reads with its access module when it lands. A failed read is a 503, never an empty list.
 * Mounted ahead of research.ts, which owns `/company-directory/:uid`: it precedes
 * research_client_prep.ts, which research_client_prep_4574 keeps immediately ahead of research.ts.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { admitsCompanies, refuseCompanies } from '../services/researchCompaniesAccess';
import { readCompanyByUid } from '../services/researchCompanyRead';
import { companyCompleteness, companyFacts, readCompanyFactRows } from '../services/researchCompanyFacts';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import clientPrep from './research_client_prep';

const router = new Hono<{ Bindings: Env }>();

/** A record the directory serves in full; a withdrawn or excluded record reads as only its review. */
const served = (row: unknown): row is Record<string, any> =>
  !!row && typeof row === 'object' && typeof (row as any).name === 'string' && 'id' in (row as object);

async function load(c: Context<{ Bindings: Env }>) {
  const uid = c.req.param('uid') || '';
  if (!uid || uid.length > 64) return { response: c.json({ detail: 'Not found' }, 404) };
  let record;
  let facts;
  try {
    record = await readCompanyByUid(c.env, uid);
    if (!served(record)) return { response: c.json({ detail: 'Not found' }, 404) };
    facts = await readCompanyFactRows(c.env, uid);
  } catch (error) {
    return {
      response: refuse(c, 503, {
        code: 'company_facts_unreadable',
        message: 'The company facts could not be read. Please retry.',
        raw: error,
      }),
    };
  }
  return { record, facts };
}

router.get('/company-directory/:uid/facts', async (c) => {
  if (!admitsCompanies(await requireAuth(c))) return refuseCompanies(c);
  const got = await load(c);
  if ('response' in got) return got.response;
  return c.json(companyFacts(String(got.record.uid), got.facts));
});

router.get('/company-directory/:uid/completeness', async (c) => {
  if (!admitsCompanies(await requireAuth(c))) return refuseCompanies(c);
  const got = await load(c);
  if ('response' in got) return got.response;
  return c.json(companyCompleteness(got.record, got.facts));
});

export const mount: RouteMount = { path: '/api/research', router: router, before: [clientPrep] };
export default router;
