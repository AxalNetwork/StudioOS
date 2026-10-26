/**
 * D1252 (#3267) — the reviewer's view of a case (DDL12b, DDL18c). On a case
 * read scoped to the viewer's sections (`case.scoped`, `routes/dd.ts`), the
 * banner, then for each of their sections the steps: sign the NDA, declare
 * conflicts, work the checklist and record the verdict. The NDA and the
 * conflicts are each an in-page dialog that says what it changes; the Worker
 * decides both (`POST …/nda`, `POST …/conflicts`). A read that is not scoped
 * is the deal team's, and draws none of this.
 */
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Info, Lock } from 'lucide-react';
import { dd } from '../../lib/api';
import { ddDeskApi } from '../../lib/api/ddDesk';
import { useAuth } from '../../hooks/useAuthSync';
import { caseHref } from './ddModel';
import { reviewerView } from './ddReviewModel';
import { Dialog, Note, Refusal, cardCls, fieldCls, inputCls, muted, useSend } from './DdUi';

const STEP_BTN = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 sm:min-h-[34px] sm:w-fit dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** Upload the signed NDA for one section. PDF, up to 10 MB; the Worker checks both. */
function NdaDialog({ uid, sectionId, title, onClose, onDone, upload = dd.uploadNda }) {
  const file = useRef(null);
  const [picked, setPicked] = useState(null);
  const { busy, error, setError, send } = useSend();
  const submit = () => {
    if (!picked) { setError('Choose your signed NDA, a PDF up to 10 MB.'); return; }
    send(async () => { await upload(uid, sectionId, picked); onDone('Your NDA is on file.'); }, 'The NDA could not be uploaded.');
  };
  return (
    <Dialog title={`Upload your signed NDA · ${title}`} sub="It is kept on the case, and only the deal team and you can open it." testId="dd-reviewer-nda" action="Upload NDA" busy={busy} onClose={onClose} onSubmit={submit}>
      <label className={fieldCls}>Signed NDA (PDF, up to 10 MB)
        <input ref={file} type="file" accept="application/pdf" className={`${inputCls} mt-1`} onChange={(e) => setPicked(e.target.files?.[0] || null)} data-testid="dd-reviewer-nda-file" />
      </label>
      <Note>Recorded on the case’s activity: who uploaded it and when.</Note>
      <Refusal text={error} testId="dd-reviewer-nda-error" />
    </Dialog>
  );
}

/** Declare conflicts for one section. A declaration needs words; the case lead is told. */
function ConflictsDialog({ uid, sectionId, subject, onClose, onDone, declare = ddDeskApi.conflicts }) {
  const [choice, setChoice] = useState('none');
  const [note, setNote] = useState('');
  const { busy, error, setError, send } = useSend();
  const submit = () => {
    const declared = choice === 'declared';
    if (declared && !note.trim()) { setError('Say what the interest is. The case lead reads it.'); return; }
    send(async () => { await declare(uid, sectionId, declared, declared ? note.trim() : ''); onDone(declared ? 'Your declaration is recorded. The case lead is told.' : 'Recorded: no conflict.'); }, 'The declaration could not be recorded.');
  };
  return (
    <Dialog title="Declare conflicts" sub={`Any interest in ${subject}: a holding, a role, a relationship.`} testId="dd-reviewer-conflicts" action="Record" busy={busy} onClose={onClose} onSubmit={submit}>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="sr-only">Conflicts</legend>
        <label className="flex min-h-[44px] items-center gap-2 text-[13px]"><input type="radio" name="dd-conflicts" checked={choice === 'none'} onChange={() => setChoice('none')} data-testid="dd-reviewer-conflicts-none" />I have no conflict</label>
        <label className="flex min-h-[44px] items-center gap-2 text-[13px]"><input type="radio" name="dd-conflicts" checked={choice === 'declared'} onChange={() => setChoice('declared')} data-testid="dd-reviewer-conflicts-declared" />I have an interest to declare</label>
      </fieldset>
      {choice === 'declared' && (
        <label className={fieldCls}>What it is
          <textarea rows={3} className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="dd-reviewer-conflicts-note" />
        </label>
      )}
      <Note>Kept encrypted on the case. The case lead is told in their bell; the deal team and you can read it.</Note>
      <Refusal text={error} testId="dd-reviewer-conflicts-error" />
    </Dialog>
  );
}

