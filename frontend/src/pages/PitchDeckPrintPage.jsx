import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Download, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { downloadDeckPdf } from '../lib/deckPdf.jsx';

// Task #25 — public viewer for an investor share link, plus an authenticated
// preview at /deck/:id/print. Shows all slides on one scrollable page;
// "Save as PDF" downloads via @react-pdf/renderer.
// Task #53 — in share mode, heartbeat read-seconds to the worker every
// 30s so the founder's Engagement panel can show "12 min read".
export default function PitchDeckPrintPage({ shareMode = false }) {
  const { id, token } = useParams();
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const viewIdRef = useRef(null);
  const startedAtRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const d = shareMode ? await api.deckShareRead(token) : await api.deckGet(parseInt(id));
        setDeck(d);
        if (shareMode && d?.view_id) {
          viewIdRef.current = d.view_id;
          startedAtRef.current = Date.now();
        }
      } catch (e) { setError(e?.message || 'Failed to load'); }
    })();
  }, [id, token, shareMode]);

  // Task #53 — read-time heartbeat. Fires every 30s while the tab is
  // open and once more on unmount. Capped server-side at 2h per view.
  useEffect(() => {
    if (!shareMode || !token) return undefined;
    const tick = () => {
      const vid = viewIdRef.current; const startedAt = startedAtRef.current;
      if (!vid || !startedAt) return;
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (seconds <= 0) return;
      api.deckShareHeartbeat(token, vid, seconds).catch(() => {});
    };
    const iv = setInterval(tick, 30_000);
    const onHide = () => { if (document.visibilityState === 'hidden') tick(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { tick(); clearInterval(iv); document.removeEventListener('visibilitychange', onHide); };
  }, [shareMode, token]);

  const exportPdf = async () => {
    if (!deck) return;
    setExporting(true);
    try { await downloadDeckPdf(deck); }
    finally { setExporting(false); }
  };

  if (error) return (
    <div className="p-8 max-w-lg mx-auto mt-12 text-center">
      <h1 className="text-lg font-semibold text-gray-900">This deck isn't available</h1>
      <p className="mt-2 text-sm text-gray-600">{error}</p>
      {shareMode && (
        <p className="mt-4 text-xs text-gray-500">
          Share links are single-use and expire after 72 hours. Ask the founder for a fresh link.
        </p>
      )}
    </div>
  );
  if (!deck) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="bg-gray-100 min-h-screen">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="text-sm text-gray-700 font-medium">{deck.title || 'Pitch deck'} · v{deck.version}</div>
        <button
          onClick={exportPdf} disabled={exporting}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Save as PDF
        </button>
      </div>
      <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
        {(deck.slides || []).map((s, i) => (
          <div key={i} className="bg-gradient-to-br from-violet-600 to-violet-800 text-white rounded-xl shadow-md p-12 aspect-video flex flex-col overflow-hidden">
            <div className="text-xs uppercase tracking-widest text-violet-200">{s.subtitle || `Slide ${i + 1}`}</div>
            <h2 className="text-3xl font-semibold mt-2">{s.title}</h2>
            {s.body && (
              <div className="prose prose-invert prose-base max-w-none mt-4 text-violet-50">
                <ReactMarkdown>{s.body}</ReactMarkdown>
              </div>
            )}
            {(s.bullets || []).length > 0 && (
              <ul className="mt-4 space-y-2 text-base">
                {s.bullets.map((b, j) => (
                  <li key={j} className="flex gap-3"><span className="text-violet-200">•</span><span>{b}</span></li>
                ))}
              </ul>
            )}
            {s.image_url && <img src={s.image_url} alt="" className="mt-auto max-h-40 object-contain self-end rounded" />}
            <div className="mt-auto pt-2 text-[11px] text-violet-200">{i + 1} / {deck.slides.length}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
