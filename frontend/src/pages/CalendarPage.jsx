/**
 * Task #56 — Unified calendar layer.
 *
 * Single page that fans-in every bookable surface (mentor bookings, IC
 * meetings, founder check-ins) into one agenda for the signed-in user,
 * plus a "Connect Google Calendar" panel that pushes those events to
 * the user's personal calendar via OAuth refresh-token sync.
 */
import { useEffect, useMemo, useState } from 'react';
import { safeReadJSON } from '../lib/storage';
import { Calendar, Download, RefreshCw, Link as LinkIcon, X, Plus, Clock, Users as UsersIcon } from 'lucide-react';
import { api } from '../lib/api';

const KIND_LABEL = {
  mentor_booking: 'Mentor session',
  ic_meeting: 'IC meeting',
  founder_checkin: 'Founder check-in',
};
const KIND_COLOR = {
  mentor_booking: 'bg-amber-100 text-amber-700 border-amber-200',
  ic_meeting: 'bg-purple-100 text-purple-700 border-purple-200',
  founder_checkin: 'bg-blue-100 text-blue-700 border-blue-200',
};

function fmtRange(startISO, endISO) {
  const s = new Date(startISO);
  const e = new Date(endISO);
  const sameDay = s.toDateString() === e.toDateString();
  const dateOpts = { weekday: 'short', month: 'short', day: 'numeric' };
  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  return sameDay
    ? `${s.toLocaleDateString(undefined, dateOpts)} · ${s.toLocaleTimeString(undefined, timeOpts)} – ${e.toLocaleTimeString(undefined, timeOpts)}`
    : `${s.toLocaleString(undefined, { ...dateOpts, ...timeOpts })} → ${e.toLocaleString(undefined, { ...dateOpts, ...timeOpts })}`;
}