export default function DdReviewerPanel({ data, uid, base, onChanged, viewerId }) {
  const auth = useAuth();
  const userId = viewerId ?? auth?.user?.id;
  const view = reviewerView(data, userId);
  const [dialog, setDialog] = useState(null);
  const [done, setDone] = useState(null);
  if (!view) return null;
  const finish = (line) => { setDialog(null); setDone(line); onChanged?.(); };
  return (
    <div className="mb-5 flex flex-col gap-3" data-testid="dd-reviewer">
      <div role="note" className="flex items-start gap-2.5 rounded-[10px] border border-violet-200 bg-violet-50 px-3.5 py-3 text-[13.5px] text-gray-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="dd-reviewer-banner">
        <Info size={16} className="mt-0.5 flex-none text-violet-700 dark:text-violet-300" aria-hidden="true" />
        <span>{view.banner}</span>
      </div>
      {done && <p role="status" className="m-0 text-[12.5px] text-emerald-800 dark:text-emerald-300" data-testid="dd-reviewer-done">{done}</p>}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          {view.cards.map((c) => (
            <section key={c.sectionId} className={`${cardCls} p-4`} data-testid={`dd-reviewer-steps-${c.sectionId}`}>
              <h3 className="m-0 text-[15px] font-bold text-gray-900 dark:text-gray-100">Your steps · {c.title}</h3>
              <ol className="m-0 mt-2 flex list-none flex-col p-0">
                {c.steps.map((s, i) => (
                  <li key={s.key} className={`flex gap-2.5 py-2.5 ${i ? 'border-t border-axal-hairline dark:border-gray-800' : ''}`} data-testid={`dd-reviewer-step-${c.sectionId}-${s.key}`}>
                    <span aria-hidden="true" className={`grid h-6 w-6 flex-none place-items-center rounded-full font-mono text-[12px] font-bold ${s.done
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : c.current === s.key ? 'bg-violet-600 text-white dark:bg-violet-500' : 'border border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>
                      {s.done ? <Check size={12} /> : i + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100">{s.title}{s.done ? <span className="sr-only"> (done)</span> : null}</span>
                      <span className={`text-[12px] ${muted}`}>{s.sub}</span>
                      {!s.done && s.key === 'nda' && <button type="button" className={STEP_BTN} onClick={() => setDialog({ kind: 'nda', c })} data-testid={`dd-reviewer-nda-open-${c.sectionId}`}>Upload signed NDA</button>}
                      {!s.done && s.key === 'conflicts' && <button type="button" className={STEP_BTN} onClick={() => setDialog({ kind: 'conflicts', c })} data-testid={`dd-reviewer-conflicts-open-${c.sectionId}`}>Declare conflicts</button>}
                      {!s.done && s.key === 'work' && !c.observer && (
                        <Link to={`${caseHref(base, uid, 'overview')}?section=${encodeURIComponent(c.sectionId)}`} className={STEP_BTN} data-testid={`dd-reviewer-work-${c.sectionId}`}>Go to your section</Link>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <section className={`${cardCls} p-4`} data-testid="dd-reviewer-subject">
          <h3 className="m-0 text-[15px] font-bold text-gray-900 dark:text-gray-100">Subject</h3>
          <div className="mt-1 font-bold text-gray-900 dark:text-gray-100">{view.subject}</div>
          <div className={`mt-2.5 flex items-center gap-1.5 rounded-[10px] border border-dashed border-axal-hairline px-3 py-2.5 text-[12.5px] dark:border-gray-700 ${muted}`}>
            <Lock size={12} aria-hidden="true" />{view.hidden}
          </div>
        </section>
      </div>
      {dialog?.kind === 'nda' && <NdaDialog uid={uid} sectionId={dialog.c.sectionId} title={dialog.c.title} onClose={() => setDialog(null)} onDone={finish} />}
      {dialog?.kind === 'conflicts' && <ConflictsDialog uid={uid} sectionId={dialog.c.sectionId} subject={view.subject} onClose={() => setDialog(null)} onDone={finish} />}
    </div>
  );
}
