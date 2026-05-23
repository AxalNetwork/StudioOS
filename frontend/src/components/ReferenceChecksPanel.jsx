import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { AlertTriangle, CheckCircle2, Mic, Plus, Sparkles, X } from 'lucide-react';

const SENTIMENT_STYLES = {
  positive: 'bg-green-100 text-green-700 border-green-300',
  mixed: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  negative: 'bg-red-100 text-red-700 border-red-300',
  insufficient: 'bg-gray-100 text-gray-600 border-gray-300',
};

const STATUS_LABELS = {
  scheduled: 'Scheduled',
  recorded: 'Recording uploaded',
  transcribed: 'Transcribed',
  summarized: 'Summarised',
  cancelled: 'Cancelled',
};

export default function ReferenceChecksPanel({ dealId, currentUserRole }) {
  const isAuthorized = currentUserRole === 'admin' || currentUserRole === 'investor';
  const [refs, setRefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');

  const reload = async () => {
    setError('');
    try {
      const list = await api.listReferences(dealId);
      setRefs(list);
    } catch (e) {
      setError(e.message || 'Failed to load references');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAuthorized && dealId) reload();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, isAuthorized]);

  if (!isAuthorized) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 mb-1 dark:text-gray-100">Reference Checks</h3>
        <p className="text-sm text-gray-500">Visible to admin and investor users only.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Reference Checks</h3>
          <p className="text-xs text-gray-500">Recorded with consent · transcribed · summarised</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg"
        >
          <Plus size={14} /> Schedule call
        </button>
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : refs.length === 0 ? (
        <p className="text-sm text-gray-500">
          No reference calls scheduled yet.
        </p>
      ) : (
        <div className="space-y-3">
          {refs.map((r) => (
            <ReferenceCard key={r.id} reference={r} onChange={reload} />
          ))}
        </div>
      )}

      {showAdd && (
        <ScheduleModal
          dealId={dealId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reload(); }}
        />
      )}
    </div>
  );
}

function ReferenceCard({ reference, onChange }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const fileInput = useRef(null);
  const sentiment = reference.summary?.overall_sentiment || 'insufficient';

  const run = async (kind, fn) => {
    setBusy(kind); setErr('');
    try { await fn(); await onChange(); }
    catch (e) { setErr(e.message || 'Action failed'); }
    setBusy('');
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await run('upload', () => api.uploadReferenceRecording(reference.id, f));
    if (fileInput.current) fileInput.current.value = '';
  };

  const captureConsent = () => run('consent',
    () => api.captureReferenceConsent(reference.id, { consent_given: true }));

  return (
    <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {reference.reference_name}
            {reference.reference_role && (
              <span className="text-gray-500 font-normal"> · {reference.reference_role}</span>
            )}
          </div>
          {reference.relationship && (
            <div className="text-xs text-gray-500 mt-0.5">{reference.relationship}</div>
          )}
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200 whitespace-nowrap dark:text-gray-300 dark:border-gray-800">
          {STATUS_LABELS[reference.status] || reference.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 items-center">
        {reference.consent_given ? (
          <span className="text-xs flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
            <CheckCircle2 size={12} /> Consent on file
          </span>
        ) : (
          <button
            onClick={captureConsent}
            disabled={!!busy}
            className="text-xs px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          >
            {busy === 'consent' ? 'Saving…' : 'Capture consent'}
          </button>
        )}

        {reference.consent_given && !reference.has_recording && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              onChange={onFile}
              className="hidden"
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={!!busy}
              className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 flex items-center gap-1 dark:border-gray-700"
            >
              <Mic size={12} /> {busy === 'upload' ? 'Uploading…' : 'Upload recording'}
            </button>
          </>
        )}

        {reference.has_recording && !reference.has_transcript && (
          <button
            onClick={() => run('transcribe', () => api.transcribeReference(reference.id))}
            disabled={!!busy}
            className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 dark:border-gray-700"
          >
            {busy === 'transcribe' ? 'Transcribing…' : 'Transcribe (Whisper)'}
          </button>
        )}

        {reference.has_transcript && !reference.summary && (
          <button
            onClick={() => run('summarize', () => api.summarizeReference(reference.id))}
            disabled={!!busy}
            className="text-xs px-2 py-1 rounded border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 flex items-center gap-1"
          >
            <Sparkles size={12} /> {busy === 'summarize' ? 'Summarising…' : 'Summarise + tag'}
          </button>
        )}

        {reference.summary && (
          <span className={`text-xs px-2 py-0.5 rounded border ${SENTIMENT_STYLES[sentiment]}`}>
            {sentiment}
          </span>
        )}
      </div>

      {err && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>
      )}

      {reference.summary && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          <p className="text-sm text-gray-800 dark:text-gray-200">{reference.summary.summary}</p>

          {reference.summary.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {reference.summary.tags.map((t) => (
                <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:text-gray-300">
                  #{t}
                </span>
              ))}
            </div>
          )}

          {reference.summary.red_flags?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-2">
              <div className="flex items-center gap-1 text-xs font-semibold text-red-800 mb-1">
                <AlertTriangle size={12} /> Red flags
              </div>
              <ul className="text-xs text-red-900 list-disc pl-5 space-y-0.5">
                {reference.summary.red_flags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          {reference.summary.strengths?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1 dark:text-gray-300">Strengths</div>
              <ul className="text-xs text-gray-700 list-disc pl-5 space-y-0.5 dark:text-gray-300">
                {reference.summary.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {reference.summary.quotes?.length > 0 && (
            <div className="border-l-2 border-gray-300 pl-3 space-y-1 dark:border-gray-700">
              {reference.summary.quotes.map((q, i) => (
                <p key={i} className="text-xs italic text-gray-600">"{q}"</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScheduleModal({ dealId, onClose, onSaved }) {
  const [form, setForm] = useState({
    reference_name: '',
    reference_email: '',
    reference_role: '',
    relationship: '',
    scheduled_at: '',
    consent_given: false,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!form.reference_name.trim()) return;
    setSaving(true); setErr('');
    try {
      await api.createReference({
        deal_id: dealId,
        ...form,
        scheduled_at: form.scheduled_at || null,
      });
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to schedule');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-5 dark:bg-gray-900">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Schedule reference call</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            required
            placeholder="Reference name *"
            value={form.reference_name}
            onChange={(e) => setForm({ ...form, reference_name: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-gray-700"
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={form.reference_email}
            onChange={(e) => setForm({ ...form, reference_email: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-gray-700"
          />
          <input
            placeholder="Role / title (e.g. Former CTO)"
            value={form.reference_role}
            onChange={(e) => setForm({ ...form, reference_role: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-gray-700"
          />
          <input
            placeholder="Relationship (how they know the founder)"
            value={form.relationship}
            onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-gray-700"
          />
          <input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-gray-700"
          />
          <label className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded p-2 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.consent_given}
              onChange={(e) => setForm({ ...form, consent_given: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              I have explicit consent from this reference to record, transcribe,
              and summarise the call. (Consent can also be captured later, but a
              recording cannot be uploaded without it.)
            </span>
          </label>
          <textarea
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-gray-700"
            rows={2}
          />
          {err && <div className="text-xs text-red-700">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 dark:border-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="text-sm px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
