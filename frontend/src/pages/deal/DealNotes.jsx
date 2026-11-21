/**
 * D1152 (#3057) — DL14: your firm's notes on this deal (part 2's store),
 * Eadwyn's draft summary (#6194: drafted on request, from what this investor
 * may read, "Not saved" until Save as my note), and the deal's activity
 * without other investors' names (the Worker withholds them, D1152).
 *
 * D6164 PART 3 (#6164, DE27, the owner's answer A): the notes are no longer
 * a tab. An investor's Activity tab (`InvestorActivity`) has one row of
 * chips, the activity's own and "Firm notes", and Firm notes draws the notes
 * block below unchanged. The choice is in the address (`?show=notes`).
 *
 * WHO WRITES. Every member of your firm reads the notes; only a note's
 * author edits or deletes it (`author_user_id`, D1150). A new note is saved
 * from the form; an edit and a delete each open an in-page dialog that says
 * what changes. Nothing is ever a browser pop-up.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Unreadable, actionPrimary, actionGhost, actionDanger } from '../../ui';
import { dealContextApi } from '../../lib/api/dealContext';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { CARD, EYE, SUB, H3, BTN_S } from './DealFrame';
import { ACTIVITY_FILTERS, EADWYN_DRAFT, EADWYN_DRAFT_WAITS, EMPTY, FIRM_NOTES_LINE, INVESTOR_ACTIVITY_CHIPS, NOTE_MAX, NOTE_TAGS, activityChoice, activityEmpty, activityShown, draftSourceRows, noteError } from './dealFrameModel';
import { SHOW_NOTES } from '../dealPageModel';
import { fillsApi } from '../../lib/api/fills.js';
import { railProposalsApi } from '../../lib/api/railProposals.js';
import { refusalView } from '../../lib/fillSheet.js';
import { NOTES_PAGE, NOTE_FILTER_ALL, noteByline, notesHaveMore } from './dealNotesModel';
import Sheet from '../../ui/Sheet.jsx';
import { FillFormBar, FillLabel, useScopedFill } from '../../ui/useScopedFill.jsx';
import { SCOPED_FORMS } from '../../lib/fillScoped.js';

const FIELD = 'block w-full rounded-axal-xs border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const TAG = (on) => `inline-flex min-h-[28px] items-center rounded-axal-pill border px-3 text-[12px] font-semibold ${on
  ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
  : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`;

function TagPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tag">
      {NOTE_TAGS.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} className={TAG(value === t)} onClick={() => onChange(value === t ? '' : t)}>{t}</button>
      ))}
    </div>
  );
}

function NoteDialog({ mode, note, dealId, onDone, onClose }) {
  const [body, setBody] = useState(note.body || '');
  const [tag, setTag] = useState(note.tag || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const del = mode === 'delete';
  // #4046 (Group A2): Ask on the note's words, read against the note itself (its id), the author's only.
  const fill = useScopedFill({
    scope: SCOPED_FORMS.dealNote, record: note.id ?? null, enabled: !del && Number(note.id) > 0,
    values: { body }, onValues: (v) => { if (v.body != null) setBody(v.body); },
  });
  const go = async () => {
    const bad = del ? null : noteError(body);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try {
      if (del) await dealContextApi.deleteNote(dealId, note.uid);
      else { await dealContextApi.editNote(dealId, note.uid, { body: body.trim(), tag: tag || null }); await fill.afterSave(note.id); }
      onDone();
    } catch (e) { setErr(e?.message || 'That did not save. Try again.'); } finally { setBusy(false); }
  };
  const title = del ? 'Delete this note?' : 'Edit your note';
  return (
    <Sheet label={title} title={title} onClose={onClose} testId={`deal-note-${mode}-dialog`}
      sub={del ? 'Your firm will no longer see it. This cannot be undone.' : 'Your firm sees the new text in place of the old.'}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose}>Back</button>
          <button type="button" className={del ? actionDanger : actionPrimary} disabled={busy} onClick={go} data-testid={`deal-note-${mode}-confirm`}>{del ? 'Delete' : 'Save'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {del
          ? <p className="m-0 whitespace-pre-line text-[13px] text-axal-ink dark:text-gray-100">{note.body}</p>
          : (<>
            <FillLabel fill={fill} name="body" label="Note" value={body}><span className={EYE}>Note</span></FillLabel>
            <textarea rows={5} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} className={FIELD} aria-label="Note" />
            <TagPicker value={tag} onChange={setTag} />
            <FillFormBar fill={fill} />
          </>)}
        {err && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{err}</p>}
      </div>
    </Sheet>
  );
}

const STATE_TONE = {
  used: 'text-axal-ink dark:text-gray-100',
  none: 'text-axal-muted dark:text-gray-400',
  not_shared: 'text-axal-muted dark:text-gray-400',
  unreadable: 'text-axal-destructive dark:text-red-300',
};

/** #6194: the sources a draft read, each with its state: Used, None on record, Not shared or Unreadable. */
function DraftSources({ sources }) {
  const rows = draftSourceRows(sources);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="deal-eadwyn-draft-sources">
      <span className={EYE}>Sources</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.key} className="text-[12.5px] leading-[1.45]" data-state={r.state} data-testid={`deal-eadwyn-draft-source-${r.key}`}>
            <span className="font-bold text-axal-ink dark:text-gray-100">{r.label}</span>
            <span className={STATE_TONE[r.state]}> · {r.word}</span>
            {r.note && <span className="text-axal-muted dark:text-gray-400"> · {r.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * #6194 — DL14's "Draft: deal summary". Asked for by the investor, never on load: the deal note's own
 * scoped fill (`input.draft: 'deal_summary'`), so the hold, the charge and the guard are the fill's.
 * The draft is Eadwyn's and "Not saved" until Save as my note, which saves it through the notes route
 * and then records the kept proposal. Discard discards the proposal and writes no note.
 */
function EadwynDraft({ dealId, fill, onSaved }) {
  const [state, setState] = useState({ step: 'idle' });
  const [busy, setBusy] = useState(false);
  const can = fill.status === 'ready' && fill.canFill && !fill.aiOff;
  const ask = async () => {
    if (!can) return;
    setState({ step: 'running' });
    try {
      const events = await fillsApi.run({ page: SCOPED_FORMS.dealNote.page, option: `form:${SCOPED_FORMS.dealNote.form}`, parent: Number(dealId), input: { draft: 'deal_summary', values: { body: '' } } });
      const end = events.find((e) => e.event === 'done')?.data || null;
      if (!end || end.refusal) { setState({ step: 'refused', text: refusalView(end?.refusal ?? null, { charged: end?.charged_microusd ?? null }).text }); return; }
      const draft = (end.proposals || []).find((p) => p.field === 'body' && String(p.value || '').trim());
      setState(draft ? { step: 'draft', uid: draft.uid, text: String(draft.value), sources: end.sources || [] } : { step: 'empty', sources: end.sources || [] });
    } catch (e) {
      reportError('DealNotes:draft', e);
      setState({ step: 'refused', text: refusalView({ code: e?.code, message: e?.message }).text });
    }
  };
  const save = async () => {
    if (state.step !== 'draft' || busy) return;
    setBusy(true);
    try {
      const created = await dealContextApi.addNote(dealId, { body: state.text.trim(), tag: null });
      if (Number(created?.id) > 0) {
        try { await fillsApi.record({ page: SCOPED_FORMS.dealNote.page, form: SCOPED_FORMS.dealNote.form, record: Number(created.id), proposals: [state.uid] }); }
        catch (e) { reportError('DealNotes:draft-record', e); }
      }
      setState({ step: 'idle' });
      onSaved();
    } catch (e) {
      setState((s) => ({ ...s, error: e?.message || 'That did not save. Try again.' }));
    } finally { setBusy(false); }
  };
  const discard = async () => {
    const uid = state.uid;
    setState({ step: 'idle' });
    // The proposal is marked discarded; no note is written. A failed mark leaves the proposal unused, never saved.
    if (uid) railProposalsApi.decide(uid, 'discard').catch((e) => reportError('DealNotes:draft-discard', e));
  };
  const why = fill.status === 'loading' ? null
    : fill.status === 'unreadable' ? EADWYN_DRAFT.unreadable
      : fill.aiOff ? EADWYN_DRAFT.aiOff
        : fill.offLine || (!can ? EADWYN_DRAFT.unavailable : null);
  return (
    <section className="flex flex-col gap-2 rounded-axal-lg border border-axal-lavender-edge bg-axal-lavender px-4 py-4 dark:border-violet-800 dark:bg-violet-950/40" data-testid="deal-eadwyn-draft" data-step={state.step}>
      <span className={EYE}>{EADWYN_DRAFT.eye}</span>
      <h3 className={H3}>{EADWYN_DRAFT.title}</h3>
      {(state.step === 'idle' || state.step === 'refused' || state.step === 'empty') && (
        <>
          <p className={`m-0 ${SUB}`}>{EADWYN_DRAFT.line}</p>
          <p className={`m-0 ${SUB}`}>{EADWYN_DRAFT_WAITS}</p>
          {state.step === 'refused' && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="deal-eadwyn-draft-refused">{state.text}</p>}
          {state.step === 'empty' && <p className={`m-0 ${SUB}`} data-testid="deal-eadwyn-draft-empty">{EADWYN_DRAFT.empty}</p>}
          {state.step === 'empty' && <DraftSources sources={state.sources} />}
          {why && <p className={`m-0 ${SUB}`} data-testid="deal-eadwyn-draft-why">{why}</p>}
          <div><button type="button" className={BTN_S} disabled={!can} onClick={ask} data-testid="deal-eadwyn-draft-ask">{state.step === 'idle' ? EADWYN_DRAFT.ask : EADWYN_DRAFT.again}</button></div>
        </>
      )}
      {state.step === 'running' && <p className={`m-0 ${SUB}`} aria-busy="true" data-testid="deal-eadwyn-draft-running">{EADWYN_DRAFT.running}</p>}
      {state.step === 'draft' && (
        <>
          <span className="inline-flex w-fit items-center rounded-axal-pill border border-axal-lavender-edge bg-white px-2.5 py-0.5 text-[11.5px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300" data-testid="deal-eadwyn-draft-mark">{EADWYN_DRAFT.mark}</span>
          <p className="m-0 whitespace-pre-line text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100" data-testid="deal-eadwyn-draft-text">{state.text}</p>
          <DraftSources sources={state.sources} />
          {state.error && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{state.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionPrimary} disabled={busy} onClick={save} data-testid="deal-eadwyn-draft-save">{EADWYN_DRAFT.save}</button>
            <button type="button" className={actionGhost} disabled={busy} onClick={discard} data-testid="deal-eadwyn-draft-discard">{EADWYN_DRAFT.discard}</button>
          </div>
        </>
      )}
    </section>
  );
}

function Notes({ dealId, userId, evidenceNote }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [body, setBody] = useState(() => typeof evidenceNote === 'string' ? evidenceNote.slice(0, NOTE_MAX) : '');
  const [tag, setTag] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode, note }
  // #4046 (#3740 2b): Ask on the new note's words, under this deal. The firm and who may fill are the
  // notes route's own rule (the Worker's deal_notes scope); the Save stays the route's, then the record step.
  const fill = useScopedFill({
    scope: SCOPED_FORMS.dealNote, parent: Number(dealId) > 0 ? Number(dealId) : null, enabled: Number(dealId) > 0,
    values: { body }, onValues: (v) => { if (v.body != null) setBody(v.body); },
  });
  // #6192: the list pages in NOTES_PAGE steps until the total is reached, and a tag chip narrows it
  // (the Worker's `?tag=`, so the count is the filtered one). A later page that fails says Unreadable
  // beside the rows already shown; a stale answer (an older tag, an older load) is dropped.
  const [filter, setFilter] = useState(NOTE_FILTER_ALL);
  const [more, setMore] = useState({ busy: false, failed: false });
  const gen = useRef(0);
  const load = (tagNow = filter) => {
    const mine = ++gen.current;
    setMore({ busy: false, failed: false });
    dealContextApi.notes(dealId, { limit: NOTES_PAGE, offset: 0, tag: tagNow })
      .then((data) => { if (mine === gen.current) setRead({ status: 'ready', data: { items: data?.items || [], total: data?.total } }); })
      .catch((e) => { if (mine !== gen.current) return; reportError('DealNotes:read', e); setRead({ status: 'unreadable' }); });
  };
  const loadMore = () => {
    if (read.status !== 'ready' || more.busy) return;
    const mine = gen.current;
    const have = read.data.items;
    setMore({ busy: true, failed: false });
    dealContextApi.notes(dealId, { limit: NOTES_PAGE, offset: have.length, tag: filter })
      .then((data) => {
        if (mine !== gen.current) return;
        const seen = new Set(have.map((n) => n.uid));
        setRead({ status: 'ready', data: { items: [...have, ...(data?.items || []).filter((n) => !seen.has(n.uid))], total: data?.total ?? read.data.total } });
        setMore({ busy: false, failed: false });
      })
      .catch((e) => { if (mine !== gen.current) return; reportError('DealNotes:more', e); setMore({ busy: false, failed: true }); });
  };
  const pick = (t) => { setFilter(t); setRead({ status: 'loading' }); load(t); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const save = async () => {
    const bad = noteError(body);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try {
      const created = await dealContextApi.addNote(dealId, { body: body.trim(), tag: tag || null });
      await fill.afterSave(created?.id);
      setBody(''); setTag(''); load();
    } catch (e) { setErr(e?.message || 'That did not save. Try again.'); } finally { setBusy(false); }
  };
  const items = read.status === 'ready' ? read.data?.items || [] : [];
  return (
    <>
      <section className={`${CARD} flex flex-col gap-3 px-4 py-4`} data-testid="deal-note-form">
        <div className="flex items-center justify-between gap-3">
          <h3 className={H3}>Your notes</h3>
          {read.status === 'ready' && <span className={SUB}>{read.data?.total ?? items.length}</span>}
        </div>
        <FillFormBar fill={fill} />
        <div className="flex flex-col gap-1.5">
          <FillLabel fill={fill} name="body" label="Note" value={body}><label htmlFor="deal-note-body" className={EYE}>New note</label></FillLabel>
          <textarea id="deal-note-body" rows={3} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} className={FIELD} placeholder="Write a note…" data-testid="deal-note-body" />
        </div>
        <div className="flex flex-col gap-1.5"><span className={EYE}>Tag</span><TagPicker value={tag} onChange={setTag} /></div>
        {err && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="deal-note-error">{err}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={SUB}>Visible to you and your firm.</span>
          <button type="button" className={BTN_S} disabled={busy} onClick={save} data-testid="deal-note-save">Save</button>
        </div>
      </section>
      <EadwynDraft dealId={dealId} fill={fill} onSaved={load} />
      <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-notes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={H3}>Notes</h3>
          {read.status === 'ready' && <span className={SUB} data-testid="deal-notes-count">{filter ? `${read.data.total ?? items.length} tagged ${filter}` : `${read.data.total ?? items.length}`}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter by tag" data-testid="deal-notes-filter">
          {[NOTE_FILTER_ALL, ...NOTE_TAGS].map((t) => (
            <button key={t || 'all'} type="button" role="radio" aria-checked={filter === t} className={TAG(filter === t)} onClick={() => pick(t)} data-testid={`deal-notes-filter-${t || 'all'}`}>{t || 'All'}</button>
          ))}
        </div>
        {read.status === 'loading' && <p className={`m-0 ${SUB}`}>Reading…</p>}
        {read.status === 'unreadable' && <Unreadable what="Your firm’s notes" claim="That is not a claim that there are none." onRetry={load} />}
        {read.status === 'ready' && !items.length && filter && (
          <p className={`m-0 py-2 ${SUB}`} data-testid="deal-notes-empty">No note is tagged {filter}.</p>
        )}
        {read.status === 'ready' && !items.length && !filter && (
          <div className="flex flex-col gap-1 py-2" data-testid="deal-notes-empty">
            <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{EMPTY.notes.title}</p>
            <p className={`m-0 ${SUB}`}>{EMPTY.notes.line}</p>
          </div>
        )}
        {items.map((n) => {
          const own = Number(n.author_user_id) === Number(userId);
          return (
            <article key={n.uid} className="flex flex-col gap-1 border-t border-axal-hairline py-2.5 dark:border-gray-700" data-testid={`deal-note-${n.uid}`}>
              <span className={EYE} data-testid={`deal-note-byline-${n.uid}`}>{noteByline(n, userId)}</span>
              <p className="m-0 whitespace-pre-line text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">{n.body}</p>
              {own && (
                <div className="flex gap-3">
                  <button type="button" className="text-[12px] font-bold text-axal-violet-deep dark:text-violet-300" onClick={() => setDialog({ mode: 'edit', note: n })} data-testid={`deal-note-edit-${n.uid}`}>Edit</button>
                  <button type="button" className="text-[12px] font-bold text-axal-destructive dark:text-red-300" onClick={() => setDialog({ mode: 'delete', note: n })} data-testid={`deal-note-delete-${n.uid}`}>Delete</button>
                </div>
              )}
            </article>
          );
        })}
        {more.failed && <Unreadable what="The older notes" claim="The notes above are still shown; that is not a claim that there are no more." onRetry={loadMore} />}
        {read.status === 'ready' && notesHaveMore(items, read.data.total) && !more.failed && (
          <button type="button" className={`${actionGhost} self-start`} disabled={more.busy} onClick={loadMore} data-testid="deal-notes-more">
            {more.busy ? 'Reading…' : `Show more (${items.length} of ${read.data.total})`}
          </button>
        )}
      </section>
      {dialog && <NoteDialog {...dialog} dealId={dealId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
  );
}

/**
 * The deal's activity: All or Mine. Other investors are never named (the Worker's rule, D1152).
 * D6164 part 3: given `filter`, the chips are the page's (`InvestorActivity`) and this draws that filter's rows.
 */
export function DealActivity({ dealId, mineFilter = false, filter: chosen = null }) {
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);
  const [own, setFilter] = useState('all');
  const filter = chosen ?? own;
  const load = () => {
    setFailed(false);
    api.dealActivity(dealId).then(setEvents).catch((e) => { reportError('DealActivity', e); setFailed(true); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  // #6193 (D6193): All · Mine · Deal · Documents · Diligence (DL14). Mine is the Notes tab's only.
  const chips = ACTIVITY_FILTERS.filter(([key]) => mineFilter || key !== 'mine');
  const shown = activityShown(events, filter);
  return (
    <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>Activity on this deal</h3>
        {chosen == null && <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
          {chips.map(([key, t]) => (
            <button key={key} type="button" role="radio" aria-checked={filter === key} className={TAG(filter === key)} onClick={() => setFilter(key)} data-testid={`deal-activity-${key}`}>{t}</button>
          ))}
        </div>}
      </div>
      {failed && <Unreadable what="The activity" claim="That is not a claim that nothing happened." onRetry={load} />}
      {!failed && events == null && <p className={`m-0 ${SUB}`}>Reading…</p>}
      {!failed && events != null && !shown.length && <p className={`m-0 ${SUB}`} data-testid="deal-activity-empty">{activityEmpty(filter)}</p>}
      {shown.map((e, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-2 dark:border-gray-700">
          <span className="text-[13px] text-axal-ink dark:text-gray-100">{e.label}</span>
          <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{e.at ? String(e.at).slice(0, 10) : e.type === 'unreadable' ? '' : 'Date not recorded'}</span>
        </div>
      ))}
      {mineFilter && <p className={`m-0 pt-1 ${SUB}`}>Rows about other investors never name them or their amounts.</p>}
    </section>
  );
}

/** DL14's notes block: the new note, Eadwyn's draft and your firm's notes. D6164 part 3: Activity's Firm notes. */
export default function DealNotes({ dealId, userId, evidenceNote = null }) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="deal-firm-notes">
      <p className={`m-0 ${SUB}`} data-testid="deal-firm-notes-line">{FIRM_NOTES_LINE}</p>
      <Notes dealId={dealId} userId={userId} evidenceNote={evidenceNote} />
    </div>
  );
}

const CHIP = (on) => `${TAG(on)} min-h-[44px] sm:min-h-[28px]`;

/**
 * D6164 part 3 (DE27, the owner's answer A): an investor's Activity. One row of chips, the activity's
 * own (All, Mine, Deal, Documents, Diligence) and Firm notes; the choice is the address's `?show=`, so
 * `/notes` lands here with Firm notes on and a refresh keeps it. A chip replaces the address rather than
 * adding a step, as a filter is not a page. Evidence's prefilled note (D6164) links to `?show=notes`.
 */
export function InvestorActivity({ dealId, userId, evidenceNote = null }) {
  const [params, setParams] = useSearchParams();
  const show = activityChoice(params.get('show'));
  const pick = (key) => setParams((was) => {
    const next = new URLSearchParams(was);
    if (key === 'all') next.delete('show'); else next.set('show', key);
    return next;
  }, { replace: true });
  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="deal-activity-tab" data-show={show}>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show" data-testid="deal-activity-show">
        {INVESTOR_ACTIVITY_CHIPS.map(([key, t]) => (
          <button key={key} type="button" role="radio" aria-checked={show === key} className={CHIP(show === key)} onClick={() => pick(key)} data-testid={`deal-activity-${key}`}>{t}</button>
        ))}
      </div>
      {show === SHOW_NOTES
        ? <DealNotes dealId={dealId} userId={userId} evidenceNote={evidenceNote} />
        : <DealActivity dealId={dealId} mineFilter filter={show} />}
    </div>
  );
}
