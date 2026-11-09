import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Skeleton } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { reportError } from '../../../lib/log';
import { adminApprovalsApi } from '../../../lib/api/adminApprovals';
import { refusalLine } from './approvalsModel';
import { assignItems, refusalToast } from './inboxModel';
import { BOARD_LANE, CHANGED_LEAD, CHANGED_REST, isChanged, ownersOf, pickState, readLaneOwners, rowOwner } from './boardGrammar';

/**
 * D1046 (#2894) — what the three lane boards share: the card and type styles,
 * a tile, the failed card, a pager, one read answered alone, and the decision
 * dialog every decision opens (APR5, APR7, APR8).
 */

export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';
export const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
export const PILL = 'ml-1.5 inline-block rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
export const WARN_PILL = 'inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
export const BTN = 'inline-flex min-h-[44px] items-center justify-center sm:min-h-[36px] rounded-[8px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
export const BTN_PRIMARY = 'inline-flex min-h-[44px] items-center justify-center sm:min-h-[36px] rounded-[8px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
export const BTN_DANGER = 'inline-flex min-h-[44px] items-center justify-center sm:min-h-[36px] rounded-[8px] bg-axal-destructive px-3 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50';
export const FIELD = 'w-full rounded-[8px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const SELECT = 'min-h-[44px] rounded-[8px] sm:min-h-[34px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
/** D1047 (APR15): a dialog's or a drawer's buttons, full width on a phone. */
export const FOOT = 'flex justify-end gap-2 max-sm:*:flex-1';
export const nf = (n) => Number(n).toLocaleString('en-US');
export const PAGE = 25;

export function Failed({ what, onRetry, testId }) {
  return (
    <div role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-axal-destructive dark:text-red-300`} data-testid={testId}>
      <span>{what} could not be read. That is not the same as having none.</span>
      <button type="button" className="font-bold underline" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function Tile({ label, children, sub, testId }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 px-4 py-3`} data-testid={testId}>
      <span className={EYE}>{label}</span>
      <div className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{children}</div>
      {sub ? <span className={SUB}>{sub}</span> : null}
    </div>
  );
}

/** A tile's figure: the number, a dash with why while it cannot be read, or … while reading. Never a 0 for a gap. */
export function Figure({ status, value }) {
  if (status === 'loading') return '…';
  if (status !== 'ready' || value == null) return <span title="This figure could not be read.">—</span>;
  return <span className={MONO}>{nf(value)}</span>;
}

/** "1–25 of 57" with Previous and Next. */
export function Pager({ page, total, onPage, testId }) {
  if (!total) return null;
  const from = page * PAGE + 1;
  const to = Math.min(total, (page + 1) * PAGE);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid={testId}>
      <span className={`${SUB} ${MONO}`}>{`${from}–${to} of ${nf(total)}`}</span>
      <span className="flex gap-2">
        <button type="button" className={BTN} disabled={page === 0} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}>Previous</button>
        <button type="button" className={BTN} disabled={to >= total} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}>Next</button>
      </span>
    </div>
  );
}

/**
 * One read, answered alone: `{ status: 'loading' | 'ready' | 'error', reply,
 * error, reload }`. `key` says when to read again; `enabled` false reads nothing.
 */
export function useLoad(fn, key, { enabled = true, what = 'approvals:board' } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', reply: null, error: null });
  const [tick, setTick] = useState(0);
  const call = useRef(fn);
  call.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState({ status: 'loading', reply: null, error: null });
    Promise.resolve().then(() => call.current()).then(
      (reply) => { if (live) setState({ status: 'ready', reply, error: null }); },
      (error) => { reportError(`${what}`, error); if (live) setState({ status: 'error', reply: null, error }); },
    );
    return () => { live = false; };
  }, [key, tick, enabled, what]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/**
 * The one decision dialog. It says what changes (`copy.changes`), who is told
 * (`copy.told`) and what is recorded (`copy.recorded`) — D4814 (AP-09b): as
 * three labelled lines, before any field; `blocked` is a refusal
 * known before sending (an unverified email, an expired licence), and a refusal
 * after sending is the Worker's own sentence. Nothing here uses alert or confirm.
 */
