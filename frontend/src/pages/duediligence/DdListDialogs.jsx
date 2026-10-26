/**
 * D1250 (#3265) — the list's dialogs. Open a case (DDL2, DDL2b) picks the
 * subject by name from `GET /api/dd/subjects`, never a typed number, and
 * sends the context with the case in one write (`POST /api/dd/cases`, D1250
 * §1). The row menu's Change lead, Set target IC date and Archive are D1246's
 * `PATCH /api/dd/cases/:uid`. Each says what it changes and who is told
 * before it is sent; a refusal stays in its dialog in the Worker's words.
 */
import React, { useEffect, useRef, useState } from 'react';
import { dd, ddDeskApi, ddLifecycleApi } from '../../lib/api';
import {
  CURRENCIES, SUBJECT_TYPES, dealLabel, openCaseLine, openCasePayload, subjectTypeWord, templateCard,
} from './ddListModel.js';
import { Dialog, Note, Refusal, dangerCls, eyebrowCls, fieldCls, inputCls, muted, useSend } from './DdUi.jsx';

const chip = (on) => `inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold ${on
  ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'
  : 'border-axal-hairline bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'}`;

/** A name search that answers after a pause; `read()` returns `{ items }`, and `key` changes when it should run again. */
function useNameSearch(read, key, enabled = true) {
  const [state, setState] = useState({ items: null, failed: false });
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await read();
        if (mine === seq.current) setState({ items: r?.items || [], failed: false });
      } catch {
        if (mine === seq.current) setState({ items: null, failed: true });
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return state;
}

/* ------------------------------------------------------------------ *
 * Open a case (DDL2, DDL2b)
 * ------------------------------------------------------------------ */

