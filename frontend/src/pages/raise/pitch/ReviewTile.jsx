import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { deckCommentsApi } from '../../../lib/api/deckComments.js';
import { deckFiguresApi } from '../../../lib/api/deckFigures.js';
import { deckCheckApi } from '../../../lib/api/deckCheck.js';
import { reportError } from '../../../lib/log';
import { asList, currentVersion } from './pitchStudioModel';
import {
  APPROVAL_UNREAD, COMMENTS_ADMIN, COMMENTS_UNREAD, FIGURES_UNREAD, FIGURE_COLUMNS, FILTERS, NO_FIGURES, NO_THREADS,
  approvalView, cardLine, deckThreads, figureRows, figuresLine, filterCounts, filterThreads, initials, personName, replyLine, threadHref,
} from './reviewTileModel';

/**
 * D4271 (#4271, D4254 P3) — the Review tile above the AI review (D900's
 * `PitchReview.jsx`, mounted after this by `PitchStudio`):
 *
 *   ps6   comments across the deck, filtered Open · Assigned to you · Mentions
 *         you · Resolved over the one `GET /api/decks/:id/comments` read; each
 *         thread with its card, its person by name, its replies, Assign and
 *         Resolve. A thread opens its card in the editor with the card's
 *         comments open.
 *   ps6   the approvals D1570 stores (`GET /api/decks/:id/approval`).
 *   ps6b  figures and their sources (`GET /api/decks/:id/figures`, D1523) with
 *         the deck check's state (`GET /api/decks/:id/check`, D900); a row
 *         opens its claim on Evidence, or its card when the check holds none.
 *
 * Comments and approvals are the founders' and the advisors they invite: an
 * admin (read only) is told where their thread is (Notes), as D1570 says.
 */

const BTN = 'inline-flex min-h-[30px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 text-[12px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const CHIP = 'inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold';
const CHIP_ON = `${CHIP} border-axal-violet bg-violet-50 text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-300`;
const CHIP_OFF = `${CHIP} border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-100`;
const AVATAR = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-axal-violet dark:bg-violet-950/60 dark:text-violet-300';
const PILL = 'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_OK = `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

/** One read into its state; a late answer for a deck no longer shown is dropped. */
function useRead(key, call) {
  const [state, setState] = useState({ status: key == null ? 'idle' : 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (key == null) { setState({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setState((s) => (s.status === 'ok' && s.key === key ? { ...s, reading: true } : { status: 'loading', data: null, key }));
    call().then((data) => { if (live) setState({ status: 'ok', data, key }); })
      .catch((e) => { if (live) setState({ status: 'error', data: null, key, error: e }); reportError('pitch-review-tile:read', e); });
    return () => { live = false; };
  }, [key, tick]);
  return [state, useCallback(() => setTick((t) => t + 1), []), setState];
}

export default function ReviewTile({ reads, readOnly, projectId }) {
  const versions = reads.versions.status === 'ok' ? asList(reads.versions.data, 'versions', 'decks') : [];
  const deckId = currentVersion(versions)?.id ?? null;
  const slides = reads.deck.status === 'ok' && Array.isArray(reads.deck.data?.slides) ? reads.deck.data.slides : [];
  if (deckId == null) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="pitch-review-tile">
      {readOnly ? (
        <section className={`${CARD} p-5`} data-testid="pitch-review-comments-admin"><p className={`m-0 ${MUTED}`}>{COMMENTS_ADMIN}</p></section>
      ) : (
        <>
          <CommentsInbox deckId={deckId} slides={slides} projectId={projectId} />
          <Approvals deckId={deckId} />
        </>
      )}
      <Figures deckId={deckId} slides={slides} projectId={projectId} />
    </div>
  );
}

function Failed({ text, onRetry, testId }) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid={testId}>
      <span className={`text-[13px] font-bold ${INK}`}>{text}</span>
      <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
    </div>
  );
}

