import React, { useCallback, useEffect, useState } from 'react';
import { interviewGuideApi } from '../../lib/api/interviewGuide.js';
import { useRailOption } from '../../ui/railCrumbs';
import Lightbox from '../../ui/Lightbox.jsx';
import {
  AI_OFF_LINE, AI_OFF_TITLE, DRAFT_FAILED_LINE, DRAFT_FAILED_TITLE, KEPT_LINE, UNAVAILABLE_LINE,
  add, authorLine, canDraft, edit, forSave, groupsOf, holdLine, isAiOff, keepDefaults, move, remove, sentenceOf,
} from './interviewGuideModel.js';

/**
 * D6008 (#6008) — the interview guide (D5995 V27, owner pick A): questions
 * under each open hypothesis and each theme no interview has judged, kept for
 * the venture. Drawn as a panel in Record a session and as Customer
 * research's Prepare questions sheet (`PrepareQuestions`).
 *
 *   - Eadwyn drafts for a chosen segment; the hold is shown before the press,
 *     and the run is capped at it. Her questions appear in their groups with
 *     Discard, Edit and Accept; nothing is saved until Accept.
 *   - Hand edits (edit, remove, reorder, add) change the local list; Save
 *     sends the whole guide with the version read, and a conflict keeps the
 *     founder's text on the page.
 *   - AI off: the draft row becomes the switch's note; the guide stays writable.
 *   - A reader who may not write (a partner) gets the questions, no tools.
 *
 * Every control is at least 44px on a phone (V29).
 */

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 disabled:opacity-50 sm:min-h-8 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_P = 'inline-flex min-h-11 items-center justify-center rounded-[9px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 sm:min-h-8';
const ICON = 'inline-flex h-11 w-11 items-center justify-center rounded-[9px] text-[13px] text-axal-muted hover:bg-gray-100 disabled:opacity-40 sm:h-8 sm:w-8 dark:text-gray-300 dark:hover:bg-gray-800';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const RAW = 'text-[11.5px] text-axal-faint dark:text-gray-400';