export function OpenCaseDialog({ me, templates, onClose, onOpened }) {
  const investor = me?.role === 'investor';
  const [form, setForm] = useState({
    subject_type: 'project', subject: null, label: '', round_label: '', cheque: '', cheque_currency: 'EUR',
    target_ic_date: '', lead: { id: me?.id, name: me?.name || 'You', isMe: true }, deal_id: '', template_depth: 'standard',
    subject_legal_name: '', subject_email: '', notes: '',
  });
  const [q, setQ] = useState('');
  const [leadQ, setLeadQ] = useState('');
  const [leadOpen, setLeadOpen] = useState(false);
  const { busy, error, setError, send } = useSend();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const subjects = useNameSearch(() => ddDeskApi.subjects(form.subject_type, q), `${form.subject_type}|${q}`, !form.subject);
  const people = useNameSearch(() => ddDeskApi.people(leadQ), leadQ, leadOpen && !investor);

  const pickType = (t) => setForm((f) => ({ ...f, subject_type: t, subject: null, label: '', deal_id: '' }));
  const pickSubject = (s) => setForm((f) => ({ ...f, subject: s, label: s.name, deal_id: s.deals?.length === 1 ? String(s.deals[0].id) : '' }));
  const submit = () => {
    const r = openCasePayload(form, me);
    if (r.error) { setError(r.error); return; }
    send(async () => {
      const made = await dd.openCase(r.payload);
      onOpened(made);
    }, 'The case could not be opened.');
  };
  const cards = (templates?.templates || ['lite', 'standard', 'deep'].map((depth) => ({ depth }))).map(templateCard);
  const typeWord = subjectTypeWord(form.subject_type).toLowerCase();

  return (
    <Dialog title="Open a case" testId="dd-open" onClose={onClose} onSubmit={submit} action="Open case" busy={busy} width={640}>
      <div>
        <span className={fieldCls}>Subject type</span>
        {investor ? (
          <div className="flex flex-col gap-1">
            <span className={chip(true)}>Startup</span>
            <p className={`m-0 text-[12.5px] ${muted}`} data-testid="dd-open-investor-note">Investors open cases on startups only.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Subject type">
            {SUBJECT_TYPES.map((t) => (
              <button key={t.key} type="button" className={chip(form.subject_type === t.key)} aria-pressed={form.subject_type === t.key} onClick={() => pickType(t.key)}>{t.label}</button>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className={fieldCls}>Subject</span>
        {form.subject ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2.5 dark:border-violet-700 dark:bg-violet-950/40" data-testid="dd-open-subject">
            <div>
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{form.subject.name}</div>
              <div className={`text-[12px] ${muted}`}>{subjectTypeWord(form.subject_type)}{form.subject.stage ? ` · ${form.subject.stage}` : ''}</div>
            </div>
            <button type="button" className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300" onClick={() => setForm((f) => ({ ...f, subject: null, label: '', deal_id: '' }))}>Change</button>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="sr-only">Search</span>
              <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${typeWord}s`}
                placeholder={investor ? 'Search startups you share a deal room with' : `Search ${typeWord === 'startup' ? 'startups' : `${typeWord}s`}`} data-testid="dd-open-search" />
            </label>
            <div className="mt-1.5 flex flex-col gap-1" data-testid="dd-open-results">
              {subjects.failed ? <Refusal text="The search could not be read. Type again to retry." /> : null}
              {subjects.items && !subjects.items.length ? <p className={`m-0 text-[12.5px] ${muted}`}>{q ? `No ${typeWord} matches “${q}”.` : `No ${typeWord} to choose.`}</p> : null}
              {(subjects.items || []).map((s) => (
                <button key={s.id} type="button" onClick={() => pickSubject(s)} className="flex items-center justify-between rounded-lg border border-axal-hairline px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" data-testid={`dd-open-pick-${s.id}`}>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{s.name}</span>
                  {s.stage ? <span className={`text-[12px] ${muted}`}>{s.stage}</span> : null}
                </button>
              ))}
            </div>
            {investor ? <p className={`m-0 mt-1 text-[12px] ${muted}`}>Only startups you share a deal room with are listed.</p> : null}
          </>
        )}
      </div>

      <label className="block">
        <span className={fieldCls}>Label</span>
        <input className={inputCls} value={form.label} onChange={(e) => set('label', e.target.value)} />
        {form.subject ? <span className={`mt-1 block text-[12px] ${muted}`}>Prefilled from the {typeWord}. You can edit it.</span> : null}
      </label>

      <div className={eyebrowCls}>Context</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldCls}>Round</span>
          <input className={inputCls} value={form.round_label} onChange={(e) => set('round_label', e.target.value)} placeholder="Series A" />
        </label>
        <div>
          <label className="block" htmlFor="dd-open-cheque"><span className={fieldCls}>Our cheque</span></label>
          <div className="flex gap-2">
            <input id="dd-open-cheque" className={`${inputCls} font-mono`} inputMode="decimal" value={form.cheque} onChange={(e) => set('cheque', e.target.value)} placeholder="2,000,000" />
            <select aria-label="Currency" className={`${inputCls} w-24`} value={form.cheque_currency} onChange={(e) => set('cheque_currency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <label className="block">
          <span className={fieldCls}>Target IC date</span>
          <input type="date" className={`${inputCls} font-mono`} value={form.target_ic_date} onChange={(e) => set('target_ic_date', e.target.value)} />
        </label>
        <div>
          <span className={fieldCls}>Case lead</span>
          {investor ? (
            <p className={`m-0 text-[13px] ${muted}`} data-testid="dd-open-lead-self">You lead the cases you open.</p>
          ) : (
            <>
              <button type="button" className={`${inputCls} text-left`} onClick={() => setLeadOpen((v) => !v)} data-testid="dd-open-lead">
                {form.lead.isMe ? `${form.lead.name} (you)` : form.lead.name}
              </button>
              {leadOpen ? (
                <div className="mt-1.5 flex flex-col gap-1">
                  <input className={inputCls} value={leadQ} onChange={(e) => setLeadQ(e.target.value)} aria-label="Search people to lead" placeholder="Search by name" />
                  {people.failed ? <Refusal text="The search could not be read. Type again to retry." /> : null}
                  {(people.items || []).filter((p) => p.role !== 'advisor').map((p) => (
                    <button key={p.id} type="button" className="rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => { set('lead', { id: p.id, name: p.name, isMe: Number(p.id) === Number(me?.id) }); setLeadOpen(false); }}>
                      {p.name} <span className={`text-[12px] ${muted}`}>{p.role}</span>
                    </button>
                  ))}
                  <p className={`m-0 text-[12px] ${muted}`}>A case is led by an Admin, a partner or an investor.</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      {form.subject_type === 'project' && form.subject ? (
        form.subject.deals?.length ? (
          <label className="block">
            <span className={fieldCls}>Linked deal</span>
            <select className={inputCls} value={form.deal_id} onChange={(e) => set('deal_id', e.target.value)} data-testid="dd-open-deal">
              <option value="">No linked deal</option>
              {form.subject.deals.map((d) => <option key={d.id} value={String(d.id)}>{dealLabel(form.subject.name, d)}</option>)}
            </select>
          </label>
        ) : <p className={`m-0 text-[12.5px] ${muted}`} data-testid="dd-open-no-deal">{investor ? 'No deal of this startup you are on can be linked.' : 'This startup has no deal to link.'}</p>
      ) : null}

      <div className={eyebrowCls}>Template</div>
      <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Template">
        {cards.map((t) => (
          <button key={t.depth} type="button" aria-pressed={form.template_depth === t.depth} onClick={() => set('template_depth', t.depth)} data-testid={`dd-open-template-${t.depth}`}
            className={`rounded-lg border p-3 text-left ${form.template_depth === t.depth ? 'border-violet-500 ring-1 ring-violet-500 dark:border-violet-400 dark:ring-violet-400' : 'border-axal-hairline hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'}`}>
            <span className="flex items-center justify-between gap-1">
              <span className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{t.name}</span>
              {t.depth === 'standard' ? <span className="rounded-full border border-violet-200 px-1.5 text-[10.5px] font-semibold text-violet-700 dark:border-violet-700 dark:text-violet-300">Default</span> : null}
            </span>
            <span className={`mt-1 block text-[12px] ${muted}`}>{templates?.failed ? 'Could not be read' : t.counts}</span>
            {t.version ? <span className={`block text-[12px] ${muted}`}>{t.version === 'Built-in' ? 'Built-in version' : `Version ${t.version}`}</span> : null}
          </button>
        ))}
      </div>
      <p className={`m-0 text-[12px] ${muted}`}>You can widen scope later, never narrow it.</p>

      <div className={eyebrowCls}>Private · optional</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldCls}>Legal name</span>
          <input className={inputCls} value={form.subject_legal_name} onChange={(e) => set('subject_legal_name', e.target.value)} />
        </label>
        <label className="block">
          <span className={fieldCls}>Email</span>
          <input type="email" className={`${inputCls} font-mono`} value={form.subject_email} onChange={(e) => set('subject_email', e.target.value)} />
        </label>
      </div>
      <p className={`m-0 text-[12px] ${muted}`}>Encrypted. Hidden from section reviewers.</p>
      <label className="block">
        <span className={fieldCls}>Analyst notes</span>
        <textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Add notes only the case lead and admins see" />
      </label>
      <Note testId="dd-open-line">{openCaseLine(form, templates?.templates)}</Note>
      <Refusal text={error} testId="dd-open-error" />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The row menu's changes (D1246)
 * ------------------------------------------------------------------ */

export function ChangeLeadDialog({ row, me, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const { busy, error, setError, send } = useSend();
  const searchable = me?.role === 'admin' || me?.role === 'partner';
  const people = useNameSearch(() => ddDeskApi.people(q), q, searchable);
  const submit = () => {
    if (!searchable) { onClose(); return; }
    if (!pick) { setError('Choose who will lead the case.'); return; }
    send(async () => { await ddLifecycleApi.update(row.uid, { lead_user_id: pick.id }); onDone(`${pick.name} now leads ${row.subject_label}.`); }, 'The lead could not be changed.');
  };
  return (
    <Dialog title={`Change the lead of ${row.subject_label}`} testId="dd-lead" onClose={onClose} onSubmit={submit} action={searchable ? 'Change lead' : 'Close'} busy={busy}>
      {searchable ? (
        <>
          <p className={`m-0 text-[13px] ${muted}`}>Today: {row.lead_name || 'Not recorded'}. The new lead can record the decision and send the case to IC, and is told in the bell.</p>
          <label className="block">
            <span className={fieldCls}>New lead</span>
            <input className={inputCls} value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="Search by name" />
          </label>
          <div className="flex flex-col gap-1">
            {people.failed ? <Refusal text="The search could not be read. Type again to retry." /> : null}
            {(people.items || []).filter((p) => p.role !== 'advisor').map((p) => (
              <button key={p.id} type="button" aria-pressed={pick?.id === p.id} onClick={() => setPick(p)}
                className={`rounded-lg px-2 py-1.5 text-left text-[13px] ${pick?.id === p.id ? 'bg-violet-50 font-semibold dark:bg-violet-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                {p.name} <span className={`text-[12px] ${muted}`}>{p.role}</span>
              </button>
            ))}
          </div>
          <p className={`m-0 text-[12px] ${muted}`}>A case is led by an Admin, a partner or an investor.</p>
        </>
      ) : <Note testId="dd-lead-not-yours">Only an Admin or a partner can search for a new lead. Ask an Admin to hand this case on.</Note>}
      <Refusal text={error} testId="dd-lead-error" />
    </Dialog>
  );
}

export function TargetDateDialog({ row, onClose, onDone }) {
  const [day, setDay] = useState(row.target_ic_date || '');
  const { busy, error, send } = useSend();
  const submit = () => send(async () => {
    await ddLifecycleApi.update(row.uid, { target_ic_date: day || null });
    onDone(day ? `The target IC date of ${row.subject_label} is set.` : `The target IC date of ${row.subject_label} is cleared.`);
  }, 'The date could not be saved.');
  return (
    <Dialog title={`Set the target IC date of ${row.subject_label}`} testId="dd-target" onClose={onClose} onSubmit={submit} action={day ? 'Set date' : 'Clear date'} busy={busy}>
      <label className="block">
        <span className={fieldCls}>Target IC date</span>
        <input type="date" className={`${inputCls} font-mono`} value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <p className={`m-0 text-[12.5px] ${muted}`}>
        {day ? 'The case reads as past its target once this day has gone and it is still open.' : 'Empty, the case has no target date: it reads Not recorded.'} Nobody is told; the change is recorded in the case’s activity.
      </p>
      <Refusal text={error} testId="dd-target-error" />
    </Dialog>
  );
}

export function ArchiveDialog({ row, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useSend();
  const submit = () => {
    const r = reason.trim();
    if (!r) { setError('Say why the case is archived.'); return; }
    if (r.length > 2000) { setError('The reason is at most 2000 characters.'); return; }
    send(async () => { await ddLifecycleApi.archive(row.uid, r); onDone(`${row.subject_label} is archived.`); }, 'The case could not be archived.');
  };
  return (
    <Dialog title={`Archive ${row.subject_label}`} testId="dd-archive" onClose={onClose} onSubmit={submit} action="Archive case" actionCls={dangerCls} busy={busy}>
      <p className={`m-0 text-[13px] ${muted}`}>
        The case leaves the open cases and takes no further change: no decision, memo or edit. {row.decision ? '' : 'It is counted as archived without a decision. '}The reason is kept encrypted on the case.
      </p>
      <label className="block">
        <span className={fieldCls}>Reason</span>
        <textarea rows={3} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Refusal text={error} testId="dd-archive-error" />
    </Dialog>
  );
}
