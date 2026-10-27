/**
 * D1251 (#3266) — one case's dialogs (DDL14 A–H, DDL6b, DDL9b). Each says
 * what it changes and who is told before it is sent; a refusal stays in its
 * dialog in the Worker's words (`ddCaseModel.caseRefusal`). Never a browser
 * pop-up and never a toast: the page says what changed when a dialog closes.
 * The lead, the target IC date and the archive are the list's own dialogs
 * (`DdListDialogs.jsx`), opened here on the case.
 */
import React, { useEffect, useRef, useState } from 'react';
import { dd } from '../../lib/api';
import { ddDeskApi } from '../../lib/api/ddDesk.js';
import { ddFlagsApi } from '../../lib/api/ddFlags.js';
import { ddLifecycleApi } from '../../lib/api/ddLifecycle.js';
import {
  FLAG_STATES, FLAG_STATE_WORD, NOT_RECORDED, WHO, bulkPatch, canWorkFlag, caseRefusal, composeBody, decisionBody,
  decisionChoices, depthWord, flagChange, flagSourceWord, historyLines, peopleOf, personName, raiseBody, widenChoices,
} from './ddCaseModel.js';
import { SEVERITY_WORD } from './ddListModel.js';
import { Dialog, Note, Refusal, dangerCls, fieldCls, inputCls, muted, useSend } from './DdUi.jsx';

const useCaseSend = () => useSend(caseRefusal);
const today = () => new Date().toISOString().slice(0, 10);

/** A change that needs no field: what it does, who is told, then Cancel or the change. */
export function ConfirmDialog({ title, testId, lines, action, danger, run, fallback, onClose, onDone, done }) {
  const { busy, error, send } = useCaseSend();
  return (
    <Dialog title={title} testId={testId} onClose={onClose} action={action} actionCls={danger ? dangerCls : undefined} busy={busy}
      onSubmit={() => send(async () => { await run(); onDone(done); }, fallback)}>
      {lines.filter(Boolean).map((l) => <p key={l} className={`m-0 text-[13px] ${muted}`}>{l}</p>)}
      <Refusal text={error} testId={`${testId}-error`} />
    </Dialog>
  );
}

/** A. Record a section's verdict. A verdict other than N/A needs the reviewer's signed NDA on file (the Worker answers 412 without one). */
export function VerdictDialog({ uid, section, ndaOnFile, onClose, onDone }) {
  const [verdict, setVerdict] = useState(section.verdict || '');
  const [notes, setNotes] = useState(section.reviewer_notes || '');
  const [file, setFile] = useState(null);
  const [onFile, setOnFile] = useState(ndaOnFile);
  const { busy, error, setError, send } = useCaseSend();
  const submit = () => {
    if (!verdict) { setError('Choose the verdict.'); return; }
    if (verdict !== 'n_a' && !onFile && !file) { setError('Upload the signed NDA first. A verdict other than N/A needs it on file.'); return; }
    send(async () => {
      if (verdict !== 'n_a' && !onFile && file) { await dd.uploadNda(uid, section.id, file); setOnFile(true); }
      await dd.setVerdict(uid, section.id, verdict, notes.trim());
      onDone(`The verdict on ${section.title} is recorded.`);
    }, 'The verdict could not be recorded.');
  };
  return (
    <Dialog title={`Record the verdict · ${section.title}`} sub="The section is signed off in your name, and the case’s score is worked out again." testId="dd-verdict" onClose={onClose} onSubmit={submit} action="Record verdict" busy={busy}>
      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className={fieldCls}>Verdict</legend>
        {[['pass', 'Pass'], ['warn', 'Warn'], ['fail', 'Fail'], ['n_a', 'Not applicable']].map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5 text-[13px]">
            <input type="radio" name="dd-verdict" checked={verdict === k} onChange={() => setVerdict(k)} data-testid={`dd-verdict-${k}`} />{label}
          </label>
        ))}
      </fieldset>
      <label className="block"><span className={fieldCls}>Reviewer notes</span>
        <textarea rows={4} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {onFile ? <Note testId="dd-verdict-nda-on-file">A signed NDA is on file for this section.</Note> : (
        <label className="block"><span className={fieldCls}>Signed NDA (PDF, up to 10 MB)</span>
          <input type="file" accept="application/pdf" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="dd-verdict-nda" />
          <span className={`text-[12px] ${muted}`}>Needed for any verdict but N/A. It is kept on the case.</span>
        </label>
      )}
      <Refusal text={error} testId="dd-verdict-error" />
    </Dialog>
  );
}

