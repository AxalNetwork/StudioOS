// Spin-Out Lab — Pitch Deck Builder (Week 3 tool page).
//
// Design handoff: attached_assets/Pitch_Deck_Builder.dc_*.html (same file
// ships in the repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - The 11-slide grid renders the actual `axal_spinout_demoday` React
//     slides (decks/templates/axal_spinout_demoday_app.tsx) via the shared
//     <Thumbnail> clip window, fed by the live Lab field map
//     (useSpinoutDeckFields → POST /projects/:id/spinout-deck).
//   - Per-slide status dots/checks are derived from that same flat field map
//     (filled vs '—'/empty per slide section) — the same signal the Worker's
//     gaps[] assembler uses, computed client-side per slide.
//   - Week chips mirror the design's Validate/Structure/Build/Pitch pills,
//     aggregated from the per-slide statuses.
//   - Edit slide: the existing per-field SpinoutSlideEditor (auto fields
//     link back to their source tool; editable fields PATCH the project).
//   - Export PDF / Share Link: the real pitch_decks version + share-token
//     backend (POST /decks/generate, /decks/:id/share) and the lazy
//     react-pdf exporter. Export follows the design rule: enabled once 6+
//     slides are ready.
//   - Omitted (no backend): per-slide image upload zones and the QR/password
//     share modal — share issues the standard 24h token link.

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Download, Share2, Check, AlertTriangle,
  ChevronLeft, ChevronRight, X, Presentation,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { useAuth } from '../hooks/useAuthSync';
import { useSpinoutDeckFields } from '../hooks/useSpinoutDeckFields';
import SpinoutSlideEditor from '../components/SpinoutSlideEditor';
import { downloadDeckPdf } from '../lib/deckPdf.jsx';
import { useToast } from '../components/useToast';
import { pickLabProject } from './SpinoutLabStartupPage';
import { TEMPLATES } from '../decks/templates';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

// Design slideMeta() — spec ids match SpinoutSlideEditor CONFIG + the deck's
// stored spec_id; `prefix` is the hydrate() section each slide reads from.
export const SLIDE_META = [
  { spec: 'cover', title: 'Cover', week: 0, prefix: 'cover' },
  { spec: 'problem', title: 'Problem', week: 1, prefix: 'problem' },
  { spec: 'validation', title: 'Validation', week: 1, prefix: 'validation' },
  { spec: 'market', title: 'Market', week: 1, prefix: 'market' },
  { spec: 'solution', title: 'Solution', week: 1, prefix: 'solution' },
  { spec: 'product_demo', title: 'Product Demo', week: 3, prefix: 'productDemo' },
  { spec: 'roadmap', title: 'Roadmap', week: 3, prefix: 'roadmap' },
  { spec: 'team_network', title: 'Team & Network', week: 2, prefix: 'team' },
  { spec: 'cap_table', title: 'Cap Table', week: 2, prefix: 'captable' },
  { spec: 'ask', title: 'The Ask · Use of Funds', week: 4, prefix: 'ask' },
  { spec: 'review_the_deal', title: 'Deal Readiness', week: 4, prefix: 'deal' },
];

const WEEKS = [
  { num: 1, label: 'Validate' },
  { num: 2, label: 'Structure' },
  { num: 3, label: 'Build' },
  { num: 4, label: 'Pitch' },
];

const EXPORT_MIN_READY = 6;

/** Per-slide status from the flat dotted-key field map.
 *  Returns { state: 'ready'|'partial'|'missing'|'unknown', filled, total, missing }. */
export function slideStatus(meta, fields) {
  if (!fields || typeof fields !== 'object') return { state: 'unknown', filled: 0, total: 0, missing: 0 };
  const pref = `${meta.prefix}.`;
  let total = 0;
  let filled = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith(pref)) continue;
    total += 1;
    const s = v == null ? '' : String(v).trim();
    if (s !== '' && s !== '—') filled += 1;
  }
  if (total === 0) return { state: 'unknown', filled: 0, total: 0, missing: 0 };
  const missing = total - filled;
  if (missing === 0) return { state: 'ready', filled, total, missing };
  if (filled === 0) return { state: 'missing', filled, total, missing };
  return { state: 'partial', filled, total, missing };
}

const STATUS_TXT = {
  ready: 'Data populated from your work',
  partial: (n) => `Partial — ${n} field${n === 1 ? '' : 's'} missing`,
  missing: 'Missing — complete the source tool',
  unknown: 'Sample data shown',
};
const DOT = {
  ready: 'bg-emerald-500',
  partial: 'bg-amber-500',
  missing: 'bg-gray-300 dark:bg-gray-600',
  unknown: 'bg-gray-300 dark:bg-gray-600',
};

