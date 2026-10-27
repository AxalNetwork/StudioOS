/**
 * D1258 (#3281) — the scorecard's dialogs, each in the page and each saying
 * what it changes; never a browser pop-up: Ask to correct (SC9), Add review
 * (SC10), Your weighting (SC7) and a sharing change.
 *
 * No dialog sends a value, band, confidence or grade (scores are derived,
 * never typed). A refusal is the Worker's own sentence, shown in the dialog;
 * the dialog stays open with it.
 */
import React, { useRef, useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { ghost as actionGhost, primary as actionPrimary } from '../../../ui/ActionSheet';
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { reportError } from '../../../lib/log';
import { SCOPES } from './scorecardModel.js';
import {
  MESSAGE_MAX, REVIEW_CAP, WEIGHT_MAX, equalWeights, isEqual, messageProblem, reviewBody, reviewPreview, reviewProblem, sharingChange, weightsProblem,
} from './founderModel.js';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'm-0 text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function Dialog({ title, sub = null, testId, button, problem, run, onClose, onDone, foot = null, width = 560, children }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || problem) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { onDone(await run()); } catch (e) {
      reportError('ScorecardDialogs:write', e);
      setRefusal(e?.data?.message || e?.data?.detail || e?.message || 'That was not saved. Nothing was changed.');
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={close} width={width} testId={testId}
      footer={(
        <div className="flex flex-col gap-2">
          {problem ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-problem`}>{problem}</p> : null}
          {refusal ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testId}-refused`}>{refusal}</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {foot ? <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-400">{foot}</span> : null}
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={go} disabled={!!problem || busy} data-testid={`${testId}-go`}>{busy ? 'Saving…' : button}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">{children}</div>
    </Lightbox>
  );
}

/** SC9 · Ask to correct one input. An Admin reads it; nothing changes until they answer. */
export function AskToCorrect({ projectId, scope, input, onClose, onDone, api = ventureScoresApi }) {
  const [message, setMessage] = useState('');
  const problem = messageProblem(message);
  return (
    <Dialog title="Ask to correct" sub="An Admin reads it. Nothing changes until they answer." testId="scorecard-ask" button="Send" problem={problem}
      foot="Sent to the studio’s Admins." onClose={onClose} onDone={onDone}
      run={() => api.askCorrection(projectId, { scope: scope.key, inputKey: input.key, message: message.trim() })}>
      <div className="flex flex-col gap-1">
        <span className={EYE}>Input</span>
        <span className="font-semibold" data-testid="scorecard-ask-input">{scope.label} › {input.label}</span>
        <span className={SUB}>{input.recorded ? input.words : input.missing}{input.source ? ` · ${input.source}` : ''}{input.grade ? ` · ${input.grade}` : ''}</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className={EYE}>What is wrong</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={MESSAGE_MAX} className={FIELD} data-testid="scorecard-ask-message" />
        <span className="self-end font-mono text-[11px] text-axal-muted">{message.trim().length} / {MESSAGE_MAX}</span>
      </label>
      <p className={SUB}>Attaching a file is not offered here yet: add it to the record the input reads, and it counts on the next score.</p>
    </Dialog>
  );
}

/** SC10 · Add review: a note, or an adjustment within ±15 points with a reason. The computed value stays beside it. */
export function AddReview({ projectId, scope, onClose, onDone, api = ventureScoresApi }) {
  const [f, setF] = useState({ kind: scope.scored ? 'adjust' : 'note', adjustment: 0, reason: '', note: '' });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const problem = reviewProblem(f, scope.scored);
  const preview = f.kind === 'adjust' ? reviewPreview(scope.value, f.adjustment) : null;
  return (
    <Dialog title={`Add review · ${scope.label}`} sub="The founder is told. Your adjustment shows beside the computed value." testId="scorecard-review"
      button="Save review" problem={problem} onClose={onClose} onDone={onDone} width={580}
      run={() => api.review(projectId, scope.key, reviewBody(f))}>
      <div className="flex flex-wrap items-center gap-2" data-testid="scorecard-review-scope">
        <span className="font-semibold">{scope.label}</span>
        {scope.scored ? <span className="text-[12.5px]">{scope.band} · computed <span className="font-mono font-bold">{scope.value}</span> · {scope.confidence} confidence</span>
          : <span className="text-[12.5px] text-axal-muted">{scope.state}</span>}
      </div>
      <div role="radiogroup" aria-label="Review" className="flex gap-1.5">
        {[['note', 'Note only'], ['adjust', 'Adjust']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={f.kind === k} disabled={k === 'adjust' && !scope.scored} onClick={() => set({ kind: k })}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold disabled:opacity-50 ${f.kind === k ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200' : 'border-axal-hairline dark:border-gray-700'}`}
            data-testid={`scorecard-review-${k}`}>{l}</button>
        ))}
      </div>
      {f.kind === 'adjust' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={EYE}>Adjustment · −{REVIEW_CAP} to +{REVIEW_CAP}</span>
            <span className="flex items-center gap-3">
              <input type="range" min={-REVIEW_CAP} max={REVIEW_CAP} step={1} value={f.adjustment} onChange={(e) => set({ adjustment: Number(e.target.value) })} className="flex-1" aria-label="Adjustment" data-testid="scorecard-review-adjustment" />
              <span className="w-10 text-right font-mono font-bold">{f.adjustment > 0 ? `+${f.adjustment}` : f.adjustment}</span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={EYE}>Reason · required</span>
            <textarea value={f.reason} onChange={(e) => set({ reason: e.target.value })} rows={3} maxLength={MESSAGE_MAX} className={FIELD} data-testid="scorecard-review-reason" />
          </label>
          {preview ? <p className="m-0 rounded-lg bg-violet-50 p-2.5 text-[12.5px] text-violet-900 dark:bg-violet-950 dark:text-violet-200" data-testid="scorecard-review-preview">{preview}</p> : null}
        </>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={EYE}>Note</span>
          <textarea value={f.note} onChange={(e) => set({ note: e.target.value })} rows={3} maxLength={MESSAGE_MAX} className={FIELD} data-testid="scorecard-review-note" />
        </label>
      )}
    </Dialog>
  );
}

/** SC7 · Your weighting: 0 to 5 per scope. It changes the caller's sort only, never a score. */
export function YourWeighting({ initial, onClose, onDone, api = ventureScoresApi }) {
  const [w, setW] = useState(() => ({ ...equalWeights(), ...(initial || {}) }));
  const problem = weightsProblem(w);
  return (
    <Dialog title="Your weighting" sub="Set how much each scope matters to you, from 0 to 5. A scope at 0 is left out of your sort." testId="scorecard-weighting"
      button="Save weighting" problem={problem} width={640} foot="Your weighting changes your sort only. It never changes a venture’s score."
      onClose={onClose} onDone={onDone} run={() => api.saveWeights(isEqual(w) ? null : w)}>
      <div className="flex items-center justify-between">
        <span className={EYE}>Weights · 0 to {WEIGHT_MAX}</span>
        <button type="button" className="text-[12.5px] font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => setW(equalWeights())} data-testid="scorecard-weighting-reset">Reset to equal</button>
      </div>
      {SCOPES.map((s) => (
        <label key={s.key} className="grid grid-cols-[minmax(0,1fr)_160px_24px] items-center gap-3">
          <span>{s.label}</span>
          <input type="range" min={0} max={WEIGHT_MAX} step={1} value={w[s.key]} aria-label={`${s.label} weight`}
            onChange={(e) => setW((x) => ({ ...x, [s.key]: Number(e.target.value) }))} data-testid={`scorecard-weight-${s.key}`} />
          <span className="text-right font-mono font-bold">{w[s.key]}</span>
        </label>
      ))}
      <p className={SUB}>No total is computed or shown. Equal weights save as no weighting.</p>
    </Dialog>
  );
}

/** A sharing change, said before it is made: who gains or loses access. */
export function SharingChange({ projectId, current, next, candidates, onClose, onDone, api = ventureScoresApi }) {
  const lines = sharingChange(current, next, candidates);
  return (
    <Dialog title="Change who sees your scorecard?" testId="scorecard-sharing" button="Save" problem={lines.length ? null : 'Nothing changes.'}
      onClose={onClose} onDone={onDone} run={() => api.saveSharing(projectId, next)}>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5" data-testid="scorecard-sharing-lines">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className={SUB}>Investors outside your deal flow see nothing either way. Every change is recorded.</p>
    </Dialog>
  );
}
