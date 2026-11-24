import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet.jsx';
import { SOURCES, STATUSES, feedbackBody, linkedWords, originWord, savedLine, sheetProblem } from './feedbackTabModel.js';

/**
 * D6865 part 2 (#6891) — Grow › Customers › Feedback's one sheet: Add feedback
 * (GR-21B) and Save as feedback from an Inbox reply (GR-24, GR-24B) or a
 * Validate interview passage (GR-25). A side sheet on a desktop and a bottom
 * sheet on a phone (GR-29C), through the one detail sheet (`ui/Sheet.jsx`).
 *
 * It writes once, through `POST /api/cycles/grow/feedback` (`onSave`), and only
 * when Save is pressed: nothing is written while it is open. The Customer
 * record is the venture's own contacts (Product improvement's form-options,
 * `options.contacts`); with none chosen it reads Not linked, and it still saves
 * with the typed name. The origin is fixed by where the sheet opened. Saving
 * disables Save and keeps every field; a failed save keeps the sheet and the
 * words, with Try again; a reply saved before names the item it already is.
 */
const FIELD = 'min-h-11 w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink sm:min-h-10 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-axal-hairline bg-white px-4 text-[13px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-10 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-axal-violet px-4 text-[13px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 sm:min-h-10 dark:bg-violet-500 dark:hover:bg-violet-400';
const BLOCK = 'flex flex-col gap-2 rounded-lg border p-3';

