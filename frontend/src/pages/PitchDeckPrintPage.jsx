import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

// Task #25 — Print-friendly view used as the "Export to PDF" path.
// The user opens this in a new tab and uses the browser's "Save as PDF"
// dialog; this is the simplest dependency-free approach to producing a
// real PDF (handles the @media print rules below).
export default function PitchDeckPrintPage({ shareMode = false }) {
  const { id, token } = useParams();
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = shareMode ? await api.deckShareRead(token) : await api.deckGet(parseInt(id));
        setDeck(d);
        // Auto-trigger the print dialog after first render so "Export to
        // PDF" is one click for the user; share-mode views don't auto-print.
        if (!shareMode) setTimeout(() => window.print(), 350);
      } catch (e) { setError(e?.message || 'Failed to load'); }
    })();
  }, [id, token, shareMode]);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!deck) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="bg-gray-100 min-h-screen print:bg-white">
      <style>{`
        @page { size: 13.333in 7.5in landscape; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .slide { page-break-after: always; box-shadow: none !important; margin: 0 !important; }
          .slide:last-child { page-break-after: auto; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="text-sm text-gray-700 font-medium">{deck.title || 'Pitch deck'} · v{deck.version}</div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >Save as PDF</button>
      </div>
      <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
        {(deck.slides || []).map((s, i) => (
          <div
            key={i}
            className="slide bg-gradient-to-br from-violet-600 to-violet-800 text-white rounded-xl shadow-md p-12 aspect-video flex flex-col"
          >
            <div className="text-xs uppercase tracking-widest text-violet-200">{s.subtitle || `Slide ${i + 1}`}</div>
            <h2 className="text-3xl font-semibold mt-2">{s.title}</h2>
            <ul className="mt-6 space-y-3 text-base">
              {(s.bullets || []).map((b, j) => (
                <li key={j} className="flex gap-3"><span className="text-violet-200">•</span><span>{b}</span></li>
              ))}
            </ul>
            <div className="mt-auto text-[11px] text-violet-200">{i + 1} / {deck.slides.length}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
