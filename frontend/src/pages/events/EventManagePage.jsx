// Task #40 (E2) — EventManagePage: roster + invites + QR check-in.
// Roster actions map to the E1 routes (approve / decline / promote). Waitlisted
// registrants are grouped separately and promoted into open seats. InvitePeopleModal
// sends invitations; CheckinScanner reads ticket QR codes via the device camera.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, UserPlus, ScanLine, Download, Check, X, ChevronsUp, CheckCircle2,
} from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';
import InvitePeopleModal from '../../components/events/InvitePeopleModal';
import CheckinScanner from '../../components/events/CheckinScanner';

const REG_STATUS_STYLES = {
  registered: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  waitlisted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  attended: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function RegBadge({ status }) {
  const cls = REG_STATUS_STYLES[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {String(status || '').replace(/_/g, ' ')}
    </span>
  );
}

export default function EventManagePage() {
  const { id } = useParams();
  const { toast, showToast } = useToast();

  const [event, setEvent] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ev, roster] = await Promise.all([
        eventsApi.get(id).catch(() => null),
        eventsApi.roster(id),
      ]);
      if (ev) setEvent(ev);
      setRegistrations(Array.isArray(roster?.registrations) ? roster.registrations : (Array.isArray(roster) ? roster : []));
      setInvitations(Array.isArray(roster?.invitations) ? roster.invitations : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load the roster.' });
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const audienceRules = useMemo(() => {
    if (!event) return {};
    try {
      return typeof event.audience_rules_json === 'string'
        ? JSON.parse(event.audience_rules_json || '{}')
        : (event.audience_rules_json || {});
    } catch { return {}; }
  }, [event]);

  const act = async (rid, action) => {
    setBusyId(rid);
    try {
      await eventsApi[action](id, rid);
      showToast({ kind: 'success', msg: `Registration ${action}d.` });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || `Could not ${action} this registration.` });
    } finally {
      setBusyId(null);
    }
  };

  const onScan = async (code) => {
    setCheckingIn(true);
    try {
      await eventsApi.checkin(id, code);
      showToast({ kind: 'success', msg: 'Checked in.' });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Check-in failed — code not recognised.' });
    } finally {
      setCheckingIn(false);
    }
  };

  const waitlisted = registrations.filter((r) => r.status === 'waitlisted');
  const pending = registrations.filter((r) => r.status === 'pending' || (r.status === 'registered' && event?.approval_required));
  const active = registrations.filter((r) => !['waitlisted', 'cancelled', 'declined'].includes(r.status) && !pending.includes(r));

  const nameOf = (r) => r.name || r.full_name || r.user_name || r.email || `#${r.id}`;

  const Row = ({ r, actions }) => (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{nameOf(r)}</span>
          <RegBadge status={r.status} />
          {r.comp ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Free seat</span>
          ) : null}
        </div>
        {r.email && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{r.email}</div>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </li>
  );

  const btn = (cls) => `inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${cls}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link to="/my/events" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
        <ArrowLeft size={15} /> Back to events
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{event?.title || 'Manage event'}</h1>
          <Link to={`/events/${id}/edit`} className="text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline">Edit details</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">
            <UserPlus size={16} /> Invite people
          </button>
          <button onClick={() => setShowScanner(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            <ScanLine size={16} /> Check in
          </button>
          <a href={eventsApi.exportUrl(id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Download size={16} /> Export
          </a>
        </div>
      </div>

      <PageExplainer pageKey="event_manage" />

      {loading ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="mt-4 space-y-6">
          {/* Pending approval */}
          {pending.length > 0 && (
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <h2 className="border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Awaiting approval ({pending.length})
              </h2>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {pending.map((r) => (
                  <Row key={r.id} r={r} actions={(
                    <>
                      <button disabled={busyId === r.id} onClick={() => act(r.id, 'approve')} className={btn('bg-emerald-600 text-white hover:bg-emerald-700')}><Check size={13} /> Approve</button>
                      <button disabled={busyId === r.id} onClick={() => act(r.id, 'decline')} className={btn('border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800')}><X size={13} /> Decline</button>
                    </>
                  )} />
                ))}
              </ul>
            </section>
          )}

          {/* Confirmed / registered roster */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <h2 className="border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Registered ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No registrations yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {active.map((r) => (
                  <Row key={r.id} r={r} actions={
                    r.status === 'attended' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-300"><CheckCircle2 size={14} /> Checked in</span>
                    ) : (
                      <button disabled={busyId === r.id} onClick={() => act(r.id, 'decline')} className={btn('border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800')}><X size={13} /> Remove</button>
                    )
                  } />
                ))}
              </ul>
            )}
          </section>

          {/* Waitlist */}
          {waitlisted.length > 0 && (
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <h2 className="border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Waitlist ({waitlisted.length})
              </h2>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {waitlisted.map((r) => (
                  <Row key={r.id} r={r} actions={(
                    <button disabled={busyId === r.id} onClick={() => act(r.id, 'promote')} className={btn('bg-violet-600 text-white hover:bg-violet-700')}><ChevronsUp size={13} /> Promote</button>
                  )} />
                ))}
              </ul>
            </section>
          )}

          {/* Invitations */}
          {invitations.length > 0 && (
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <h2 className="border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                Invitations ({invitations.length})
              </h2>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{inv.invited_name || inv.invited_email || `#${inv.id}`}</span>
                      {inv.invited_email && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{inv.invited_email}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.comp ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Free seat</span> : null}
                      <RegBadge status={inv.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {showInvite && (
        <InvitePeopleModal
          eventId={id}
          audienceRules={audienceRules}
          onClose={() => setShowInvite(false)}
          onInvited={(_res, count) => {
            setShowInvite(false);
            showToast({ kind: 'success', msg: `${count} invitation${count === 1 ? '' : 's'} sent.` });
            load();
          }}
        />
      )}

      {showScanner && (
        <CheckinScanner busy={checkingIn} onDetect={onScan} onClose={() => setShowScanner(false)} />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-gray-900 dark:bg-gray-700'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
