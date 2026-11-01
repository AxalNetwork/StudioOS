import { useEffect, useState } from 'react';
import { posthogApi } from '../../lib/api/posthog';
import Lightbox from '../../ui/Lightbox';
import FromPosthog from './FromPosthog';
import { asOfLine, figureText, refusalOf } from './fromPosthogModel';

/**
 * D1605 (#3731, #2409 part 3) — PostHog in Validate, on the shared "From
 * PostHog" part (D1609). Built from #2409's PH4 and PH8 brief: no canvas was
 * drawn.
 *
 *   ValidateExperimentsPosthog — Experiments and evidence: each experiment's
 *     result (variants, exposures, uplift) and each survey's counts, as
 *     figures "From PostHog, as of <date>"; "Link this experiment to a
 *     hypothesis" with the hypothesis and Supports / Contradicts chosen by
 *     the founder (never guessed), strength Measured; Accept is off until
 *     both are chosen.
 *   ValidateDemandPosthog — Demand and urgency signals: the last 7 days'
 *     visitors and sessions BESIDE the waitlist line, never added to it; an
 *     answer to a question the founder marked "would pay" or "need to have"
 *     as a signal to confirm; Mark survey questions, in an in-page dialog.
 */
export const BESIDE_WAITLIST = 'Shown beside the waitlist. It never changes the waitlist count.';
export const MARK_LINE = 'You decide what a question means. Axal VC never guesses it from its words, and keeps no respondent’s identity.';
export const MARK_WORDS = Object.freeze({ would_pay: 'Would pay', need_to_have: 'Need to have', feedback: 'Feedback' });

export function ValidateExperimentsPosthog({ projectId, api = posthogApi, loadHypotheses, phone = false }) {
  return (
    <FromPosthog section="validate" projectId={projectId} module="experiments" api={api} phone={phone}
      onSync={() => api.sync('validate', projectId)}
      renderProposal={(p, ctx) => (p.kind === 'experiment_evidence' ? <ExperimentProposal p={p} ctx={ctx} loadHypotheses={loadHypotheses} /> : null)}>
      {({ facts, onDelete }) => <ExperimentFacts facts={facts} onDelete={onDelete} />}
    </FromPosthog>
  );
}

export function ValidateDemandPosthog({ projectId, api = posthogApi, phone = false }) {
  const [marking, setMarking] = useState(false);
  return (
    <>
      <FromPosthog section="validate" projectId={projectId} module="demand_signals" api={api} phone={phone}
        onSync={() => api.sync('validate', projectId)}
        actions={<button type="button" className={GHOST} onClick={() => setMarking(true)} data-testid="posthog-mark-open">Mark survey questions</button>}
        renderProposal={(p, ctx) => (p.kind === 'survey_signal' ? <SignalProposal p={p} ctx={ctx} /> : null)}>
        {({ facts, onDelete }) => <OverviewFacts facts={facts} onDelete={onDelete} />}
      </FromPosthog>
      {marking && <MarkQuestions api={api} projectId={projectId} onClose={() => setMarking(false)} />}
    </>
  );
}

/** "Variant test: 900 exposures, +3.1" lines, and "46 responses of 400 shown". */
export function experimentLines(f) {
  const d = f?.data || {};
  if (f?.kind === 'survey_stats') {
    const r = figureText(d.responses, 'count');
    const shown = figureText(d.shown, 'count');
    return [r ? `${r} ${d.responses === 1 ? 'response' : 'responses'}${shown ? ` of ${shown} shown` : ''}` : 'Responses not recorded'];
  }
  const vs = Array.isArray(d.variants) ? d.variants : [];
  if (!vs.length) return ['Results not recorded'];
  return vs.map((v) => {
    const parts = [figureText(v.exposure, 'count') ? `${figureText(v.exposure, 'count')} exposures` : null, v.uplift != null ? `${v.uplift > 0 ? '+' : ''}${v.uplift}` : null].filter(Boolean);
    return `Variant ${v.key}: ${parts.length ? parts.join(', ') : 'not recorded'}`;
  });
}

