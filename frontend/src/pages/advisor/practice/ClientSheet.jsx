import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../../ui';
import { api } from '../../../lib/api';
import { Pill, SaveNote, Unrecorded, buttonClass, ghostButtonClass, inputClass, money } from '../expertise/kit';
import { dueLine, longDay, priceLine } from './engagementBoard';
import { readEveryPage } from './everyPage';
import { AccessLogTable } from './ClientAccessLog';
import {
  CLIENT_TABS, activeEngagement, clientAccess, deliveryLine, engagementSummary, grantScope, lastDelivery,
  mine, nextSession, outstanding, outstandingLine, recentActivity, relationshipLine,
} from './clientSheetModel';

/**
 * #4831 (D4831 part 2): the Practice Client Sheet (Practice v2 canvas, PX-04).
 * One client, one sheet, opened from anywhere in Practice that names a client
 * with an account. Engagements opens it here; Opportunities (#4830) and the
 * Practice root (#4829, #4832) import this same component.
 *
 * IT READS FOR ITSELF, so a caller passes only who the client is. Each source
 * is its own read, and a failed one says "could not be read" in its own tab
 * while the rest stand. Every source is joined by the client's account id,
 * never by name (`clientSheetModel.js`).
 *
 * NOTES ARE PRIVATE TO THE ADVISOR. The Worker keys them by the advisor's own
 * account and opens them only for a client who has booked this advisor; the
 * client never reads them.
 */
