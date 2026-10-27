import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ventureScoresApi } from '../lib/api/ventureScores.js';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import Lightbox from '../ui/Lightbox';
import RiskRadar from './RiskRadar';
import { NOT_ENOUGH, NOT_REVIEWED, bandWord, scopeOf } from './scoring/scorecard/scorecardModel';

/**
 * Venture risk on the project page — the scorecard's Risk scope and its ten
 * layers (D1260, #3283; owner question 8 A of #2428).
 *
 * It reads `GET /api/venture-scores/:projectId` and nothing else that scores.
 * The old panel read `/api/venture-risk`, whose automatic layer scores came
 * from the Lab scorer's sliders and the projects row, scored a layer with no
 * data as 0, and averaged it into an "overall derisking" figure. None of that
 * is drawn now:
 *
 *   · The headline is the Risk scope as the scorecard computed it, with its
 *     band in risk words and its confidence, or why it has no value.
 *   · The ten layers are Risk's sub-rows: an analyst's review, or "Not
 *     reviewed", never 0. The radar plots only reviewed layers.
 *   · An Admin or Operating Partner reviews a layer in a dialog that says what
 *     it changes. The review is written where it always was
 *     (`PUT /api/venture-risk/:id/layers/:key`), and the scorecard is read
 *     again, so the Risk scope moves with it.
 *   · An investor reads a scorecard through a deal they are on; here they get
 *     the Worker's sentence and the deal list, never a figure.
 */

const RISK_BAND = Object.freeze({ Strong: 'low', Fair: 'medium', Weak: 'high' });
const CARD = 'rounded-xl border border-slate-200 bg-white p-5 mb-6 dark:border-slate-700 dark:bg-gray-900';
const SUB = 'text-xs text-slate-600 dark:text-slate-400';
const BTN = 'inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';
const STATUSES = [['open', 'Open'], ['in_review', 'In review'], ['mitigated', 'Mitigated'], ['accepted', 'Accepted'], ['flagged', 'Flagged']];

/** What the review dialog sends: a score of 0–100 or none, a status, a note. Never a band: the Worker derives it. */
export function layerReviewBody(form) {
  const raw = String(form.score ?? '').trim();
  const score = raw === '' ? null : Number(raw);
  if (score != null && (!Number.isFinite(score) || score < 0 || score > 100)) return { error: 'A score is a number from 0 to 100, or leave it empty.' };
  if (score == null && !String(form.note || '').trim()) return { error: 'Give a score, a note, or both.' };
  return { body: { analyst_score: score, status: form.status || 'open', analyst_note: String(form.note || '').trim() || null } };
}

function ReviewLayer({ projectId, layer, onClose, onSaved }) {
  const [form, setForm] = useState({ score: layer.score ?? '', status: 'open', note: layer.note ?? '' });
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (clear = false) => {
    setProblem('');
    const out = clear ? { body: null } : layerReviewBody(form);
    if (out.error) { setProblem(out.error); return; }
    setBusy(true);
    try {
      if (clear) await api.ventureRiskClearLayer(projectId, layer.key);
      else await api.ventureRiskSetLayer(projectId, layer.key, out.body);
      onSaved();
    } catch (e) {
      reportError('VentureRiskPanel:review', e);
      setProblem('The review could not be saved. Nothing changed. Try again.');
    } finally { setBusy(false); }
  };
  return (
    <Lightbox label={`Review ${layer.label}`} title={`Review · ${layer.label}`} onClose={onClose} width={480} testId={`risk-layer-review-${layer.key}`}
      footer={(
        <div className="flex flex-col gap-2">
          {problem ? <p className="m-0 text-[12px] text-rose-700 dark:text-rose-300" data-testid="risk-layer-review-problem">{problem}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {layer.reviewed && <button type="button" className={BTN} disabled={busy} onClick={() => save(true)} data-testid="risk-layer-review-clear">Remove the review</button>}
            <button type="button" className={BTN} onClick={onClose}>Cancel</button>
            <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg bg-violet-700 px-3 text-xs font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => save(false)} data-testid="risk-layer-review-save">Save the review</button>
          </div>
        </div>
      )}>
      <p className={`m-0 ${SUB}`}>
        Your score is this layer&rsquo;s figure on the scorecard: 0 to 100, higher is lower risk. It changes
        Risk&rsquo;s &ldquo;Analyst layer reviews&rdquo; input, the mean of the layers reviewed, on the next read.
        Investors with an NDA see the figure and its band; your note is for studio staff only.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">Score (0–100, or empty for a note only)
        <input type="number" min="0" max="100" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-gray-800" data-testid="risk-layer-review-score" />
      </label>
      <label className="mt-2 flex flex-col gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">Status
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-gray-800">
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="mt-2 flex flex-col gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">Note (staff only)
        <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-gray-800" />
      </label>
    </Lightbox>
  );
}

