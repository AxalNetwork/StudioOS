import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, Clock, AlertTriangle, CheckCircle2, Plus, Loader2,
  ArrowLeft, X, Trash2, Filter,
} from 'lucide-react';
import { api } from '../lib/api';

// Task #32 — Compliance calendar.
//
// Once incorporated, founders need recurring reminders so they don't lose
// good standing. This page surfaces every open compliance event (annual
// report, franchise tax, registered agent, board meetings...) with a
// countdown pill and a one-click mark-complete. Reminder pings at
// T-30/14/7/1 are fired by `services.compliance_reminders` via the
// notify() publisher.

function StatusPill({ event }) {
  if (event.completion_status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">
        <CheckCircle2 size={12} /> Completed
      </span>
    );
  }
  const d = event.days_until;
  if (d < 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">
        <AlertTriangle size={12} /> {Math.abs(d)} day{Math.abs(d) === 1 ? '' : 's'} overdue
      </span>
    );
  }
  if (d <= 7) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-900">
        <Clock size={12} /> {d} day{d === 1 ? '' : 's'} left
      </span>
    );
  }
  if (d <= 30) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">
        <Clock size={12} /> {d} days left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-violet-100 text-violet-800">
      <Clock size={12} /> {d} days left
    </span>
  );
}

const EVENT_TYPE_LABELS = {
  annual_report: 'Annual report',
  franchise_tax: 'Franchise / corporate tax',
  registered_agent: 'Registered agent',
  board_meeting: 'Board meeting',
  other: 'Other',
};