export function DecisionDialog({ copy, testId, onClose, onSend, onStale, ready = true, blocked = null, danger = false, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // D4814 (AP-18e): another decision got there first; nothing of yours was written.
  const [stale, setStale] = useState(null);
  const send = async () => {
    if (!ready || blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend();
    } catch (e) {
      if (isChanged(e)) { setStale(refusalLine(e)); setBusy(false); onStale?.(); return; }
      setError(refusalLine(e));
      setBusy(false);
    }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={onClose} testId={testId} width={520}
      footer={(
        <div className={FOOT}>
          {stale ? (
            <>
              <button type="button" className={BTN} onClick={onClose} data-testid={`${testId}-cancel`}>Close</button>
              <button type="button" className={BTN_PRIMARY} onClick={onClose} data-testid={`${testId}-latest`}>View latest</button>
            </>
          ) : (
            <>
              <button type="button" className={BTN} onClick={onClose} data-testid={`${testId}-cancel`}>Cancel</button>
              <button type="button" className={danger ? BTN_DANGER : BTN_PRIMARY} disabled={!ready || !!blocked || busy} onClick={send} data-testid={`${testId}-send`}>
                {busy ? 'Saving…' : copy.button}
              </button>
            </>
          )}
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4" data-testid={`${testId}-fields`}>
        {stale ? (
          <p role="alert" className="m-0 flex gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] text-axal-ink dark:border-amber-800 dark:bg-amber-950/40 dark:text-gray-100" data-testid={`${testId}-changed`}>
            <span aria-hidden="true">↻</span>
            <span><b>{CHANGED_LEAD}</b> {CHANGED_REST}<span className={`block ${SUB}`}>{stale}</span></span>
          </p>
        ) : null}
        <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 text-[13px] dark:border-gray-700" data-testid={`${testId}-explain`}>
          <dt className={EYE}>What changes</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`${testId}-changes`}>{copy.changes}</dd>
          <dt className={EYE}>Who is told</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`${testId}-told`}>{copy.told}</dd>
          <dt className={EYE}>What is recorded</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`${testId}-recorded`}>{copy.recorded}</dd>
        </dl>
        {children}
        {blocked ? <p role="alert" className="m-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300" data-testid={`${testId}-blocked`}>{blocked}</p> : null}
        {error ? <p role="alert" className="m-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300" data-testid={`${testId}-refused`}>{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/**
 * D1047 (APR15): on a phone a drawer is a full-screen sheet, and its way back
 * is "‹ [where it came from]" at the top, 44px tall. Hidden from `sm` up,
 * where the drawer is a dialog over the page with its own ×.
 */
export function PhoneBack({ label, onClose, testId }) {
  return (
    <button type="button" onClick={onClose} className="-mt-1 inline-flex min-h-[44px] items-center self-start text-[13px] font-bold text-axal-violet sm:hidden dark:text-violet-300" data-testid={testId}>
      {`‹ ${label}`}
    </button>
  );
}

/** A labelled text field inside a dialog. */
export function DialogField({ label, value, onChange, testId, placeholder = 'Write…', rows = 3, mono = false }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={EYE}>{label}</span>
      {rows > 1
        ? <textarea className={FIELD} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
        : <input className={`${FIELD}${mono ? ' font-mono' : ''}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />}
    </label>
  );
}

/**
 * The line a board shows after a decision lands. D4814 (AP-18d): it ends with
 * View in Decided. AP-18f: `text` may be `afterDecision`'s warning — the
 * decision recorded but the notice not delivered — drawn amber, with Check
 * item when the board passes `onCheck`. A plain string is the ordinary line.
 */
export function DoneLine({ text, onDismiss, onCheck }) {
  if (!text) return null;
  const t = typeof text === 'string' ? { text, warn: false } : text;
  return (
    <div role={t.warn ? 'alert' : 'status'} className={`${CARD} flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-axal-ink dark:text-gray-100 ${t.warn ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40' : ''}`} data-testid="board-done">
      <span className="min-w-0 flex-1">{t.warn ? <><b>{t.text}</b>{t.sub ? <span className={`block ${SUB}`}>{t.sub}</span> : null}</> : t.text}</span>
      {t.warn && onCheck ? <button type="button" className={BTN} onClick={onCheck} data-testid="board-done-check">Check item</button> : null}
      {/* Only a recorded decision is in Decided; an assignment or a copied link is not. */}
      {t.decided && !t.warn ? <Link to="/admin/approvals/decided" className={LINK} data-testid="board-done-decided">View in Decided</Link> : null}
      <button type="button" className="font-bold underline" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/** A fact in a drawer: its label and value, "Not recorded" for a gap. */
export function Fact({ k, v, sub, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <dt className={EYE}>{k}</dt>
      <dd className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{v == null || v === '' ? <span className={SUB}>Not recorded</span> : v}</dd>
      {sub ? <dd className={`m-0 ${SUB}`}>{sub}</dd> : null}
    </div>
  );
}

/**
 * D4814 (AP-08, AP-10, AP-12): the four-cell summary every board shares, from
 * `boardStrip` — a figure, "Could not be read" with why, or a skeleton.
 */
export function BoardStrip({ cells, testId = 'board-strip' }) {
  return (
    <section aria-label="Summary" className={`${CARD} grid grid-cols-2 lg:grid-cols-4`} data-testid={testId}>
      {cells.map((c) => {
        const tone = c.tone === 'bad' ? 'text-axal-destructive dark:text-red-300' : c.tone === 'warn' ? 'text-axal-amber-deep dark:text-amber-200' : 'text-axal-ink dark:text-gray-100';
        return (
          <div key={c.key} className="flex min-w-0 flex-col gap-0.5 border-axal-hairline px-4 py-3 dark:border-gray-700 max-lg:[&:nth-child(-n+2)]:border-b max-lg:odd:border-r lg:[&:not(:last-child)]:border-r" data-testid={`${testId}-${c.key}`}>
            <span className={EYE}>{c.label}</span>
            {c.state === 'loading' ? <Skeleton h={22} w="40%" />
              : c.state === 'unreadable' ? <span title={c.reason} className="cursor-help text-[13px] font-bold text-axal-destructive dark:text-red-300">Could not be read</span>
                : <span className={`text-[22px] font-extrabold tracking-[-.02em] ${MONO} ${tone}`} data-testid={`${testId}-${c.key}-value`}>{c.value}</span>}
            {c.state === 'unreadable' ? <span className={SUB}>{c.reason}</span> : c.sub ? <span className={SUB}>{c.sub}</span> : null}
          </div>
        );
      })}
    </section>
  );
}

/**
 * D4814: who owns each item on a board — the inbox read filtered to the
 * board's lane (`readLaneOwners`), the caller, whether they can take an item
 * (only an admin the Worker lists as a reviewer can be assigned), and Assign.
 * `onDone(text)` hears each outcome; the owners are read again after it.
 */
export function useBoardOwners(board, onDone) {
  const lane = BOARD_LANE[board];
  const read = useLoad(() => readLaneOwners((page) => adminApprovalsApi.inbox(page, { lane })), `owners-${lane}`, { what: `approvals:${board}:owners` });
  const owners = ownersOf(read);
  const auth = useAuth();
  const callerId = auth?.user?.id ?? null;
  const reviewers = owners.first && Array.isArray(owners.first.reviewers) ? owners.first.reviewers : [];
  const canTake = callerId != null && reviewers.some((r) => Number(r.id) === Number(callerId)) ? callerId : null;
  const [assignFor, setAssignFor] = useState(null);
  const of = (id) => rowOwner(owners, id);
  const asRow = (r) => ({ ...r, lane, assignee: of(r.id) });
  const assign = (rows) => setAssignFor(rows.map((r) => ({ lane, id: r.id, who: r.who || r.name || r.title, laneLabel: r.laneLabel || '' })));
  const take = async (row) => {
    try {
      await adminApprovalsApi.assign(canTake, assignItems([{ lane, id: row.id }]));
      onDone(`${row.who || row.name || row.title} is now assigned to you.`);
    } catch (e) {
      onDone(refusalToast(e));
    }
    read.reload();
  };
  const finish = (text) => { setAssignFor(null); onDone(text); read.reload(); };
  return { lane, owners, of, asRow, callerId, canTake, assign, take, assignFor, finish, close: () => setAssignFor(null), inbox: { reply: owners.first } };
}

/**
 * D4814 (AP-09a, AP-11a, AP-13a): the drawer's owner, first — Unassigned in
 * amber with "Nobody owns this item yet", or the owner's name; Assign to me
 * (only when the caller can be assigned and does not own it) and Change….
 * An owner that was not read says so and offers nothing.
 */
export function OwnerBox({ owner, callerId, canTake, onTake, onAssign, testId }) {
  const mine = owner.kind === 'person' && callerId != null && Number(owner.id) === Number(callerId);
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <h3 className={`m-0 ${EYE}`}>Owner</h3>
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          {owner.kind === 'none' ? <><span className="text-[13px] font-bold text-axal-amber-deep dark:text-amber-200">Unassigned</span><span className={`block ${SUB}`}>Nobody owns this item yet</span></>
            : owner.kind === 'person' ? <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{owner.text}{mine ? <span className={SUB}> · you</span> : null}</span>
              : owner.kind === 'loading' ? <span className={SUB}>Reading the owner…</span>
                : <><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Not read</span><span className={`block ${SUB}`}>The assignment record could not be read for this item.</span></>}
        </div>
        {owner.kind === 'none' || owner.kind === 'person' ? (
          <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
            {canTake && !mine ? <button type="button" className={BTN} onClick={onTake} data-testid={`${testId}-take`}>Assign to me</button> : null}
            <button type="button" className={BTN} onClick={onAssign} data-testid={`${testId}-change`}>Change…</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * D4814 (#4814, part 6, AP-09/11/13): a board drawer's place in its tab —
 * "2 of 6" with ‹ and ›, each a link to the item before or after it, carrying
 * the tab the drawer came from so closing still returns there.
 */
export function DrawerStep({ step, prevTo, nextTo, from, testId }) {
  if (!step) return null;
  const BOX = 'inline-flex h-11 w-11 items-center justify-center rounded-[7px] border border-axal-hairline text-[13px] font-bold text-axal-ink hover:bg-gray-50 sm:h-8 sm:w-8 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div className="flex items-center gap-1.5" data-testid={testId}>
      <span className={`${SUB} ${MONO}`} data-testid={`${testId}-pos`}>{step.pos}</span>
      {prevTo ? <Link to={prevTo} state={{ from }} aria-label="Previous item" className={BOX} data-testid={`${testId}-prev`}>‹</Link>
        : <span aria-hidden="true" className={`${BOX} opacity-40`}>‹</span>}
      {nextTo ? <Link to={nextTo} state={{ from }} aria-label="Next item" className={BOX} data-testid={`${testId}-next`}>›</Link>
        : <span aria-hidden="true" className={`${BOX} opacity-40`}>›</span>}
    </div>
  );
}

/**
 * D4814 (#4814, part 8, AP-08/10/12): selection on a board's waiting tab, as
 * the Inbox has it (AP-03): a box on each row, a header box that is mixed when
 * some rows are picked, and a bar floating over the bottom of the queue —
 * "N selected · Assign… · Clear" — so nothing below moves. Assigning changes
 * ownership only; a decision is still made one item at a time, in its drawer,
 * with its own reason or acknowledgement. The pick is cleared when the tab,
 * page or search changes (`resetKey`), and after an assignment.
 */
export function useBoardPick(resetKey) {
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => { setSel(new Set()); }, [resetKey]);
  return {
    sel,
    of: (rows) => pickState(sel, rows),
    toggle: (key) => setSel((s) => { const next = new Set(s); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
    setAll: (rows, on) => setSel(on ? new Set(rows.map((r) => r.key)) : new Set()),
    clear: () => setSel(new Set()),
  };
}

const ROW_PICKED = 'bg-axal-lavender dark:bg-violet-950/30';
/** A waiting row's classes and `aria-selected`, picked or not. */
export const pickedRow = (pick, row) => ({ 'aria-selected': pick.sel.has(row.key), className: `border-b border-axal-hairline last:border-0 dark:border-gray-700 ${pick.sel.has(row.key) ? ROW_PICKED : ''}` });

/** The header box: checked when every row on screen is picked, mixed when some are. */
export function PickAll({ pick, rows, testId }) {
  const st = pick.of(rows);
  return (
    <th scope="col" className="w-10 px-3 py-2">
      <input type="checkbox" aria-label="Select all on this page" checked={st.all}
        ref={(el) => { if (el) el.indeterminate = st.some; }} onChange={() => pick.setAll(rows, !st.all)} data-testid={testId} />
    </th>
  );
}

/** A row's box, named for the row ("Select Gus Demo"). */
export function PickBox({ pick, row, label, testId }) {
  return <td className="w-10 px-3 py-2.5 align-top"><input type="checkbox" aria-label={`Select ${label}`} checked={pick.sel.has(row.key)} onChange={() => pick.toggle(row.key)} data-testid={testId} /></td>;
}

/** The bar, while anything is picked: "N selected · Assign… · Clear". */
export function BoardBulkBar({ pick, rows, onAssign, testId }) {
  const st = pick.of(rows);
  if (!st.picked.length) return null;
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 h-0" data-testid={`${testId}-holder`}>
      <div role="region" aria-label="Bulk actions" className="pointer-events-auto mx-auto flex w-max max-w-[calc(100%-24px)] -translate-y-[calc(100%+12px)] flex-wrap items-center gap-2 rounded-[12px] bg-axal-ink px-3 py-2 text-white shadow-lg dark:bg-gray-100 dark:text-gray-900" data-testid={testId}>
        <span className="px-1 text-[13px] font-bold" aria-live="polite" data-testid={`${testId}-count`}>{st.line}</span>
        <button type="button" className={BTN_PRIMARY} onClick={() => onAssign(st.picked)} data-testid={`${testId}-assign`}>Assign…</button>
        <button type="button" className="inline-flex min-h-[44px] items-center rounded-[8px] px-3 text-[12.5px] font-bold hover:bg-white/10 sm:min-h-[36px] dark:hover:bg-gray-900/10" onClick={pick.clear} data-testid={`${testId}-clear`}>Clear</button>
      </div>
    </div>
  );
}

/**
 * D4814 (#4814, part 8): where a row's ⋯ popover opens. A queue scrolls
 * sideways inside its card, and a popover positioned inside that scroller is
 * clipped on the last rows (its actions sat behind the pager). So it is placed
 * against the window from its button: below it, or above when there is no room
 * below, right-aligned to it, and placed again whenever anything scrolls or the
 * window resizes, so it stays with its row.
 */
export function usePopoverPlace(trigger, open, height = 96) {
  const [place, setPlace] = useState(null);
  // Before paint, so the popover is never drawn once inside the scroller first.
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return undefined; }
    const at = () => {
      const r = trigger.current?.getBoundingClientRect?.();
      if (!r) return;
      const vh = globalThis.innerHeight || 0;
      const vw = globalThis.innerWidth || 0;
      setPlace(r.bottom + 4 + height > vh && r.top - 4 - height > 0
        ? { position: 'fixed', bottom: vh - r.top + 4, right: vw - r.right }
        : { position: 'fixed', top: r.bottom + 4, right: vw - r.right });
    };
    at();
    globalThis.addEventListener?.('scroll', at, true);
    globalThis.addEventListener?.('resize', at);
    return () => { globalThis.removeEventListener?.('scroll', at, true); globalThis.removeEventListener?.('resize', at); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return place;
}

/**
 * A waiting row's ⋯ (the canvas's More column): a disclosure popover, not an
 * ARIA menu, as the Inbox's is (AP-17) — Assign… and Copy link. Esc closes it
 * and gives focus back; Assign… gives focus back to ⋯ before its dialog opens,
 * so the dialog returns it there. Review stays the row's own button.
 */
export function BoardRowMore({ label, href, onAssign, onCopy, testId }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const close = (refocus) => { setOpen(false); if (refocus) trigger.current?.focus?.(); };
  const place = usePopoverPlace(trigger, open);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const ITEM = 'flex min-h-[44px] items-center px-3 py-1.5 text-left text-[12.5px] text-axal-ink hover:bg-gray-50 focus-visible:bg-gray-50 sm:min-h-[36px] dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800';
  return (
    <div ref={wrap} className="relative" data-testid={testId}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } }}
      onBlur={(e) => { if (open && e.relatedTarget && wrap.current && !wrap.current.contains(e.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={`${testId}-pop`} aria-label={`More actions for ${label}`} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-axal-muted hover:bg-gray-100 sm:h-8 sm:w-8 dark:text-gray-400 dark:hover:bg-gray-800" data-testid={`${testId}-button`}>⋯</button>
      {open ? (
        <div id={`${testId}-pop`} role="group" aria-label={`Actions for ${label}`} style={place || undefined} className={`${CARD} ${place ? '' : 'absolute right-0 mt-1'} z-30 flex min-w-[180px] flex-col py-1 shadow-lg`} data-testid={`${testId}-pop`}>
          <button type="button" className={ITEM} onClick={() => { close(true); onAssign(); }} data-testid={`${testId}-assign`}>Assign…</button>
          <button type="button" className={ITEM} onClick={() => { close(true); onCopy(href); }} data-testid={`${testId}-copy`}>Copy link</button>
        </div>
      ) : null}
    </div>
  );
}

/** Copies a board item's address and says so on the board's line. */
export function copyBoardLink(href, say) {
  const url = `${globalThis.location?.origin || ''}${href}`;
  Promise.resolve(globalThis.navigator?.clipboard?.writeText(url)).then(() => say('Link copied.'), () => say('The link could not be copied.'));
}

