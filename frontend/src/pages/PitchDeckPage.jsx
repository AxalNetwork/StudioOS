import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Sparkles, Loader2, Plus, Trash2, Copy, Share2, Download,
  History, RotateCcw, ChevronLeft, ChevronRight, Image as ImageIcon,
  FolderPlus,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadDeckPdf } from '../lib/deckPdf.jsx';

// Task #25 — Pitch deck builder.
// Project picker → generate 10 slides (project + scoring data) → per-slide
// editor with title/subtitle, markdown body, bullets, image URL. Autosave
// creates a new version each save (full version history with restore).
// Share button mints a ONE-TIME signed URL. Export uses @react-pdf/renderer.
export default function PitchDeckPage() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [deck, setDeck] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savingState, setSavingState] = useState('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef(null);

  useEffect(() => {
    api.listProjects().then((r) => {
      const list = Array.isArray(r) ? r : (r?.projects || []);
      setProjects(list);
      if (list.length && !projectId) setProjectId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setShareUrl(''); setShareExpiresAt(''); setError('');
    (async () => {
      try {
        const r = await api.deckListVersions(projectId);
        const list = r?.versions || [];
        setVersions(list);
        const current = list.find((v) => v.is_current) || list[0];
        if (current) {
          const full = await api.deckGet(current.id);
          setDeck(full); setActiveIdx(0);
        } else { setDeck(null); }
      } catch (e) {
        // 404 here just means "no deck exists yet for this project" — that's the
        // expected state until the user clicks Generate, so don't show a scary
        // banner. Same for stale project ids: clear state and let the user pick
        // another project from the dropdown.
        const msg = (e?.message || '').toLowerCase();
        const is404 = e?.status === 404 || msg.includes('not found');
        setVersions([]); setDeck(null);
        if (!is404) setError(e?.message || 'Failed to load decks');
      }
    })();
  }, [projectId]);

  const generate = async () => {
    if (!projectId) return;
    setBusy(true); setError('');
    try {
      const fresh = await api.deckGenerate(projectId);
      setDeck(fresh); setActiveIdx(0);
      const r = await api.deckListVersions(projectId);
      setVersions(r?.versions || []);
    } catch (e) { setError(e?.message || 'Generate failed'); }
    finally { setBusy(false); }
  };

  // Each save = a new version (per task spec — explicit history + restore).
  const queueSave = (next) => {
    setDeck(next);
    setSavingState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await api.deckUpdate(next.id, { title: next.title, slides: next.slides });
        setDeck(updated); setSavingState('saved');
        const r = await api.deckListVersions(projectId);
        setVersions(r?.versions || []);
        // Existing share URL is bound to the prior version → invalidate.
        setShareUrl(''); setShareExpiresAt('');
      } catch (e) { setError(e?.message || 'Autosave failed'); setSavingState('idle'); }
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
    if (!deck || deck.slides.length >= 20) return;
    const slides = [...deck.slides, { title: 'New slide', subtitle: null, body: '', bullets: [], image_url: null }];
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
      setDeck(restored); setActiveIdx(0);
      const r = await api.deckListVersions(projectId);
      setVersions(r?.versions || []);
      setShareUrl(''); setShareExpiresAt('');
    } finally { setBusy(false); }
  };

  const shareDeck = async () => {
    if (!deck) return;
    setBusy(true); setError('');
    try {
      const r = await api.deckShare(deck.id, { ttl_hours: 72 });
      setShareUrl(`${window.location.origin}${r.share_path}`);
      setShareExpiresAt(r.expires_at || '');
    } catch (e) { setError(e?.message || 'Share failed'); }
    finally { setBusy(false); }
  };

  const exportPdf = async () => {
    if (!deck) return;
    setExporting(true); setError('');
    try {
      await downloadDeckPdf(deck);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'PDF export failed');
    }
    finally { setExporting(false); }
  };

  const slide = deck?.slides?.[activeIdx];
  const bulletsText = useMemo(() => (slide?.bullets || []).join('\n'), [slide]);
  const hasProjects = projects.length > 0;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="text-violet-600" size={22} /> Pitch Deck Builder
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Generate a 10-slide deck from your project + scoring data, edit each slide, and share a one-time tokenized link with investors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectId || ''} onChange={(e) => setProjectId(parseInt(e.target.value) || null)}
            disabled={!hasProjects}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          >
            {!hasProjects && <option value="">No projects available</option>}
            {hasProjects && <option value="">Pick a project…</option>}
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

      {!hasProjects && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <FolderPlus size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-base font-semibold text-gray-900">No projects yet</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            The pitch deck builder pulls from a project's scoring data. Create or join a project first, then come back to generate a 10-slide deck.
          </p>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 mt-4 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={14} /> Go to Projects
          </Link>
        </div>
      )}

      {hasProjects && !deck && !busy && (
        <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center text-gray-500">
          Pick a project and hit <strong>Generate deck</strong> to draft 10 slides from your project + scoring data.
        </div>
      )}

      {deck && (
        <div className="grid grid-cols-12 gap-4">
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
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Body (markdown)</label>
                    <textarea
                      value={slide.body || ''} onChange={(e) => updateSlide(activeIdx, { body: e.target.value })}
                      rows={5} placeholder="**Bold**, *italic*, [links](https://…). Renders as rich text on the deck."
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Bullets (one per line, max 6)</label>
                    <textarea
                      value={bulletsText} onChange={(e) => updateBullets(activeIdx, e.target.value)}
                      rows={5}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium flex items-center gap-1">
                      <ImageIcon size={11} /> Image URL (optional, https://)
                    </label>
                    <input
                      type="url" value={slide.image_url || ''} onChange={(e) => updateSlide(activeIdx, { image_url: e.target.value || null })}
                      placeholder="https://…/image.png"
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => removeSlide(activeIdx)} disabled={deck.slides.length <= 1}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-40"
                    ><Trash2 size={12} /> Remove slide</button>
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

            {/* Live preview */}
            {slide && (
              <div className="mt-4 bg-gradient-to-br from-violet-600 to-violet-800 rounded-xl p-8 text-white shadow-md aspect-video flex flex-col overflow-hidden">
                <div className="text-xs uppercase tracking-widest text-violet-200">{slide.subtitle || ''}</div>
                <h2 className="text-2xl font-semibold mt-2">{slide.title}</h2>
                {slide.body && (
                  <div className="prose prose-invert prose-sm max-w-none mt-3 text-violet-50">
                    <ReactMarkdown>{slide.body}</ReactMarkdown>
                  </div>
                )}
                {(slide.bullets || []).length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {slide.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2"><span className="text-violet-200">•</span><span>{b}</span></li>
                    ))}
                  </ul>
                )}
                {slide.image_url && (
                  <img src={slide.image_url} alt="" className="mt-auto max-h-32 object-contain rounded self-end" />
                )}
              </div>
            )}
          </main>

          <aside className="col-span-12 lg:col-span-3 space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-medium">Actions</div>
              <button
                onClick={shareDeck} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
              ><Share2 size={14} /> Share with investor</button>
              <button
                onClick={exportPdf} disabled={exporting}
                className="w-full inline-flex items-center justify-center gap-2 border border-gray-200 hover:border-violet-300 text-sm text-gray-700 font-medium px-3 py-2 rounded-lg disabled:opacity-50"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export to PDF
              </button>
              {shareUrl && (
                <div className="border border-emerald-200 bg-emerald-50 rounded-md p-2 text-xs">
                  <div className="font-medium text-emerald-800 mb-1">One-time share URL</div>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 break-all text-[11px] text-emerald-900">{shareUrl}</code>
                    <button onClick={() => navigator.clipboard.writeText(shareUrl)} className="text-emerald-700 hover:text-emerald-900">
                      <Copy size={12} />
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-emerald-700">
                    Single-use, expires {shareExpiresAt ? new Date(shareExpiresAt).toLocaleString() : '72h after issue'}.
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