/** B. Raise a flag by hand: a title, its section and severity; an owner from the case's team. */
export function RaiseFlagDialog({ uid, data, sectionId = '', itemId = '', onClose, onDone }) {
  const sections = (data.sections || []).filter((s) => data.allowed?.work?.[String(s.id)]);
  const people = [...peopleOf(data).entries()];
  const [f, setF] = useState({ title: '', sectionId: sectionId ? String(sectionId) : (sections.length === 1 ? String(sections[0].id) : ''), severity: '', detail: '', ownerId: '', itemId });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { busy, error, setError, send } = useCaseSend();
  const submit = () => {
    const r = raiseBody(f);
    if (r.error) { setError(r.error); return; }
    send(async () => { await ddFlagsApi.raise(uid, r.body); onDone(`The flag “${r.body.title}” is raised.`); }, 'The flag could not be raised.');
  };
  return (
    <Dialog title="Raise a flag" sub="A flag counts in the case’s score until it is closed. The owner is told in the bell." testId="dd-raise" onClose={onClose} onSubmit={submit} action="Raise flag" busy={busy}>
      <label className="block"><span className={fieldCls}>Title</span><input className={inputCls} value={f.title} onChange={set('title')} maxLength={200} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={fieldCls}>Section</span>
          <select className={inputCls} value={f.sectionId} onChange={set('sectionId')} data-testid="dd-raise-section">
            <option value="">Choose…</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label className="block"><span className={fieldCls}>Severity</span>
          <select className={inputCls} value={f.severity} onChange={set('severity')} data-testid="dd-raise-severity">
            <option value="">Choose…</option>
            {['critical', 'high', 'medium', 'low', 'info'].map((s) => <option key={s} value={s}>{SEVERITY_WORD[s]}</option>)}
          </select>
        </label>
      </div>
      <label className="block"><span className={fieldCls}>Detail (optional)</span><textarea rows={3} className={inputCls} value={f.detail} onChange={set('detail')} /></label>
      <label className="block"><span className={fieldCls}>Owner (optional)</span>
        <select className={inputCls} value={f.ownerId} onChange={set('ownerId')}>
          <option value="">No owner yet</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <Refusal text={error} testId="dd-raise-error" />
    </Dialog>
  );
}