function ExperimentFacts({ facts, onDelete }) {
  const shown = facts.filter((f) => f.kind === 'experiment_result' || f.kind === 'survey_stats');
  if (!shown.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="posthog-experiment-facts">
      {shown.map((f) => (
        <li key={f.id} className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="posthog-experiment-fact">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{f.label || (f.kind === 'survey_stats' ? 'Survey' : 'Experiment')}</span>
            <button type="button" className={LINK} onClick={() => onDelete(f)} data-testid="posthog-fact-delete">Delete</button>
          </div>
          {experimentLines(f).map((l) => <span key={l} className="font-mono text-[12px] tabular-nums text-axal-ink dark:text-gray-200">{l}</span>)}
          {f.data?.significant === true && <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Significant</span>}
          <span className="text-[11px] text-axal-muted dark:text-gray-400">{asOfLine(f.as_of)}</span>
        </li>
      ))}
    </ul>
  );
}

/** PH4: the hypothesis and the direction are the founder's; Accept is off until both are chosen. */
function ExperimentProposal({ p, ctx, loadHypotheses }) {
  const [list, setList] = useState({ status: 'loading', items: [] });
  const [hypothesis, setHypothesis] = useState('');
  const [direction, setDirection] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(loadHypotheses ? loadHypotheses() : []).then(
      (items) => { if (live) setList({ status: 'ready', items: Array.isArray(items) ? items : [] }); },
      () => { if (live) setList({ status: 'unreadable', items: [] }); },
    );
    return () => { live = false; };
  }, [loadHypotheses]);
  return (
    <div className="flex flex-col gap-2" data-testid="posthog-experiment-proposal">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Link “{String(p.payload?.title || 'this experiment')}” to a hypothesis</p>
      {ctx.mine && (
        <>
          <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
            <select value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} aria-label="Hypothesis" data-testid="posthog-hypothesis"
              className="rounded-[7px] border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]">
              <option value="">{list.status === 'loading' ? 'Reading hypotheses…' : list.status === 'unreadable' ? 'Hypotheses could not be read' : 'Choose a hypothesis'}</option>
              {list.items.map((h) => <option key={h.id} value={h.id}>{h.code ? `${h.code} · ` : ''}{h.claim || h.statement || 'Hypothesis'}</option>)}
            </select>
            <div role="radiogroup" aria-label="Direction" className="flex gap-[7px]">
              {[['supports', 'Supports'], ['contradicts', 'Contradicts']].map(([k, w]) => (
                <button key={k} type="button" role="radio" aria-checked={direction === k} onClick={() => setDirection(k)} data-testid="posthog-direction" data-direction={k}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold max-sm:min-h-[44px] ${direction === k ? 'border-axal-violet bg-axal-violet text-white' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>{w}</button>
              ))}
            </div>
            <span className="font-mono text-[10.5px] uppercase tracking-axal-label text-axal-muted dark:text-gray-400">Strength · Measured</span>
          </div>
          <div className="flex flex-wrap gap-2 max-sm:flex-col">
            <button type="button" className={PRIMARY} disabled={ctx.busy || !hypothesis || !direction} onClick={() => ctx.accept({ hypothesis_id: Number(hypothesis), direction })} data-testid="posthog-accept">Accept</button>
            <button type="button" className={GHOST} disabled={ctx.busy} onClick={ctx.dismiss} data-testid="posthog-dismiss">Dismiss</button>
          </div>
        </>
      )}
    </div>
  );
}