export default function ClientSheet({ clientUserId, clientName, onClose, now = Date.now(), initialTab = 'Overview' }) {
  const [tab, setTab] = useState(CLIENT_TABS.includes(initialTab) ? initialTab : 'Overview');
  const [src, setSrc] = useState({ loading: true });
  const tabRefs = useRef({});

  const load = useCallback(async () => {
    setSrc({ loading: true });
    const tolerate = (p) => p.then((v) => v, () => null);
    const [engagements, bookings, deliverables, grants, log] = await Promise.all([
      tolerate(readEveryPage((page) => api.listMyAdvisorEngagements(page)).then((r) => r.items)),
      tolerate(readEveryPage((page) => api.listMyAdvisorBookings(undefined, page)).then((r) => r.items)),
      tolerate(readEveryPage((page) => api.listMyAdvisorDeliverables(page)).then((r) => r.items)),
      tolerate(api.advisorClientsSharedWithMe().then((r) => (Array.isArray(r?.items) ? r.items : null))),
      tolerate(api.listMyAdvisorAccessLog().then((r) => (Array.isArray(r?.items) ? r.items : null))),
    ]);
    setSrc({
      loading: false,
      engagements: mine(engagements, clientUserId, 'founder_user_id'),
      bookings: mine(bookings, clientUserId, 'client_user_id'),
      deliverables: mine(deliverables, clientUserId, 'client_user_id'),
      access: clientAccess(grants, log, clientUserId),
    });
  }, [clientUserId]);
  useEffect(() => { load(); }, [load]);

  const onTabKey = (ev) => {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const next = CLIENT_TABS[(CLIENT_TABS.indexOf(tab) + step + CLIENT_TABS.length) % CLIENT_TABS.length];
    setTab(next);
    tabRefs.current[next]?.focus?.();
  };

  const name = clientName || `Member #${clientUserId}`;
  const initial = String(name).trim().charAt(0).toUpperCase() || '?';
  return (
    <Sheet
      title={name}
      eyebrow="Client"
      sub={src.loading ? 'Reading this client’s record…' : relationshipLine(src.engagements, src.bookings)}
      onClose={onClose}
      width={560}
      testId={`client-sheet-${clientUserId}`}
      headerActions={<span aria-hidden="true"
        className="grid h-9 w-9 place-items-center rounded-full bg-emerald-100 text-[14px] font-extrabold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{initial}</span>}
    >
      <div role="tablist" aria-label="Sections" data-testid="client-sheet-tabs" onKeyDown={onTabKey}
        className="mb-3 flex flex-wrap gap-3 border-b border-axal-hairline dark:border-gray-700">
        {CLIENT_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1}
            ref={(el) => { tabRefs.current[t] = el; }} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-0.5 pb-2 text-[12.5px] font-semibold ${tab === t
              ? 'border-emerald-600 text-axal-ink dark:text-white'
              : 'border-transparent text-axal-faint hover:text-axal-ink dark:hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} data-testid={`client-tab-${tab.toLowerCase()}`}>
        {src.loading ? <p className="text-[12.5px] text-axal-muted">Reading this client’s record…</p> : (
          <>
            {tab === 'Overview' && <Overview src={src} id={clientUserId} now={now} />}
            {tab === 'Engagements' && <EngagementsTab rows={src.engagements} />}
            {tab === 'Sessions' && <SessionsTab rows={src.bookings} />}
            {tab === 'Delivery' && <DeliveryTab rows={src.deliverables} />}
            {tab === 'Agreements' && <AgreementsTab />}
            {tab === 'Access' && <AccessTab access={src.access} />}
            {tab === 'Notes' && <NotesTab id={clientUserId} name={name} />}
          </>
        )}
      </div>
    </Sheet>
  );
}

const Unread = ({ what }) => <p className="text-[12.5px] text-amber-700 dark:text-amber-300">{what} could not be read. Close the sheet and open it again to try again.</p>;

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-axal-faint">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Overview({ src, id, now }) {
  const active = activeEngagement(src.engagements);
  const next = nextSession(src.bookings, now);
  const last = lastDelivery(src.deliverables, id);
  const owed = outstandingLine(outstanding(src.bookings), money);
  const recent = src.bookings == null && src.deliverables == null ? null : recentActivity(src.bookings, src.deliverables, id);
  const unread = <Unrecorded>Could not be read</Unrecorded>;
  return (
    <div className="grid gap-4">
      <KV rows={[
        ['Active engagement', src.engagements == null ? unread
          : active ? `${active.scope_label || 'Engagement'} · ${active.lane === 'renewal_due' ? 'renewal due' : 'signed'}`
            : <Unrecorded>No engagement under contract</Unrecorded>],
        ['Next session', src.bookings == null ? unread
          : next ? `${longDay(next.slot_starts_at) || 'Time not recorded'} · ${next.topic || 'Session'}`
            : <Unrecorded>None booked</Unrecorded>],
        ['Last delivery', src.deliverables == null ? unread
          : deliveryLine(last) || <Unrecorded>Nothing sent to this client</Unrecorded>],
        ['Recorded outstanding', src.bookings == null ? unread : <span className="tabular-nums">{owed}</span>],
      ]} />
      <section>
        <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Recent activity</h3>
        {recent == null ? unread : recent.length === 0
          ? <p className="text-[12.5px] text-axal-muted">Nothing recorded yet.</p>
          : <ul className="grid gap-1 text-[12px]" data-testid="client-recent">
            {recent.map((r) => <li key={`${r.at}-${r.text}`}><span className="mr-2 text-axal-faint">{longDay(r.at)}</span>{r.text}</li>)}
          </ul>}
      </section>
    </div>
  );
}

function EngagementsTab({ rows }) {
  if (rows == null) return <Unread what="Your engagements" />;
  if (rows.length === 0) return <p className="text-[12.5px] text-axal-muted">No engagement is linked to this client’s account.</p>;
  return (
    <ul className="grid gap-2" data-testid="client-engagements">
      {rows.map((e) => (
        <li key={e.id} className="rounded-[9px] border border-axal-hairline p-2.5 text-[12.5px] dark:border-gray-700">
          <b>{engagementSummary(e)}</b>
          <div className="mt-0.5 text-axal-faint">{dueLine(e)} · {priceLine(e, money)}</div>
        </li>
      ))}
      <li><Link to="/practice/engagements" className="text-[12px] font-semibold text-emerald-700 underline">Open Engagements</Link></li>
    </ul>
  );
}

function SessionsTab({ rows }) {
  if (rows == null) return <Unread what="Your sessions" />;
  if (rows.length === 0) return <p className="text-[12.5px] text-axal-muted">No session with this client is on record.</p>;
  return (
    <ul className="grid gap-2" data-testid="client-sessions">
      {rows.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-axal-hairline p-2.5 text-[12.5px] dark:border-gray-700">
          <span><b>{b.topic || 'Session'}</b><span className="ml-2 text-axal-faint">{longDay(b.slot_starts_at) || 'Time not recorded'}</span></span>
          <Pill tone="neutral">{b.status}</Pill>
        </li>
      ))}
    </ul>
  );
}

