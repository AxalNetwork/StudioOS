import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox';
import { actionGhost, actionPrimary } from '../../ui';
import { api as mainApi } from '../../lib/api';
import { googleWorkspace } from '../../lib/api/googleWorkspace';
import { FROM, workspaceRefusal } from '../../lib/googleWorkspaceWords';
import FromGoogle from './FromGoogle';

/**
 * D1092 (#2957), Google Workspace part 3 — From Google on Validate's three
 * modules, from the module read's `parts.from_google`
 * (`routes/cycle_validate.ts`):
 *   - Customer research: the shared section (`FromGoogle.jsx`) with the
 *     interview notes each mapped Doc became, and "Choose the interview" for a
 *     Doc not mapped yet;
 *   - Demand and urgency signals: the shared section with the signals a Form's
 *     qualifying responses became, each "To confirm" until the founder confirms
 *     it on the module, and GW5's Map a question for a Form not mapped yet;
 *   - Experiments: confirmed signals offered as evidence, each with Add as
 *     evidence (the hypothesis picker) and Dismiss.
 *
 * Every change opens an in-page dialog that says what it changes. No respondent
 * name or email is shown: the Worker never reads one. A part the viewer may
 * not read says why (`team_only`, `not_connected`); one that failed reads
 * "Unreadable" for this part only, and the module's records stay drawn.
 */

export const STATUS_WORDS = Object.freeze({ to_confirm: 'To confirm', confirmed: 'Confirmed', counted: 'Counted' });
export const DEMAND_KIND_WORDS = Object.freeze({
  waitlist: 'Waitlist', loi: 'Letter of intent', pre_sale: 'Pre-sale', need_to_have: 'Need-to-have', would_pay: 'Would pay',
});
const STRENGTHS = Object.freeze([['', 'Not recorded'], ['anecdote', 'Anecdote'], ['pattern', 'Pattern'], ['measured', 'Measured']]);

const CARD = 'flex min-w-0 flex-col gap-2 rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const AMBER = 'flex flex-wrap items-center justify-between gap-2 rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
const INPUT = 'mt-1 w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
const ALERT = 'm-0 text-[12.5px] text-red-700 dark:text-red-300';

/** The rows the shared section draws, from what landed. */
export function rowsOf(module, facts) {
  return (Array.isArray(facts) ? facts : []).map((f) => ({
    id: f.id,
    label: f.label,
    cells: module === 'demand_signals'
      ? { label: f.label, status: STATUS_WORDS[f.status] || null }
      : { label: f.label, as_of: f.as_of ? String(f.as_of).slice(0, 10) : null },
  }));
}
export const COLUMNS = Object.freeze({
  customer_research: [{ key: 'label', label: 'Interview notes' }, { key: 'as_of', label: 'Last read' }],
  demand_signals: [{ key: 'label', label: 'Signal' }, { key: 'status', label: 'Status' }],
});

/** A sync's counts, as one sentence: counts only, never a file's text. */
export function syncSentence(c) {
  if (!c) return '';
  const parts = [];
  if (c.imported) parts.push(`${c.imported} ${c.imported === 1 ? 'Doc' : 'Docs'} read into interview notes`);
  if (c.proposed_signals) parts.push(`${c.proposed_signals} ${c.proposed_signals === 1 ? 'signal' : 'signals'} to confirm`);
  if (c.offered_evidence) parts.push(`${c.offered_evidence} confirmed ${c.offered_evidence === 1 ? 'signal' : 'signals'} offered as evidence`);
  let s = parts.length ? `${parts.join(', ')}.` : 'Nothing new in your Google files.';
  if (c.unmapped) s += ` ${c.unmapped} ${c.unmapped === 1 ? 'file is' : 'files are'} not mapped yet.`;
  if (c.unreadable) s += ` ${c.unreadable} could not be read.`;
  if (c.partly) s += ' Google’s read limit was reached: Sync again to carry on.';
  return s;
}

