import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Sheet from '../../../ui/Sheet.jsx';
import { deckCommentsApi } from '../../../lib/api/deckComments.js';
import { reportError } from '../../../lib/log';
import { comments as commentsAdapter } from './deckV2Adapter';
import { LATER } from './deckV2Model';
import {
  ADMIN_LINE, AREA_ID, COMMENT_MAX, NO_THREADS, Q_NOTE, REPLY_PLACEHOLDER, THREAD_PLACEHOLDER, UNASSIGNED,
  commentsTitle, insertMention, kindLabel, mayAct, mentionMatches, mentionQuery, mentionsIn, nameOf, openLine, threadsOn,
} from './commentsModel';

/**
 * D1570 (#3817, deck builder v2 D9) — PD-3 · pd33 "Comments on a card": the
 * sheet "Comments · card [n]" with its open count, the card's threads
 * numbered from 1, an @-mention people listbox, "Assign to" ▾ and Resolve,
 * and, at its foot, who must approve the deck before it is shared.
 *
 * It opens from the card's ⋯ (`cardMenuItems`) or from ⋯ › This card ›
 * Comments; there is no header button. The threads are read through
 * `deckV2Adapter.js` (`comments`); a post, an assignee, Resolve and the
 * approvers write through `deckCommentsApi` and nothing is posted until Post
 * is pressed. Comments are only between people: nothing here runs a model,
 * and Eadwyn never replies in a thread.
 */

const BTN = 'inline-flex min-h-[34px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-60`;
const MUTED = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const SELECT = 'min-h-[32px] rounded-[8px] border border-axal-hairline bg-white px-2 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ALERT = 'rounded-[10px] bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-axal-destructive dark:bg-red-950/40 dark:text-red-300';

const failed = (e, fallback) => (typeof e?.message === 'string' && e.message) || fallback;