export default function FeedbackSheet({
  title = 'Add feedback', from = null, initial, origin = 'typed', replyKey = null, consent = null, options, onSave, onClose,
  onSaved = null, itemHref = (uid) => uid, testId = 'feedback-sheet',
}) {
  const id = useId();
  const [v, setV] = useState(initial);
  const [linking, setLinking] = useState(false);
  const [state, setState] = useState({ kind: 'idle' });
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const contacts = Array.isArray(options?.contacts) ? options.contacts : [];
  const themes = Array.isArray(options?.themes) ? options.themes : [];
  const items = Array.isArray(options?.roadmap_items) ? options.roadmap_items : [];
  const link = linkedWords(contacts, v.contact_uid);
  const problem = sheetProblem(v);
  const done = state.kind === 'saved' || state.kind === 'already';

  const save = async () => {
    if (problem || state.kind === 'saving') { if (problem) setState({ kind: 'problem', line: problem }); return; }
    setState({ kind: 'saving' });
    try {
      const out = await onSave(feedbackBody(v, { origin, replyKey }));
      setState({ kind: 'saved', uid: out?.uid ?? null });
      onSaved?.(out?.uid ?? null, v);
    } catch (e) {
      if (e?.status === 409 && e?.data?.uid) { setState({ kind: 'already', uid: String(e.data.uid) }); onSaved?.(String(e.data.uid), v); return; }
      setState({ kind: 'failed', line: e?.message || 'Couldn’t save.' });
    }
  };

  const footer = done ? (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" className={BTN} onClick={onClose}>Close</button>
      {state.uid ? <Link className={PRIMARY} to={itemHref(state.uid)} data-testid={`${testId}-open`}>Open in Feedback</Link> : null}
    </div>
  ) : (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" className={BTN} onClick={onClose} disabled={state.kind === 'saving'}>Cancel</button>
      <button type="button" className={PRIMARY} onClick={save} disabled={state.kind === 'saving'} data-testid={`${testId}-save`}>
        {state.kind === 'saving' ? 'Saving…' : title === 'Add feedback' ? 'Add feedback' : 'Save'}
      </button>
    </div>
  );

  return (
    <Sheet title={title} sub={from ? <span className={`text-[12px] ${MUTED}`}>{from}{done ? '' : ' · nothing is written until you save'}</span> : null}
      onClose={onClose} width={480} phone="sheet" footer={footer} testId={testId}>
      <div className="flex flex-col gap-3" data-testid={`${testId}-body`}>
        {state.kind === 'saved' ? (
          <div role="status" className={`${BLOCK} border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200`} data-testid={`${testId}-saved`}>
            <b className="text-[13px]">✓ {savedLine(v.status)}</b>
            {state.uid ? <Link className="text-[12.5px] font-semibold underline" to={itemHref(state.uid)}>Open item</Link> : null}
          </div>
        ) : null}
        {state.kind === 'already' ? (
          <div role="status" className={`${BLOCK} border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`} data-testid={`${testId}-already`}>
            <b className="text-[13px]">This reply is already saved as feedback.</b>
            <Link className="text-[12.5px] font-semibold underline" to={itemHref(state.uid)}>Open item</Link>
          </div>
        ) : null}
        {state.kind === 'failed' || state.kind === 'problem' ? (
          <div role="alert" className={`${BLOCK} border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200`} data-testid={`${testId}-failed`}>
            <span className="text-[12.5px]"><b>{state.kind === 'failed' ? 'Couldn’t save.' : state.line}</b>{state.kind === 'failed' ? ' Your words and fields are kept.' : ''}</span>
            {state.kind === 'failed' ? <button type="button" className={`${BTN} self-start`} onClick={save}>Try again</button> : null}
          </div>
        ) : null}
        <fieldset disabled={done} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <label className={LABEL}>What they said{title === 'Add feedback' ? '' : <span className={`font-normal ${MUTED}`}> · editable</span>}
            <textarea className={`${FIELD} min-h-[72px]`} value={v.body} onChange={set('body')} maxLength={4000} data-testid={`${testId}-text`} />
          </label>
          {consent}
          <div className={LABEL} role="radiogroup" aria-labelledby={`${id}-src`}>
            <span id={`${id}-src`}>Source</span>
            <div className="flex gap-1">
              {SOURCES.map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={v.source === k} onClick={() => set('source')(k)}
                  className={`min-h-11 flex-1 rounded-lg border text-[12.5px] sm:min-h-9 ${v.source === k ? 'border-violet-300 bg-violet-50 font-bold text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>Name<input className={FIELD} value={v.from_name} onChange={set('from_name')} maxLength={200} /></label>
            <label className={LABEL}>Email<input className={FIELD} type="email" value={v.from_email} onChange={set('from_email')} maxLength={200} placeholder="Not recorded" /></label>
          </div>
          <label className={LABEL}>Company<input className={FIELD} value={v.from_company} onChange={set('from_company')} maxLength={200} />
            <small className={`font-normal ${MUTED}`}>Plan reads the ledger by this exact company name.</small>
          </label>
          <div className={`${BLOCK} ${link.linked ? 'border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/25' : 'border-dashed border-axal-hairline dark:border-gray-700'}`} data-testid={`${testId}-record`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>Customer record</span>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{link.linked ? <b>{link.text}</b> : <><span aria-hidden="true">○ </span>{link.text}</>}</span>
              {options === 'unreadable' ? <span className={`text-[12px] ${MUTED}`}>Records unreadable</span>
                : <button type="button" className={`${BTN} min-h-11 px-3 text-[12px] sm:min-h-8`} onClick={() => setLinking((x) => !x)} aria-expanded={linking} disabled={!contacts.length}>{link.linked ? 'Change' : 'Link'}</button>}
            </div>
            {linking && contacts.length ? (
              <label className={LABEL}>Link to a customer or prospect
                <select className={FIELD} value={v.contact_uid} onChange={(e) => { set('contact_uid')(e); setLinking(false); }} data-testid={`${testId}-link`}>
                  <option value="">Not linked</option>
                  {contacts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            ) : null}
            {!link.linked ? <small className={`text-[12px] ${MUTED}`}>You can save without a link; the typed name stays.</small> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>Theme
              <select className={FIELD} value={v.theme} onChange={set('theme')} data-testid={`${testId}-theme`}>
                <option value="">No theme</option>
                {themes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className={LABEL}>Status
              <select className={FIELD} value={v.status} onChange={set('status')}>
                {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          {items.length ? (
            <label className={LABEL}>Roadmap item
              <select className={FIELD} value={v.roadmap_item_ref || ''} onChange={set('roadmap_item_ref')}>
                <option value="">None</option>
                {items.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
          ) : null}
          {!v.theme ? <label className={LABEL}>Or name a new theme<input className={FIELD} value={v.new_theme} onChange={set('new_theme')} maxLength={80} placeholder="No theme yet" /></label> : null}
          <label className="flex min-h-11 items-start gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={v.notify} onChange={set('notify')} data-testid={`${testId}-notify`} />
            <span><b>Tell them when it ships</b><small className={`block ${MUTED}`}>You tell them; Axal sends nothing. Closing the loop reminds you once it ships.</small></span>
          </label>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12px]" data-testid={`${testId}-origin`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>Origin</span>
            <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-axal-ink dark:border-gray-700 dark:text-gray-200">{originWord(origin)}</span>
          </p>
        </fieldset>
      </div>
    </Sheet>
  );
}