export default function VentureRiskPanel({ projectId, canWrite = false }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    setRead({ status: 'loading' });
    try {
      const out = await ventureScoresApi.venture(projectId);
      const raw = (out?.scopes || []).find((s) => s?.scope === 'risk');
      setRead({ status: 'ready', risk: scopeOf(raw, 'risk') });
    } catch (e) {
      if (e?.status === 403 || e?.status === 404) setRead({ status: 'refused', message: e?.data?.message || e?.message || 'You cannot read this scorecard.' });
      else { reportError('VentureRiskPanel:load', e); setRead({ status: 'error' }); }
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const risk = read.status === 'ready' ? read.risk : null;
  const layers = risk?.layers || [];
  const reviewed = layers.filter((l) => l.reviewed);

  return (
    <div className={CARD} data-testid="venture-risk-panel">
      <div className="mb-1 flex items-center gap-2">
        <ShieldAlert size={16} className="text-violet-600" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Venture risk</h3>
        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">Scorecard · Risk</span>
      </div>
      <p className={`mb-4 ${SUB}`}>
        The venture scorecard&rsquo;s Risk scope and its ten layers. A higher value means lower risk.{' '}
        <Link to="/scoring/method" className="underline">How scoring works</Link>
      </p>

      {read.status === 'loading' && <p className={SUB} aria-live="polite">Reading the scorecard…</p>}
      {read.status === 'refused' && <p className={SUB} data-testid="venture-risk-refused">{read.message} <Link to="/deals" className="underline">Your deals</Link></p>}
      {read.status === 'error' && (
        <p className={SUB} data-testid="venture-risk-unreadable">
          The scorecard could not be read. That is not a score of zero.{' '}
          <button type="button" className="underline" onClick={load}>Try again</button>
        </p>
      )}

      {risk && (
        <>
          <div className="mb-5 grid items-center gap-6 lg:grid-cols-[auto_1fr]">
            <div data-testid="venture-risk-scope">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk</div>
              {risk.state === 'scored' ? (
                <>
                  <div className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">{Math.round(risk.value)}</div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{bandWord(risk.band, 'risk')} · {risk.confidence ?? 'confidence not recorded'} confidence</div>
                </>
              ) : (
                <div className="mt-1 max-w-[16rem] text-xs text-slate-500 dark:text-slate-400" data-testid="venture-risk-no-value">{risk.reason || (risk.state === 'not_enough' ? NOT_ENOUGH : 'Not scored yet')}. Missing is never 0.</div>
              )}
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{reviewed.length} of {layers.length || 10} layers reviewed</div>
            </div>
            <div className="flex justify-center">
              <RiskRadar layers={layers.map((l) => ({ key: l.key, label: l.label, score: l.score }))} band={RISK_BAND[risk.band] || 'medium'} size={300} muted={reviewed.length === 0} />
            </div>
          </div>
          {layers.length === 0 ? (
            <p className={SUB}>The ten layers are not in this read.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2" data-testid="venture-risk-layers">
              {layers.map((l) => (
                <li key={l.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={`venture-risk-layer-${l.key}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{l.label}</span>
                    <span className={`font-mono text-xs ${l.reviewed ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{l.reviewed ? l.text : NOT_REVIEWED}</span>
                  </div>
                  {l.reviewed_on && <div className="text-[11px] text-slate-500 dark:text-slate-400">Reviewed {l.reviewed_on}</div>}
                  {l.note && <p className="m-0 mt-1 text-xs text-slate-600 dark:text-slate-300">{l.note}</p>}
                  {canWrite && <button type="button" className={`${BTN} mt-2`} onClick={() => setReviewing(l)} data-testid={`venture-risk-review-${l.key}`}>{l.reviewed ? 'Change the review' : 'Review this layer'}</button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {reviewing && <ReviewLayer projectId={projectId} layer={reviewing} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); load(); }} />}
    </div>
  );
}
