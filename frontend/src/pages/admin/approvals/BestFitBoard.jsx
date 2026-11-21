import React, { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AdminPageHeader, HeaderTab, Lightbox, Skeleton } from '../../../ui';
import Sheet from '../../../ui/Sheet.jsx';
import AdminBoardFrame from '../AdminBoardFrame';
import { adminConsultationsApi } from '../../../lib/api/adminConsultations';
import { RAIL_NOTE } from './approvalsModel';
import { AssignDialog, OwnerCell, UrgencyPill } from './AdminApprovals';
import { boardCrumb, boardStep, boardStrip, slaOfBand } from './boardGrammar';
import {
  BTN, BTN_DANGER, BTN_PRIMARY, BoardStrip, CARD, DoneLine, DrawerStep, EYE, FIELD, FOOT, Fact, Failed, H2, LINK, MONO, OwnerBox, PhoneBack, SUB, TD, TH,
  useBoardOwners, useLoad,
} from './boardParts';
import {
  BEST_FIT_BASE, NOTHING_LEFT, STATUS_WORDS, bestFitAt, decisionBody, decisionCopy, decisionsFor, doneText, emptyLine, historyOf, listOf, refusalOf,
  rowOf, slotStart, stripRows, tabCount, tabRows, whenText,
} from './bestFitModel';

/**
 * D5885 (#5885, part of #4716) — Best-Fit consultations, a native Approvals
 * board (AP-20 to AP-31, D5884) at /admin/approvals/best-fit, with
 * /confirmed, /completed and /cancelled as path tabs and one item at
 * /admin/approvals/best-fit/:item as a drawer over the tab it came from.
 *
 * It decides on the consultations route (#5301): only the transitions the
 * Worker allows are offered, each sends the version that was read, and a 409
 * redraws from the Worker's `current` row and never says someone else
 * decided. A Confirm field's slot time is sent only with text and survives
 * every failure. Confirm and Cancel tell the member in app (D5886); Complete tells nobody. The report
 * is Recorded or Not recorded only (option A).
 */

const CRUMB = boardCrumb('Best-Fit consultations');
const LINE = 'Members who booked a Best-Fit consultation. Confirm, cancel or complete each one here.';

function StatusWord({ status, testId }) {
  const s = STATUS_WORDS[status];
  if (!s) return <span className={SUB}>Not recorded</span>;
  return <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-axal-ink dark:text-gray-100" data-testid={testId}><span aria-hidden="true">{s.glyph}</span>{s.word}</span>;
}

const NotRec = ({ what }) => <span className={SUB}>{`○ No ${what} recorded`}</span>;

/** The decision dialog (AP-22, AP-23, AP-24): what changes, who is told, what is recorded, then the slot field. */
function BestFitDialog({ to, row, slot, setSlot, onClose, onDone, onStale }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const copy = decisionCopy(to, row);
  const testId = `bestfit-dialog-${to}`;
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const reply = await adminConsultationsApi.decide(row.id, decisionBody(to, row, slot));
      onDone(to, reply?.notified);
    } catch (e) {
      const r = refusalOf(e);
      setFailed(r);
      setBusy(false);
      if (r.kind === 'changed' || r.kind === 'illegal' || r.kind === 'unknown') onStale(r.current);
    }
  };
  const now = failed?.current ? rowOf(failed.current) : null;
  const stuck = failed && failed.kind !== 'refused';
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={onClose} testId={testId} width={520}
      footer={(
        <div className={FOOT}>
          <button type="button" className={BTN} onClick={onClose} data-testid={`${testId}-cancel`}>{stuck ? 'Close' : (copy.dismiss || 'Back')}</button>
          {stuck ? <button type="button" className={BTN_PRIMARY} onClick={onClose} data-testid={`${testId}-latest`}>{failed.kind === 'unknown' ? 'Read again' : 'View latest'}</button>
            : <button type="button" className={to === 'cancelled' ? BTN_DANGER : BTN_PRIMARY} disabled={busy} onClick={send} data-testid={`${testId}-send`}>{busy ? 'Saving…' : copy.button}</button>}
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4" data-testid={`${testId}-fields`}>
        {stuck ? (
          <div role="alert" className="flex flex-col gap-1 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] text-axal-ink dark:border-amber-800 dark:bg-amber-950/40 dark:text-gray-100" data-testid={`${testId}-${failed.kind}`}>
            <span><span aria-hidden="true">↻ </span><b>{failed.lead}</b> {failed.rest}</span>
            {now ? (
              <span className={SUB} data-testid={`${testId}-current`}>
                {`Now: ${STATUS_WORDS[now.status]?.word || 'status not recorded'} · slot ${now.slot || 'not recorded'}. `}
                {decisionsFor(now.status).length ? `Decisions now: ${decisionsFor(now.status).map((d) => d.label.replace('…', '')).join(', ')}.` : NOTHING_LEFT}
              </span>
            ) : null}
          </div>
        ) : null}
        <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-[10px] border border-axal-hairline px-3.5 py-3 text-[13px] dark:border-gray-700" data-testid={`${testId}-explain`}>
          <dt className={EYE}>What changes</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`${testId}-changes`}>{copy.changes}</dd>
          <dt className={EYE}>Who is told</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`${testId}-told`}>{copy.told}</dd>
          <dt className={EYE}>What is recorded</dt><dd className="m-0 text-axal-ink dark:text-gray-100" data-testid={`${testId}-recorded`}>{copy.recorded}</dd>
        </dl>
        {to === 'confirmed' ? (
          <label className="flex flex-col gap-1">
            <span className={EYE}>Slot time · optional</span>
            <input className={FIELD} value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="2026-11-20T14:00Z" data-testid={`${testId}-slot`} />
            <span className={SUB}>{row.slot ? `Prefilled with the recorded slot. Leave blank to keep it (${row.slot}).` : 'Leave blank to keep no slot time.'}</span>
          </label>
        ) : null}
        {failed?.kind === 'refused' ? <p role="alert" className="m-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300" data-testid={`${testId}-refused`}>{failed.lead}</p> : null}
      </div>
    </Lightbox>
  );
}