export default function ValidateFromGoogle({ part, module, projectId, reload, api = googleWorkspace, appApi = mainApi }) {
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState(null);
  if (!part || typeof part !== 'object') return null;
  if (part.state !== 'ok') {
    return (
      <section aria-label={FROM.title} className={CARD} data-testid="validate-from-google" data-state={part.state}>
        <h3 className="m-0 text-[14px] font-extrabold">{FROM.title}</h3>
        <p className={part.state === 'unreadable' ? ALERT : MUTED} data-testid="validate-from-google-reason">
          {part.reason || 'Not recorded: the Google files could not be read.'}
          {part.state === 'unreadable' && reload ? <> <button type="button" className="underline" onClick={reload} data-testid="validate-from-google-retry">Try again</button></> : null}
        </p>
        {part.href ? <Link to={part.href} className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300 dark:hover:underline">Open the Google Workspace page ›</Link> : null}
      </section>
    );
  }
  const sync = async () => {
    const counts = await api.validate.sync(projectId);
    setNote(syncSentence(counts));
    reload?.();
  };
  const done = (msg) => { setDialog(null); if (msg) setNote(msg); reload?.(); };

  if (module === 'experiments') {
    return (
      <>
        <EvidenceOffers proposals={part.proposals} onSync={sync} note={note} setNote={setNote}
          onAccept={(p) => setDialog({ kind: 'accept', p })}
          onDismiss={async (p) => {
            try { await api.validate.dismiss(projectId, p.id); done('Dismissed. It is not offered again.'); } catch (e) { setNote(workspaceRefusal(e)); }
          }} />
        {dialog?.kind === 'accept' && (
          <AcceptEvidenceDialog proposal={dialog.p} projectId={projectId} api={api} appApi={appApi}
            onClose={() => setDialog(null)} onDone={() => done('Added as evidence.')} />
        )}
      </>
    );
  }

  const unmapped = (part.files || []).filter((f) => !f.mapped && f.status !== 'unreadable');
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="validate-from-google" data-state="ok">
      {unmapped.map((f) => (
        <div key={f.uid} className={AMBER} data-testid={`validate-from-google-unmapped-${f.uid}`}>
          <span className="min-w-0 break-words">
            “{f.name}” is not mapped yet, so nothing is read from it.
          </span>
          <button type="button" className={actionGhost} onClick={() => setDialog({ kind: module === 'customer_research' ? 'interview' : 'question', file: f })}
            data-testid={`validate-from-google-map-${f.uid}`}>
            {module === 'customer_research' ? 'Choose the interview' : 'Map a question'}
          </button>
        </div>
      ))}
      <FromGoogle project={projectId} module={module} columns={COLUMNS[module]} rows={rowsOf(module, part.facts)} deleted={Number(part.deleted) || 0}
        onSync={sync} onDeleteRow={(row) => api.validate.deleteFact(projectId, row.id)} />
      {module === 'demand_signals' && (part.facts || []).some((f) => f.status === 'to_confirm') && (
        <p className={MUTED} data-testid="validate-from-google-confirm">A signal from Google Forms counts only once you confirm it on this page.</p>
      )}
      {note ? <p className={MUTED} role="status" data-testid="validate-from-google-note">{note}</p> : null}
      {dialog?.kind === 'interview' && (
        <MapInterviewDialog file={dialog.file} projectId={projectId} api={api} appApi={appApi}
          onClose={() => setDialog(null)} onDone={() => done(`“${dialog.file.name}” is mapped. Sync from Google to read it.`)} />
      )}
      {dialog?.kind === 'question' && (
        <MapQuestionDialog file={dialog.file} projectId={projectId} api={api}
          onClose={() => setDialog(null)} onDone={(counts) => done(syncSentence(counts))} />
      )}
    </div>
  );
}

function EvidenceOffers({ proposals, onSync, onAccept, onDismiss, note, setNote }) {
  const list = Array.isArray(proposals) ? proposals : [];
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await onSync(); } catch (e) { setNote(workspaceRefusal(e)); } setBusy(false); };
  return (
    <section aria-label={FROM.title} className={CARD} data-testid="validate-from-google" data-state="ok">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[14px] font-extrabold">{FROM.title}</h3>
          <p className={MUTED}>Signals you confirmed from Google Forms, offered as evidence on a hypothesis you pick.</p>
        </div>
        <button type="button" className={actionGhost} onClick={run} disabled={busy} data-testid="validate-from-google-sync">{busy ? 'Syncing…' : FROM.sync}</button>
      </header>
      {list.length === 0
        ? <p className={MUTED} data-testid="validate-from-google-no-offers">No confirmed signal from Google Forms waits to be added as evidence.</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="validate-from-google-offers">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-axal-sm border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`validate-from-google-offer-${p.id}`}>
                <span className="min-w-0 break-words"><span className="font-semibold">{p.title}</span> <span className="text-axal-muted dark:text-gray-400">· {p.source}</span></span>
                <span className="flex gap-2">
                  <button type="button" className={actionPrimary} onClick={() => onAccept(p)} data-testid={`validate-from-google-accept-${p.id}`}>Add as evidence</button>
                  <button type="button" className={actionGhost} onClick={() => onDismiss(p)} data-testid={`validate-from-google-dismiss-${p.id}`}>Dismiss</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      {note ? <p className={MUTED} role="status" data-testid="validate-from-google-note">{note}</p> : null}
    </section>
  );
}

function Footer({ busy, onClose, onGo, go, disabled, testId }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className={actionPrimary} onClick={onGo} disabled={busy || disabled} data-testid={testId}>{go}</button>
    </div>
  );
}

