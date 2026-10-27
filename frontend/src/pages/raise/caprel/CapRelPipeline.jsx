import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { cyclesApi, cyclesWrite } from '../../../lib/api/cycles';
import { Lightbox, Unreadable } from '../../../ui';
import { RecordFacts, RecordSection } from '../../cycles/RecordView';
import { recordHref } from '../../cycles/recordModel';
import { parseCsv } from '../../RaisePipelinePage';
import {
  IMPORT_CHUNK, NO_STATUS, PASSED, SLUG, STAGES, STAGE_LABEL, STATUS_OPTIONS, amountText, asksStatus, boardColumns, chunks,
  importRows, mergeImport, moveBody, moveSentence, moveTargets, stageLabel, statusCounts, statusLabel, tabSearch,
} from './capRelModel';
import CapRelProposals from './CapRelProposals';

/**
 * D1192 (#3126) — Capital relationships' Pipeline (CRL2 the board, CRL3 the
 * list), the investor lightbox (CRL4), Add investor and Import (CRL5), and the
 * step, next step, status and feedback dialogs (CRL6).
 *
 * READS. The venture's prospects (`api.raiseProspects`, the pipeline's own
 * read) and, in the lightbox, the investor's record
 * (`cyclesApi.record('raise', …, 'capital-relationships', id)`).
 * WRITES. Every one through `services/raiseWriters.ts`: a move and a status
 * through `PATCH /cycles/raise/prospects/:id`, Add through `POST
 * /cycles/raise/prospects`, Import through `POST /cycles/raise/prospects/import`
 * (50 rows a request), a next step through `PUT …/next-step`, and a step and
 * feedback through the record's own actions (`log`, `add-feedback`). Every
 * change opens an in-page dialog that says what it changes.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold disabled:opacity-50';
const BTN_P = `${BTN} border-axal-violet bg-axal-violet text-white hover:bg-violet-700 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const BTN_S = `${BTN} border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200';
const NR = 'rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';

export const errText = (e, fallback) => (e?.status === 409 ? 'Already in the pipeline: this venture tracks an investor with that email.' : (e?.message || fallback));
export const nameOf = (p) => [p?.name, p?.firm && p.firm !== p.name ? p.firm : null].filter(Boolean).join(' · ') || 'Investor';

/** The prospects read, with a reload. */
export function useProspects(projectId) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', items: null });
  useEffect(() => {
    let alive = true;
    setRead((r) => ({ status: 'loading', items: r.items }));
    Promise.resolve().then(() => api.raiseProspects(projectId))
      .then((d) => { if (alive) setRead({ status: 'ready', items: Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [] }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', items: null }); });
    return () => { alive = false; };
  }, [projectId, n]);
  return { ...read, reload: () => setN((x) => x + 1) };
}

/* ------------------------------------------------------------------ *
 * Dialogs (CRL6, CRL5)
 * ------------------------------------------------------------------ */

export function Dialog({ label, title, sub, onClose, children, footer, testId, width = 520 }) {
  return (
    <Lightbox label={label} title={title} sub={sub} onClose={onClose} testId={testId} width={width}
      footer={footer}>{children}</Lightbox>
  );
}

export function Footer({ busy, error, onClose, cta, onGo, disabled, testId }) {
  return (
    <div className="flex flex-col gap-2">
      {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={BTN_P} onClick={onGo} disabled={busy || disabled} data-testid={`${testId}-go`}>{busy ? 'Saving…' : cta}</button>
      </div>
    </div>
  );
}

/** Run a write; close on success, keep the dialog open with the reason on failure. */
export function useWrite(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, fallback) => {
    setBusy(true); setError('');
    try { const out = await fn(); setBusy(false); onDone?.(out); return out; } catch (e) { setBusy(false); setError(errText(e, fallback)); return null; }
  };
  return { busy, error, run };
}

/** Move one investor or several (CRL6's status dialog when the target is Committed). */
export function MoveDialog({ projectId, prospects, to: initialTo, onClose, onDone }) {
  const [to, setTo] = useState(initialTo || '');
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState([]);
  const w = useWrite();
  const from = prospects.length === 1 ? prospects[0].stage : null;
  const status_ = to === 'committed' && prospects.some((p) => asksStatus(p.stage, to));
  const go = async () => {
    const bad = [];
    for (const p of prospects) {
      const ok = await w.run(() => cyclesWrite.raise.prospectUpdate(projectId, p.id, moveBody(to, status || null)), 'This move could not be saved');
      if (!ok) bad.push(nameOf(p));
    }
    setFailed(bad);
    if (!bad.length) { onDone?.(); onClose(); } else onDone?.();
  };
  return (
    <Dialog label="Move investors" testId="caprel-move-dialog" onClose={onClose}
      title={prospects.length === 1 ? `Move ${nameOf(prospects[0])}` : `Move ${prospects.length} investors`}
      sub={to ? moveSentence(prospects.map(nameOf), from, to) : 'Choose where they move.'}
      footer={<Footer testId="caprel-move" busy={w.busy} error={failed.length ? `Not moved: ${failed.join(', ')}. ${w.error}` : ''} onClose={onClose} cta="Move" onGo={go} disabled={!to} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>Move to
          <select className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} data-testid="caprel-move-to">
            <option value="">Choose a stage</option>
            {moveTargets(from).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        {status_ ? (
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="caprel-status-field">
            <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">What did they commit?</legend>
            {[...STATUS_OPTIONS, { value: '', label: NO_STATUS, counts: false }].map((o) => (
              <label key={o.value || 'none'} className={`flex items-center gap-2 text-[13px] ${INK}`}>
                <input type="radio" name="caprel-status" value={o.value} checked={status === o.value} onChange={() => setStatus(o.value)} data-testid={`caprel-status-${o.value || 'none'}`} />
                {o.label}<span className={`text-[11.5px] ${MUTED}`}>{o.counts ? 'counts as committed' : 'not counted'}</span>
              </label>
            ))}
            <p className={`m-0 text-[12px] ${MUTED}`}>Only Signed and Wired count toward the round. Eadwyn never sets a status or an amount.</p>
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}

/** A committed investor's status on its own (CRL6). */
export function StatusDialog({ projectId, prospect, onClose, onDone }) {
  const [status, setStatus] = useState(prospect.commit_status || '');
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Commitment status" testId="caprel-status-dialog" onClose={onClose} title={`${nameOf(prospect)}'s commitment`}
      sub={`The status changes from ${statusLabel(prospect.commit_status)} to ${status ? statusLabel(status) : NO_STATUS}.`}
      footer={<Footer testId="caprel-status" busy={w.busy} error={w.error} onClose={onClose} cta="Save status"
        onGo={() => w.run(() => cyclesWrite.raise.prospectUpdate(projectId, prospect.id, { commit_status: status || null }), 'The status could not be saved')} />}>
      <div className="flex flex-col gap-1.5">
        {[...STATUS_OPTIONS, { value: '', label: NO_STATUS }].map((o) => (
          <label key={o.value || 'none'} className={`flex items-center gap-2 text-[13px] ${INK}`}>
            <input type="radio" name="caprel-status-only" checked={status === o.value} onChange={() => setStatus(o.value)} />{o.label}
          </label>
        ))}
      </div>
    </Dialog>
  );
}

/** Set the next step (CRL6). */
export function NextStepDialog({ projectId, prospect, onClose, onDone }) {
  const [step, setStep] = useState(prospect.next_step || '');
  const [due, setDue] = useState(prospect.next_step_due ? String(prospect.next_step_due).slice(0, 10) : '');
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Next step" testId="caprel-next-dialog" onClose={onClose} title={`Next step with ${nameOf(prospect)}`}
      sub={step ? `The next step becomes “${step}”${due ? `, due ${due}` : ', with no date'}.` : 'An empty step clears it.'}
      footer={<Footer testId="caprel-next" busy={w.busy} error={w.error} onClose={onClose} cta="Save next step"
        onGo={() => w.run(() => cyclesWrite.raise.prospectNextStep(projectId, prospect.id, { next_step: step || null, next_step_due: due || null, warm_path: prospect.warm_path ?? null }), 'The next step could not be saved')} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>Next step<input className={FIELD} value={step} maxLength={300} onChange={(e) => setStep(e.target.value)} data-testid="caprel-next-step" /></label>
        <label className={LABEL}>Due<input className={FIELD} type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="caprel-next-due" /></label>
      </div>
    </Dialog>
  );
}

const STEP_KINDS = [['meeting', 'Meeting'], ['call', 'Call'], ['email', 'Email'], ['intro', 'Intro'], ['note', 'Note']];

/** Log a step (CRL6): the record's own Log action. */
export function StepDialog({ projectId, prospect, onClose, onDone }) {
  const [kind, setKind] = useState('meeting');
  const [note, setNote] = useState('');
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Log a step" testId="caprel-step-dialog" onClose={onClose} title={`Log a step with ${nameOf(prospect)}`}
      sub={`A ${STEP_KINDS.find(([k]) => k === kind)?.[1].toLowerCase()} on ${on || 'no date'} is added to the timeline. A later date is due, not done.`}
      footer={<Footer testId="caprel-step" busy={w.busy} error={w.error} onClose={onClose} cta="Log step" disabled={!on}
        onGo={() => w.run(() => cyclesApi.recordAction('raise', projectId, SLUG, prospect.id, 'log', { kind, note: note || undefined, on }), 'The step could not be logged')} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>What
          <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="caprel-step-kind">
            {STEP_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={LABEL}>Note<input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className={LABEL}>On<input className={FIELD} type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
    </Dialog>
  );
}

/** Add feedback (CRL6): the record's own Add feedback action. */
export function FeedbackDialog({ projectId, prospect, onClose, onDone }) {
  const [objection, setObjection] = useState('');
  const [answer, setAnswer] = useState('');
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Add feedback" testId="caprel-feedback-dialog" onClose={onClose} title={`Feedback from ${nameOf(prospect)}`}
      sub="What they said is added to the record's feedback, with your answer if you have one."
      footer={<Footer testId="caprel-feedback" busy={w.busy} error={w.error} onClose={onClose} cta="Add feedback" disabled={!objection.trim()}
        onGo={() => w.run(() => cyclesApi.recordAction('raise', projectId, SLUG, prospect.id, 'add-feedback', { objection, answer: answer || undefined }), 'The feedback could not be added')} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>What they said<textarea className={FIELD} rows={3} value={objection} onChange={(e) => setObjection(e.target.value)} data-testid="caprel-feedback-said" /></label>
        <label className={LABEL}>Your answer<textarea className={FIELD} rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
      </div>
    </Dialog>
  );
}

/** Add investor (CRL5): a duplicate email is answered inline, and the dialog stays open. */
export function AddDialog({ projectId, onClose, onDone, fund = null }) {
  // D1193 (CRL7): Add to pipeline from Match opens this with the fund filled in, tracked by its directory id.
  const [f, setF] = useState({ name: fund?.name || '', firm: fund?.name || '', email: '', stage: 'to_contact' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const w = useWrite(() => { onDone?.(); onClose(); });
  return (
    <Dialog label="Add investor" testId="caprel-add-dialog" onClose={onClose} title="Add investor"
      sub={f.name.trim() ? `${f.name.trim()} is added at ${STAGE_LABEL[f.stage]}.` : 'Name the investor, or give an email.'}
      footer={<Footer testId="caprel-add" busy={w.busy} error={w.error} onClose={onClose} cta="Add investor" disabled={!f.name.trim() && !f.email.trim()}
        onGo={() => w.run(() => cyclesWrite.raise.prospect(projectId, fund?.uid
          ? { research_fund_uid: fund.uid, email: f.email.trim() || undefined, stage: f.stage }
          : { name: f.name.trim() || undefined, firm: f.firm.trim() || undefined, email: f.email.trim() || undefined, stage: f.stage }), 'The investor could not be added')} />}>
      <div className="flex flex-col gap-3">
        <label className={LABEL}>Investor<input className={FIELD} value={f.name} onChange={set('name')} data-testid="caprel-add-name" /></label>
        <label className={LABEL}>Firm<input className={FIELD} value={f.firm} onChange={set('firm')} /></label>
        <label className={LABEL}>Email<input className={FIELD} type="email" value={f.email} onChange={set('email')} data-testid="caprel-add-email" /></label>
        <label className={LABEL}>Stage
          <select className={FIELD} value={f.stage} onChange={set('stage')}>{[...STAGES, PASSED].map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
        </label>
      </div>
    </Dialog>
  );
}

/** Import (CRL5): the column map, a preview, then the rows in chunks of 50, and every skipped row with why. */
export function ImportDialog({ projectId, onClose, onDone }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (text.trim() ? importRows(parseCsv(text)) : null), [text]);
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setText).catch(() => setText(''));
  };
  const go = async () => {
    setBusy(true);
    const answers = [];
    for (const part of chunks(parsed.rows, IMPORT_CHUNK)) {
      try { answers.push(await cyclesWrite.raise.prospectsImport(projectId, part)); }
      catch (e) { answers.push({ failed: true, count: part.length, reason: e?.message || 'This part of the file could not be sent' }); }
    }
    setBusy(false);
    setResult(mergeImport(answers, IMPORT_CHUNK));
    onDone?.();
  };
  return (
    <Dialog label="Import investors" testId="caprel-import-dialog" onClose={onClose} width={640} title="Import investors from a CSV"
      sub="The header row names the columns: name or email, and firm, amount, stage and notes if you have them. Rows go 50 at a time."
      footer={result ? <div className="flex justify-end"><button type="button" className={BTN_P} onClick={onClose} data-testid="caprel-import-done">Done</button></div>
        : <Footer testId="caprel-import" busy={busy} onClose={onClose} cta={parsed?.rows ? `Import ${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'}` : 'Import'} onGo={go} disabled={!parsed?.rows?.length} />}>
      {result ? (
        <div className="flex flex-col gap-2" data-testid="caprel-import-result">
          <p className={`m-0 text-[13px] font-semibold ${INK}`}>{result.created} of {result.total} added.</p>
          {result.skipped.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="caprel-import-skipped">
              {result.skipped.map((s) => <li key={s.row} className="text-[12.5px] text-amber-800 dark:text-amber-300">Row {s.row}: {s.reason}</li>)}
            </ul>
          ) : <p className={`m-0 text-[12.5px] ${MUTED}`}>No row was skipped.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-[12.5px]" data-testid="caprel-import-file" />
          <label className={LABEL}>Or paste the CSV<textarea className={`${FIELD} font-mono`} rows={5} value={text} onChange={(e) => setText(e.target.value)} data-testid="caprel-import-text" /></label>
          {parsed?.error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="caprel-import-parse-error">{parsed.error}</p> : null}
          {parsed?.rows ? (
            <div className="flex flex-col gap-1.5" data-testid="caprel-import-preview">
              <p className={`m-0 text-[12.5px] ${INK}`}>Columns: {parsed.mapped.map((m) => `${m.column} → ${m.field}`).join(', ')}{parsed.ignored.length ? `. Not imported: ${parsed.ignored.join(', ')}` : ''}.</p>
              <p className={`m-0 text-[12.5px] ${MUTED}`}>{parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'}; the first: {parsed.rows.slice(0, 3).map((r) => r.name || r.email || '(empty)').join(', ')}.</p>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The investor lightbox (CRL4)
 * ------------------------------------------------------------------ */

export function InvestorLightbox({ projectId, prospect, search = '', onClose, onChanged }) {
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', record: null });
  const [dialog, setDialog] = useState(null);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', record: null });
    Promise.resolve().then(() => cyclesApi.record('raise', projectId, SLUG, prospect.id))
      .then((d) => { if (alive) setRead({ status: 'ready', record: d?.record || d }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', record: null }); });
    return () => { alive = false; };
  }, [projectId, prospect.id, n]);
  const done = () => { setN((x) => x + 1); onChanged?.(); };
  const rec = read.record;
  const committed = prospect.stage === 'committed';
  const props = { projectId, prospect, onClose: () => setDialog(null), onDone: done };
  return (
    <>
      <Lightbox label={nameOf(prospect)} testId="caprel-investor" onClose={onClose} width={860} eyebrow={stageLabel(prospect.stage)} title={nameOf(prospect)}
        sub={committed ? `Commitment: ${statusLabel(prospect.commit_status)}${amountText(prospect.amount) ? ` · ${amountText(prospect.amount)}` : ' · Amount not recorded'}` : (prospect.next_step ? `Next: ${prospect.next_step}${prospect.next_step_due ? ` · ${String(prospect.next_step_due).slice(0, 10)}` : ''}` : 'No next step set')}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" data-testid="caprel-investor-actions">
            <button type="button" className={BTN_S} onClick={() => setDialog('step')} data-testid="caprel-investor-step">Log a step</button>
            <button type="button" className={BTN_S} onClick={() => setDialog('next')} data-testid="caprel-investor-next">Next step</button>
            <button type="button" className={BTN_S} onClick={() => setDialog('move')} data-testid="caprel-investor-move">Move to…</button>
            {committed ? <button type="button" className={BTN_S} onClick={() => setDialog('status')} data-testid="caprel-investor-status">Status</button> : null}
            <button type="button" className={BTN_S} onClick={() => setDialog('feedback')} data-testid="caprel-investor-feedback">Add feedback</button>
            {/* D1193 (CRL11): Eadwyn proposes next steps and moves from this investor's newest note. */}
            <button type="button" className={BTN_S} onClick={() => setDialog('eadwyn')} data-testid="caprel-investor-eadwyn">Ask Eadwyn</button>
            <Link className={`${BTN_S} no-underline`} to={recordHref('raise', SLUG, prospect.id, tabSearch(search))} data-testid="caprel-investor-open">Open the full record</Link>
          </div>
          {read.status === 'loading' ? <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="caprel-investor-loading" /> : null}
          {read.status === 'unreadable' ? <Unreadable what="This investor's record" claim="The pipeline card above still holds what it shows." onRetry={() => setN((x) => x + 1)} /> : null}
          {rec ? (
            <div className="flex flex-col gap-3" data-testid="caprel-investor-record">
              <RecordFacts facts={rec.facts || []} />
              {[...(rec.main || []), ...(rec.side || [])].map((s) => <RecordSection key={s.key || s.title} section={s} side cycleName="Raise" moduleName="Capital relationships" />)}
            </div>
          ) : null}
        </div>
      </Lightbox>
      {dialog === 'step' ? <StepDialog {...props} /> : null}
      {dialog === 'next' ? <NextStepDialog {...props} /> : null}
      {dialog === 'feedback' ? <FeedbackDialog {...props} /> : null}
      {dialog === 'eadwyn' ? <CapRelProposals projectId={projectId} prospect={{ id: prospect.id, name: nameOf(prospect) }} onClose={() => setDialog(null)} onChanged={done} /> : null}
      {dialog === 'status' ? <StatusDialog {...props} /> : null}
      {dialog === 'move' ? <MoveDialog projectId={projectId} prospects={[prospect]} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The board (CRL2) and the list (CRL3)
 * ------------------------------------------------------------------ */

function Card({ p, onOpen, onMove }) {
  const committed = p.stage === 'committed';
  return (
    <li className={`${CARD} flex flex-col gap-1.5 px-3 py-2.5`} data-testid={`caprel-card-${p.id}`}>
      <button type="button" className={`m-0 border-0 bg-transparent p-0 text-left text-[13px] font-bold ${INK} hover:underline`} onClick={() => onOpen(p)}>{nameOf(p)}</button>
      {committed ? (
        <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {p.commit_status ? <span className={`font-semibold ${statusCounts(p.commit_status) ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>{statusLabel(p.commit_status)}</span> : <span className={NR}>{NO_STATUS}</span>}
          <span className={MUTED}>{amountText(p.amount) || 'Amount not recorded'}</span>
        </span>
      ) : null}
      <span className={`text-[12px] ${MUTED}`}>{p.next_step ? `Next: ${p.next_step}${p.next_step_due ? ` · ${String(p.next_step_due).slice(0, 10)}` : ''}` : 'No next step set'}</span>
      <label className="sr-only" htmlFor={`caprel-move-${p.id}`}>Move {nameOf(p)} to</label>
      <select id={`caprel-move-${p.id}`} className="w-full rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        value="" onChange={(e) => { if (e.target.value) onMove(p, e.target.value); }} data-testid={`caprel-card-move-${p.id}`}>
        <option value="">Move to…</option>
        {moveTargets(p.stage).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
      </select>
    </li>
  );
}

function Board({ cols, onOpen, onMove, phone }) {
  const [showPassed, setShowPassed] = useState(false);
  const [one, setOne] = useState(STAGES[0]);
  const visible = phone ? cols.columns.filter((c) => c.stage === one) : cols.columns;
  return (
    <div className="flex flex-col gap-3" data-testid="caprel-board">
      {phone ? (
        <label className={LABEL}>Stage
          <select className={FIELD} value={one} onChange={(e) => setOne(e.target.value)} data-testid="caprel-board-stage">
            {cols.columns.map((c) => <option key={c.stage} value={c.stage}>{c.label} · {c.items.length}</option>)}
          </select>
        </label>
      ) : null}
      <div className={phone ? 'flex flex-col gap-3' : 'grid gap-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]'}>
        {visible.map((c) => (
          <section key={c.stage} className="flex min-w-0 flex-col gap-2 rounded-xl bg-gray-50 p-2.5 dark:bg-gray-950" data-testid={`caprel-col-${c.stage}`}>
            <h3 className={`m-0 flex items-center justify-between text-[12px] font-extrabold uppercase tracking-[.06em] ${MUTED}`}>{c.label}<span className="font-mono">{c.items.length}</span></h3>
            {c.items.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{c.items.map((p) => <Card key={p.id} p={p} onOpen={onOpen} onMove={onMove} />)}</ul>
              : <p className={`m-0 text-[12px] ${MUTED}`}>No investor here.</p>}
          </section>
        ))}
        {!phone ? (
          <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-gray-300 p-2.5 dark:border-gray-700" data-testid="caprel-col-passed">
            <button type="button" className={`m-0 border-0 bg-transparent p-0 text-left text-[12px] font-extrabold uppercase tracking-[.06em] ${MUTED}`}
              aria-expanded={showPassed} onClick={() => setShowPassed((x) => !x)} data-testid="caprel-passed-toggle">Passed · {cols.passed.length}</button>
            {showPassed ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{cols.passed.map((p) => <Card key={p.id} p={p} onOpen={onOpen} onMove={onMove} />)}</ul> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function List({ items, onOpen, onBulk }) {
  const [picked, setPicked] = useState(() => new Set());
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex flex-col gap-2" data-testid="caprel-list">
      {picked.size ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-[12.5px] dark:bg-violet-950/40" data-testid="caprel-bulk">
          <span className={`font-semibold ${INK}`}>{picked.size} picked</span>
          <button type="button" className={BTN_S} onClick={() => onBulk(items.filter((p) => picked.has(p.id)))} data-testid="caprel-bulk-move">Move to…</button>
          <button type="button" className={BTN_S} onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
          <thead><tr className={`text-[11px] font-extrabold uppercase tracking-[.06em] ${MUTED}`}>
            <th className="w-8 px-2 py-2"><span className="sr-only">Pick</span></th>
            {['Investor', 'Stage', 'Commitment', 'Next step', 'Due'].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}
          </tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`caprel-row-${p.id}`}>
                <td className="px-2 py-2"><input type="checkbox" aria-label={`Pick ${nameOf(p)}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} data-testid={`caprel-pick-${p.id}`} /></td>
                <td className="px-2 py-2"><button type="button" className={`m-0 border-0 bg-transparent p-0 text-left font-semibold ${INK} hover:underline`} onClick={() => onOpen(p)}>{nameOf(p)}</button></td>
                <td className="px-2 py-2">{stageLabel(p.stage)}</td>
                <td className="px-2 py-2">{p.stage === 'committed' ? `${statusLabel(p.commit_status)} · ${amountText(p.amount) || 'Amount not recorded'}` : <span className={MUTED}>—</span>}</td>
                <td className="px-2 py-2">{p.next_step || <span className={MUTED}>No next step set</span>}</td>
                <td className="px-2 py-2 font-mono">{p.next_step_due ? String(p.next_step_due).slice(0, 10) : <span className={MUTED}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const usePhone = () => {
  const q = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return phone;
};

/** Pipeline (CRL2, CRL3): the board or the list, Add investor and Import, and the lightbox. */
export default function CapRelPipeline({ projectId, search = '' }) {
  const read = useProspects(projectId);
  const phone = usePhone();
  const [view, setView] = useState('board');
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const reload = useCallback(() => read.reload(), [read]);
  const items = read.items || [];
  const cols = useMemo(() => boardColumns(items), [items]);
  const onMove = (p, to) => setDialog({ kind: 'move', prospects: [p], to });
  return (
    <div className="flex flex-col gap-4" data-testid="caprel-pipeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-axal-hairline p-0.5 text-[12px] font-semibold dark:border-gray-700" role="radiogroup" aria-label="Show as">
          {[['board', 'Board'], ['list', 'List']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} data-testid={`caprel-view-${k}`}
              className={view === k ? 'rounded-md bg-violet-50 px-2.5 py-1 text-axal-ink dark:bg-violet-950 dark:text-gray-100' : `rounded-md px-2.5 py-1 ${MUTED}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'proposals' })} data-testid="caprel-proposals-open">Eadwyn’s proposals</button>
          <button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'import' })} data-testid="caprel-import">Import</button>
          <button type="button" className={BTN_P} onClick={() => setDialog({ kind: 'add' })} data-testid="caprel-add">Add investor</button>
        </div>
      </div>

      {read.status === 'loading' && !read.items ? (
        <div className="grid gap-3 lg:grid-cols-5" data-testid="caprel-pipeline-loading">{STAGES.map((s) => <div key={s} className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}</div>
      ) : null}
      {read.status === 'unreadable' ? <Unreadable what="Your investors" claim="This is not a claim that you have none." onRetry={read.reload} /> : null}
      {read.items && items.length === 0 ? (
        <section className={`${CARD} flex flex-col items-center gap-2 px-6 py-10 text-center`} data-testid="caprel-pipeline-empty">
          <h3 className={`m-0 text-[15px] font-bold ${INK}`}>No investors yet</h3>
          <p className={`m-0 max-w-md text-[12.5px] ${MUTED}`}>Add the investors you are raising from, or import them from a CSV. Each one moves through Identified, Contacted, Meeting, Diligence and Committed.</p>
          <div className="flex gap-2"><button type="button" className={BTN_P} onClick={() => setDialog({ kind: 'add' })}>Add investor</button><button type="button" className={BTN_S} onClick={() => setDialog({ kind: 'import' })}>Import</button></div>
        </section>
      ) : null}
      {items.length && view === 'board' ? <Board cols={cols} onOpen={setOpen} onMove={onMove} phone={phone} /> : null}
      {items.length && view === 'list' ? <List items={items} onOpen={setOpen} onBulk={(ps) => setDialog({ kind: 'move', prospects: ps, to: '' })} /> : null}
      {cols.unknown.length ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="caprel-unknown-stage">{cols.unknown.length} {cols.unknown.length === 1 ? 'investor has' : 'investors have'} a stage the board does not draw; the list shows them.</p> : null}

      {open ? <InvestorLightbox projectId={projectId} prospect={items.find((p) => p.id === open.id) || open} search={search} onClose={() => setOpen(null)} onChanged={reload} /> : null}
      {dialog?.kind === 'move' ? <MoveDialog projectId={projectId} prospects={dialog.prospects} to={dialog.to} onClose={() => setDialog(null)} onDone={reload} /> : null}
      {dialog?.kind === 'add' ? <AddDialog projectId={projectId} onClose={() => setDialog(null)} onDone={reload} /> : null}
      {dialog?.kind === 'import' ? <ImportDialog projectId={projectId} onClose={() => setDialog(null)} onDone={reload} /> : null}
      {dialog?.kind === 'proposals' ? <CapRelProposals projectId={projectId} onClose={() => setDialog(null)} onChanged={reload} /> : null}
    </div>
  );
}
