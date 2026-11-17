/**
 * #6173 (D6173): `GET /api/deals/:id/case`, the deal page's Investment case (DX4), assembled only
 * from what the caller may already read on this deal, for the firm chosen (`deal_context`'s rule).
 *
 *   thesis_fit      the thesis-fit read's computation (`computeThesisFit`), for this deal
 *   main_evidence   the investor evidence read's coverage (`investorEvidenceCoverage`): counts, never items
 *   open_questions  this firm's own notes tagged Question or Risk (`deal_notes`), newest first
 *   missing         scorecard scopes with low coverage, after the NDA and the founder's switch only
 *
 * Each block has `state`: `recorded`, `not_recorded` (with its reason) or `unreadable`. One block
 * failing never fails the others. Nothing here is drafted: an Eadwyn draft is a proposal the
 * investor saves as a note, never stored as a fact (D6173).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { selectJwt, requireAuth } from '../auth';
import type { RouteMount } from '../util/routeRegistry';
import dealContext, { context } from './deal_context';
import { computeThesisFit, readFitGeographies, readThesis } from '../services/thesisFit';
import { investorEvidenceCoverage } from '../services/raiseEvidence';
import { hasNda, investorsMaySee, SCOPE_LABELS } from '../services/ventureScoring/access';
import { storedScorecard } from '../services/ventureScoring/store';

const r = new Hono<{ Bindings: Env }>();

/** Below this stored coverage a scope is listed as Missing (half its applicable inputs). */
export const LOW_COVERAGE = 0.5;
export const CASE_TAGS = Object.freeze(['question', 'risk']);
export const CASE_REASONS = Object.freeze({
  thesisNotSet: 'No thesis is recorded for you, so fit is not worked out.',
  thesisThin: 'Too little is recorded about this venture to work out fit against your thesis.',
  noEvidenceAudience: 'The founder has not shared evidence with you on this deal.',
  noEvidence: 'No evidence is shared with you on this deal yet.',
  noQuestions: 'Your firm has no note tagged Question or Risk on this deal.',
  scoresLocked: 'The founder has not shared the scorecard with investors.',
  beforeNda: 'Sign the NDA with this venture to see which scopes are thinly evidenced.',
});
const unreadable = (what: string) => ({ state: 'unreadable' as const, reason: `${what} could not be read. Try again.` });

r.use('/:id/case', async (c, next) => {
  if ((await selectJwt(c))?.payload.impersonated_by) return c.json({ error: 'support_session_refused' }, 403);
  await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  await next();
});

r.get('/:id/case', async (c) => {
  const x = await context(c); if ('error' in x) return x.error;
  const { user, company, id, deal } = x as any;
  const projectId = Number(deal.project_id);
  const block = async <T>(what: string, read: () => Promise<T>) => { try { return await read(); } catch { return unreadable(what); } };

  const [thesisFit, mainEvidence, openQuestions, missing] = await Promise.all([
    block('Thesis fit', async () => {
      const thesis = await readThesis(c.env, user.id);
      const row = await c.env.DB.prepare(`SELECT d.minimum_check, d.currency, p.sector, p.stage FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`)
        .bind(id).first<{ minimum_check: number | null; currency: string | null; sector: string | null; stage: string | null }>();
      if (!row) throw new Error('deal_missing');
      const geo = thesis?.regions.length ? (await readFitGeographies(c.env, [projectId])).get(projectId) : undefined;
      if (geo?.unreadable) throw new Error('geography_unreadable');
      const fit = computeThesisFit(thesis, { sector: row.sector, stage: row.stage, minimumCheck: row.minimum_check, currency: row.currency,
        regions: geo?.regions ?? null, geographyIncomplete: geo?.geographyIncomplete ?? false });
      if (fit.state === 'not_set') return { state: 'not_recorded' as const, reason: CASE_REASONS.thesisNotSet, fit };
      if (fit.state !== 'recorded') return { state: 'not_recorded' as const, reason: CASE_REASONS.thesisThin, fit };
      return { state: 'recorded' as const, fit };
    }),
    block('The shared evidence', async () => {
      const read = await investorEvidenceCoverage(c.env, projectId, user.id);
      if (!read) return { state: 'not_recorded' as const, reason: CASE_REASONS.noEvidenceAudience };
      if (read.coverage.state !== 'recorded') return unreadable('The shared evidence');
      const groups = [...read.coverage.groups].sort((a, b) => b.count - a.count || String(b.newest ?? '').localeCompare(String(a.newest ?? ''))).slice(0, 5);
      if (!groups.length) return { state: 'not_recorded' as const, reason: CASE_REASONS.noEvidence };
      return { state: 'recorded' as const, groups, partial: Boolean(read.partial) };
    }),
    block('Your firm’s notes', async () => {
      const rows = await c.env.DB.prepare(`SELECT n.uid, n.tag, n.body, n.created_at, NULLIF(trim(u.name), '') AS author_name
        FROM deal_notes n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.deal_id = ? AND n.company_id IS ? AND (n.company_id IS NOT NULL OR n.author_user_id = ?)
          AND lower(trim(n.tag)) IN (SELECT value FROM json_each(?))
        ORDER BY n.id DESC LIMIT 20`).bind(id, company, user.id, JSON.stringify(CASE_TAGS)).all();
      if (!rows.success) throw new Error('notes_unreadable');
      if (!rows.results.length) return { state: 'not_recorded' as const, reason: CASE_REASONS.noQuestions };
      return { state: 'recorded' as const, items: rows.results };
    }),
    block('The scorecard', async () => {
      if (!(await investorsMaySee(c.env, projectId)).on) return { state: 'not_recorded' as const, reason: CASE_REASONS.scoresLocked };
      if (!(await hasNda(c.env, projectId, user.id))) return { state: 'not_recorded' as const, reason: CASE_REASONS.beforeNda };
      const stored = await storedScorecard(c.env, projectId);
      const thin = stored.filter((s) => s.state === 'not_enough' || (s.state === 'scored' && Number(s.coverage ?? 0) < LOW_COVERAGE))
        .map((s) => ({ scope: s.scope, label: SCOPE_LABELS[s.scope], state: s.state, coverage: s.coverage ?? null }));
      return { state: 'recorded' as const, scopes: thin, threshold: LOW_COVERAGE };
    }),
  ]);
  return c.json({ deal_id: id, thesis_fit: thesisFit, main_evidence: mainEvidence, open_questions: openQuestions, missing });
});

// Ahead of the deal-context router, whose `/:id/...` reads share this prefix.
export const mount: RouteMount = { path: '/api/deals', router: r, before: [dealContext] };
export default r;
