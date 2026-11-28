/**
 * D5882 (#5882): assignment and the row's actions, moved out of AdminApprovals.jsx unchanged: the ⋯ menu, the Assign dialog, the item drawer, the phone row card and its sheet, the Owner and Review cells. The boards import `AssignDialog` and `OwnerCell` through AdminApprovals.jsx.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApprovalsApi } from '../../../lib/api/adminApprovals';
import { Lightbox, Skeleton } from '../../../ui';
import {
  ASSIGN_NOTE, assignButton, assignChoices, assignItems, assignNames, assignNoteRest, assignTitle,
  continueLine, itemView, refusalToast, reviewDestination, cardAge,
} from './inboxModel';
import { FOOT, PhoneBack, usePopoverPlace } from './boardParts';
import { matchReviewers } from './lanesDecidedModel';
import Sheet from '../../../ui/Sheet.jsx';
import { BTN, BTN_PRIMARY, BTN_SM, CARD, EYE, FailedCard, LINK, MONO, PILL, SUB, UrgencyPill, useRead } from './approvalsUi';
import { DressedDoor } from './approvalDoors';

/**
 * D4814 (AP-17): a row's ⋯ as a disclosure popover, not an ARIA menu — the
 * trigger says whether it is open, Tab moves through Assign…, Copy link and
 * Open in [destination] ↗, Esc or a click outside closes it and focus goes
 * back to ⋯. Review is never only in here: the row's Review button stays.
 */