function HistoryBox({ item, testId = 'bestfit-history' }) {
  const h = historyOf(item);
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <h3 className={H2}>History</h3>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {h.rows.map((r) => (
          <li key={r.key} className="flex flex-wrap gap-x-2 text-[13px] text-axal-ink dark:text-gray-100" data-testid={`${testId}-${r.key}`}>
            <span className={`${MONO} ${SUB}`}>{r.when || 'Time not recorded'}</span><span>{r.line}</span>
          </li>
        ))}
      </ol>
      {h.text ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-${h.state}`}>{h.state === 'not_recorded' ? `○ ${h.text}` : h.text}</p> : null}
    </section>
  );
}

/** One consultation at its own address (AP-21, AP-25), over the board. */
function BestFitDrawer({ id, onClose, onDecided, own, step, from }) {
  const read = useLoad((signal) => adminConsultationsApi.consultation(id, { signal }), `bestfit-${id}`, { what: 'approvals:best-fit:item' });
  const [dialog, setDialog] = useState(null);
  // The typed slot time lives here, so it survives a failed or stale decision (AP-24).
  const [slot, setSlot] = useState(null);
  const [current, setCurrent] = useState(null);
  const item = read.status === 'ready' ? read.reply : null;
  const row = item?.booking ? rowOf(item.booking) : null;
  // The dialog keeps the row it opened on while the drawer reads again.
  const held = useRef(null);
  if (row) held.current = row;
  const shown = current ? rowOf(current) : row;
  const open = (to) => {
    if (slot == null) setSlot(slotStart(shown));
    setCurrent(null);
    setDialog(to);
  };
  const done = (to, notified) => { setDialog(null); setSlot(null); read.reload(); onDecided(doneText(to, held.current, notified), to); };
  const decisions = shown ? decisionsFor(shown.status) : [];
  return (
    <>
      <Sheet label={row ? `${row.who}, Best-Fit consultation` : 'Best-Fit consultation'} eyebrow={shown ? `Best-Fit consultation · ${STATUS_WORDS[shown.status]?.word || ''} · #${shown.id}` : 'Best-Fit consultation'}
        title={row ? row.who : 'Best-Fit consultation'} sub={row ? row.whoSub : null} onClose={onClose} testId="bestfit-drawer" width={600}
        headerActions={<DrawerStep step={step} from={from} testId="bestfit-step" prevTo={step?.prev ? `/admin/approvals/best-fit/${step.prev.id}` : null} nextTo={step?.next ? `/admin/approvals/best-fit/${step.next.id}` : null} />}
        footer={shown ? (
          <div className="flex flex-col gap-2">
            {decisions.length ? (
              <div className={`${FOOT} flex-wrap items-center`}>
                {decisions.map((d) => (
                  <button key={d.to} type="button" className={d.danger ? `${BTN} border-axal-destructive text-axal-destructive dark:border-red-700 dark:text-red-300` : BTN_PRIMARY} onClick={() => open(d.to)} data-testid={`bestfit-action-${d.to}`}>{d.label}</button>
                ))}
              </div>
            ) : <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="bestfit-nothing-left">{NOTHING_LEFT}</p>}
            <p className={`m-0 ${SUB}`} data-testid="bestfit-told">Confirming or cancelling tells the member in app. Completing tells nobody. Nothing is emailed.</p>
          </div>
        ) : null}>
        <div className="flex flex-col gap-4 px-5 py-4" data-testid="bestfit-drawer-content">
          <PhoneBack label="Best-Fit consultations" onClose={onClose} testId="bestfit-drawer-back" />
          {read.status === 'loading' ? <Skeleton.Text lines={5} /> : null}
          {read.status === 'error' ? (
            read.error?.status === 404
              ? <p className={`m-0 ${SUB}`} data-testid="bestfit-drawer-missing">That consultation is not on this board.</p>
              : <Failed what="This consultation" onRetry={read.reload} testId="bestfit-drawer-failed" />
          ) : null}
          {row && shown ? (
            <>
              {current ? <p role="status" className="m-0 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-amber-800 dark:bg-amber-950/40 dark:text-gray-100" data-testid="bestfit-drawer-current">Shown as it stands now, from the Worker’s answer.</p> : null}
              {shown.status === 'requested' ? (
                <OwnerBox owner={own.of(shown.id)} callerId={own.callerId} canTake={own.canTake} testId="bestfit-owner"
                  onTake={() => own.take({ id: shown.id, who: shown.who })} onAssign={() => own.assign([{ id: shown.id, who: shown.who }])} />
              ) : null}
              <section className="flex flex-col gap-2" data-testid="bestfit-facts">
                <h3 className={H2}>Facts</h3>
                <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Fact k="Status" v={<StatusWord status={shown.status} testId="bestfit-fact-status" />} />
                  <Fact k="Slot time" v={shown.slot} testId="bestfit-fact-slot" />
                  <Fact k="Topic" v={shown.topic} testId="bestfit-fact-topic" />
                  <Fact k="Requested" v={whenText(shown.requestedAt)} sub={shown.age ? `waiting ${shown.age}` : null} />
                  <Fact k="First triaged by" v={shown.triagedBy} testId="bestfit-fact-triaged" />
                  <Fact k="Best-Fit report" v={shown.reportRecorded ? '✓ Recorded' : null} testId="bestfit-fact-report" />
                </dl>
                <Fact k="Notes" v={shown.notes ? <span className="whitespace-pre-wrap">{shown.notes}</span> : null} testId="bestfit-fact-notes" />
              </section>
              <HistoryBox item={item} />
            </>
          ) : null}
        </div>
      </Sheet>
      {dialog && held.current ? (
        <BestFitDialog to={dialog} row={held.current} slot={slot ?? ''} setSlot={setSlot} onClose={() => setDialog(null)} onDone={done}
          onStale={(cur) => { if (cur) setCurrent(cur); read.reload(); }} />
      ) : null}
    </>
  );
}