function dayKey(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [google, setGoogle] = useState(null);
  const [microsoft, setMicrosoft] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [msSyncBusy, setMsSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [showIc, setShowIc] = useState(false);
  const [showCk, setShowCk] = useState(false);

  const role = (() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? (JSON.parse(raw).role || 'founder') : 'founder';
    } catch { return 'founder'; }
  })();
  const me = (() => {
    return safeReadJSON('user', {});
  })();

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await api.listCalendarEvents();
      setEvents(r.items || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadGoogle() {
    try { setGoogle(await api.googleCalStatus()); } catch (e) { setGoogle({ available: false, connected: false, error: e.message }); }
  }
  async function loadMicrosoft() {
    try { setMicrosoft(await api.microsoftCalStatus()); }
    catch (e) { setMicrosoft({ available: false, connected: false, error: e.message }); }
  }

  useEffect(() => {
    load(); loadGoogle(); loadMicrosoft();
    // Surface OAuth callback result from query string.
    const qs = new URLSearchParams(window.location.search);
    const g = qs.get('google');
    const m = qs.get('microsoft');
    if (g === 'connected') {
      setSyncResult({ kind: 'success', text: 'Google Calendar connected.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (g === 'error' || g === 'failed') {
      setSyncResult({ kind: 'error', text: `Google connection failed${qs.get('reason') ? ` (${qs.get('reason')})` : ''}.` });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (m === 'connected') {
      setSyncResult({ kind: 'success', text: 'Outlook / Microsoft 365 calendar connected.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (m === 'error' || m === 'failed') {
      setSyncResult({ kind: 'error', text: `Outlook connection failed${qs.get('reason') ? ` (${qs.get('reason')})` : ''}.` });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const visible = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.kind === filter);
  }, [events, filter]);

  const grouped = useMemo(() => {
    const out = new Map();
    for (const e of visible) {
      const k = dayKey(e.start_at);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(e);
    }
    return Array.from(out.entries());
  }, [visible]);

  async function connectGoogle() {
    try {
      const r = await api.googleCalConnect();
      window.location.href = r.auth_url;
    } catch (e) {
      setSyncResult({ kind: 'error', text: e.message });
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm('Disconnect Google Calendar? Already-pushed events stay on Google.')) return;
    await api.googleCalDisconnect();
    await loadGoogle();
    setSyncResult({ kind: 'success', text: 'Google disconnected.' });
  }

  async function runSync() {
    setSyncBusy(true); setSyncResult(null);
    try {
      const r = await api.googleCalSync();
      setSyncResult({ kind: 'success', text: `Pushed ${r.pushed} new, updated ${r.updated}, ${r.failed} failed (of ${r.total}).` });
      await loadGoogle();
    } catch (e) {
      setSyncResult({ kind: 'error', text: e.message });
    }
    setSyncBusy(false);
  }

  async function connectMicrosoft() {
    try {
      const r = await api.microsoftCalConnect();
      window.location.href = r.auth_url;
    } catch (e) {
      setSyncResult({ kind: 'error', text: e.message });
    }
  }

  async function disconnectMicrosoft() {
    if (!window.confirm('Disconnect Outlook? Already-pushed events stay on Outlook.')) return;
    await api.microsoftCalDisconnect();
    await loadMicrosoft();
    setSyncResult({ kind: 'success', text: 'Outlook disconnected.' });
  }

  async function runMsSync() {
    setMsSyncBusy(true); setSyncResult(null);
    try {
      const r = await api.microsoftCalSync();
      setSyncResult({ kind: 'success', text: `Outlook: pushed ${r.pushed} new, updated ${r.updated}, ${r.failed} failed (of ${r.total}).` });
      await loadMicrosoft();
    } catch (e) {
      setSyncResult({ kind: 'error', text: e.message });
    }
    setMsSyncBusy(false);
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-7 h-7 text-blue-600" /> Calendar
          </h1>
        <PageExplainer pageKey="calendar" />
          <p className="text-sm text-slate-600 mt-1">
            Mentor sessions, IC meetings, and founder check-ins in one feed. Connect Google to sync to your personal calendar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={api.calendarIcsUrl()} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-50">
            <Download className="w-4 h-4" /> .ics
          </a>
          <button onClick={load} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </header>

      {/* Google sync panel */}
      <section className="border border-slate-200 rounded-lg bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-blue-600" /> Google Calendar sync
            </h2>
            {google?.available === false && (
              <p className="text-sm text-amber-700 mt-1">Server-side Google OAuth credentials are not configured. Ask an admin to set <code>GOOGLE_CLIENT_ID</code>/<code>GOOGLE_CLIENT_SECRET</code>.</p>
            )}
            {google?.available && !google.connected && (
              <p className="text-sm text-slate-600 mt-1">Connect your Google account to mirror upcoming events to your personal calendar.</p>
            )}
            {google?.connected && (
              <p className="text-sm text-slate-700 mt-1">
                Connected as <span className="font-medium">{google.google_email || 'your Google account'}</span>
                {google.last_synced_at && <> · last sync {new Date(google.last_synced_at).toLocaleString()}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {google?.connected ? (
              <>
                <button onClick={runSync} disabled={syncBusy}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${syncBusy ? 'animate-spin' : ''}`} />
                  {syncBusy ? 'Syncing…' : 'Sync now'}
                </button>
                <button onClick={disconnectGoogle}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-rose-300 text-rose-700 rounded hover:bg-rose-50">
                  Disconnect
                </button>
              </>
            ) : (
              <button onClick={connectGoogle} disabled={!google?.available}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                Connect Google
              </button>
            )}
          </div>
        </div>
        {syncResult && (
          <div className={`mt-3 text-sm px-3 py-2 rounded ${syncResult.kind === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {syncResult.text}
          </div>
        )}
      </section>

      {/* Outlook / Microsoft 365 sync panel */}
      <section className="border border-slate-200 rounded-lg bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-sky-600" /> Outlook / Microsoft 365 sync
            </h2>
            {microsoft?.available === false && (
              <p className="text-sm text-amber-700 mt-1">Server-side Microsoft OAuth credentials are not configured. Ask an admin to set <code>MICROSOFT_CLIENT_ID</code>/<code>MICROSOFT_CLIENT_SECRET</code>.</p>
            )}
            {microsoft?.available && !microsoft.connected && (
              <p className="text-sm text-slate-600 mt-1">Connect your Microsoft 365 / Outlook account to mirror upcoming events to your personal calendar.</p>
            )}
            {microsoft?.connected && (
              <p className="text-sm text-slate-700 mt-1">
                Connected as <span className="font-medium">{microsoft.microsoft_email || 'your Microsoft account'}</span>
                {microsoft.last_synced_at && <> · last sync {new Date(microsoft.last_synced_at).toLocaleString()}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {microsoft?.connected ? (
              <>
                <button onClick={runMsSync} disabled={msSyncBusy}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${msSyncBusy ? 'animate-spin' : ''}`} />
                  {msSyncBusy ? 'Syncing…' : 'Sync now'}
                </button>
                <button onClick={disconnectMicrosoft}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-rose-300 text-rose-700 rounded hover:bg-rose-50">
                  Disconnect
                </button>
              </>
            ) : (
              <button onClick={connectMicrosoft} disabled={!microsoft?.available}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50">
                Connect Outlook
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Quick add */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600 mr-1">Filter:</span>
        {[
          ['all', 'All'],
          ['mentor_booking', 'Mentor sessions'],
          ['ic_meeting', 'IC meetings'],
          ['founder_checkin', 'Check-ins'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
                  className={`text-sm px-3 py-1 rounded-full border ${filter === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            {l}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {(role === 'admin' || role === 'investor') && (
            <button onClick={() => setShowIc(true)}
                    className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700">
              <Plus className="w-4 h-4" /> New IC meeting
            </button>
          )}
          <button onClick={() => setShowCk(true)}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">
            <Plus className="w-4 h-4" /> New check-in
          </button>
        </div>
      </section>

      {/* Agenda */}
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">{error}</div>}
      {loading && <div className="text-sm text-slate-500">Loading…</div>}
      {!loading && grouped.length === 0 && (
        <div className="text-center py-12 border border-dashed border-slate-300 rounded">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500">Nothing on your calendar yet.</p>
        </div>
      )}
      <div className="space-y-6">
        {grouped.map(([day, items]) => (
          <div key={day}>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">{day}</h3>
            <ul className="space-y-2">
              {items.map((e) => (
                <li key={e.id} className="border border-slate-200 rounded-lg p-3 bg-white hover:shadow-sm transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded border ${KIND_COLOR[e.kind]}`}>{KIND_LABEL[e.kind] || e.kind}</span>
                        <span className="font-medium text-slate-900 truncate">{e.title}</span>
                        {e.status && e.status !== 'scheduled' && e.status !== 'confirmed' && (
                          <span className="text-xs text-slate-500">· {e.status}</span>
                        )}
                      </div>
                      <div className="text-sm text-slate-600 mt-1 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{fmtRange(e.start_at, e.end_at)}</span>
                        {e.attendees?.length > 0 && (
                          <span className="flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" />{e.attendees.length} attendee{e.attendees.length === 1 ? '' : 's'}</span>
                        )}
                        {e.location_uri && (
                          <a href={e.location_uri} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate">join</a>
                        )}
                      </div>
                      {e.notes && <p className="text-sm text-slate-500 mt-1 line-clamp-2">{e.notes}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {showIc && <IcMeetingModal me={me} onClose={() => setShowIc(false)} onSaved={() => { setShowIc(false); load(); }} />}
      {showCk && <CheckinModal me={me} onClose={() => setShowCk(false)} onSaved={() => { setShowCk(false); load(); }} />}
    </div>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function IcMeetingModal({ me, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: '', agenda: '', start_at: '', duration_min: 60,
    deal_id: '', location_uri: '', attendee_user_ids: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const ids = form.attendee_user_ids.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
      await api.createIcMeeting({
        title: form.title,
        agenda: form.agenda || null,
        start_at: new Date(form.start_at).toISOString(),
        duration_min: parseInt(form.duration_min, 10) || 60,
        deal_id: form.deal_id ? parseInt(form.deal_id, 10) : null,
        location_uri: form.location_uri || null,
        attendee_user_ids: ids,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="Schedule IC meeting" onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <Field label="Title">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Start">
          <input type="datetime-local" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)">
            <input type="number" min={10} max={600} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
          </Field>
          <Field label="Deal id (optional)">
            <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.deal_id} onChange={(e) => setForm({ ...form, deal_id: e.target.value })} />
          </Field>
        </div>
        <Field label="Agenda">
          <textarea rows={3} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                    value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
        </Field>
        <Field label="Meeting link">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder="https://meet.google.com/…"
                 value={form.location_uri} onChange={(e) => setForm({ ...form, location_uri: e.target.value })} />
        </Field>
        <Field label="Attendee user ids (comma-separated)">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder={`e.g. 12, 17, 23 (you (#${me?.id || '?'}) are auto-added)`}
                 value={form.attendee_user_ids} onChange={(e) => setForm({ ...form, attendee_user_ids: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !form.title || !form.start_at}
                  className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CheckinModal({ me, onClose, onSaved }) {
  const [form, setForm] = useState({
    founder_user_id: '', counterpart_user_id: '', title: '', notes: '',
    start_at: '', duration_min: 30, location_uri: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await api.createCheckin({
        founder_user_id: parseInt(form.founder_user_id, 10),
        counterpart_user_id: form.counterpart_user_id ? parseInt(form.counterpart_user_id, 10) : null,
        title: form.title,
        notes: form.notes || null,
        start_at: new Date(form.start_at).toISOString(),
        duration_min: parseInt(form.duration_min, 10) || 30,
        location_uri: form.location_uri || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell title="Schedule founder check-in" onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{err}</div>}
        <Field label="Founder user id">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder={me?.role === 'founder' ? `e.g. ${me?.id || ''}` : 'e.g. 42'}
                 value={form.founder_user_id} onChange={(e) => setForm({ ...form, founder_user_id: e.target.value })} />
        </Field>
        <Field label="Counterpart user id (optional)">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 placeholder={`leave blank to default to you (#${me?.id || '?'})`}
                 value={form.counterpart_user_id} onChange={(e) => setForm({ ...form, counterpart_user_id: e.target.value })} />
        </Field>
        <Field label="Title">
          <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Start">
          <input type="datetime-local" className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                 value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)">
            <input type="number" min={10} max={240} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
          </Field>
          <Field label="Meeting link">
            <input className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                   value={form.location_uri} onChange={(e) => setForm({ ...form, location_uri: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                    value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 border border-slate-300 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !form.founder_user_id || !form.title || !form.start_at}
                  className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