function CommentsInbox({ deckId, slides, projectId }) {
  const [read, reload, setRead] = useRead(deckId, () => deckCommentsApi.list(deckId));
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const viewerId = read.data?.viewer?.user_id ?? null;
  const canManage = read.data?.viewer?.can_manage !== false;
  const threads = useMemo(() => deckThreads(read.data?.comments, slides), [read.data, slides]);
  const counts = useMemo(() => filterCounts(threads, viewerId), [threads, viewerId]);
  const shown = filterThreads(threads, filter, viewerId);
  const people = read.data?.people || [];

  /** A write answers the one comment it changed; the list takes it in place. */
  const apply = async (uid, call) => {
    setBusy(uid); setNotice(null);
    try {
      const res = await call();
      const next = res?.comment;
      if (next) setRead((s) => ({ ...s, data: { ...s.data, comments: (s.data?.comments || []).map((c) => (c.uid === next.uid ? next : c)) } }));
      else reload();
    } catch (e) { setNotice({ uid, text: e?.message || 'That could not be saved. Try again.' }); }
    finally { setBusy(null); }
  };

  return (
    <section className={`${CARD} flex flex-col gap-3 p-5`} aria-labelledby="pitch-review-comments-title" data-testid="pitch-review-comments">
      <div className="flex flex-col gap-0.5">
        <h2 id="pitch-review-comments-title" className={`m-0 text-[16px] font-extrabold ${INK}`}>Comments across the deck</h2>
        <span className={MUTED}>Every card’s threads in one list. Open one to answer it on its card.</span>
      </div>
      {read.status === 'loading' || read.status === 'idle' ? <div className={`${SKEL} h-24`} aria-hidden="true" data-testid="pitch-review-comments-loading" /> : null}
      {read.status === 'error' ? <Failed text={COMMENTS_UNREAD} onRetry={reload} testId="pitch-review-comments-error" /> : null}
      {read.status === 'ok' ? (
        <>
          <div role="tablist" aria-label="Filter comments" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={f.id === filter} className={f.id === filter ? CHIP_ON : CHIP_OFF}
                onClick={() => setFilter(f.id)} data-testid={`pitch-review-filter-${f.id}`}>
                {f.label} <span className="tabular-nums" data-testid={`pitch-review-filter-count-${f.id}`}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? <p className={`m-0 ${MUTED}`} data-testid="pitch-review-comments-empty">{NO_THREADS[filter]}</p> : (
            <ul className="m-0 flex list-none flex-col p-0" data-testid="pitch-review-threads">
              {shown.map((t) => (
                <li key={t.uid} className="flex flex-col gap-2 border-t border-axal-hairline py-3 dark:border-gray-700" data-testid={`pitch-review-thread-${t.uid}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={AVATAR} aria-hidden="true">{initials(t.root.author?.name)}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={`text-[13px] font-bold ${INK}`}>{personName(t.root.author)}</span>
                        <span className={MUTED}>{cardLine(t)}</span>
                        <span className={MUTED}>· {replyLine(t.replies.length)}</span>
                        <span className={t.open ? PILL_MU : PILL_OK}>{t.open ? 'Open' : 'Resolved'}</span>
                      </div>
                      <span className={`text-[13px] leading-[1.5] ${INK}`}>{t.root.body}</span>
                      {t.root.assignee ? <span className={MUTED}>Assigned to {personName(t.root.assignee)}</span> : null}
                    </div>
                  </div>
                  {notice?.uid === t.uid ? <p className="m-0 text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert">{notice.text}</p> : null}
                  <div className="flex flex-wrap items-center gap-2 pl-[38px]">
                    <Link className={LINK} to={threadHref(projectId, t.card)} data-testid={`pitch-review-thread-open-${t.uid}`}>Open on its card ›</Link>
                    {canManage ? (
                      <>
                        <label className="sr-only" htmlFor={`assign-${t.uid}`}>Assign</label>
                        <select id={`assign-${t.uid}`} className={`${GHOST} pr-6`} value={t.root.assignee?.id ?? ''} disabled={busy === t.uid}
                          onChange={(e) => apply(t.uid, () => deckCommentsApi.assign(deckId, t.uid, e.target.value ? Number(e.target.value) : null))}
                          data-testid={`pitch-review-assign-${t.uid}`}>
                          <option value="">Unassigned</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}
                        </select>
                        <button type="button" className={GHOST} disabled={busy === t.uid}
                          onClick={() => apply(t.uid, () => deckCommentsApi.resolve(deckId, t.uid, t.open))} data-testid={`pitch-review-resolve-${t.uid}`}>
                          {t.open ? 'Resolve' : 'Open again'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

function Approvals({ deckId }) {
  const [read, reload] = useRead(deckId, () => deckCommentsApi.approval(deckId));
  const view = read.status === 'ok' ? approvalView(read.data) : null;
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-5`} aria-labelledby="pitch-review-approvals-title" data-testid="pitch-review-approvals">
      <h2 id="pitch-review-approvals-title" className={`m-0 text-[16px] font-extrabold ${INK}`}>Approvals</h2>
      {read.status === 'error' ? <Failed text={APPROVAL_UNREAD} onRetry={reload} testId="pitch-review-approvals-error" /> : null}
      {read.status === 'loading' || read.status === 'idle' ? <div className={`${SKEL} h-12`} aria-hidden="true" /> : null}
      {view ? (
        <>
          <p className={`m-0 ${MUTED}`} data-testid="pitch-review-approvals-line">{view.line}</p>
          {view.rows.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {view.rows.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5" data-testid={`pitch-review-approver-${r.id}`}>
                  <span className={AVATAR} aria-hidden="true">{r.initials}</span>
                  <span className={`min-w-0 flex-1 text-[13px] font-bold ${INK}`}>{r.name}</span>
                  <span className={r.approved ? PILL_OK : PILL_MU}>{r.state}{r.at ? ` · ${r.at}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Figures({ deckId, slides, projectId }) {
  const [figures, reloadFigures] = useRead(deckId, () => deckFiguresApi.list(deckId));
  // The check is read alone: a version never checked, or a check that cannot be read, leaves every figure Not checked.
  const [check] = useRead(deckId, () => deckCheckApi.read(deckId).catch(() => null));
  const rows = figures.status === 'ok' ? figureRows(figures.data?.figures, check.status === 'ok' ? check.data : null, slides, projectId) : [];
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-5`} aria-labelledby="pitch-review-figures-title" data-testid="pitch-review-figures">
      <div className="flex flex-col gap-0.5">
        <h2 id="pitch-review-figures-title" className={`m-0 text-[16px] font-extrabold ${INK}`}>Figures and their sources</h2>
        {figures.status === 'ok' ? <span className={MUTED} data-testid="pitch-review-figures-line">{figuresLine(rows)}</span> : null}
      </div>
      {figures.status === 'error' ? <Failed text={FIGURES_UNREAD} onRetry={reloadFigures} testId="pitch-review-figures-error" /> : null}
      {figures.status === 'loading' || figures.status === 'idle' ? <div className={`${SKEL} h-20`} aria-hidden="true" /> : null}
      {figures.status === 'ok' && !rows.length ? <p className={`m-0 ${MUTED}`} data-testid="pitch-review-figures-empty">{NO_FIGURES}</p> : null}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-axal-hairline dark:border-gray-700">
                {FIGURE_COLUMNS.map((h) => <th key={h} scope="col" className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[.04em] text-axal-muted dark:text-gray-400">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-review-figure-${r.key}`}>
                  <td className="px-2 py-2"><Link className={LINK} to={r.href} data-testid={`pitch-review-figure-open-${r.key}`}>{r.name}</Link></td>
                  <td className={`px-2 py-2 text-[12.5px] ${INK}`}>{r.card}</td>
                  <td className={`px-2 py-2 text-[12.5px] ${INK}`}>{r.source}</td>
                  <td className="px-2 py-2"><span className={r.checked ? PILL_OK : PILL_MU}>{r.check}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