function DeliveryTab({ rows }) {
  if (rows == null) return <Unread what="Your deliverables" />;
  if (rows.length === 0) return <p className="text-[12.5px] text-axal-muted">No work product is filed for this client.</p>;
  return (
    <ul className="grid gap-2" data-testid="client-deliverables">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-axal-hairline p-2.5 text-[12.5px] dark:border-gray-700">
          <b>{d.title}</b><span className="text-axal-faint">{d.version_count ? `v${d.version_count}` : 'No version yet'}</span>
        </li>
      ))}
    </ul>
  );
}

function AgreementsTab() {
  return (
    <div className="grid gap-2 text-[12.5px]" data-testid="client-agreements">
      <b>No agreement is linked to this client</b>
      <p className="text-axal-muted">Nothing records which signed agreement belongs to a client yet, so none is shown here rather than one matched by name.</p>
      <Link to="/advisor/advisory/contracts" className="font-semibold text-emerald-700 underline">Open Contracts</Link>
    </div>
  );
}

function AccessTab({ access }) {
  if (access == null) return <Unread what="What this client shared with you" />;
  return (
    <div className="grid gap-3 text-[12.5px]">
      <section>
        <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Shared with you</h3>
        {access.grants.length === 0
          ? <p className="text-axal-muted">This client has not opened a record to you.</p>
          : <ul className="grid gap-1.5" data-testid="client-grants">
            {access.grants.map((g) => (
              <li key={g.grant_uid}>
                <b>{g.project_name || 'Company record'}</b>
                <span className="ml-2 text-axal-faint">{grantScope(g)} · {g.expires_at ? `until ${longDay(g.expires_at)}` : 'no end date'}</span>
              </li>
            ))}
          </ul>}
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-faint">What you opened</h3>
        {access.log == null ? <Unread what="The access log" />
          : access.log.length === 0 ? <p className="text-axal-muted">Nothing they shared has been opened.</p>
            : <AccessLogTable rows={access.log} showClient={false} />}
      </section>
    </div>
  );
}

/** "Private to you": one note per client, kept by the Worker under the advisor's own account. */
function NotesTab({ id, name }) {
  const [state, setState] = useState({ loading: true, body: '', saved: '', error: '', refused: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const read = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.advisorClientNote(id);
      const body = res?.note?.body || '';
      setState({ loading: false, body, saved: body, error: '', refused: false });
    } catch (error) {
      setState({ loading: false, body: '', saved: '', error: error?.message || 'The note could not be read.', refused: error?.status === 403 });
    }
  }, [id]);
  useEffect(() => { read(); }, [read]);

  const write = async (fn, ok) => {
    setBusy(true); setNote(null);
    try { const res = await fn(); const body = res?.note?.body || ''; setState((s) => ({ ...s, body, saved: body })); setNote({ ok: true, text: ok }); }
    catch (error) { setNote({ ok: false, text: error?.message || 'The note could not be saved.' }); }
    finally { setBusy(false); }
  };

  return (
    <section className="grid gap-2 text-[12.5px]" data-testid="client-notes">
      <h3 className="text-[13px] font-extrabold">Private to you</h3>
      {state.loading ? <p className="text-axal-muted">Reading your note…</p>
        : state.refused ? <p className="text-axal-muted">A note opens once this client has booked you.</p>
          : state.error ? <p className="text-amber-700 dark:text-amber-300">{state.error} <button type="button" className="font-semibold underline" onClick={read}>Try again</button></p>
            : <>
              <textarea className={inputClass} rows={4} value={state.body} aria-label="Private note"
                onChange={(ev) => setState((s) => ({ ...s, body: ev.target.value }))} />
              <span className="text-[11px] text-axal-faint">{name} never sees this note.</span>
              <div className="flex gap-2">
                <button type="button" className={buttonClass} disabled={busy || !state.body.trim() || state.body === state.saved}
                  onClick={() => write(() => api.saveAdvisorClientNote(id, { body: state.body }), 'Note saved.')}>Save note</button>
                {state.saved && (
                  <button type="button" className={ghostButtonClass} disabled={busy}
                    onClick={() => write(() => api.deleteAdvisorClientNote(id), 'Note deleted.')}>Delete note</button>
                )}
              </div>
              <SaveNote note={note} />
            </>}
    </section>
  );
}
