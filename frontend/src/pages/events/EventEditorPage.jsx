// Task #40 (E2) — EventEditorPage: create (/events/new) + edit (/events/:id/edit).
// Title, type, schedule + timezone, location, cover, capacity, waitlist,
// approval, visibility, and the audience-rules builder (design §7.1). A draft
// or sent-back event offers one action (D1031, #2872): "Send for review" when
// public, "Publish" when unlisted or private. Either opens a dialog that says
// what happens and who is told; the save is the dialog's button.
// D1036 (#2877): the shared host header (MEV12a) carries that one action, and
// /events/new has its own (MEV12b); a new event lands on its Details tab.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Gift } from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';
import { EVENT_TYPE_IDS } from '../../lib/eventTypes';
import Lightbox from '../../ui/Lightbox';
import { publishAction } from './eventOrganiserModel';
import HostHeader, { NewEventHeader } from './HostHeader';
import { pendingCount } from './hostHeaderModel';

const EVENT_TYPES = EVENT_TYPE_IDS;
const LOCATION_KINDS = ['virtual', 'in_person', 'hybrid'];
const VISIBILITIES = ['private', 'unlisted', 'public'];

const AUDIENCE_RULES = [
  { key: 'comp_official_partners', label: 'Official partners', help: 'Active official partners get a free seat.' },
  { key: 'comp_invested_lps', label: 'Invested LPs', help: 'Limited partners who have invested.' },
  { key: 'comp_investors', label: 'Investors', help: 'Users with an investor profile.' },
  { key: 'comp_host_connections', label: 'My connections', help: 'Your accepted network connections.' },
  { key: 'comp_project_founders', label: 'Startup founders', help: 'Founders of active startups.' },
];

const COMMON_TZS = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Singapore',
  'Asia/Tokyo', 'Australia/Sydney',
];

function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-200';
const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500';

