import React, { useEffect, useState } from 'react';
import { Inbox, CheckCircle2, Link as LinkIcon, Send } from 'lucide-react';
import { dd } from '../lib/api';
import { reportError } from '../lib/log';
import { useToast } from '../components/useToast';

// Build queue #128 — the subject-facing half of the DD request list
// (Due_Diligence.dc.html, "FOUNDER SIDE"). This is the ONLY diligence
// surface a founder ever sees: the requests addressed to them, nothing
// about the case itself — no score, no sections, no findings. Backed by
// GET /api/dd/requests/mine + PATCH /api/dd/requests/:id/respond, both
// auth'd by subject-resolution rather than role.
const STATE_META = {
  requested: { label: 'Waiting on you', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  received: { label: 'Sent — under review', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  reviewed: { label: 'Reviewed', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
};

export default function DueDiligenceRequestsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const { toast, push } = useToast();

  const load = async () => {
    try {
      const r = await dd.myRequests();
      setItems(r.items || []);
      setError('');
    } catch (e) {
      reportError('DueDiligenceRequestsPage:list', e);
      setError(e.message || 'Failed to load requests');
      setItems([]);
    }
  };
  useEffect(() => { load(); }, []);

  const answered = (items || []).filter(i => i.state !== 'requested').length;
  const total = (items || []).length;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-1">
        <Inbox size={24} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Diligence requests</h1>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Requests sent to you by a diligence team. Respond with a link to the document (a data-room or
        drive link) and a short note — you'll never be asked to see or discuss the review itself here.
      </p>

      {total > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">Your progress</span>
            <span>{answered} of {total} answered</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div className="h-full bg-violet-600 transition-all" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-600 mb-4">{error}</div>}
      {items === null && <div className="text-gray-500 text-sm py-10 text-center">Loading…</div>}
      {items && items.length === 0 && !error && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center text-sm text-gray-500">
          No open requests. When an investor or partner running diligence needs something from you,
          it will appear here and you'll be notified.
        </div>
      )}

      <div className="space-y-3">
        {(items || []).map(r => (
          <RequestCard key={r.id} req={r}
            onRespond={async (payload) => {
              try {
                await dd.respondRequest(r.id, payload);
                push('Response sent', 'success');
                load();
              } catch (e) { push(e.message || 'Failed to send response', 'error'); }
            }} />
        ))}
      </div>
      {toast}
    </div>
  );
}

function RequestCard({ req, onRespond }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(req.response_note || '');
  const [url, setUrl] = useState(req.response_url || '');
  const [busy, setBusy] = useState(false);
  const meta = STATE_META[req.state] || STATE_META.requested;
  // Founders may amend a response until the team marks it reviewed.
  const actionable = req.state !== 'reviewed';

  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim() && !url.trim()) return;
    setBusy(true);
    try { await onRespond({ response_note: note.trim() || undefined, response_url: url.trim() || undefined }); setOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold text-gray-900 dark:text-gray-100">{req.title}</div>
          {req.details && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{req.details}</div>}
          <div className="text-[11px] text-gray-400 mt-1.5">
            For {req.subject_label} · asked {req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}
          </div>
          {(req.response_note || req.response_url) && (
            <div className="mt-2 text-xs bg-gray-50 dark:bg-gray-900/40 rounded p-2 text-gray-600 dark:text-gray-400">
              <CheckCircle2 size={11} className="inline text-emerald-600 mr-1" />
              You responded{req.responded_at ? ` on ${new Date(req.responded_at).toLocaleDateString()}` : ''}
              {req.response_url && (
                <a href={req.response_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline ml-1 break-all inline-flex items-center gap-0.5">
                  <LinkIcon size={10} /> {req.response_url}
                </a>
              )}
            </div>
          )}
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${meta.cls}`}>{meta.label}</span>
      </div>

      {actionable && !open && (
        <button onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700">
          <Send size={12} /> {req.state === 'received' ? 'Amend response' : 'Respond'}
        </button>
      )}
      {actionable && open && (
        <form onSubmit={submit} className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-700/60 pt-3">
          <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="https:// link to the document or data room"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000}
            placeholder="Short note (what's included, anything to know)…"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
            <button type="submit" disabled={busy || (!note.trim() && !url.trim())}
              className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-60">
              {busy ? 'Sending…' : 'Send response'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