function QuestionRow({ q, tools, first, last, onEdit, onRemove, onMove }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.text);
  const by = authorLine(q);
  return (
    <li className={`flex items-start gap-2 rounded-[9px] border px-2 py-2 ${q.by === 'eadwyn' ? 'border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-900/20' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`guide-q-${q.id}`}>
      {tools && (
        <div className="flex shrink-0 flex-col">
          <button type="button" className={ICON} aria-label="Move up" disabled={first} onClick={() => onMove(q.id, -1)}>▲</button>
          <button type="button" className={ICON} aria-label="Move down" disabled={last} onClick={() => onMove(q.id, 1)}>▼</button>
        </div>
      )}
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1.5">
            <label className="sr-only" htmlFor={`guide-edit-${q.id}`}>Question</label>
            <textarea id={`guide-edit-${q.id}`} className={FIELD} rows={2} maxLength={240} value={text} onChange={(e) => setText(e.target.value)} data-testid={`guide-edit-${q.id}`} />
            <div className="flex gap-1.5">
              <button type="button" className={BTN} onClick={() => { setEditing(false); setText(q.text); }}>Cancel</button>
              <button type="button" className={BTN_P} disabled={!text.trim()} onClick={() => { onEdit(q.id, text.trim()); setEditing(false); }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{q.text}</p>
            {by && <span className={RAW}>{by}</span>}
          </>
        )}
      </div>
      {tools && !editing && (
        <div className="flex shrink-0 gap-1">
          <button type="button" className={BTN} onClick={() => setEditing(true)} data-testid={`guide-edit-btn-${q.id}`}>Edit</button>
          <button type="button" className={ICON} aria-label="Remove question" onClick={() => onRemove(q.id)} data-testid={`guide-remove-${q.id}`}>✕</button>
        </div>
      )}
    </li>
  );
}

function ProposalRow({ p, onDiscard, onAccept, busy }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.text);
  return (
    <li className="flex items-start gap-2 rounded-[9px] border border-dashed border-violet-300 bg-violet-50/60 px-2 py-2 dark:border-violet-700 dark:bg-violet-900/20" data-testid={`guide-p-${p.id}`}>
      <div className="min-w-0 flex-1">
        {editing
          ? <textarea className={FIELD} rows={2} maxLength={240} value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit Eadwyn’s question" />
          : <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{p.text}</p>}
        <span className={RAW}>Eadwyn’s · until you edit it</span>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <button type="button" className={BTN} disabled={busy} onClick={() => onDiscard(p.id)}>Discard</button>
        {!editing && <button type="button" className={BTN} disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
        <button type="button" className={BTN_P} disabled={busy || !text.trim()} onClick={() => onAccept(p.id, editing && text.trim() !== p.text ? text.trim() : null)} data-testid={`guide-accept-${p.id}`}>Accept</button>
      </div>
    </li>
  );
}

export default function InterviewGuide({ projectId, api = interviewGuideApi }) {
  const [read, setRead] = useState(undefined); // undefined loading · null unavailable
  const [list, setList] = useState([]);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState({ busy: false, error: null, conflict: false });
  const [segment, setSegment] = useState('');
  const [quote, setQuote] = useState(null); // { hold_microusd, model } | { error }
  const [draft, setDraft] = useState({ busy: false, failed: null, questions: [], receipt: null });

  const load = useCallback(async () => {
    setRead(undefined);
    try {
      const r = await api.read(projectId);
      setRead(r); setList(r.guide?.questions || []); setVersion(r.guide?.version ?? 0); setDirty(false);
      setSave({ busy: false, error: null, conflict: false });
    } catch { setRead(null); }
  }, [api, projectId]);
  useEffect(() => { load(); }, [load]);

  const writer = !!read?.can_write;
  const drafting = !!read && canDraft(read);
  useRailOption(drafting ? 'draft:validate/interview-guide' : null, 'Draft questions');

  // The hold for the chosen segment, read before the press (V27).
  useEffect(() => {
    if (!drafting) return undefined;
    let live = true;
    setQuote(null);
    api.quoteDraft(projectId, segment ? Number(segment) : null)
      .then((r) => { if (live) setQuote(r.estimate); })
      .catch((e) => { if (live) setQuote({ error: sentenceOf(e, 'The cost of this draft could not be worked out.') }); });
    return () => { live = false; };
  }, [api, projectId, segment, drafting]);

  const change = (next) => { setList(next); setDirty(true); };

  async function onSave() {
    setSave({ busy: true, error: null, conflict: false });
    try {
      const r = await api.save(projectId, forSave(list), version);
      setList(r.guide.questions); setVersion(r.guide.version); setDirty(false);
      setSave({ busy: false, error: null, conflict: false });
    } catch (e) {
      setSave({ busy: false, conflict: e?.status === 409, error: sentenceOf(e, 'Couldn’t save. Your questions are kept here.') });
    }
  }

  async function onDraft() {
    if (!quote || quote.error) return;
    setDraft({ busy: true, failed: null, questions: [], receipt: null });
    try {
      const r = await api.draft(projectId, segment ? Number(segment) : null, quote);
      setDraft({ busy: false, failed: null, questions: r.draft.questions, receipt: r.receipt });
    } catch (e) {
      if (e?.status === 409) { // the hold changed: read it again before another press
        try { setQuote((await api.quoteDraft(projectId, segment ? Number(segment) : null)).estimate); } catch { /* the row keeps its error */ }
      }
      setDraft({ busy: false, failed: sentenceOf(e, DRAFT_FAILED_LINE), questions: [], receipt: null });
    }
  }

  async function onAccept(id, editedText) {
    if (dirty) { setSave((s) => ({ ...s, error: 'Save your changes before accepting Eadwyn’s question.' })); return; }
    setDraft((d) => ({ ...d, busy: true }));
    try {
      const r = await api.acceptDraft(projectId, draft.receipt, [id], editedText ? { [id]: editedText } : {}, version);
      setList(r.guide.questions); setVersion(r.guide.version);
      setDraft((d) => ({ ...d, busy: false, questions: d.questions.filter((q) => q.id !== id) }));
    } catch (e) {
      setDraft((d) => ({ ...d, busy: false }));
      setSave({ busy: false, conflict: e?.status === 409, error: sentenceOf(e, 'Couldn’t save. Your questions are kept here.') });
    }
  }

  if (read === undefined) return <section className="space-y-2" data-testid="interview-guide" aria-busy="true"><p className={RAW} role="status">Loading the interview guide</p></section>;
  if (read === null) {
    return (
      <section className="space-y-2" data-testid="interview-guide">
        <p className="m-0 text-[12.5px] font-semibold">Unavailable</p>
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="guide-unavailable">{UNAVAILABLE_LINE}</p>
        <button type="button" className={BTN} onClick={load}>Try again</button>
      </section>
    );
  }

  const groups = groupsOf(read, list, draft.questions);
  const order = list.map((q) => q.id);
  const showingDefaults = !list.length && (read.defaults || []).length > 0;
  return (
    <section className="space-y-3" data-testid="interview-guide">
      <div>
        <h3 className="m-0 text-[14px] font-bold">Interview guide</h3>
        <span className={RAW}>{KEPT_LINE}</span>
      </div>

      {writer && isAiOff(read) && (
        <div className="rounded-[9px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid="guide-ai-off">
          <p className="m-0 text-[12.5px] font-semibold">{AI_OFF_TITLE}</p>
          <p className="m-0 text-[12px] text-axal-muted dark:text-gray-300">{AI_OFF_LINE}</p>
        </div>
      )}
      {drafting && (
        <div className="space-y-1.5 rounded-[9px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid="guide-draft-row">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="guide-segment" className="text-[12.5px]">Draft for</label>
            <select id="guide-segment" className={`${FIELD} w-auto min-h-11 sm:min-h-8`} value={segment} onChange={(e) => setSegment(e.target.value)} data-testid="guide-segment">
              <option value="">No segment</option>
              {(read.material?.segments || []).map((s) => <option key={s.id} value={String(s.id)}>Segment: {s.name}</option>)}
            </select>
            <button type="button" className={BTN} disabled={draft.busy || !quote || !!quote.error} onClick={onDraft} data-testid="guide-draft">{draft.busy ? 'Drafting…' : 'Draft questions'}</button>
          </div>
          <span className={RAW} data-testid="guide-hold">{quote == null ? 'Reading the hold…' : quote.error ? quote.error : holdLine(quote.hold_microusd)}</span>
          {draft.failed && (
            <div role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="guide-draft-failed">
              <b>{DRAFT_FAILED_TITLE}</b> {draft.failed === DRAFT_FAILED_LINE ? DRAFT_FAILED_LINE : draft.failed}
            </div>
          )}
        </div>
      )}

      {showingDefaults && (
        <div className="flex flex-wrap items-center gap-2" data-testid="guide-defaults-note">
          <span className={RAW}>Labelled default discovery questions while no hypothesis is open.</span>
          {writer && <button type="button" className={BTN} onClick={() => change(keepDefaults(read.defaults))}>Keep these questions</button>}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="space-y-1.5" data-testid={`guide-group-${g.key}`}>
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-[12px] font-bold ${g.kind === 'hypothesis' ? 'text-axal-violet dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>{g.tag}</span>
            <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{g.label}</span>
          </div>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {g.questions.map((q) => (
              <QuestionRow key={q.id} q={q} tools={writer && !q.unsaved} first={order.indexOf(q.id) === 0} last={order.indexOf(q.id) === order.length - 1}
                onEdit={(id, t) => change(edit(list, id, t))} onRemove={(id) => change(remove(list, id))} onMove={(id, d) => change(move(list, id, d))} />
            ))}
            {writer && g.proposals.map((p) => (
              <ProposalRow key={p.id} p={p} busy={draft.busy} onAccept={onAccept}
                onDiscard={(id) => setDraft((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== id) }))} />
            ))}
          </ul>
          {writer && g.kind !== 'default' && (
            <button type="button" className={`${BTN} border-transparent text-axal-violet dark:text-violet-300`} onClick={() => change(add(list, g.kind === 'other' ? { kind: 'other', ref: null } : { kind: g.kind, ref: g.key }, ''))}>+ Add a question</button>
          )}
        </div>
      ))}
      {!groups.length && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="guide-empty">No question yet.</p>}
      {writer && !groups.some((g) => g.kind === 'other') && (
        <button type="button" className={`${BTN} border-transparent text-axal-violet dark:text-violet-300`} onClick={() => change(add(list, { kind: 'other', ref: null }, ''))} data-testid="guide-add">+ Add a question</button>
      )}

      {writer && (dirty || save.error) && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_P} disabled={save.busy || list.some((q) => !q.text.trim())} onClick={onSave} data-testid="guide-save">{save.busy ? 'Saving…' : 'Save the guide'}</button>
          {save.busy && <span role="status" className={RAW}>Saving</span>}
          {save.error && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="guide-save-error">✕ {save.error}</span>}
          {save.conflict && <button type="button" className={BTN} onClick={load}>Reload the guide</button>}
        </div>
      )}
    </section>
  );
}

/** Customer research's Prepare questions (V27 B): the guide as a sheet; a full-screen sheet on a phone. */
export function PrepareQuestions({ projectId }) {
  const [open, setOpen] = useState(false);
  if (!projectId) return null;
  return (
    <>
      <button type="button" className={`${BTN} self-start`} onClick={() => setOpen(true)} data-testid="button-prepare-questions">Prepare questions</button>
      {open && (
        <Lightbox label="Prepare questions" eyebrow="Customer research" title="Prepare questions" onClose={() => setOpen(false)} width={640} testId="prepare-questions">
          <InterviewGuide projectId={projectId} />
        </Lightbox>
      )}
    </>
  );
}