/** C. One flag: what it is, its history, and — for who works its section — its state, owner and resolution. */
export function FlagDialog({ uid, data, flag, onClose, onDone }) {
  const people = peopleOf(data);
  const works = canWorkFlag(data, flag);
  const [state, setState] = useState(flag.state || 'open');
  const [resolution, setResolution] = useState(flag.resolution || '');
  const [ownerId, setOwnerId] = useState(flag.owner_user_id == null ? '' : String(flag.owner_user_id));
  const [history, setHistory] = useState({ items: null, failed: false });
  const { busy, error, setError, send } = useCaseSend();
  const section = (data.sections || []).find((s) => Number(s.id) === Number(flag.section_id));
  const readHistory = () => {
    if (flag.kind !== 'finding' || flag.id == null) return;
    setHistory({ items: null, failed: false });
    ddFlagsApi.history(uid, flag.id).then((r) => setHistory({ items: r?.items || [], failed: false })).catch(() => setHistory({ items: null, failed: true }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(readHistory, [uid, flag.id]);
  const submit = () => {
    if (!works) { onClose(); return; }
    const r = flagChange(flag, { state, resolution, ownerId });
    if (r.error) { setError(r.error); return; }
    send(async () => { await ddFlagsApi.change(uid, flag.id, r.body); onDone(`“${flag.title}” is updated.`); }, 'The flag could not be updated.');
  };
  return (
    <Dialog title={flag.title} sub={`${SEVERITY_WORD[flag.severity] || NOT_RECORDED} · ${section?.title || 'Case-wide'} · ${flagSourceWord(flag)}`} testId="dd-flag" onClose={onClose} onSubmit={submit} action={works ? 'Save changes' : 'Close'} busy={busy} width={620}>
      {flag.detail ? <p className="m-0 whitespace-pre-wrap text-[13px]">{flag.detail}</p> : null}
      {flag.kind === 'checklist' ? (
        <Note testId="dd-flag-checklist">This flag is a checklist item marked {flag.item_status === 'fail' ? 'Fail' : 'Flag'}. It is worked on the Checklist.{flag.severity_recorded ? '' : ' Its severity is the score’s default; none was recorded on the item.'}</Note>
      ) : works ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={fieldCls}>State</span>
              <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)} data-testid="dd-flag-state">
                {FLAG_STATES.map((s) => <option key={s} value={s}>{FLAG_STATE_WORD[s]}</option>)}
              </select>
            </label>
            <label className="block"><span className={fieldCls}>Owner</span>
              <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} data-testid="dd-flag-owner">
                <option value="">No owner</option>
                {[...people.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                {flag.owner_user_id != null && !people.has(Number(flag.owner_user_id)) ? <option value={flag.owner_user_id}>{personName(people, flag.owner_user_id)}</option> : null}
              </select>
            </label>
          </div>
          <label className="block"><span className={fieldCls}>Resolution</span>
            <textarea rows={3} className={inputCls} value={resolution} onChange={(e) => setResolution(e.target.value)} data-testid="dd-flag-resolution" />
            <span className={`text-[12px] ${muted}`}>Needed to accept or close the flag. The owner is told when it changes hands.</span>
          </label>
        </>
      ) : (
        <>
          <p className="m-0 text-[13px]">State: {FLAG_STATE_WORD[flag.state] || NOT_RECORDED} · Owner: {personName(people, flag.owner_user_id) || 'No owner'}</p>
          {flag.resolution ? <p className={`m-0 text-[13px] ${muted}`}>Resolution: {flag.resolution}</p> : null}
          <Note testId="dd-flag-who">{data.case?.status === 'archived' ? WHO.archived : WHO.work}</Note>
        </>
      )}
      {flag.kind === 'finding' && (
        <div data-testid="dd-flag-history">
          <span className={fieldCls}>History</span>
          {history.failed ? (
            <p className="m-0 text-[12.5px]">Unreadable. <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={readHistory}>Try again</button></p>
          ) : history.items == null ? <p className={`m-0 text-[12.5px] ${muted}`}>Reading…</p> : history.items.length === 0 ? (
            <p className={`m-0 text-[12.5px] ${muted}`}>Nothing recorded on this flag yet.</p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0">
              {historyLines(history.items).map((h) => <li key={h.id} className="text-[12.5px]"><span className="font-mono">{h.at}</span> · {h.who} · {h.what}</li>)}
            </ul>
          )}
        </div>
      )}
      <Refusal text={error} testId="dd-flag-error" />
    </Dialog>
  );
}

/** D. Record the decision. Proceed is not offered while a blocking section has an open High or Critical flag. */
export function DecisionDialog({ uid, data, onClose, onDone }) {
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useCaseSend();
  const choices = decisionChoices(data.sections, data.flags);
  const blocked = !choices.some((c) => c.key === 'proceed');
  const submit = () => {
    const r = decisionBody({ decision, reason }, data.sections, data.flags);
    if (r.error) { setError(r.error); return; }
    send(async () => { await ddLifecycleApi.decide(uid, r.body.decision, r.body.reason); onDone('The decision is recorded.'); }, 'The decision could not be recorded.');
  };
  return (
    <Dialog title={`Record the decision on ${data.case.subject_label}`} sub="The decision, its reason and your name are kept on the case. Section reviewers see the decision, never its reason." testId="dd-decide" onClose={onClose} onSubmit={submit} action="Record decision" busy={busy}>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={fieldCls}>Decision</legend>
        {choices.map((c) => (
          <label key={c.key} className="flex items-start gap-2 text-[13px]">
            <input type="radio" name="dd-decide" checked={decision === c.key} onChange={() => setDecision(c.key)} data-testid={`dd-decide-${c.key}`} />
            <span>{c.label}{c.sub ? <span className={`block text-[12px] ${muted}`}>{c.sub}</span> : null}</span>
          </label>
        ))}
      </fieldset>
      {blocked ? <Note tone="warn" testId="dd-decide-blocked">A blocking section has an open High or Critical flag, so Proceed is not offered.</Note> : null}
      <label className="block"><span className={fieldCls}>Reason</span><textarea rows={3} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Refusal text={error} testId="dd-decide-error" />
    </Dialog>
  );
}

/** F. Notify the founder: they are told a report exists, never what it says. */
export function NotifyFounderDialog({ uid, subject, onClose, onDone }) {
  return (
    <ConfirmDialog title={`Notify the founder of ${subject}`} testId="dd-notify" action="Notify founder" onClose={onClose} onDone={onDone}
      lines={['The founder is told, in the bell and by email, that a diligence report on their company is ready.', 'They do not see the report, the findings or the verdicts.']}
      run={() => dd.shareReport(uid)} fallback="The founder could not be notified." done="The founder is notified." />
  );
}

/** G. Generate a report (`generate` is the page's call, so the Admin rail's list reads it there). It asks for your authenticator code first if your session has not had one recently. */
export function ReportDialog({ generate, onClose, onDone }) {
  const { busy, error, send } = useCaseSend();
  const submit = () => send(async () => {
    const r = await generate();
    if (r?.download_url) window.open(r.download_url, '_blank', 'noopener,noreferrer');
    onDone(`A report is generated${r?.format ? ` (${String(r.format).toUpperCase()})` : ''}.`);
  }, 'The report could not be generated.');
  return (
    <Dialog title="Generate a report" testId="dd-report" onClose={onClose} onSubmit={submit} action="Generate report" busy={busy}>
      <p className={`m-0 text-[13px] ${muted}`}>The report carries every section’s verdict, the flags and the score as they stand now. It opens in a new tab through a link that works once, for five minutes.</p>
      <Note>Your authenticator code is asked for if you have not given one recently. Generating is recorded on the case.</Note>
      <Refusal text={error} testId="dd-report-error" />
    </Dialog>
  );
}

/** H. Widen the scope: a deeper template adds its items to the checklist; scope never narrows. */
export function WidenDialog({ uid, depth, onClose, onDone }) {
  const choices = widenChoices(depth);
  const [to, setTo] = useState(choices[0] || '');
  const { busy, error, send } = useCaseSend();
  const submit = () => {
    if (!to) { onClose(); return; }
    send(async () => { const r = await ddDeskApi.widen(uid, to); onDone(`The scope is widened to ${depthWord(to)}: ${Number(r?.items_added ?? 0) === 1 ? 'one item' : `${r?.items_added ?? 'the'} items`} added.`); }, 'The scope could not be widened.');
  };
  return (
    <Dialog title="Widen the scope" sub={`Today: ${depthWord(depth || 'standard')}. Scope only widens; it never narrows.`} testId="dd-widen" onClose={onClose} onSubmit={submit} action={to ? 'Widen scope' : 'Close'} busy={busy}>
      {choices.length ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className={fieldCls}>Template</legend>
          {choices.map((d) => (
            <label key={d} className="flex items-center gap-2 text-[13px]"><input type="radio" name="dd-widen" checked={to === d} onChange={() => setTo(d)} />{depthWord(d)}</label>
          ))}
        </fieldset>
      ) : <Note>This case already has the deepest template.</Note>}
      <p className={`m-0 text-[12.5px] ${muted}`}>Its extra items join each section’s checklist as Pending. Nothing already worked changes.</p>
      <Refusal text={error} testId="dd-widen-error" />
    </Dialog>
  );
}