export function RowActions({ row, onAssign, onCopy }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const popId = `approvals-pop-${row.lane}-${row.id}`;
  const close = (refocus) => { setOpen(false); if (refocus) trigger.current?.focus?.(); };
  const place = usePopoverPlace(trigger, open, 140);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const ITEM = 'flex min-h-[36px] items-center px-3 py-1.5 text-left text-[12.5px] text-axal-ink hover:bg-gray-50 focus-visible:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800';
  return (
    <div ref={wrap} className="relative" data-testid={`approvals-actions-${row.key}`}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } }}
      onBlur={(e) => { if (open && e.relatedTarget && wrap.current && !wrap.current.contains(e.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={popId} aria-label={`More actions for ${row.who}`} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-axal-muted hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" data-testid={`approvals-menu-${row.key}`}>⋯</button>
      {open ? (
        <div id={popId} aria-label={`Actions for ${row.who}`} role="group" style={place || undefined} className={`${CARD} ${place ? '' : 'absolute right-0 mt-1'} z-30 flex min-w-[200px] flex-col py-1 shadow-lg`} data-testid={`approvals-pop-${row.key}`}>
          <button type="button" data-testid={`approvals-menu-${row.key}-assign`} className={ITEM} onClick={() => { close(true); onAssign([row]); }}>Assign…</button>
          <button type="button" data-testid={`approvals-menu-${row.key}-copy`} className={ITEM} onClick={() => { close(true); onCopy(row); }}>Copy link</button>
          <span onClickCapture={() => close(false)}><DressedDoor lane={row.lane} itemId={row.id} before="Open in " after=" ↗" className={ITEM} plain={`${ITEM} text-axal-muted dark:text-gray-400`} testId={`approvals-menu-${row.key}-open-in`} /></span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Assign dialog. D4814 (AP-05): it says first that assigning changes
 * ownership only, names who it is about, and lists the reviewers as a radio
 * group — you, then lowest workload, then alphabetical, each with the items
 * they own now. The button names the person. `line` is what a caller adds
 * (Assign overdue…'s cap).
 */
export function AssignDialog({ items, title, line, inbox, callerId, onClose, onDone }) {
  const choices = assignChoices(inbox?.reply, callerId);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  // D4814 part 6 (AP-05): "Search reviewers", on names; the chosen one stays chosen while it is filtered out.
  const [find, setFind] = useState('');
  const list = choices.state === 'ready' ? choices.choices : [];
  const shown = matchReviewers(list, find);
  const send = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await adminApprovalsApi.assign(pick, assignItems(items));
      const who = list.find((c) => c.id === pick);
      onDone(`${items.length === 1 ? `${items[0].who} is` : `${items.length.toLocaleString('en-US')} items are`} now assigned to ${who ? (who.you ? 'you' : who.name) : 'that admin'}.`);
    } catch (e) {
      onDone(refusalToast(e));
    }
  };
  const heading = title || assignTitle(items);
  return (
    <Lightbox label={heading} eyebrow="Assign" title={heading} onClose={onClose} testId="approvals-assign" width={480}
      footer={(
        <div className={FOOT}>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!pick || busy} onClick={send} data-testid="approvals-assign-send">{busy ? 'Assigning…' : assignButton(list, pick)}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="m-0 flex gap-2 rounded-[8px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="approvals-assign-note">
          <span aria-hidden="true">i</span><span><b>{ASSIGN_NOTE}</b> {assignNoteRest(items.length)}</span>
        </p>
        {items.length > 1 ? <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="approvals-assign-names">{assignNames(items)}</p> : null}
        {line ? <p className={`m-0 ${SUB}`} data-testid="approvals-assign-line">{line}</p> : null}
        {choices.state !== 'ready' ? <p className={`m-0 ${SUB}`} data-testid="approvals-assign-unread">{choices.text}</p> : (
          <>
            <label className="flex flex-col gap-1">
              <span className="sr-only">Search reviewers</span>
              <input type="search" value={find} placeholder="Search reviewers" onChange={(e) => setFind(e.target.value)}
                className="min-h-[44px] w-full rounded-[7px] border border-axal-hairline bg-white px-3 text-[13px] sm:min-h-[36px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="approvals-assign-search" />
            </label>
            {!shown.length ? <p className={`m-0 ${SUB}`} data-testid="approvals-assign-none">{`No reviewer is called “${find.trim()}”.`}</p> : null}
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid="approvals-assign-list">
              <legend className="sr-only">Reviewer</legend>
              {shown.map((c) => (
                <label key={c.id} className={`flex min-h-[44px] items-center gap-2.5 rounded-[8px] border px-3 text-[13px] text-axal-ink dark:text-gray-100 ${pick === c.id ? 'border-axal-violet bg-axal-lavender dark:bg-violet-950/40' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`approvals-assign-${c.id}`}>
                  <input type="radio" name="assignee" checked={pick === c.id} onChange={() => setPick(c.id)} data-testid={`approvals-assign-pick-${c.id}`} />
                  <b className="flex-1">{c.name}</b>
                  {c.load ? <small className={`${SUB} ${MONO}`}>{c.load}</small> : null}
                </label>
              ))}
            </fieldset>
            <p className={`m-0 ${SUB}`} data-testid="approvals-assign-order">{choices.note}</p>
          </>
        )}
      </div>
    </Lightbox>
  );
}

/**
 * The item at its own address (APR3). D4814 (AP-04, AP-15): the owner first,
 * with Assign to me and Change…, then the facts, then History; its place in
 * the queue with the rows before and after it; and the action names where
 * review continues ("Continue review in KYC & KYB →") with why it is there.
 */
export function ItemDrawer({ at, step, search, state, canTake, onClose, onAssign, onTake }) {
  const read = useRead(() => adminApprovalsApi.item(at.lane, at.id), `${at.lane}-${at.id}`);
  const v = itemView(read);
  const ready = v.state === 'ready';
  const row = ready ? [{ lane: v.lane, id: v.id, who: v.who, laneLabel: v.laneLabel }] : null;
  const mine = ready && v.assignee.kind === 'person' && canTake && Number(v.assignee.id) === Number(canTake);
  const STEP_BOX = 'inline-flex h-11 w-11 items-center justify-center rounded-[7px] border border-axal-hairline bg-white text-[13px] font-bold text-axal-ink hover:bg-gray-50 sm:h-8 sm:w-8 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
  const stepper = step ? (
    <div className="flex items-center gap-1.5" data-testid="approvals-item-step">
      <span className={`${SUB} ${MONO}`} data-testid="approvals-item-pos">{step.pos}</span>
      {step.prev ? <Link to={`/admin/approvals/items/${step.prev.lane}-${step.prev.id}${search}`} state={state} aria-label="Previous item" className={STEP_BOX} data-testid="approvals-item-prev">‹</Link>
        : <span aria-hidden="true" className={`${STEP_BOX} opacity-40`}>‹</span>}
      {step.next ? <Link to={`/admin/approvals/items/${step.next.lane}-${step.next.id}${search}`} state={state} aria-label="Next item" className={STEP_BOX} data-testid="approvals-item-next">›</Link>
        : <span aria-hidden="true" className={`${STEP_BOX} opacity-40`}>›</span>}
    </div>
  ) : null;
  return (
    <Sheet label={ready ? `${v.who}, ${v.laneLabel}` : 'Item'} eyebrow={ready ? `Item · ${v.laneLabel}` : 'Item'} title={ready ? v.who : 'Item'} onClose={onClose} testId="approvals-item" width={600}
      headerActions={stepper}
      sub={ready ? <span>Waiting <span className={MONO}>{v.age}</span><UrgencyPill sla={v.sla} /></span> : null}
      footer={ready ? (
        <div className="flex flex-col gap-2" data-testid="approvals-item-continue">
          <div className="flex flex-wrap items-center gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
            <DressedDoor lane={v.lane} itemId={v.id} before="Continue review in " after=" →" className={`${BTN_PRIMARY} flex-1`} plain={`flex-1 ${SUB}`} testId="approvals-item-continue-link" />
            <button type="button" className={BTN} onClick={onClose}>Close</button>
          </div>
          <p className={`m-0 ${SUB}`} data-testid="approvals-item-why">{continueLine(v.lane)}</p>
        </div>
      ) : null}>
      <div className="flex flex-col gap-4 px-5 py-4" data-testid="approvals-item-body">
        <PhoneBack label="Approvals" onClose={onClose} testId="approvals-item-back" />
        {v.state === 'loading' ? <Skeleton.Text lines={4} /> : null}
        {v.state === 'gone' || v.state === 'missing' ? (
          <div className="flex flex-col items-start gap-2" data-testid={`approvals-item-${v.state}`}>
            <p className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">{v.text}</p>
            <button type="button" className={LINK} onClick={onClose}>Back to the inbox</button>
          </div>
        ) : null}
        {v.state === 'unread' ? (
          <FailedCard title="This item could not be read." line={v.text} error={read.error} onRetry={read.reload} testId="approvals-item-failed" />
        ) : null}
        {ready ? (
          <>
            <section className="flex flex-col gap-1.5" data-testid="approvals-item-assigned">
              <h3 className={`m-0 ${EYE}`}>Owner</h3>
              <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700">
                <div className="min-w-0 flex-1">
                  {v.assignee.kind === 'none' ? <span className="text-[13px] font-bold text-axal-amber-deep dark:text-amber-200" data-testid="approvals-item-owner">Unassigned</span>
                    : v.assignee.kind === 'unread' ? <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="approvals-item-owner">Not read</span>
                      : <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="approvals-item-owner">{v.assignee.text}{mine ? <span className={SUB}> · you</span> : null}</span>}
                  {v.assignee.kind === 'unread' ? <span className={`block ${SUB}`}>{v.assigneeReason || 'The assignment record could not be read for this item.'}</span>
                    : v.ownerLine ? <span className={`block ${SUB}`} data-testid="approvals-item-owner-line">{v.ownerLine}</span> : null}
                </div>
                {v.assignee.kind !== 'unread' ? (
                  <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
                    {canTake && !mine ? <button type="button" className={BTN_SM} onClick={() => onTake(row, read.reload)} data-testid="approvals-item-take">Assign to me</button> : null}
                    <button type="button" className={BTN_SM} onClick={() => onAssign(row, read.reload)} data-testid="approvals-item-assign">Change…</button>
                  </div>
                ) : null}
              </div>
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className={`m-0 ${EYE}`}>Facts</h3>
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]" data-testid="approvals-item-facts">
                <dt className={EYE}>Submitted</dt><dd className="m-0">{v.submitted}</dd>
                <dt className={EYE}>Profile / request</dt><dd className="m-0">{v.what}</dd>
                <dt className={EYE}>Item ID</dt><dd className={`m-0 ${MONO}`}>{v.id}</dd>
                <dt className={EYE}>Lane</dt><dd className="m-0">{v.laneLabel}{v.group ? ` · ${v.group}` : ''}</dd>
              </dl>
            </section>
            <section className="flex flex-col gap-1" data-testid="approvals-item-history">
              <h3 className={`m-0 ${EYE}`}>History</h3>
              {v.history.state !== 'ready' ? <p className={`m-0 ${SUB}`}>{v.history.text}</p>
                : v.history.lines.length ? (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {v.history.lines.map((l, i) => <li key={i} className="text-[13px]">{l.text} <span className={SUB}>· {l.day}</span></li>)}
                  </ul>
                ) : <p className={`m-0 ${SUB}`}>Nobody has assigned it yet.</p>}
              {v.history.capped ? <p className={`m-0 ${SUB}`}>The oldest entries are not shown.</p> : null}
            </section>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * D1047 (APR15), D4814 (AP-14): one item as a phone card — name, request and
 * lane, its age with the band in words, who owns it (Unassigned in amber),
 * then Open, Assign when nobody owns it, and ⋯. Every target is 44px.
 */
export function RowCard({ row, search, state, onMore, onAssign }) {
  const age = cardAge(row);
  const a = row.assignee;
  return (
    <li className="flex flex-col gap-2 border-b border-axal-hairline px-3 py-3 last:border-0 dark:border-gray-700" data-testid={`approvals-card-${row.key}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link to={`/admin/approvals/items/${row.lane}-${row.id}${search}`} state={state} className="inline-flex min-h-[44px] items-center text-[14px] font-bold text-axal-ink dark:text-gray-100" data-testid={`approvals-card-open-${row.key}`}>{row.who}</Link>
        <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{row.what} · {row.laneLabel}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[age.tone] || PILL.plain}`} data-testid={`approvals-card-age-${row.key}`}>{age.text}</span>
          <span className="text-[12px]" data-testid={`approvals-card-owner-${row.key}`}>
            {a.kind === 'none' ? <span className="font-bold text-axal-amber-deep dark:text-amber-200">Unassigned</span>
              : a.kind === 'unread' ? <span className={SUB}>Owner not read</span>
                : <span className="text-axal-ink dark:text-gray-100">Assigned to {a.text}</span>}
          </span>
        </div>
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Review in {reviewDestination(row.lane)}</span>
      </div>
      <div className="flex gap-2">
        <Link to={`/admin/approvals/items/${row.lane}-${row.id}${search}`} state={state} className={`${BTN_PRIMARY} flex-1`} data-testid={`approvals-card-review-${row.key}`}>Open</Link>
        {a.kind === 'none' ? <button type="button" className={`${BTN} flex-1`} onClick={() => onAssign([row])} data-testid={`approvals-card-assign-${row.key}`}>Assign</button> : null}
        <button type="button" aria-label={`More actions for ${row.who}`} onClick={() => onMore(row)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`approvals-card-more-${row.key}`}>⋯</button>
      </div>
    </li>
  );
}

export const SHEET_ITEM = 'flex min-h-[44px] items-center rounded-[8px] px-3 text-left text-[14px] font-semibold text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800';

/** D1047 (APR15), D4814: a card's ⋯ as a bottom sheet: Assign…, Copy link, Open in [destination] — a list of actions, not a menu. */
export function RowSheet({ row, onAssign, onCopy, onClose }) {
  return (
    <Lightbox label={`More actions for ${row.who}`} title={row.who} sub={row.laneLabel} phone="sheet" onClose={onClose} testId="approvals-row-sheet" width={420}>
      <div className="flex flex-col gap-1 px-3 py-3">
        <button type="button" className={SHEET_ITEM} onClick={() => { onClose(); onAssign([row]); }} data-testid="approvals-row-sheet-assign">Assign…</button>
        <button type="button" className={SHEET_ITEM} onClick={() => { onClose(); onCopy(row); }} data-testid="approvals-row-sheet-copy">Copy link</button>
        <span onClickCapture={onClose}><DressedDoor lane={row.lane} itemId={row.id} before="Open in " after=" ↗" className={SHEET_ITEM} plain={`${SHEET_ITEM} text-axal-muted dark:text-gray-400`} testId="approvals-row-sheet-open-in" /></span>
      </div>
    </Lightbox>
  );
}

/**
 * D4814: who holds a row. Unassigned is amber with Assign beside it; an unread
 * record is "Not read", never "Unassigned". Part 3: the native boards draw it
 * too, under their own `prefix`.
 */
export function OwnerCell({ row, callerId, onAssign, prefix = 'approvals' }) {
  const a = row.assignee;
  const id = `${prefix}-owner-${row.key}`;
  if (a.kind === 'loading') return <span aria-label="Reading the owner" className={SUB} data-testid={id}>…</span>;
  if (a.kind === 'unread') return <span title="The assignment record could not be read for this item." className={`cursor-help ${SUB}`} data-testid={id}>Not read</span>;
  if (a.kind === 'none') {
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid={id}>
        <span className="font-bold text-axal-amber-deep dark:text-amber-200">Unassigned</span>
        <button type="button" className={BTN_SM} onClick={() => onAssign([row])} data-testid={`${prefix}-owner-assign-${row.key}`}>Assign</button>
      </span>
    );
  }
  const you = callerId != null && Number(a.id) === Number(callerId);
  return <span data-testid={id}>{a.text}{you ? <span className={SUB}> · you</span> : null}</span>;
}

/** D4814: Review opens the item here; the line under it says where review continues. */
export function ReviewCell({ row, search, state }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Link to={`/admin/approvals/items/${row.lane}-${row.id}${search}`} state={state} className={BTN_SM} data-testid={`approvals-review-${row.key}`}>Review</Link>
      <span className="text-[11px] text-axal-muted dark:text-gray-400" data-testid={`approvals-review-in-${row.key}`}>in {reviewDestination(row.lane)}</span>
    </div>
  );
}