function OverviewFacts({ facts, onDelete }) {
  const web = facts.filter((f) => f.kind === 'web_overview').sort((a, b) => String(b.as_of).localeCompare(String(a.as_of)))[0];
  if (!web) return null;
  const d = web.data || {};
  const parts = [['visitors', 'visitors'], ['sessions', 'sessions'], ['pageviews', 'pageviews']]
    .map(([k, w]) => (figureText(d[k], 'count') ? `${figureText(d[k], 'count')} ${w}` : null)).filter(Boolean);
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="posthog-overview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">Last 7 days</span>
        <button type="button" className={LINK} onClick={() => onDelete(web)} data-testid="posthog-fact-delete">Delete</button>
      </div>
      <span className="font-mono text-[12px] tabular-nums text-axal-ink dark:text-gray-200" data-testid="posthog-overview-line">{parts.length ? parts.join(' · ') : 'Not recorded'}</span>
      <span className="text-[11px] text-axal-muted dark:text-gray-400">{asOfLine(web.as_of)}. {BESIDE_WAITLIST}</span>
    </div>
  );
}

function SignalProposal({ p, ctx }) {
  const mark = MARK_WORDS[p.payload?.mark] || 'Survey answer';
  return (
    <div className="flex flex-col gap-2" data-testid="posthog-signal-proposal">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">“{String(p.payload?.answer || '')}”</p>
      <span className="font-mono text-[10.5px] uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{mark}{p.payload?.at ? ` · ${p.payload.at}` : ''} · no respondent identity</span>
      {ctx.mine && (
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          <button type="button" className={PRIMARY} disabled={ctx.busy} onClick={() => ctx.accept({})} data-testid="posthog-accept">Add as a signal to confirm</button>
          <button type="button" className={GHOST} disabled={ctx.busy} onClick={ctx.dismiss} data-testid="posthog-dismiss">Dismiss</button>
        </div>
      )}
    </div>
  );
}

/** Each question of each survey, marked Would pay, Need to have, Feedback or nothing. Each change is saved on its own. */
function MarkQuestions({ api, projectId, onClose }) {
  const [read, setRead] = useState({ status: 'loading', surveys: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    api.surveys(projectId).then(
      (r) => { if (live) setRead({ status: 'ready', surveys: Array.isArray(r?.surveys) ? r.surveys : [] }); },
      (e) => { if (live) setRead({ status: 'unreadable', surveys: [], error: refusalOf(e) }); },
    );
    return () => { live = false; };
  }, [api, projectId, round]);
  const set = async (s, q, mark) => {
    setBusy(`${s.id}:${q.id}`); setError(null);
    try { await api.markQuestion(projectId, s.id, q.id, mark); setRound((n) => n + 1); } catch (e) { setError(refusalOf(e, 'The mark could not be saved. Try again.')); }
    setBusy(null);
  };
  return (
    <Lightbox label="Mark survey questions" title="Mark survey questions" onClose={onClose} width={560} testId="posthog-mark-dialog" phone="sheet"
      footer={<div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose}>Done</button></div>}>
      <div className="flex flex-col gap-3 text-[13px] text-axal-ink dark:text-gray-200">
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{MARK_LINE}</p>
        {read.status === 'loading' && <div className="h-2 w-40 animate-pulse rounded bg-axal-hairline dark:bg-gray-800" role="status" aria-label="Reading your surveys" />}
        {read.status === 'unreadable' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert">{read.error} <button type="button" className={LINK} onClick={() => setRound((n) => n + 1)}>Try again</button></p>}
        {read.status === 'ready' && read.surveys.length === 0 && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="posthog-mark-none">This PostHog project has no survey yet.</p>}
        {read.surveys.map((s) => (
          <div key={s.id} className="flex flex-col gap-1.5">
            <span className="font-semibold">{s.name || 'Survey'}</span>
            {s.questions.map((q) => (
              <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="posthog-mark-question">
                <span className="min-w-0 flex-1">{q.text || 'Question'}</span>
                <select value={q.mark || ''} disabled={busy === `${s.id}:${q.id}`} onChange={(e) => set(s, q, e.target.value || null)} aria-label={`Mark ${q.text || 'question'}`} data-testid="posthog-mark"
                  className="rounded-[7px] border border-axal-hairline bg-white px-2 py-1 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]">
                  <option value="">Not marked</option>
                  {Object.entries(MARK_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="posthog-mark-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:opacity-50 dark:text-violet-300 dark:hover:underline';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
