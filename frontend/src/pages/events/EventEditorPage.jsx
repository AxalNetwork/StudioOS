// Task #40 (E2) — EventEditorPage: create (/events/new) + edit (/events/:id/edit).
// Title, type, schedule + timezone, location, cover, capacity, waitlist,
// approval, visibility, and the audience-rules builder (design §7.1). The
// "Submit for review" action appears only when visibility = public (design §1.2).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Send, Gift } from 'lucide-react';
import { eventsApi } from '../../lib/eventsApi';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';

const EVENT_TYPES = ['demo_day', 'workshop', 'office_hours', 'networking', 'fireside', 'meetup', 'webinar'];
const LOCATION_KINDS = ['virtual', 'in_person', 'hybrid'];
const VISIBILITIES = ['private', 'unlisted', 'public'];

const AUDIENCE_RULES = [
  { key: 'comp_official_partners', label: 'Official partners', help: 'Active official partners get a free seat.' },
  { key: 'comp_invested_lps', label: 'Invested LPs', help: 'Limited partners who have invested.' },
  { key: 'comp_investors', label: 'Investors', help: 'Users with an investor profile.' },
  { key: 'comp_host_connections', label: 'My connections', help: 'Your accepted network connections.' },
  { key: 'comp_project_founders', label: 'Project founders', help: 'Founders of active projects.' },
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
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    (async () => {
      try {
        const ev = await eventsApi.get(id);
        if (!alive) return;
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
        try {
          const parsed = typeof ev.audience_rules_json === 'string'
            ? JSON.parse(ev.audience_rules_json || '{}')
            : (ev.audience_rules_json || {});
          setRules(parsed && typeof parsed === 'object' ? parsed : {});
        } catch { setRules({}); }
      } catch (e) {
        showToast({ kind: 'error', msg: e?.message || 'Could not load this event.' });
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
        await eventsApi.update(id, payload());
        showToast({ kind: 'success', msg: 'Event saved.' });
      } else {
        const created = await eventsApi.create(payload());
        const newId = created?.id ?? created?.event?.id;
        showToast({ kind: 'success', msg: 'Event created.' });
        if (newId) navigate(`/events/${newId}/manage`);
        else navigate('/my/events');
      }
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not save the event.' });
    } finally {
      setSaving(false);
    }
  };

  const submitForReview = async () => {
    setSaving(true);
    try {
      await eventsApi.update(id, payload());
      await eventsApi.submitReview(id);
      setStatus('pending_review');
      showToast({ kind: 'success', msg: 'Submitted for admin review.' });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not submit for review.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="py-12 text-center text-gray-500 dark:text-gray-400">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button
        onClick={() => navigate('/my/events')}
        className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <ArrowLeft size={15} /> Back to events
      </button>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {isEdit ? 'Edit event' : 'New event'}
      </h1>
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
          {isEdit && form.visibility === 'public' && status !== 'pending_review' && status !== 'published' && (
            <button
              onClick={submitForReview}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-300 dark:border-violet-700 px-4 py-2 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50"
            >
              <Send size={16} /> Submit for review
            </button>
          )}
        </div>
      </div>

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