/** DDL6b. Compose a request to the subject. */
export function ComposeDialog({ uid, data, onClose, onDone }) {
  const [f, setF] = useState({ title: '', details: '', sectionId: '', due: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { busy, error, setError, send } = useCaseSend();
  const submit = () => {
    const r = composeBody(f, today());
    if (r.error) { setError(r.error); return; }
    send(async () => { await dd.createRequest(uid, r.body); onDone('The request is sent to the subject.'); }, 'The request could not be sent.');
  };
  return (
    <Dialog title={`Request from ${data.case.subject_label}`} sub="The subject is told in the bell and by email, and answers in their own requests page." testId="dd-compose" onClose={onClose} onSubmit={submit} action="Send request" busy={busy}>
      <label className="block"><span className={fieldCls}>What you need</span><input className={inputCls} value={f.title} onChange={set('title')} maxLength={200} /></label>
      <label className="block"><span className={fieldCls}>Details (optional)</span><textarea rows={3} className={inputCls} value={f.details} onChange={set('details')} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={fieldCls}>Section (optional)</span>
          <select className={inputCls} value={f.sectionId} onChange={set('sectionId')}>
            <option value="">Case-wide</option>
            {(data.sections || []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label className="block"><span className={fieldCls}>Due (optional)</span><input type="date" min={today()} className={`${inputCls} font-mono`} value={f.due} onChange={set('due')} /></label>
      </div>
      <Refusal text={error} testId="dd-compose-error" />
    </Dialog>
  );
}

/** A request's due date. */
export function RequestDueDialog({ uid, req, onClose, onDone }) {
  const [day, setDay] = useState(req.due_date || '');
  const { busy, error, setError, send } = useCaseSend();
  const submit = () => {
    if (day && day < today()) { setError('The due date is today or later.'); return; }
    send(async () => { await dd.setRequestDue(uid, req.id, day || null); onDone(day ? `“${req.title}” is due ${day}.` : `“${req.title}” has no due date.`); }, 'The date could not be saved.');
  };
  return (
    <Dialog title={`Due date · ${req.title}`} testId="dd-req-due" onClose={onClose} onSubmit={submit} action={day ? 'Set date' : 'Clear date'} busy={busy}>
      <input type="date" min={today()} className={`${inputCls} font-mono`} value={day} onChange={(e) => setDay(e.target.value)} />
      <p className={`m-0 text-[12.5px] ${muted}`}>The subject sees the new date on their request.</p>
      <Refusal text={error} testId="dd-req-due-error" />
    </Dialog>
  );
}

/** Withdraw a request: the subject no longer sees it. */
export function WithdrawDialog({ uid, req, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const { busy, error, send } = useCaseSend();
  const submit = () => send(async () => { await dd.withdrawRequest(uid, req.id, reason.trim() || undefined); onDone(`“${req.title}” is withdrawn.`); }, 'The request could not be withdrawn.');
  return (
    <Dialog title={`Withdraw “${req.title}”`} testId="dd-withdraw" onClose={onClose} onSubmit={submit} action="Withdraw request" actionCls={dangerCls} busy={busy}>
      <p className={`m-0 text-[13px] ${muted}`}>The subject no longer sees the request, and files already sent stay on the case.</p>
      <label className="block"><span className={fieldCls}>Reason (optional)</span><textarea rows={2} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Refusal text={error} testId="dd-withdraw-error" />
    </Dialog>
  );
}

/** DDL9b. Assign someone to a section, as a reviewer or an observer. Picked by name, never a typed number. */
export function AssignDialog({ uid, data, sectionId = '', onClose, onDone }) {
  const [sid, setSid] = useState(sectionId ? String(sectionId) : '');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [role, setRole] = useState('reviewer');
  const [found, setFound] = useState({ items: null, failed: false });
  const seq = useRef(0);
  const { busy, error, setError, send } = useCaseSend();
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      ddDeskApi.people(q).then((r) => { if (mine === seq.current) setFound({ items: r?.items || [], failed: false }); })
        .catch(() => { if (mine === seq.current) setFound({ items: null, failed: true }); });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const section = (data.sections || []).find((s) => String(s.id) === sid);
  const submit = () => {
    if (!sid) { setError('Choose the section.'); return; }
    if (!pick) { setError('Choose who to assign.'); return; }
    send(async () => { await ddDeskApi.assign(uid, Number(sid), pick.id, role); onDone(`${pick.name} is assigned to ${section?.title || 'the section'} as ${role === 'observer' ? 'an observer' : 'a reviewer'}.`); }, 'The assignment could not be made.');
  };
  return (
    <Dialog title="Assign to a section" sub="They are told in the bell and by email, with a link to this section that works for 14 days." testId="dd-assign" onClose={onClose} onSubmit={submit} action="Assign" busy={busy}>
      <label className="block"><span className={fieldCls}>Section</span>
        <select className={inputCls} value={sid} onChange={(e) => setSid(e.target.value)} data-testid="dd-assign-section">
          <option value="">Choose…</option>
          {(data.sections || []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </label>
      <label className="block"><span className={fieldCls}>Person</span>
        <input className={inputCls} value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="Search by name" data-testid="dd-assign-q" />
      </label>
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {found.failed ? <Refusal text="The search could not be read. Type again to retry." /> : null}
        {(found.items || []).map((p) => (
          <button key={p.id} type="button" aria-pressed={pick?.id === p.id} onClick={() => setPick(p)} data-testid={`dd-assign-person-${p.id}`}
            className={`rounded-lg px-2 py-1.5 text-left text-[13px] ${pick?.id === p.id ? 'bg-violet-50 font-semibold dark:bg-violet-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
            {p.name} <span className={`text-[12px] ${muted}`}>{p.role}</span>
          </button>
        ))}
      </div>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className={fieldCls}>Role</legend>
        <label className="flex items-start gap-2 text-[13px]"><input type="radio" name="dd-assign-role" checked={role === 'reviewer'} onChange={() => setRole('reviewer')} /><span>Reviewer<span className={`block text-[12px] ${muted}`}>Works the section’s checklist and flags, and records its verdict.</span></span></label>
        <label className="flex items-start gap-2 text-[13px]"><input type="radio" name="dd-assign-role" checked={role === 'observer'} onChange={() => setRole('observer')} data-testid="dd-assign-observer" /><span>Observer<span className={`block text-[12px] ${muted}`}>Reads the section; changes nothing.</span></span></label>
      </fieldset>
      <Refusal text={error} testId="dd-assign-error" />
    </Dialog>
  );
}

/** DDL4's bulk changes: one write per chosen item; what was refused is said by count. */
export function BulkDialog({ uid, data, kind, itemIds, onClose, onDone }) {
  const [value, setValue] = useState('');
  const people = [...peopleOf(data).entries()];
  const { busy, error, setError, send } = useCaseSend();
  const TITLE = { owner: 'Set the owner', due: 'Set the due date', n_a: 'Mark N/A' };
  const submit = () => {
    if (kind === 'due' && value && value < today()) { setError('The due date is today or later.'); return; }
    const patch = bulkPatch(kind, value);
    send(async () => {
      let refused = 0;
      for (const id of itemIds) {
        try { await dd.updateItem(uid, id, patch); } catch { refused += 1; }
      }
      const done = itemIds.length - refused;
      if (!done) throw new Error('None of the items could be changed. Nothing was saved.');
      onDone(`${done === 1 ? 'One item is' : `${done} items are`} changed.${refused ? ` ${refused === 1 ? 'One was' : `${refused} were`} refused and kept as it was.` : ''}`);
    }, 'The items could not be changed.');
  };
  return (
    <Dialog title={`${TITLE[kind]} · ${itemIds.length === 1 ? 'one item' : `${itemIds.length} items`}`} testId="dd-bulk" onClose={onClose} onSubmit={submit} action={TITLE[kind]} busy={busy}>
      {kind === 'owner' && (
        <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} data-testid="dd-bulk-owner">
          <option value="">No owner</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}
      {kind === 'due' && <input type="date" min={today()} className={`${inputCls} font-mono`} value={value} onChange={(e) => setValue(e.target.value)} data-testid="dd-bulk-due" />}
      <p className={`m-0 text-[12.5px] ${muted}`}>{kind === 'n_a' ? 'The items count as worked and leave the score.' : 'Each change is recorded in the case’s activity.'}</p>
      <Refusal text={error} testId="dd-bulk-error" />
    </Dialog>
  );
}
