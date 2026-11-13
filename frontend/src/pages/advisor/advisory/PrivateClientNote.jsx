import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';

/** Keyed by owner and client so account/roster switches cannot carry over a draft. */
export default function PrivateClientNote({ clientId }) {
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setLoading(true); setError(''); setLoadError(false);
    api.advisorClientNote(clientId).then(
      (res) => {
        if (!cancelled) { setSaved(res.note); setBody(res.note?.body || ''); setLoading(false); }
      },
      () => { if (!cancelled) { setError('Your private note could not be loaded.'); setLoadError(true); setLoading(false); } },
    );
    return () => { cancelled = true; mounted.current = false; };
  }, [clientId, attempt]);

  async function write(remove = false) {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = remove ? await api.deleteAdvisorClientNote(clientId) : await api.saveAdvisorClientNote(clientId, body);
      if (mounted.current) {
        setSaved(res.note); setBody(res.note?.body || '');
        setMessage(remove ? 'Private note deleted.' : 'Private note saved.');
      }
    } catch {
      if (mounted.current) setError('Your private note could not be saved.');
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <section className="space-y-2">
      <label htmlFor={`private-client-note-${clientId}`} className="block text-sm font-medium text-gray-900 dark:text-gray-100">Private client note</label>
      <p className="text-xs text-gray-500 dark:text-gray-400">Only your advisor account can access this note. It is separate from the shared session record.</p>
      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading your note…</p> : <>
        <textarea id={`private-client-note-${clientId}`} value={body} onChange={(e) => setBody(e.target.value)}
          maxLength={8000} rows={5} disabled={busy || loadError}
          className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => write()} disabled={busy || loadError || !body.trim() || body === saved?.body}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save note'}</button>
          {saved && <button type="button" onClick={() => write(true)} disabled={busy}
            className="text-sm text-rose-700 disabled:opacity-50 dark:text-rose-300">Delete note</button>}
        </div>
        {saved && <p className="text-xs text-gray-500 dark:text-gray-400">Saved: {saved.updated_at}</p>}
      </>}
      {error && <div role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}{loadError && <button type="button" onClick={() => setAttempt((n) => n + 1)} className="ml-2 underline">Retry loading</button>}</div>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
    </section>
  );
}