/** A Customer research Doc → one of the venture's interviews. Its text becomes that interview's notes on the next sync. */
function MapInterviewDialog({ file, projectId, api, appApi, onClose, onDone }) {
  const [list, setList] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    appApi.listInterviews(projectId).then(
      (r) => { if (live) setList(Array.isArray(r?.interviews) ? r.interviews : Array.isArray(r) ? r : []); },
      () => { if (live) setList(false); },
    );
    return () => { live = false; };
  }, [appApi, projectId]);
  const go = async () => {
    setBusy(true); setError('');
    try { await api.mapping(file.uid, { interview_id: Number(pick) }); onDone(); } catch (e) { setError(workspaceRefusal(e)); setBusy(false); }
  };
  const title = `Map “${file.name}” to an interview`;
  return (
    <Lightbox label={title} title={title} sub="Its text becomes that interview’s notes when you sync. Axal VC never changes the Doc." onClose={onClose} width={500}
      testId="validate-map-interview" footer={<Footer busy={busy} onClose={onClose} onGo={go} go="Use this interview" disabled={!pick} testId="validate-map-interview-go" />}>
      <div className="flex flex-col gap-2 text-[13px]">
        {list === null && <p className={MUTED} role="status">Reading your interviews…</p>}
        {list === false && <p className={ALERT} role="alert">Your interviews could not be read.</p>}
        {Array.isArray(list) && list.length === 0 && <p className={MUTED} data-testid="validate-map-interview-none">Log the interview on Customer research first, then map the Doc to it.</p>}
        {Array.isArray(list) && list.length > 0 && (
          <label className="block font-semibold">Interview
            <select className={INPUT} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="validate-map-interview-select">
              <option value="">Choose an interview</option>
              {list.map((i) => <option key={i.id} value={i.id}>{i.interviewee_name || `Interview ${i.id}`}{i.interview_date ? ` · ${String(i.interview_date).slice(0, 10)}` : ''}</option>)}
            </select>
          </label>
        )}
        {error && <p className={ALERT} role="alert" data-testid="validate-map-interview-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

/**
 * GW5, Map a question: one of the Form's questions, the answers that count as
 * demand, and the kind of signal. The preview counts the qualifying responses
 * and stores nothing; Propose saves the mapping and syncs, so each signal
 * waits at To confirm.
 */
export function MapQuestionDialog({ file, projectId, api, onClose, onDone }) {
  const [form, setForm] = useState({ status: 'loading', questions: [] });
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState([]);
  const [kind, setKind] = useState('waitlist');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.validate.previewForm(projectId, file.uid, null).then(
      (r) => { if (live) setForm({ status: 'ready', questions: (r?.questions || []).filter((q) => Array.isArray(q.choices) && q.choices.length) }); },
      (e) => { if (live) { setForm({ status: 'unreadable', questions: [] }); setError(workspaceRefusal(e)); } },
    );
    return () => { live = false; };
  }, [api, projectId, file.uid]);
  const mapping = question && answers.length ? { question_id: question, answers, kind } : null;
  useEffect(() => {
    if (!mapping) { setCount(null); return undefined; }
    let live = true;
    setCount('reading');
    api.validate.previewForm(projectId, file.uid, mapping).then(
      (r) => { if (live) setCount({ responses: r?.responses ?? null, qualifying: r?.qualifying ?? null, capped: !!r?.capped }); },
      (e) => { if (live) { setCount(null); setError(workspaceRefusal(e)); } },
    );
    return () => { live = false; };
  }, [api, projectId, file.uid, question, answers.join('\u0000'), kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = form.questions.find((x) => x.question_id === question) || null;
  const n = count && typeof count === 'object' ? Number(count.qualifying) || 0 : 0;
  const go = async () => {
    setBusy(true); setError('');
    try { await api.mapping(file.uid, mapping); const counts = await api.validate.sync(projectId); onDone(counts); } catch (e) { setError(workspaceRefusal(e)); setBusy(false); }
  };
  const title = `Map “${file.name}” to Demand and urgency signals`;
  return (
    <Lightbox label={title} title={title}
      sub={count && typeof count === 'object' && count.responses != null ? `From Google Forms · ${count.responses} responses${count.capped ? ' read (the first 500)' : ''}` : 'From Google Forms'}
      onClose={onClose} width={560} testId="validate-map-question"
      footer={<Footer busy={busy} onClose={onClose} onGo={go} go={n ? `Propose ${n} ${n === 1 ? 'signal' : 'signals'}` : 'Propose signals'} disabled={!mapping || !n || count === 'reading'} testId="validate-map-question-go" />}>
      <div className="flex flex-col gap-3 text-[13px]">
        {form.status === 'loading' && <p className={MUTED} role="status">Reading “{file.name}”…</p>}
        {form.status === 'ready' && form.questions.length === 0 && <p className={MUTED} data-testid="validate-map-question-none">This Form has no question with choices to map.</p>}
        {form.status === 'ready' && form.questions.length > 0 && (
          <>
            <label className="block font-semibold">The question
              <select className={INPUT} value={question} onChange={(e) => { setQuestion(e.target.value); setAnswers([]); }} data-testid="validate-map-question-select">
                <option value="">Choose a question</option>
                {form.questions.map((x) => <option key={x.question_id} value={x.question_id}>{x.title || 'Untitled question'}</option>)}
              </select>
            </label>
            {q && (
              <fieldset className="m-0 border-0 p-0" data-testid="validate-map-question-answers">
                <legend className="mb-1 font-semibold">Answers that count as demand</legend>
                {q.choices.map((c) => (
                  <label key={c} className="flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={answers.includes(c)} data-testid={`validate-map-answer-${q.choices.indexOf(c)}`}
                      onChange={(e) => setAnswers((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))} />
                    <span>{c}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {q && (
              <label className="block font-semibold">Kind of signal
                <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="validate-map-question-kind">
                  {Object.entries(DEMAND_KIND_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
                </select>
              </label>
            )}
            {count === 'reading' && <p className={MUTED} role="status">Counting the responses…</p>}
            {count && typeof count === 'object' && (
              <p className="m-0 font-semibold" data-testid="validate-map-question-count">
                {n
                  ? `${n} ${n === 1 ? 'response' : 'responses'} would be proposed as demand signals to confirm.`
                  : 'No response gives these answers yet.'}
              </p>
            )}
            <p className={MUTED}>No names or emails are kept. Each signal waits for you to confirm it.</p>
          </>
        )}
        {error && <p className={ALERT} role="alert" data-testid="validate-map-question-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

/** Accept's hypothesis picker: which hypothesis the confirmed signal is evidence on, and how. */
function AcceptEvidenceDialog({ proposal, projectId, api, appApi, onClose, onDone }) {
  const [list, setList] = useState(null);
  const [pick, setPick] = useState('');
  const [direction, setDirection] = useState('supports');
  const [strength, setStrength] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    appApi.getValidationBoard(projectId).then(
      (b) => { if (live) setList((b?.hypotheses || []).filter((h) => !h.retired_at)); },
      () => { if (live) setList(false); },
    );
    return () => { live = false; };
  }, [appApi, projectId]);
  const go = async () => {
    setBusy(true); setError('');
    try {
      await api.validate.accept(projectId, proposal.id, { hypothesis_id: Number(pick), direction, ...(strength ? { strength } : {}) });
      onDone();
    } catch (e) { setError(workspaceRefusal(e)); setBusy(false); }
  };
  return (
    <Lightbox label="Add this signal as evidence" title="Add this signal as evidence" sub={`“${proposal.title}” links to the hypothesis you pick. Nothing in Google is changed.`}
      onClose={onClose} width={500} testId="validate-accept-evidence"
      footer={<Footer busy={busy} onClose={onClose} onGo={go} go="Add as evidence" disabled={!pick} testId="validate-accept-evidence-go" />}>
      <div className="flex flex-col gap-3 text-[13px]">
        {list === null && <p className={MUTED} role="status">Reading your hypotheses…</p>}
        {list === false && <p className={ALERT} role="alert">Your hypotheses could not be read.</p>}
        {Array.isArray(list) && list.length === 0 && <p className={MUTED} data-testid="validate-accept-evidence-none">Write a hypothesis on Experiments first.</p>}
        {Array.isArray(list) && list.length > 0 && (
          <>
            <label className="block font-semibold">Hypothesis
              <select className={INPUT} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="validate-accept-evidence-select">
                <option value="">Choose a hypothesis</option>
                {list.map((h) => <option key={h.id} value={h.id}>{h.code ? `${h.code} · ` : ''}{h.claim || 'Untitled hypothesis'}</option>)}
              </select>
            </label>
            <label className="block font-semibold">It
              <select className={INPUT} value={direction} onChange={(e) => setDirection(e.target.value)} data-testid="validate-accept-evidence-direction">
                <option value="supports">Supports it</option>
                <option value="contradicts">Contradicts it</option>
              </select>
            </label>
            <label className="block font-semibold">Strength
              <select className={INPUT} value={strength} onChange={(e) => setStrength(e.target.value)} data-testid="validate-accept-evidence-strength">
                {STRENGTHS.map(([k, w]) => <option key={k || 'none'} value={k}>{w}</option>)}
              </select>
            </label>
          </>
        )}
        {error && <p className={ALERT} role="alert" data-testid="validate-accept-evidence-error">{error}</p>}
      </div>
    </Lightbox>
  );
}