/** A text box with the @-mention people listbox under it. Posts only on Post. */
function Composer({ people, me, placeholder, onPost, testId }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const q = mentionQuery(text, caret);
  const matches = q ? mentionMatches(people, q.query, me) : [];
  const listId = `${testId}-people`;

  const pick = (p) => {
    const next = insertMention(text, q.start, caret, p);
    setText(next.text); setCaret(next.caret);
    setPicked((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    setActive(0);
    // Back to the text, with the caret after the name.
    setTimeout(() => { box.current?.focus?.(); box.current?.setSelectionRange?.(next.caret, next.caret); }, 0);
  };
  const keys = (e) => {
    if (!matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[Math.min(active, matches.length - 1)]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setCaret(0); }
  };
  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try {
      await onPost(body, mentionsIn(body, picked));
      setText(''); setPicked([]); setCaret(0);
    } catch (e) {
      reportError('CommentsSheet:post', e);
      setError(failed(e, 'The comment was not posted. Try again.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="relative flex flex-col gap-1.5" data-testid={testId}>
      <textarea ref={box} className={`${FIELD} min-h-[64px]`} value={text} placeholder={placeholder} maxLength={COMMENT_MAX}
        role="combobox" aria-expanded={matches.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={matches.length ? `${listId}-${matches[Math.min(active, matches.length - 1)].id}` : undefined}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setActive(0); }}
        onSelect={(e) => setCaret(e.target.selectionStart ?? 0)} onKeyDown={keys} data-testid={`${testId}-text`} />
      {matches.length ? (
        <ul id={listId} role="listbox" aria-label="People"
          className="absolute left-0 top-[68px] z-20 m-0 w-[240px] list-none rounded-[10px] border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          data-testid={`${testId}-listbox`}>
          {matches.map((p, i) => (
            <li key={p.id} id={`${listId}-${p.id}`} role="option" aria-selected={i === active}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-[12.5px] ${i === active ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : INK}`}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} data-testid={`${testId}-person-${p.id}`}>
              <span>{nameOf(p)}</span><span className={MUTED}>{kindLabel(p.kind)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <div role="alert" className={ALERT} data-testid={`${testId}-failed`}>{error}</div> : null}
      <div className="flex justify-end">
        <button type="button" className={PRIMARY} onClick={post} disabled={busy || !text.trim()} data-testid={`${testId}-post`}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </div>
  );
}

function Thread({ deckId, thread, people, viewer, onChanged }) {
  const { root, replies, n, open } = thread;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (what, call) => {
    setBusy(true); setError(null);
    try { await call(); await onChanged(); }
    catch (e) { reportError(`CommentsSheet:${what}`, e); setError(failed(e, 'That did not save. Try again.')); }
    finally { setBusy(false); }
  };
  const canAssign = mayAct(viewer, root, 'assign');
  const canResolve = mayAct(viewer, root, 'resolve');
  const line = (c) => (
    <div key={c.uid} className="flex flex-col gap-0.5" data-testid={`pitch-comment-${c.uid}`}>
      <span className={`text-[12px] font-bold ${INK}`}>{nameOf(c.author)}</span>
      <p className={`m-0 whitespace-pre-wrap text-[12.5px] ${INK}`}>{c.body}</p>
    </div>
  );
  return (
    <li className={`flex flex-col gap-2 rounded-[12px] border p-3 ${open ? 'border-axal-hairline dark:border-gray-700' : 'border-dashed border-axal-hairline opacity-80 dark:border-gray-700'}`}
      data-testid={`pitch-comment-thread-${n}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-axal-violet font-mono text-[10.5px] font-bold text-white" aria-label={`Thread ${n}`}>{n}</span>
        {root.area ? <span className={MUTED}>On one area</span> : <span className={MUTED}>On the card</span>}
        {!open ? <span className="ml-auto font-mono text-[10px] uppercase text-axal-muted dark:text-gray-400">Resolved</span> : null}
      </div>
      {line(root)}
      {replies.map(line)}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`flex items-center gap-1.5 ${MUTED}`}>
          <span>Assign to</span>
          <select className={SELECT} value={root.assignee?.id ?? ''} disabled={!canAssign || busy}
            onChange={(e) => run('assign', () => deckCommentsApi.assign(deckId, root.uid, e.target.value === '' ? null : Number(e.target.value)))}
            data-testid={`pitch-comment-assign-${n}`}>
            <option value="">{UNASSIGNED}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
          </select>
        </label>
        {canResolve ? (
          <button type="button" className={GHOST} disabled={busy} onClick={() => run('resolve', () => deckCommentsApi.resolve(deckId, root.uid, open))}
            data-testid={`pitch-comment-resolve-${n}`}>{open ? 'Resolve' : 'Open again'}</button>
        ) : null}
      </div>
      {error ? <div role="alert" className={ALERT}>{error}</div> : null}
      {open ? (
        <Composer people={people} me={viewer.user_id} placeholder={REPLY_PLACEHOLDER} testId={`pitch-comment-reply-${n}`}
          onPost={async (body, mentions) => { await deckCommentsApi.post(deckId, { body, parent_uid: root.uid, mentions }); await onChanged(); }} />
      ) : null}
    </li>
  );
}

/** Who must approve the deck before it is shared, and the approver's own Approve. */
function Approvers({ deckId, people, viewer }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setState((s) => ({ ...s, status: s.data ? 'ok' : 'loading' }));
    return deckCommentsApi.approval(deckId).then((data) => setState({ status: 'ok', data }), (e) => { reportError('CommentsSheet:approval', e); setState({ status: 'error', data: null }); });
  }, [deckId]);
  useEffect(() => { load(); }, [load]);
  const write = async (what, call) => {
    setBusy(true); setError(null);
    try { setState({ status: 'ok', data: await call() }); }
    catch (e) { reportError(`CommentsSheet:${what}`, e); setError(failed(e, 'That did not save. Try again.')); }
    finally { setBusy(false); }
  };
  if (state.status === 'loading') return <span className={MUTED}>Reading who approves…</span>;
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-2" role="alert">
        <span className={MUTED}>Who approves this deck could not be read.</span>
        <button type="button" className={GHOST} onClick={load}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
      </div>
    );
  }
  const a = state.data;
  const named = Array.isArray(a?.approvers) ? a.approvers : [];
  const ids = named.map((x) => Number(x.user_id));
  const me = named.find((x) => Number(x.user_id) === Number(viewer.user_id));
  const addable = people.filter((p) => !ids.includes(Number(p.id)));
  return (
    <div className="flex flex-col gap-2" data-testid="pitch-comments-approvers">
      <span className={EYE}>Approval before sharing</span>
      {named.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {named.map((x) => (
            <li key={x.user_id} className={`flex items-center justify-between gap-2 text-[12.5px] ${INK}`}>
              <span>{nameOf(x)}</span>
              <span className="flex items-center gap-2">
                <span className={x.approved ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{x.approved ? `Approved v${a.version}` : 'Not approved yet'}</span>
                {viewer.can_manage ? (
                  <button type="button" className="text-[11.5px] font-bold text-axal-muted hover:text-axal-ink dark:text-gray-400" disabled={busy}
                    onClick={() => write('approvers', () => deckCommentsApi.setApprovers(deckId, ids.filter((id) => id !== Number(x.user_id))))}
                    aria-label={`Remove ${nameOf(x)} as an approver`}>Remove</button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <span className={MUTED}>No approver named. A share link is made without one.</span>}
      {viewer.can_manage && addable.length ? (
        <label className={`flex items-center gap-1.5 ${MUTED}`}>
          <span>Ask to approve</span>
          <select className={SELECT} value="" disabled={busy}
            onChange={(e) => { if (e.target.value) write('approvers', () => deckCommentsApi.setApprovers(deckId, [...ids, Number(e.target.value)])); }}
            data-testid="pitch-comments-add-approver">
            <option value="">Choose…</option>
            {addable.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
          </select>
        </label>
      ) : null}
      {me && !me.approved ? (
        <button type="button" className={PRIMARY} disabled={busy} onClick={() => write('approve', () => deckCommentsApi.approve(deckId))} data-testid="pitch-comments-approve">
          Approve v{a.version}
        </button>
      ) : null}
      {error ? <div role="alert" className={ALERT}>{error}</div> : null}
    </div>
  );
}

export default function CommentsSheet({ deckId, card, index, area = null, admin = false, onClose }) {
  const [state, setState] = useState({ status: 'loading', answer: null });
  const load = useCallback(() => commentsAdapter(deckId).then((answer) => setState({ status: 'done', answer })), [deckId]);
  useEffect(() => { load(); }, [load]);
  const answer = state.answer;
  const value = answer?.available ? answer.value : null;
  const threads = value ? threadsOn(value.comments, card, index) : [];
  const open = threads.filter((t) => t.open).length;
  const pinArea = typeof area === 'string' && AREA_ID.test(area) ? area : null;

  return (
    <Sheet label={commentsTitle(index)} title={commentsTitle(index)} eyebrow="This card" width={520} onClose={onClose} testId="pitch-sheet-comments"
      headerActions={value ? <span className="rounded-full bg-axal-lavender px-2 py-0.5 font-mono text-[11px] font-bold text-axal-violet dark:bg-violet-950/40 dark:text-violet-300" data-testid="pitch-comments-open">{openLine(open)}</span> : null}>
      <div className="flex flex-col gap-3">
        {state.status === 'loading' ? <span className={MUTED}>Reading the comments…</span> : null}
        {answer && !answer.available && !answer.unreadable ? <p className={`m-0 ${MUTED}`} data-testid="pitch-comments-off">{admin ? ADMIN_LINE : LATER}</p> : null}
        {answer?.unreadable ? (
          <div className="flex items-center gap-2" role="alert" data-testid="pitch-comments-unreadable">
            <span className={MUTED}>The comments could not be read.</span>
            <button type="button" className={GHOST} onClick={() => { setState({ status: 'loading', answer: null }); load(); }}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
          </div>
        ) : null}
        {value ? (
          <>
            {threads.length ? (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {threads.map((t) => <Thread key={t.root.uid} deckId={deckId} thread={t} people={value.people} viewer={value.viewer} onChanged={load} />)}
              </ol>
            ) : <p className={`m-0 ${MUTED}`} data-testid="pitch-comments-none">{NO_THREADS}</p>}
            <div className="flex flex-col gap-1.5">
              <span className={EYE}>New comment{pinArea ? ' · on the selected area' : ''}</span>
              <Composer people={value.people} me={value.viewer.user_id} placeholder={THREAD_PLACEHOLDER} testId="pitch-comment-new"
                onPost={async (body, mentions) => {
                  await deckCommentsApi.post(deckId, { body, card_index: index, card_uid: card?.uid || undefined, area: pinArea || undefined, mentions });
                  await load();
                }} />
            </div>
            <Approvers deckId={deckId} people={value.people} viewer={value.viewer} />
            <p className={`m-0 ${MUTED}`} data-testid="pitch-comments-q">{Q_NOTE}</p>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