function Board() {
  const loc = useLocation();
  const navigate = useNavigate();
  const at = bestFitAt(loc.pathname) || { tab: 'requested', item: null };
  // An item opened from a tab's row keeps that tab under its drawer.
  const under = at.item ? bestFitAt(loc.state?.from) : null;
  const tab = at.tab || (under && !under.item ? under.tab : 'requested');
  const from = at.item ? (loc.state?.from || BEST_FIT_BASE) : loc.pathname;
  const read = useLoad((signal) => adminConsultationsApi.consultations({ signal }), 'bestfit-list', { what: 'approvals:best-fit' });
  const [done, setDone] = useState(null);
  const [q, setQ] = useState('');
  const own = useBoardOwners('best-fit', setDone);
  const list = listOf(read);
  const rows = list.state === 'ready' ? tabRows(list, tab, q) : [];
  const waiting = stripRows(list);
  const strip = boardStrip({ status: list.state === 'ready' ? 'ready' : list.state === 'loading' ? 'loading' : 'error', label: 'Requested · waiting now',
    total: list.state === 'ready' ? list.counts.requested : null, rows: waiting, complete: list.state === 'ready', owners: own.owners, noun: 'consultations to decide' });
  const count = (k) => tabCount(list, k);
  // Literal paths, so the reachability walk finds every tab.
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals/best-fit" count={count('requested')} data-testid="bestfit-tab-requested">Requested</HeaderTab>
      <HeaderTab to="/admin/approvals/best-fit/confirmed" count={count('confirmed')} data-testid="bestfit-tab-confirmed">Confirmed</HeaderTab>
      <HeaderTab to="/admin/approvals/best-fit/completed" count={count('completed')} data-testid="bestfit-tab-completed">Completed</HeaderTab>
      <HeaderTab to="/admin/approvals/best-fit/cancelled" count={count('cancelled')} data-testid="bestfit-tab-cancelled">Cancelled</HeaderTab>
    </>
  );
  // Completion is history, not a decision, so only Confirm and Cancel offer View in Decided.
  const decided = (text, to) => { setDone({ text, warn: false, decided: to !== 'completed' }); read.reload(); };
  const empty = emptyLine(tab);
  const itemLink = (r, label, cls) => <Link className={cls} to={`/admin/approvals/best-fit/${r.id}`} state={{ from }} data-testid={`bestfit-open-${r.id}`}>{label}</Link>;
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-best-fit">
      <AdminPageHeader crumb={CRUMB} title="Best-Fit consultations" line={LINE} scope tabs={tabs} data-testid="approvals-board-header" />
      <DoneLine text={done} onDismiss={() => setDone(null)} />
      <BoardStrip cells={strip} testId="bestfit-strip" />
      {list.state === 'unreadable' ? (
        <div role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-axal-destructive dark:text-red-300`} data-testid="bestfit-unreadable">
          <span>{`! Unreadable. ${list.reason}`}</span>
          <button type="button" className="font-bold underline" onClick={read.reload}>Try again</button>
        </div>
      ) : list.state === 'loading' ? <Skeleton.Text lines={4} /> : (
        <section className={`${CARD} flex flex-col`} data-testid="bestfit-queue">
          <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-3 py-2.5 dark:border-gray-700">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search name, email or topic</span>
              <input className={FIELD} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="⌕ Search name, email or topic" data-testid="bestfit-search" />
            </label>
            <span className={SUB} data-testid="bestfit-sort">{tab === 'requested' ? 'Sort: Oldest first' : 'Sort: Newest first'}</span>
          </div>
          {rows.length ? (
            <div className="relative overflow-x-auto">
              {tab === 'requested' ? (
                <table className="w-full min-w-[820px]">
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                    <th className={TH}>Member</th><th className={TH}>Topic</th><th className={TH}>Requested</th><th className={TH}>Waiting</th><th className={TH}>Owner</th><th className={TH}><span className="sr-only">Review</span></th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`bestfit-row-${r.id}`}>
                        <td className={TD}><b>{r.who}</b><div className={SUB}>{r.whoSub}</div></td>
                        <td className={TD}>{r.topic || <NotRec what="topic" />}</td>
                        <td className={TD}><span className={MONO}>{whenText(r.requestedAt) || 'Not recorded'}</span><div className={SUB}>{r.slot ? `Slot: ${r.slot}` : 'No slot time recorded'}</div></td>
                        <td className={TD}><span className={MONO}>{r.age || 'Not recorded'}</span><UrgencyPill sla={slaOfBand(r.band)} /></td>
                        <td className={TD}><OwnerCell row={own.asRow({ ...r, who: r.who })} callerId={own.callerId} onAssign={own.assign} prefix="bestfit" /></td>
                        <td className={TD}>{itemLink(r, 'Review →', `${BTN} sm:min-h-[30px]`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full min-w-[760px]">
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                    <th className={TH}>Member</th><th className={TH}>Topic</th><th className={TH}>Slot time</th><th className={TH}>Decided</th><th className={TH}><span className="sr-only">Open</span></th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`bestfit-row-${r.id}`}>
                        <td className={TD}><b>{r.who}</b><div className={SUB}>{r.whoSub}</div></td>
                        <td className={TD}>{r.topic || <NotRec what="topic" />}</td>
                        <td className={TD}>{r.slot || <NotRec what="slot time" />}</td>
                        <td className={TD} data-testid={`bestfit-decided-${r.id}`}>{r.decidedAt ? <><span className={MONO}>{whenText(r.decidedAt)}</span><div className={SUB}>{r.decidedBy || 'Actor not recorded'}</div></> : <span className={SUB}>○ Not recorded</span>}</td>
                        <td className={TD}>{itemLink(r, 'Open', LINK)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 px-4 py-6" data-testid="bestfit-empty">
              {q.trim() ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">No consultation here matches that search.</p> : (
                <>
                  <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100"><span aria-hidden="true">✓ </span>{empty.lead}</p>
                  {empty.sub ? <p className={`m-0 ${SUB}`}>{empty.sub}</p> : null}
                </>
              )}
            </div>
          )}
          <p className={`m-0 px-3 py-2.5 ${SUB}`}>Members, topics, notes and slot times are the members’ own words. Confirming or cancelling here tells the member in app.</p>
        </section>
      )}
      {at.item ? <BestFitDrawer id={at.item} onClose={() => navigate(from)} onDecided={decided} own={own} step={list.state === 'ready' ? boardStep(rows, String(at.item)) : null} from={from} /> : null}
      {own.assignFor ? <AssignDialog items={own.assignFor} inbox={own.inbox} callerId={own.callerId} onClose={own.close} onDone={own.finish} /> : null}
    </div>
  );
}

export default function BestFitBoard() {
  return (
    <AdminBoardFrame workspace="Approvals" note={RAIL_NOTE} operations data-testid="admin-board-approvals-best-fit">
      <div className="pb-24 lg:pb-10"><Board /></div>
    </AdminBoardFrame>
  );
}
