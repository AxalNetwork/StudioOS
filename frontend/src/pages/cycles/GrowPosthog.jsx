import { posthogApi } from '../../lib/api/posthog';
import FromPosthog from './FromPosthog';
import { asOfLine } from './fromPosthogModel';

/**
 * D1608 (#3731, #2409 part 6) — PostHog in Grow, on the shared "From PostHog"
 * part (D1609). Built from #2409's PH6, PH7 and PH8 brief: no canvas was drawn.
 *
 *   RevenuePosthog — Revenue and traction: the tracked metrics (each is also
 *     a KPI row "From PostHog", with no Enter by hand) and "Product retention
 *     by first-seen week, from PostHog", drawn BESIDE revenue cohort
 *     retention and labelled apart; never merged with it or with churn.
 *   ImprovementPosthog — Product improvement: each survey's responses and its
 *     NPS or average score, and answers to questions marked "feedback" as
 *     "Add as customer feedback". Survey answers come without the
 *     respondent's identity.
 *
 * The venture's team alone reads either part (decision C, a).
 */
export const RETENTION_TITLE = 'Product retention by first-seen week, from PostHog';
export const APART_LINE = 'Labelled apart from revenue retention by signup month; the two are never merged.';
export const NO_IDENTITY = 'Survey answers come without the respondent’s identity.';

/** "Week 1 42% · Week 2 31% …" for one cohort; a week PostHog gave no count for reads "—", never 0%. */
export function cohortLine(c) {
  const weeks = (Array.isArray(c?.pct) ? c.pct : []).slice(0, 6).map((p, i) => `W${i + 1} ${p == null ? '—' : `${p}%`}`);
  return `${c?.week} · ${Number(c?.size || 0).toLocaleString('en-US')} people${weeks.length ? ` · ${weeks.join(' · ')}` : ''}`;
}

/** "46 responses · NPS 31", or what is not recorded. */
export function surveyLine(d) {
  const parts = [d?.responses != null ? `${Number(d.responses).toLocaleString('en-US')} ${d.responses === 1 ? 'response' : 'responses'}` : 'Responses not recorded'];
  if (d?.nps != null) parts.push(`NPS ${d.nps}`);
  else if (d?.average != null) parts.push(`Average ${d.average}`);
  return parts.join(' · ');
}

export function RevenuePosthog({ projectId, api = posthogApi, phone = false }) {
  return (
    <FromPosthog section="grow" projectId={projectId} module="revenue_and_traction" api={api} phone={phone} onSync={() => api.sync('grow', projectId)}>
      {({ facts, onDelete }) => <Retention facts={facts} onDelete={onDelete} />}
    </FromPosthog>
  );
}

export function ImprovementPosthog({ projectId, api = posthogApi, phone = false }) {
  return (
    <FromPosthog section="grow" projectId={projectId} module="product_improvement" api={api} phone={phone} onSync={() => api.sync('grow', projectId)}
      renderProposal={(p, ctx) => (p.kind === 'survey_feedback' ? <Feedback p={p} ctx={ctx} /> : null)}>
      {({ facts, onDelete }) => <Surveys facts={facts} onDelete={onDelete} />}
    </FromPosthog>
  );
}

function Retention({ facts, onDelete }) {
  const latest = new Map();
  for (const f of facts.filter((x) => String(x.fact_key).startsWith('retention:')).sort((a, b) => String(a.period).localeCompare(String(b.period)))) latest.set(f.fact_key, f);
  if (!latest.size) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="posthog-retention">
      <h3 className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{RETENTION_TITLE}</h3>
      <p className="m-0 text-[11px] text-axal-muted dark:text-gray-400">{APART_LINE}</p>
      {[...latest.values()].map((f) => (
        <div key={f.fact_key} className="flex flex-col gap-0.5">
          {(f.data?.cohorts || []).map((c) => <span key={c.week} className="font-mono text-[11.5px] tabular-nums text-axal-ink dark:text-gray-200" data-testid="posthog-cohort">{cohortLine(c)}</span>)}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-axal-muted dark:text-gray-400">{f.label ? `${f.label} · ` : ''}{asOfLine(f.as_of)}</span>
            <button type="button" className={LINK} onClick={() => onDelete(f)} data-testid="posthog-fact-delete">Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Surveys({ facts, onDelete }) {
  const surveys = facts.filter((f) => f.kind === 'survey_stats');
  if (!surveys.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="posthog-surveys">
      {surveys.map((f) => (
        <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]" data-testid="posthog-survey">
          <span className="text-axal-ink dark:text-gray-100">{f.label || 'Survey'} · {f.period}</span>
          <span className="font-mono tabular-nums text-axal-ink dark:text-gray-200" data-testid="posthog-survey-line">{surveyLine(f.data)}</span>
          <span className="text-[11px] text-axal-muted dark:text-gray-400">{asOfLine(f.as_of)}</span>
          <button type="button" className={LINK} onClick={() => onDelete(f)} data-testid="posthog-fact-delete">Delete</button>
        </li>
      ))}
    </ul>
  );
}

/** PH7: an answer as customer feedback; never a name or an email. */
function Feedback({ p, ctx }) {
  return (
    <div className="flex flex-col gap-2" data-testid="posthog-feedback-proposal">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">“{String(p.payload?.answer || '')}”</p>
      <span className="text-[11px] text-axal-muted dark:text-gray-400">{NO_IDENTITY}</span>
      {ctx.mine && (
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          <button type="button" className={PRIMARY} disabled={ctx.busy} onClick={() => ctx.accept({})} data-testid="posthog-accept">Add as customer feedback</button>
          <button type="button" className={GHOST} disabled={ctx.busy} onClick={ctx.dismiss} data-testid="posthog-dismiss">Dismiss</button>
        </div>
      )}
    </div>
  );
}

const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:opacity-50 dark:text-violet-300 dark:hover:underline';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