export default function EventEditorPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const browserTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }, []);

  const [form, setForm] = useState({
    title: '', type: 'meetup', summary: '', description: '',
    starts_at: '', ends_at: '', timezone: browserTz,
    location_kind: 'virtual', location_text: '', location_url: '', cover_url: '',
    capacity: '', waitlist_enabled: true, approval_required: false,
    visibility: 'private',
  });
  const [rules, setRules] = useState({});
  const [status, setStatus] = useState('draft');
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(null);
  const [publishError, setPublishError] = useState('');
  // What the header shows: the event as last read or saved, and Registrations' count.
  const [saved, setSaved] = useState(null);
  const [pending, setPending] = useState(undefined);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const reply = await eventsApi.get(id);
        if (!alive) return;
        if (!reply?.event || !Array.isArray(reply.agenda)) throw new Error('Event response is incomplete.');
        const ev = reply.event;
        setForm({
          title: ev.title || '', type: ev.type || 'meetup',
          summary: ev.summary || '', description: ev.description || '',
          starts_at: isoToLocalInput(ev.starts_at), ends_at: isoToLocalInput(ev.ends_at),
          timezone: ev.timezone || browserTz,
          location_kind: ev.location_kind || 'virtual',
          location_text: ev.location_text || '', location_url: ev.location_url || '',
          cover_url: ev.cover_url || '',
          capacity: ev.capacity ?? '',
          waitlist_enabled: ev.waitlist_enabled !== 0 && ev.waitlist_enabled !== false,
          approval_required: ev.approval_required === 1 || ev.approval_required === true,
          visibility: ev.visibility || 'private',
        });
        setStatus(ev.status || 'draft');
        setRules(ev.audience_rules || {});
        setSaved(ev);
        // The count is the header's own read: a failure is no number, never a 0.
        Promise.resolve().then(() => eventsApi.roster(id))
          .then((roster) => { if (alive) setPending(pendingCount(roster, ev.approval_required === 1 || ev.approval_required === true)); })
          .catch(() => { if (alive) setPending(null); });
      } catch (e) {
        if (alive) setLoadError(e?.message || 'Could not load this event.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, isEdit, browserTz, showToast]);

  const payload = useCallback(() => ({
    title: form.title.trim(),
    type: form.type,
    summary: form.summary.trim() || null,
    description: form.description.trim() || null,
    starts_at: localInputToIso(form.starts_at),
    ends_at: localInputToIso(form.ends_at),
    timezone: form.timezone,
    location_kind: form.location_kind,
    location_text: form.location_text.trim() || null,
    location_url: form.location_url.trim() || null,
    cover_url: form.cover_url.trim() || null,
    capacity: form.capacity === '' ? null : Number(form.capacity),
    waitlist_enabled: form.waitlist_enabled ? 1 : 0,
    approval_required: form.approval_required ? 1 : 0,
    visibility: form.visibility,
    audience_rules_json: JSON.stringify(rules),
  }), [form, rules]);

  const save = async () => {
    if (!form.title.trim()) { showToast({ kind: 'error', msg: 'Add a title first.' }); return; }
    if (!form.starts_at) { showToast({ kind: 'error', msg: 'Pick a start date and time.' }); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const body = payload();
        await eventsApi.update(id, body);
        setSaved((ev) => (ev ? { ...ev, ...body } : ev));
        showToast({ kind: 'success', msg: 'Event saved.' });
      } else {
        const created = await eventsApi.create(payload());
        const newId = created?.id ?? created?.event?.id;
        showToast({ kind: 'success', msg: 'Event created.' });
        // D1036: a new event lands on its Details tab, not on the manage page.
        if (newId) navigate(`/events/${newId}/edit`);
        else navigate('/my/events/hosting');
      }
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not save the event.' });
    } finally {
      setSaving(false);
    }
  };

  // A new event is a draft until it is saved, so it offers its visibility's action too.
  const action = publishAction(form.visibility, isEdit ? status : 'draft');
  const openPublish = () => { setPublishError(''); setPublishing(action); };
  const closePublish = () => { if (!saving) setPublishing(null); };

  // The save is the dialog's button; a refusal stays in the dialog.
  const confirmPublish = async () => {
    const asked = publishing;
    setSaving(true);
    setPublishError('');
    try {
      if (!isEdit) {
        // MEV12b: create the draft, submit it, and land on its Details tab.
        if (!form.title.trim()) throw new Error('Add a title first.');
        if (!form.starts_at) throw new Error('Pick a start date and time.');
        const created = await eventsApi.create(payload());
        const newId = created?.id ?? created?.event?.id;
        if (!newId) throw new Error('The reply did not say the new event\'s id.');
        await eventsApi.submitReview(newId);
        setPublishing(null);
        showToast({ kind: 'success', msg: asked.done });
        navigate(`/events/${newId}/edit`);
        return;
      }
      const body = payload();
      await eventsApi.update(id, body);
      const reply = await eventsApi.submitReview(id);
      const next = reply?.event?.status;
      if (!next) throw new Error('The reply did not say the event\'s status.');
      setStatus(next);
      setSaved((ev) => (ev ? { ...ev, ...body, status: next } : ev));
      setPublishing(null);
      showToast({ kind: 'success', msg: asked.done });
    } catch (e) {
      setPublishError(e?.message || (asked.kind === 'review' ? 'Could not send for review.' : 'Could not publish.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="py-12 text-center text-gray-500 dark:text-gray-400">Loading…</p>;
  }

  if (loadError) {
    return <p role="alert" className="py-12 text-center text-gray-500 dark:text-gray-400">Unreadable — {loadError}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {isEdit
        ? <HostHeader event={{ ...(saved || {}), id, status }} screen="details" pending={pending} publishLabel={action?.label} onPublish={openPublish} busy={saving} />
        : <NewEventHeader primaryLabel={action?.label} onSaveDraft={save} onPrimary={openPublish} busy={saving} />}
      <PageExplainer pageKey="event_editor" />

      <div className="mt-4 space-y-6">
        {/* Basics */}
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
          <div>
            <label className={labelCls}>Title</label>
            <input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Spring Demo Day" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Type</label>
              <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value)}>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Cover image URL</label>
              <input className={inputCls} value={form.cover_url} onChange={(e) => set('cover_url', e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Summary</label>
            <input className={inputCls} value={form.summary} onChange={(e) => set('summary', e.target.value)} placeholder="One-line teaser" />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea className={inputCls} rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What attendees can expect…" />
          </div>
        </section>

        {/* Schedule */}
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Schedule</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Starts</label>
              <input type="datetime-local" className={inputCls} value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Ends</label>
              <input type="datetime-local" className={inputCls} value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Timezone</label>
            <select className={inputCls} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {[...new Set([form.timezone, browserTz, ...COMMON_TZS])].filter(Boolean).map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Location */}
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Location</h2>
          <div>
            <label className={labelCls}>Format</label>
            <select className={inputCls} value={form.location_kind} onChange={(e) => set('location_kind', e.target.value)}>
              {LOCATION_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          {form.location_kind !== 'virtual' && (
            <div>
              <label className={labelCls}>Venue / address</label>
              <input className={inputCls} value={form.location_text} onChange={(e) => set('location_text', e.target.value)} placeholder="123 Main St, San Francisco" />
            </div>
          )}
          {form.location_kind !== 'in_person' && (
            <div>
              <label className={labelCls}>Join URL</label>
              <input className={inputCls} value={form.location_url} onChange={(e) => set('location_url', e.target.value)} placeholder="https://meet…" />
            </div>
          )}
        </section>

        {/* Capacity & registration */}
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Capacity & registration</h2>
          <div>
            <label className={labelCls}>Capacity <span className="font-normal text-gray-400">(blank = unlimited)</span></label>
            <input type="number" min="0" className={inputCls} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="Unlimited" />
          </div>
          <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={form.waitlist_enabled} onChange={(e) => set('waitlist_enabled', e.target.checked)} className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500" />
            Enable a waitlist when full
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={form.approval_required} onChange={(e) => set('approval_required', e.target.checked)} className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500" />
            Require my approval for each registration
          </label>
        </section>

        {/* Visibility */}
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Visibility</h2>
          <div>
            <select className={inputCls} value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
              {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {form.visibility === 'public'
                ? 'Public events appear on the calendar only after admin review.'
                : form.visibility === 'unlisted'
                  ? 'Reachable by direct link or invitation only.'
                  : 'Private — invitation only, never listed.'}
            </p>
          </div>
        </section>

        {/* Audience rules (comp eligibility) */}
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2">
            <Gift size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Free-seat audience rules</h2>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Grant complimentary seats to whole audiences. Matching people are auto-invited with a free ticket.
          </p>
          <div className="mt-3 space-y-2">
            {AUDIENCE_RULES.map((r) => (
              <label key={r.key} className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                <input
                  type="checkbox"
                  checked={!!rules[r.key]}
                  onChange={(e) => setRules((prev) => ({ ...prev, [r.key]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">Free seats for {r.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{r.help}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {status === 'pending_review' && (
            <span className="mr-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Pending admin review
            </span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Save size={16} /> {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create event')}
          </button>
        </div>
      </div>

      {publishing && (
        <Lightbox label={publishing.title} title={publishing.title} onClose={closePublish} testId="event-publish-dialog"
          footer={<>
            <button type="button" disabled={saving} onClick={closePublish} className="px-4 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700">Cancel</button>
            <button type="button" disabled={saving} onClick={confirmPublish} data-testid="event-publish-confirm" className="px-4 py-2 text-sm rounded bg-violet-600 text-white disabled:opacity-50">{saving ? publishing.busy : publishing.label}</button>
          </>}>
          <p>{publishing.body}</p>
          {publishError && <p role="alert" className="mt-3 text-red-700 dark:text-red-300">{publishError}</p>}
        </Lightbox>
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