export default function SpinoutLabPitchDeckPage() {
  const { user } = useAuth();
  const { toast, showToast } = useToast(3500);

  const [projectId, setProjectId] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { fields, loading: fieldsLoading } = useSpinoutDeckFields({ projectId, enabled: !!projectId, reloadKey });

  const [view, setView] = useState('grid'); // grid | editor
  const [slideIdx, setSlideIdx] = useState(0);
  const [Thumbnail, setThumbnail] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [error, setError] = useState('');

  // Resolve the founder's Lab project (same picker as the other tool pages).
  useEffect(() => {
    let alive = true;
    setProjectLoading(true);
    api.listProjects()
      .then((projects) => {
        if (!alive) return;
        const proj = pickLabProject(projects, user);
        setProjectId(proj?.id ?? null);
      })
      .catch((e) => { if (alive) reportError('SpinoutLabPitchDeckPage:projects', e); })
      .finally(() => { if (alive) setProjectLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Lazy-load the heavy Thumbnail renderer (same pattern as PitchDeckPage).
  useEffect(() => {
    let alive = true;
    import('../decks/Thumbnail')
      .then((m) => { if (alive && m?.Thumbnail) setThumbnail(() => m.Thumbnail); })
      .catch((e) => reportError('SpinoutLabPitchDeckPage:thumbnail', e));
    return () => { alive = false; };
  }, []);

  const template = TEMPLATES.axal_spinout_demoday;

  const statuses = useMemo(() => SLIDE_META.map((m) => slideStatus(m, fields)), [fields]);
  const readyCount = statuses.filter((s) => s.state === 'ready').length;
  const readyPct = Math.round((readyCount / SLIDE_META.length) * 100);
  const exportDisabled = readyCount < EXPORT_MIN_READY;

  // Week chips aggregated from the per-slide statuses (cover excluded).
  const weekPills = useMemo(() => WEEKS.map((w) => {
    const idxs = SLIDE_META.map((m, i) => (m.week === w.num ? i : -1)).filter((i) => i >= 0);
    const sts = idxs.map((i) => statuses[i]);
    if (sts.every((s) => s.state === 'ready')) return { ...w, state: 'done', note: '' };
    const missingItems = sts.reduce((n, s) => n + (s.state === 'unknown' ? 0 : s.missing > 0 ? 1 : 0), 0);
    if (sts.some((s) => s.state === 'ready' || s.state === 'partial')) {
      return { ...w, state: 'warn', note: `${missingItems} item${missingItems === 1 ? '' : 's'} missing` };
    }
    return { ...w, state: 'pending', note: '' };
  }), [statuses]);

  // Fetch (or create) the current AXAL-method deck version — needed for the
  // real export/share backend. The stored current deck may be a different
  // template the founder built in /raise/pitch, so this only accepts a row
  // whose method_id is `axal_spinout_demoday`; otherwise it applies the Axal
  // method (creates a new current version bound to the Lab data).
  const isAxalDeck = (deck) => {
    if (!deck) return false;
    if (deck.method_id === 'axal_spinout_demoday') return true;
    let slides = deck.slides;
    if (typeof slides === 'string') { try { slides = JSON.parse(slides); } catch { slides = []; } }
    return Array.isArray(slides) && slides.some((s) => s?.method_id === 'axal_spinout_demoday');
  };

  const ensureDeck = async () => {
    const versions = await api.deckListVersions(projectId);
    const list = Array.isArray(versions?.versions) ? versions.versions : Array.isArray(versions) ? versions : [];
    const current = list.find((v) => v.is_current) || list[0];
    if (current) {
      const deck = await api.deckGet(current.id);
      if (isAxalDeck(deck)) return deck;
    }
    // No current Axal deck — apply the Axal Spin-Out method (auto-fills from
    // Lab data and becomes the current version). 402 = Growth-tier gate;
    // api.js turns it into the standard upgrade modal upstream.
    // apply-method is Worker-only (prod); the dev FastAPI 405s it — fall
    // back to the stored current deck (or generic generate) so dev share
    // still works, and let export use the exact client-built spinout deck.
    try {
      const r = await api.deckApplyMethod(projectId, 'axal_spinout_demoday');
      return r?.deck || r;
    } catch (e) {
      if (e?.status === 405 || e?.status === 404) {
        if (current) return api.deckGet(current.id);
        const gen = await api.deckGenerate(projectId);
        return gen?.deck || gen;
      }
      throw e;
    }
  };

  const onExport = async () => {
    if (exporting || exportDisabled || !projectId) return;
    setExporting(true); setError('');
    try {
      const deck = await ensureDeck();
      // Template-aware server-side render (Cloudflare Browser Rendering
      // against the live SPA print template) — same 11 Axal slides as the
      // grid. Falls back to the client react-pdf renderer when the server
      // export is unavailable (dev) or fails.
      const r = await api.deckExport(deck.id, 'pdf');
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(deck.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast({ msg: 'PDF exported.', kind: 'ok' });
      } else if (r.status === 503 || r.status === 502 || r.status === 405 || r.status === 404) {
        // Server PDF render unavailable (dev) or failed — export the exact
        // client-built Spin-Out PowerPoint instead (same Task #41 path the
        // main deck builder uses; matches the 11 Axal slides byte-for-byte).
        const bundle = await api.spinoutDeck(projectId);
        const buildDeck = (await import('../decks/spinout/buildDeck.js')).default;
        const blob = await buildDeck(bundle.data, { notes: bundle.notes, draft: bundle.draft });
        const fname = `${(deck.title || 'spinout-deck').replace(/[^A-Za-z0-9_-]+/g, '-')}${bundle.draft ? '-DRAFT' : ''}.pptx`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast({ msg: 'Server PDF unavailable — exported PowerPoint instead.', kind: 'info' });
      } else {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `Export failed (${r.status})`);
      }
    } catch (e) {
      setError(e?.message || 'Export failed');
      reportError('SpinoutLabPitchDeckPage:export', e);
    } finally {
      setExporting(false);
    }
  };

  const onShare = async () => {
    if (sharing || !projectId) return;
    setSharing(true); setError('');
    try {
      const deck = await ensureDeck();
      const r = await api.deckShare(deck.id, { expires_in_hours: 24 });
      const path = r?.share_path || (r?.token && `/share/deck/${r.token}`);
      const url = r?.url || (path && `${window.location.origin}${path}`);
      setShareUrl(url || '');
      if (url && navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        showToast({ msg: 'Share link copied to clipboard.', kind: 'ok' });
      }
    } catch (e) {
      setError(e?.message || 'Share failed');
      reportError('SpinoutLabPitchDeckPage:share', e);
    } finally {
      setSharing(false);
    }
  };

  const openSlide = (i) => { setSlideIdx(i); setView('editor'); };
  const meta = SLIDE_META[slideIdx];
  const status = statuses[slideIdx];

  if (projectLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Presentation size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Pitch Deck Builder</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Create your startup record in the Spin-Out Lab first — the deck auto-assembles from your Lab work.
        </p>
        <Link to="/spinout-lab" className="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700">
          <ArrowLeft size={15} /> Back to Workspace
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6" data-testid="spinout-pitch-deck-page">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white'
            : toast.kind === 'err' ? 'bg-red-600 text-white'
              : 'bg-slate-800 text-white'
        }`}
        >
          {toast.msg}
        </div>
      )}
      {/* ---- page header ---- */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/spinout-lab" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200" data-testid="link-back-workspace">
          <ArrowLeft size={14} /> Back to Workspace
        </Link>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-2 min-w-0">
          <Presentation size={16} className="text-violet-600 dark:text-violet-400 flex-none" />
          <span className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100 truncate">Pitch Deck Builder</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Active</span>
        </div>
      </div>
      <p className="-mt-3 mb-5 text-[13px] text-gray-500 dark:text-gray-400">Auto-assemble your venture pitch deck</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-[12.5px] text-red-700 dark:text-red-300">
          <AlertTriangle size={14} className="flex-none" /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

      {view === 'grid' ? (
        <>
          {/* ---- action banner ---- */}
          <div className={`${CARD} p-5 mb-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100">Your Pitch Deck</div>
                <div className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-0.5">
                  Auto-assembled from your Spin-Out Lab work. Edit any slide, then export or share.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onExport}
                  disabled={exportDisabled || exporting}
                  title={exportDisabled ? `Complete at least ${EXPORT_MIN_READY} slides to export` : 'Export all 11 slides as PDF'}
                  className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12.5px] font-semibold ${exportDisabled ? 'bg-violet-300 dark:bg-violet-900/40 text-white/80 cursor-not-allowed' : 'bg-violet-600 text-white hover:bg-violet-700'}`}
                  data-testid="button-export-pdf"
                >
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export PDF
                </button>
                <button
                  type="button"
                  onClick={onShare}
                  disabled={sharing}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  data-testid="button-share-link"
                >
                  {sharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share Link
                </button>
              </div>
            </div>
            {shareUrl && (
              <div className="mt-3 text-[12px] text-gray-500 dark:text-gray-400 break-all">
                Share link (24h): <span className="font-mono text-violet-700 dark:text-violet-300">{shareUrl}</span>
              </div>
            )}
            {/* week pills */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {weekPills.map((w) => (
                <span
                  key={w.num}
                  data-testid={`week-pill-${w.num}`}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] font-semibold border ${
                    w.state === 'done'
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : w.state === 'warn'
                        ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {w.state === 'done' ? <Check size={12} /> : w.state === 'warn' ? <AlertTriangle size={12} /> : null}
                  {w.label} — Week {w.num}{w.note ? `, ${w.note}` : ''}
                </span>
              ))}
            </div>
          </div>

          {/* ---- slide grid ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="slide-grid">
            {SLIDE_META.map((m, i) => {
              const st = statuses[i];
              return (
                <button
                  type="button"
                  key={m.spec}
                  onClick={() => openSlide(i)}
                  className={`${CARD} p-0 overflow-hidden text-left group hover:border-violet-300 dark:hover:border-violet-700 transition-colors`}
                  data-testid={`slide-card-${m.spec}`}
                >
                  <div className="relative">
                    <div className="aspect-video bg-gray-50 dark:bg-gray-800 overflow-hidden">
                      {Thumbnail
                        ? <Thumbnail template={template} data={fields || undefined} slideIndex={i} />
                        : <div className="w-full h-full flex items-center justify-center text-gray-300"><Loader2 size={16} className="animate-spin" /></div>}
                    </div>
                    <span className="absolute top-2 left-2 w-5 h-5 rounded-md bg-white/90 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-700 text-[10.5px] font-bold text-gray-600 dark:text-gray-300 flex items-center justify-center">{i + 1}</span>
                    {st.state === 'ready' && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check size={11} /></span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-gray-100 dark:border-gray-800">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 truncate">{m.title}</div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                        {st.state === 'partial' ? STATUS_TXT.partial(st.missing) : STATUS_TXT[st.state]}
                      </div>
                    </div>
                    <span className={`ml-auto w-2 h-2 rounded-full flex-none ${DOT[st.state]}`} title={st.state} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* ---- progress bar ---- */}
          <div className="flex items-center gap-3 mt-6" data-testid="deck-progress">
            <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${readyPct}%` }} />
            </div>
            <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
              {readyCount} of {SLIDE_META.length} slides ready
            </span>
          </div>
          {fieldsLoading && (
            <div className="mt-3 text-[11.5px] text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Refreshing from your Lab data…</div>
          )}
        </>
      ) : (
        /* ---- editor view ---- */
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6" data-testid="slide-editor-view">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <button type="button" onClick={() => setView('grid')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" data-testid="button-back-to-deck">
                <ArrowLeft size={13} /> Back to deck
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" disabled={slideIdx === 0} onClick={() => setSlideIdx((i) => Math.max(0, i - 1))} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700" data-testid="button-prev-slide">
                  <ChevronLeft size={13} /> Prev
                </button>
                <button type="button" disabled={slideIdx === SLIDE_META.length - 1} onClick={() => setSlideIdx((i) => Math.min(SLIDE_META.length - 1, i + 1))} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700" data-testid="button-next-slide">
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
            <div className={`${CARD} overflow-hidden`}>
              <div className="aspect-video bg-gray-50 dark:bg-gray-800">
                {Thumbnail
                  ? <Thumbnail template={template} data={fields || undefined} slideIndex={slideIdx} />
                  : <div className="w-full h-full flex items-center justify-center text-gray-300"><Loader2 size={16} className="animate-spin" /></div>}
              </div>
              <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">{meta.title}</div>
                <span className="text-[11.5px] text-gray-400">Slide {slideIdx + 1} of {SLIDE_META.length}</span>
                <span className={`ml-auto w-2 h-2 rounded-full ${DOT[status.state]}`} title={status.state} />
              </div>
            </div>
            <p className="mt-2.5 text-[11px] text-gray-400 dark:text-gray-500">
              Changes here update your startup's source data — the slide re-renders from it.
            </p>
          </div>
          <div className={`${CARD} p-5`}>
            <div className={`${LBL} mb-2`}>Edit slide</div>
            <SpinoutSlideEditor
              slide={{ spec_id: meta.spec, title: meta.title }}
              fields={fields}
              projectId={projectId}
              onSaved={() => setReloadKey((k) => k + 1)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