function CreateModal({ open, onClose, projects: parentProjects, onCreated }) {
  const [projectId, setProjectId] = useState('');
  const [eventType, setEventType] = useState('annual_report');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [recurrence, setRecurrence] = useState('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localProjects, setLocalProjects] = useState([]);

  // Fallback: if the parent didn't pass projects (e.g. a transient blip
  // in the initial fetch), load them when the modal opens so the user
  // is never stuck with an empty dropdown.
  const projects = parentProjects.length ? parentProjects : localProjects;
  useEffect(() => {
    if (open && parentProjects.length === 0 && localProjects.length === 0) {
      api.listProjects().then((p) => {
        setLocalProjects(Array.isArray(p) ? p : (p?.projects || []));
      }).catch(() => {});
    }
  }, [open, parentProjects.length, localProjects.length]);

  useEffect(() => {
    if (open && projects.length && !projectId) setProjectId(String(projects[0].id));
  }, [open, projects, projectId]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.complianceCreate({
        project_id: Number(projectId),
        event_type: eventType,
        title: title.trim(),
        description: description || null,
        due_date: dueDate,
        recurrence,
      });
      onCreated(created);
      // Reset
      setTitle('');
      setDescription('');
      onClose();
    } catch (e) {
      setError(e?.message || 'Failed to create event');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">New compliance event</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Project</label>
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Select…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.title || `Project #${p.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Event type</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Recurrence</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
              >
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
                <option value="one_time">One time</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Delaware franchise tax + annual report"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Due date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !projectId || !title.trim() || !dueDate}
            className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Create event
          </button>
        </div>
      </div>
    </div>
  );
}

function EventCard({ event, projectName, onUpdated, onDeleted }) {
  const [busy, setBusy] = useState(false);

  const markComplete = async () => {
    setBusy(true);
    try {
      const updated = await api.complianceUpdate(event.id, { completion_status: 'completed' });
      onUpdated(updated);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e?.message || 'Failed to mark complete');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      const updated = await api.complianceUpdate(event.id, { completion_status: 'pending' });
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    // eslint-disable-next-line no-alert
    if (!confirm('Delete this compliance event? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.complianceDelete(event.id);
      onDeleted(event.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-semibold text-gray-900 truncate">{event.title}</h4>
          <StatusPill event={event} />
          {event.source === 'auto' && (
            <span className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
              Auto
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
          <span>{EVENT_TYPE_LABELS[event.event_type] || event.event_type}</span>
          <span>·</span>
          <span>{event.jurisdiction}</span>
          <span>·</span>
          <span>Due {event.due_date}</span>
          <span>·</span>
          <span>Recurs: {event.recurrence}</span>
          {projectName && (
            <>
              <span>·</span>
              <span className="text-gray-500">{projectName}</span>
            </>
          )}
        </div>
        {event.description && (
          <p className="mt-2 text-sm text-gray-700">{event.description}</p>
        )}
        {event.reminders_sent && event.reminders_sent.length > 0 && (
          <div className="mt-2 text-[11px] text-gray-500">
            Reminders sent: {event.reminders_sent.join(', ')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {event.completion_status === 'completed' ? (
          <button
            onClick={reopen}
            disabled={busy}
            className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Reopen
          </button>
        ) : (
          <button
            onClick={markComplete}
            disabled={busy}
            className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Mark complete
          </button>
        )}
        <button
          onClick={remove}
          disabled={busy}
          className="text-xs p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-50"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function CompliancePage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('open'); // open | overdue | completed | all
  const [projectFilter, setProjectFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const projectName = useMemo(() => {
    const m = new Map();
    projects.forEach((p) => m.set(p.id, p.name || p.title || `Project #${p.id}`));
    return m;
  }, [projects]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      api.complianceList(projectFilter ? Number(projectFilter) : null),
      api.listProjects(),
    ]);
    const [eventsRes, projectsRes] = results;
    if (eventsRes.status === 'fulfilled') {
      setEvents(eventsRes.value.events || []);
      setSummary(eventsRes.value.summary || null);
    } else {
      setError(eventsRes.reason?.message || 'Failed to load events');
    }
    if (projectsRes.status === 'fulfilled') {
      const p = projectsRes.value;
      setProjects(Array.isArray(p) ? p : (p?.projects || []));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'completed') return events.filter((e) => e.completion_status === 'completed');
    if (filter === 'overdue') {
      return events.filter((e) => e.completion_status !== 'completed' && e.days_until < 0);
    }
    // open
    return events.filter((e) => e.completion_status !== 'completed');
  }, [events, filter]);

  const onCreated = (event) => {
    setEvents((prev) => [event, ...prev]);
  };
  const onUpdated = (updated) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };
  const onDeleted = (id) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-3"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2">
            <CalendarCheck className="text-violet-600" /> Compliance Calendar
          </h1>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            Recurring obligations to keep your entity in good standing — auto-populated from your jurisdiction at incorporation.
            We'll ping you at 30, 14, 7 and 1 day before each deadline.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 px-3 py-2 bg-violet-600 text-white text-sm rounded hover:bg-violet-700"
        >
          <Plus size={16} /> New event
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-white border rounded-lg p-4">
            <div className="text-xs text-gray-500">Open</div>
            <div className="text-2xl font-bold text-gray-900">{summary.total - summary.completed}</div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <div className="text-xs text-gray-500">Due ≤ 7 days</div>
            <div className="text-2xl font-bold text-amber-700">{summary.due_7d}</div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <div className="text-xs text-gray-500">Overdue</div>
            <div className="text-2xl font-bold text-red-700">{summary.overdue}</div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <div className="text-xs text-gray-500">Completed</div>
            <div className="text-2xl font-bold text-emerald-700">{summary.completed}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Filter size={14} className="text-gray-500" />
        {[
          { v: 'open', l: 'Open' },
          { v: 'overdue', l: 'Overdue' },
          { v: 'completed', l: 'Completed' },
          { v: 'all', l: 'All' },
        ].map((opt) => (
          <button
            key={opt.v}
            onClick={() => setFilter(opt.v)}
            className={`text-xs px-2.5 py-1 rounded border ${
              filter === opt.v
                ? 'bg-violet-50 border-violet-300 text-violet-800'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {opt.l}
          </button>
        ))}
        <div className="flex-1" />
        <select
          className="text-xs border rounded px-2 py-1.5"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.title || `Project #${p.id}`}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-600 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading events…
        </div>
      ) : error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed rounded-lg p-8 text-center text-gray-500 text-sm">
          No {filter} compliance events.{' '}
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')} className="text-violet-700 underline">
              Show all
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              projectName={projectName.get(e.project_id)}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}

      <CreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projects={projects}
        onCreated={onCreated}
      />
    </div>
  );
}
