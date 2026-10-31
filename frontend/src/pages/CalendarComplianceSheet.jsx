// D1384 (#3692) — a compliance deadline in the Calendar's shared right Sheet
// (D1317), and the dialogs that change it: Mark done, Reopen, Delete and New
// deadline. /compliance is retired into this layer; every write is that page's
// own (`/api/compliance/events`), and every change opens an in-page dialog that
// says what it does first. The words are in calendarComplianceModel.js.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Lightbox, Sheet, actionDanger, actionGhost, actionPrimary } from '../ui';
import {
  REPEAT_WORDS, SAYS, TYPE_WORDS, createError, dayWords, doneSays, ownerLine, refusalOf, sourceLine, stateLine, stateOf,
} from './calendarComplianceModel';

const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SECTION = 'flex flex-col gap-1.5 border-t border-axal-hairline px-5 py-3.5 dark:border-gray-700';
const PILL = 'inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-200';
const STATE_PILL = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  overdue: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  due: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
};
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ALERT = 'm-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400';

function Row({ title, children, testId }) {
  return (
    <section className={SECTION} data-testid={testId}>
      <h3 className={`m-0 ${EYEBROW}`}>{title}</h3>
      {children}
    </section>
  );
}

/** One change, said first and sent only on its button. */
function ChangeDialog({ change, item, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const words = {
    done: { title: `Mark ${item.title} done?`, says: doneSays(item), go: 'Mark done', going: 'Marking…', danger: false },
    reopen: { title: `Reopen ${item.title}?`, says: SAYS.reopen, go: 'Reopen', going: 'Reopening…', danger: false },
    delete: { title: `Delete ${item.title}?`, says: SAYS.delete, go: 'Delete deadline', going: 'Deleting…', danger: true },
  }[change];
  const save = async () => {
    setBusy(true); setSaid(null);
    try {
      if (change === 'delete') await api.complianceDelete(item.source_id);
      else await api.complianceUpdate(item.source_id, { completion_status: change === 'done' ? 'completed' : 'pending' });
      onDone(change);
    } catch (e) { setSaid(refusalOf(e)); }
    setBusy(false);
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose} data-testid="cal-compliance-back">Back</button>
      <button type="button" className={words.danger ? actionDanger : actionPrimary} disabled={busy} onClick={save} data-testid={`cal-compliance-${change}-save`}>{busy ? words.going : words.go}</button>
    </div>
  );
  return (
    <Lightbox label={words.title} title={words.title} sub={`Due ${dayWords(item.compliance?.due_date || item.start_at)}.`} onClose={onClose} width={480} phone="sheet" footer={footer} testId={`cal-compliance-${change}-dialog`}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className={`m-0 text-[12.5px] ${INK}`} data-testid={`cal-compliance-${change}-says`}>{words.says}</p>
        {said ? <p role="alert" className={ALERT} data-testid={`cal-compliance-${change}-refused`}>{said}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * The deadline in the Sheet: its state, day, venture, type, repeat, owner and
 * notes, with Mark done or Reopen and Delete. `onClose` returns to the view;
 * `onChanged` re-reads it; `reload` re-reads this item.
 */
export default function CalendarComplianceSheet({ item, onClose, onChanged, reload }) {
  const [change, setChange] = useState(null);
  const state = stateOf(item);
  const c = item.compliance || {};
  const owner = ownerLine(item);
  const source = sourceLine(item);
  const done = (what) => {
    setChange(null);
    onChanged?.();
    if (what === 'delete') onClose?.(); else reload?.();
  };
  const head = (
    <span className="flex flex-col gap-1.5">
      <span className={EYEBROW}>Compliance</span>
      <span className="flex flex-wrap gap-1.5">
        <span className={`${PILL} ${STATE_PILL[state]}`} data-testid="cal-compliance-state">{stateLine(item)}</span>
        {c.event_type ? <span className={PILL}>{TYPE_WORDS[c.event_type] || c.event_type}</span> : null}
      </span>
    </span>
  );
  const footer = (
    <span className="flex flex-wrap gap-2">
      {state === 'done'
        ? <button type="button" className={actionGhost} onClick={() => setChange('reopen')} data-testid="cal-compliance-reopen">Reopen</button>
        : <button type="button" className={actionPrimary} onClick={() => setChange('done')} data-testid="cal-compliance-done">Mark done</button>}
      <button type="button" className={actionDanger} onClick={() => setChange('delete')} data-testid="cal-compliance-delete">Delete</button>
    </span>
  );
  return (
    <>
      <Sheet label={item.title || 'Compliance deadline'} eyebrow={null} title={item.title || 'Not recorded'} sub={head} onClose={onClose} width={640} footer={footer} testId="cal-item-drawer">
        <div className="flex flex-col" data-testid="cal-item-compliance_due">
          <Row title="Due" testId="cal-compliance-due">
            <p className={`m-0 font-mono text-[12.5px] font-semibold ${INK}`}>{dayWords(c.due_date || item.start_at)} · all day</p>
          </Row>
          <Row title="Venture" testId="cal-compliance-venture">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-[13px] font-semibold ${INK}`}>{item.project_name || 'Not recorded'}</span>
              {item.project_id ? <Link className="font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400" to={`/projects/${item.project_id}`} data-testid="cal-compliance-open-venture">Open venture</Link> : null}
            </span>
            {c.jurisdiction ? <span className={`text-[12px] ${MUTED}`}>Jurisdiction: {c.jurisdiction}</span> : null}
          </Row>
          <Row title="Repeats" testId="cal-compliance-repeats">
            <p className={`m-0 text-[13px] ${INK}`}>{REPEAT_WORDS[c.recurrence] || 'Not recorded'}</p>
          </Row>
          <Row title="Owner" testId="cal-compliance-owner">
            <p className={`m-0 text-[13px] ${owner.missing ? MUTED : INK}`}>{owner.name}</p>
            {owner.missing ? <span className={`text-[11.5px] ${MUTED}`}>{owner.missing}</span> : null}
          </Row>
          {item.notes ? (
            <Row title="Notes" testId="cal-compliance-notes">
              <p className={`m-0 whitespace-pre-line text-[13px] leading-relaxed ${INK}`}>{item.notes}</p>
            </Row>
          ) : null}
          {source ? <p className={`m-0 px-5 pb-3 text-[11.5px] ${MUTED}`} data-testid="cal-compliance-source">{source}</p> : null}
        </div>
      </Sheet>
      {change ? <ChangeDialog change={change} item={item} onClose={() => setChange(null)} onDone={done} /> : null}
    </>
  );
}

/** New › Compliance deadline: /compliance's create, as an in-page dialog. */
export function NewComplianceDialog({ onClose, onDone }) {
  const [projects, setProjects] = useState({ status: 'loading', list: [] });
  const [form, setForm] = useState({
    project_id: '', event_type: 'annual_report', recurrence: 'annual', title: '', description: '', due_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    let live = true;
    api.listProjects()
      .then((p) => {
        if (!live) return;
        const list = Array.isArray(p) ? p : (p?.projects || []);
        setProjects({ status: 'ready', list });
        if (list.length === 1) setForm((f) => ({ ...f, project_id: String(list[0].id) }));
      })
      .catch(() => { if (live) setProjects({ status: 'error', list: [] }); });
    return () => { live = false; };
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const error = createError(form);
  const save = async () => {
    setTried(true);
    if (error) return;
    setBusy(true); setSaid(null);
    try {
      await api.complianceCreate({
        project_id: Number(form.project_id), event_type: form.event_type, recurrence: form.recurrence,
        title: form.title.trim(), description: form.description.trim() || null, due_date: form.due_date,
      });
      onDone();
    } catch (e) { setSaid(refusalOf(e)); }
    setBusy(false);
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose}>Back</button>
      <button type="button" className={actionPrimary} disabled={busy || projects.status !== 'ready'} onClick={save} data-testid="cal-compliance-new-save">{busy ? 'Adding…' : 'Add deadline'}</button>
    </div>
  );
  return (
    <Lightbox label="New compliance deadline" title="New compliance deadline" sub="On the venture’s compliance calendar, and on this Calendar." onClose={onClose} width={520} phone="sheet" footer={footer} testId="cal-compliance-new-dialog">
      <div className="flex flex-col gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Venture</span>
          {projects.status === 'error'
            ? <span role="alert" className={ALERT} data-testid="cal-compliance-new-ventures-unread">Your ventures couldn’t be read. Close this and try again.</span>
            : (
              <select className={FIELD} value={form.project_id} onChange={set('project_id')} disabled={projects.status !== 'ready'} data-testid="cal-compliance-new-venture">
                <option value="">{projects.status === 'loading' ? 'Reading your ventures…' : 'Choose a venture'}</option>
                {projects.list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
        </label>
        <span className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={EYEBROW}>Type</span>
            <select className={FIELD} value={form.event_type} onChange={set('event_type')} data-testid="cal-compliance-new-type">
              {Object.entries(TYPE_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={EYEBROW}>Repeats</span>
            <select className={FIELD} value={form.recurrence} onChange={set('recurrence')} data-testid="cal-compliance-new-repeats">
              {Object.entries(REPEAT_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
            </select>
          </label>
        </span>
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Title</span>
          <input className={FIELD} value={form.title} onChange={set('title')} maxLength={200} placeholder="Delaware annual report" data-testid="cal-compliance-new-title" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Due date</span>
          <input type="date" className={`${FIELD} font-mono`} value={form.due_date} onChange={set('due_date')} data-testid="cal-compliance-new-due" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Notes · optional</span>
          <textarea rows={2} className={FIELD} value={form.description} onChange={set('description')} data-testid="cal-compliance-new-notes" />
        </label>
        <p className={`m-0 text-[12.5px] ${INK}`} data-testid="cal-compliance-new-says">{SAYS.create}</p>
        {tried && error ? <p role="alert" className={ALERT} data-testid="cal-compliance-new-error">{error}</p> : null}
        {said ? <p role="alert" className={ALERT} data-testid="cal-compliance-new-refused">{said}</p> : null}
      </div>
    </Lightbox>
  );
}
