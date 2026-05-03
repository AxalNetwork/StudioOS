import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, Loader2, Plus, Trash2, Copy, Share2, Printer,
  History, RotateCcw, ChevronLeft, ChevronRight, Save,
} from 'lucide-react';
import { api } from '../lib/api';

// Task #25 — Pitch deck builder.
// Single-page editor: project picker → generate 10 slides → per-slide
// editor with autosave (each save = a new version) → version history +
// restore → "share with investor" signed URL → print-to-PDF view.
export default function PitchDeckPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [deck, setDeck] = useState(null); // { id, version, title, slides, ... }
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savingState, setSavingState] = useState('idle'); // idle|saving|saved
  const [shareUrl, setShareUrl] = useState('');
  const [error, setError] = useState('');
  const saveTimer = useRef(null);

  // Initial project list.
  useEffect(() => {
    api.listProjects().then((r) => {
      const list = Array.isArray(r) ? r : (r?.projects || []);
      setProjects(list);
      if (list.length && !projectId) setProjectId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load latest deck when project changes.
  useEffect(() => {
    if (!projectId) return;
    setShareUrl('');
    setError('');
    (async () => {
      try {
        const r = await api.deckListVersions(projectId);
        const list = r?.versions || [];
        setVersions(list);
        const current = list.find((v) => v.is_current) || list[0];
        if (current) {
          const full = await api.deckGet(current.id);
          setDeck(full);
          setActiveIdx(0);
        } else {
          setDeck(null);
        }
      } catch (e) { setError(e?.message || 'Failed to load decks'); }
    })();
  }, [projectId]);

  const generate = async () => {
    if (!projectId) return;
    setBusy(true); setError('');
    try {
      const fresh = await api.deckGenerate(projectId);
      setDeck(fresh);
      setActiveIdx(0);
      const r = await api.deckListVersions(projectId);
      setVersions(r?.versions || []);
    } catch (e) { setError(e?.message || 'Generate failed'); }
    finally { setBusy(false); }
  };

  // Debounced autosave: every save creates a new version on the server
  // (per task spec — explicit version history with restore). We mark
  // "Saved · v{N}" in the UI so the founder sees their version number.
  const queueSave = (next) => {
    setDeck(next);
    setSavingState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await api.deckUpdate(next.id, { title: next.title, slides: next.slides });
        setDeck(updated);
        setSavingState('saved');
        const r = await api.deckListVersions(projectId);
        setVersions(r?.versions || []);
        setShareUrl(''); // version bumped → existing share URL is stale
      } catch (e) {
        setError(e?.message || 'Autosave failed');
        setSavingState('idle');
      }
    }, 1200);
  };

  const updateSlide = (idx, patch) => {
    if (!deck) return;
    const slides = deck.slides.map((s, i) => i === idx ? { ...s, ...patch } : s);
    queueSave({ ...deck, slides });
  };

  const updateBullets = (idx, text) => {
    const bullets = text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    updateSlide(idx, { bullets });
  };

  const addSlide = () => {
    if (!deck) return;
    if (deck.slides.length >= 20) return;
    const slides = [...deck.slides, { title: 'New slide', subtitle: null, bullets: [] }];
    queueSave({ ...deck, slides });
    setActiveIdx(slides.length - 1);
  };

  const removeSlide = (idx) => {
    if (!deck || deck.slides.length <= 1) return;
    const slides = deck.slides.filter((_, i) => i !== idx);
    queueSave({ ...deck, slides });
    setActiveIdx(Math.max(0, idx - 1));
  };

  const restoreVersion = async (vid) => {
    if (!window.confirm('Restore this version? A new version will be created from its content.')) return;
    setBusy(true);
    try {
      const restored = await api.deckRestore(vid);
      setDeck(restored);
      setActiveIdx(0);
      const r = await api.deckListVersions(projectId);
      setVersions(r?.versions || []);
      setShareUrl('');
    } finally { setBusy(false); }
  };

  const shareDeck = async () => {
    if (!deck) return;
    setBusy(true); setError('');
    try {
      const r = await api.deckShare(deck.id, { ttl_hours: 72 });
      setShareUrl(`${window.location.origin}${r.share_path}`);
    } catch (e) { setError(e?.message || 'Share failed'); }
    finally { setBusy(false); }
  };

  const exportPdf = () => {
    if (!deck) return;
    // Open the dedicated print view; user invokes browser "Save as PDF".
    window.open(`/deck/${deck.id}/print`, '_blank');
  };

  const slide = deck?.slides?.[activeIdx];
  const bulletsText = useMemo(() => (slide?.bullets || []).join('\n'), [slide]);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="text-violet-600" size={22} /> Pitch Deck Builder
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Generate a 10-slide deck, edit it, and share a tokenized link with investors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectId || ''} onChange={(e) => setProjectId(parseInt(e.target.value) || null)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Pick a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={generate} disabled={busy || !projectId}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {deck ? 'Regenerate' : 'Generate deck'}
          </button>
        </div>
      </div>

      {!deck && !busy && (
        <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">
          Pick a project and hit <strong>Generate deck</strong> to draft 10 slides from your project + scoring data.
        </div>
      )}

      {deck && (
        <div className="grid grid-cols-12 gap-4">
          {/* Slide list */}
          <aside className="col-span-12 lg:col-span-3 space-y-2">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-medium px-1">Slides</div>
            {deck.slides.map((s, i) => (
              <button
                key={i} type="button" onClick={() => setActiveIdx(i)}
                className={`w-full text-left border rounded-lg px-3 py-2 ${
                  i === activeIdx ? 'border-violet-300 bg-violet-50/40' : 'border-gray-200 bg-white hover:border-violet-200'
                }`}
              >
                <div className="text-[11px] text-gray-400">Slide {i + 1}</div>
                <div className="text-sm font-medium text-gray-900 truncate">{s.title || 'Untitled'}</div>
              </button>
            ))}
            <button
              onClick={addSlide}
              className="w-full inline-flex items-center justify-center gap-1 text-xs text-violet-700 hover:text-violet-800 border border-dashed border-violet-200 rounded-lg py-2"
            >
              <Plus size={12} /> Add slide
            </button>
          </aside>

          {/* Editor + preview */}
          <main className="col-span-12 lg:col-span-6">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3 text-xs">
                <span className="text-gray-500">Slide {activeIdx + 1} of {deck.slides.length}</span>
                <span className={`${
                  savingState === 'saving' ? 'text-amber-600' : savingState === 'saved' ? 'text-emerald-600' : 'text-gray-400'
                }`}>
                  {savingState === 'saving' && (<><Loader2 size={11} className="inline animate-spin mr-1" />Saving…</>)}
                  {savingState === 'saved' && (<>Saved · v{deck.version}</>)}
                </span>
              </div>
              {slide && (
                <div className="space-y-3">
                  <input
                    value={slide.title} onChange={(e) => updateSlide(activeIdx, { title: e.target.value })}
                    placeholder="Slide title"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-base font-semibold"
                  />
                  <input
                    value={slide.subtitle || ''} onChange={(e) => updateSlide(activeIdx, { subtitle: e.target.value })}
                    placeholder="Subtitle (optional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <textarea
                    value={bulletsText} onChange={(e) => updateBullets(activeIdx, e.target.value)}
                    rows={8} placeholder="One bullet per line (max 6)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => removeSlide(activeIdx)} disabled={deck.slides.length <= 1}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-40"
                    >
                      <Trash2 size={12} /> Remove slide
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setActiveIdx((i) => Math.max(0, i - 1))} disabled={activeIdx === 0}
                        className="p-1.5 text-gray-500 hover:text-violet-700 disabled:opacity-30"
                      ><ChevronLeft size={16} /></button>
                      <button
                        onClick={() => setActiveIdx((i) => Math.min(deck.slides.length - 1, i + 1))}
                        disabled={activeIdx === deck.slides.length - 1}
                        className="p-1.5 text-gray-500 hover:text-violet-700 disabled:opacity-30"
                      ><ChevronRight size={16} /></button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Live preview card */}
            {slide && (
              <div className="mt-4 bg-gradient-to-br from-violet-600 to-violet-800 rounded-xl p-8 text-white shadow-md aspect-video flex flex-col">
                <div className="text-xs uppercase tracking-widest text-violet-200">{slide.subtitle || ''}</div>
                <h2 className="text-2xl font-semibold mt-2">{slide.title}</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  {(slide.bullets || []).map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-violet-200">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </main>

          {/* Side panel: actions + versions */}
          <aside className="col-span-12 lg:col-span-3 space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-medium">Actions</div>
              <button
                onClick={shareDeck} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
              >
                <Share2 size={14} /> Share with investor
              </button>
              <button
                onClick={exportPdf}
                className="w-full inline-flex items-center justify-center gap-2 border border-gray-200 hover:border-violet-300 text-sm text-gray-700 font-medium px-3 py-2 rounded-lg"
              >
                <Printer size={14} /> Export to PDF
              </button>
              {shareUrl && (
                <div className="border border-emerald-200 bg-emerald-50 rounded-md p-2 text-xs">
                  <div className="font-medium text-emerald-800 mb-1">Share URL (expires in 72h)</div>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 break-all text-[11px] text-emerald-900">{shareUrl}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(shareUrl)}
                      className="text-emerald-700 hover:text-emerald-900"
                    ><Copy size={12} /></button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-2 flex items-center gap-1">
                <History size={12} /> Versions
              </div>
              <ul className="divide-y divide-gray-100 max-h-72 overflow-auto">
                {versions.map((v) => (
                  <li key={v.id} className="py-2 flex items-center justify-between text-sm">
                    <div className="flex flex-col">
                      <span className="text-gray-900 font-medium">v{v.version}{v.is_current ? ' · current' : ''}</span>
                      <span className="text-[11px] text-gray-500">{(v.created_at || '').slice(0, 19).replace('T', ' ')}</span>
                    </div>
                    {!v.is_current && (
                      <button
                        onClick={() => restoreVersion(v.id)}
                        className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-800"
                      ><RotateCcw size={12} /> Restore</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}

      {error && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
      )}

      <div className="mt-6 text-xs text-gray-500">
        <Link to="/founder" className="text-violet-700 hover:underline">← Back to Founder Portal</Link>
      </div>
    </div>
  );
}
