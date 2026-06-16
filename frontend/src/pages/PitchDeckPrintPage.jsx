import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minimize2, Printer, X } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { downloadDeckPdf } from '../lib/deckPdf.jsx';
import { downloadRasterDeckPdf } from '../lib/deckRasterPdf';
import ShareDeckCTA from '../components/ShareDeckCTA';
import { ReviewDealSlotContext } from '../decks/templates/reviewDealSlot';

// Task #25 — public viewer for an investor share link, plus an authenticated
// preview at /deck/:id/print. Task #6 expanded the advanced (live React
// template + window.print()) path to cover ALL 12 registered templates so
// the share viewer matches the in-app editor preview for every deck. Only
// decks with no recognisable method_id at all still fall back to the
// generic purple-card stack. The YC Seed redesign verification (this task)
// is now subsumed by that broader coverage — yc_seed flows through the
// same Template-loaded advanced path as the rest.
// Task #53 — heartbeat read-seconds to the worker every 30s so the
// founder's Engagement panel can show "12 min read".

// Slide16x9 fixed dimensions — every template renders at 1920×1080
// inside transform: scale() so the viewer fits the browser width.
const INNER_W = 1920;
const INNER_H = 1080;

// Pull the method_id out of the persisted slide blob the same way the
// editor does — /apply-method stamps every slide with method_id.
function detectMethodId(deck) {
  if (!deck) return null;
  // Prefer the explicit method_id set by /apply-method, but fall back
  // through every place the platform stores the template key so a deck
  // saved via an older path (template_key column / slide-level
  // template / nested method object) still picks the right renderer.
  const direct = deck.method_id || deck.template_key || deck.template || deck.method?.id || deck.method?.key;
  if (typeof direct === 'string' && direct) return direct;
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  for (const s of slides) {
    const k = s?.method_id || s?.template_key || s?.template;
    if (typeof k === 'string' && k) return k;
  }
  return null;
}

// Coerce a metric_grid cell value or a numeric paragraph field into a
// number for the template's chart components. Strips currency / commas
// / "k" / "m" suffixes; returns undefined on failure so the template
// falls back to its own sample.
function toNumber(raw) {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim().toLowerCase().replace(/[,$\s_]/g, '');
  if (!s) return undefined;
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kmb])?/);
  if (!m) return undefined;
  const base = parseFloat(m[1]);
  if (Number.isNaN(base)) return undefined;
  const mul = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  return base * mul;
}

const NUMERIC_KEYS = new Set([
  'tam_usd', 'sam_usd', 'som_usd', 'market_cagr_pct',
  'mrr_usd', 'paying_customers', 'growth_mom_pct', 'nrr_pct',
  'ask_amount_usd', 'runway_months',
]);

// Promote bullet-string arrays into the object shape the Sequoia
// template's richer slides expect (broken_pillars, moats, founders,
// roadmap, use_of_funds, flywheel_nodes, customer_logos, team_timeline,
// shift_curves). When the AI/autofill writes simple strings, we
// reconstruct minimal {title, body} / {name} / {label, pct} records
// so the design renders gracefully — title/label-only when that's all
// we have, no broken graphs.
function normalizeBullets(key, value) {
  if (!Array.isArray(value)) return value;
  const stringy = value.every((x) => typeof x === 'string');
  if (!stringy) return value;
  switch (key) {
    case 'broken_pillars':
      return value.map((s) => ({ title: s, body: '', cost: '' }));
    case 'moats':
    case 'product_pillars':
      return value.map((s) => ({ title: s, body: '' }));
    case 'founders':
      return value.map((s) => {
        // Common autofill shape: "Name — Role · short bio"
        const parts = String(s).split(/\s+[\u2014\u2013-]\s+/);
        const [name, rest = ''] = parts;
        const initials = (name || '').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
        const [role, ...bioParts] = rest.split(/\s+\u00b7\s+|\s*\|\s*/);
        return { name: name || s, role: role || '', bio: bioParts.join(' · ') || rest, initials };
      });
    case 'team_timeline':
      return value.map((s) => {
        const m = String(s).match(/^\s*(\d{4})[\s\u2014\u2013:\-]+(.+)$/);
        return m ? { year: m[1], event: m[2] } : { year: '', event: String(s) };
      });
    case 'roadmap':
      return value.map((s) => {
        const m = String(s).match(/^\s*([^:\u2014\u2013-]+)[\s\u2014\u2013:\-]+(.+)$/);
        return m ? { quarter: m[1].trim(), goal: m[2].trim() } : { quarter: '', goal: String(s) };
      });
    case 'use_of_funds':
      return value.map((s) => {
        const m = String(s).match(/^\s*(.+?)\s*[:\u2014\u2013-]\s*(\d+)\s*%?\s*$/);
        return m ? { label: m[1].trim(), pct: parseInt(m[2], 10) } : { label: String(s), pct: 0 };
      });
    case 'flywheel_nodes':
      return value.map((s) => {
        const parts = String(s).split(/\s+[\u2014\u2013-]\s+|\s*[:\u00b7]\s*/);
        return { label: parts[0] || s, body: parts.slice(1).join(' ') };
      });
    case 'customer_logos':
      return value.map((s) => ({ name: String(s) }));
    case 'shift_curves':
      return value.map((s, i) => ({
        label: String(s),
        from: 20 + i * 15, to: 70 - i * 20,
      }));
    case 'market_curve':
    case 'revenue_curve':
    case 'user_curve':
      // Accept "2024:38" / "2024 — 38" / "Jan 12" / "Mar=24k".
      return value.map((s) => {
        const m = String(s).match(/^\s*([^:=\u2014\u2013\-,\s][^:=\u2014\u2013,]*?)\s*[:=\u2014\u2013\-,]\s*([\d.,kmKMbB]+)/);
        const label = m ? m[1].trim() : String(s);
        const num = m ? toNumber(m[2]) : undefined;
        return key === 'market_curve' ? { year: label, v: num ?? 0 } : { month: label, v: num ?? 0 };
      }).filter((p) => p.v !== 0 || /\d/.test(String(p.year || p.month || '')));
    case 'retention_curve':
      return value.map((s) => {
        const m = String(s).match(/^\s*([^:=\u2014\u2013\-,\s]+)\s*[:=\u2014\u2013\-,]\s*([\d.]+)\s*%?/);
        return m ? { m: m[1].trim(), v: parseFloat(m[2]) } : { m: String(s), v: 0 };
      });
    case 'competitors':
      // "Name | x | y" or "Name: 80,40" — x/y on 0–100.
      return value.map((s) => {
        const parts = String(s).split(/\s*[|,;]\s*|\s*:\s*/);
        const name = parts[0] || String(s);
        const x = parseFloat(parts[1] || '50');
        const y = parseFloat(parts[2] || '50');
        return { name, x: Number.isFinite(x) ? x : 50, y: Number.isFinite(y) ? y : 50 };
      });
    case 'solution_pillar_words':
    case 'magic_capabilities':
      // Plain words; pass through as a string array (template renders
      // them directly). Defensive uppercase strip stays a no-op.
      return value.map((s) => String(s));
    case 'revenue_flow':
      // "Customer → Subscription : pays" / "Customer | Subscription | pays".
      // Split on arrow/pipe *or* a free-standing colon so the label
      // suffix is extracted instead of sticking to `to`.
      return value.map((s) => {
        const parts = String(s).split(/\s*(?:\u2192|->|\|)\s*|\s+:\s+/);
        return { from: parts[0] || '', to: parts[1] || String(s), label: parts[2] || '' };
      });
    case 'funnel':
      // "Visitors: 12000" / "Signups — 2100".
      return value.map((s) => {
        const m = String(s).match(/^\s*([^:=\u2014\u2013\-,]+)\s*[:=\u2014\u2013\-,]\s*([\d.,kmKMbB]+)/);
        return m
          ? { stage: m[1].trim(), v: toNumber(m[2]) ?? 0 }
          : { stage: String(s), v: 0 };
      });
    case 'revenue_series':
    case 'user_series':
      // "2024:0.2" / "Jan — 120". Template reads {label, v}.
      return value.map((s) => {
        const m = String(s).match(/^\s*([^:=\u2014\u2013\-,]+)\s*[:=\u2014\u2013\-,]\s*([\d.,kmKMbB]+)/);
        return m
          ? { label: m[1].trim(), v: toNumber(m[2]) ?? 0 }
          : { label: String(s), v: 0 };
      });
    case 'milestones':
      // "2025: First $1M ARR" / "Q2 — Closed 10 logos".
      return value.map((s) => {
        const m = String(s).match(/^\s*([^:\u2014\u2013\-]+?)\s*[:\u2014\u2013\-]\s*(.+)$/);
        return m
          ? { date: m[1].trim(), label: m[2].trim() }
          : { date: '', label: String(s) };
      });
    case 'product_modules':
      // "Capture: Web, API, Mobile" → {name, nodes:[…]}
      return value.map((s) => {
        const [name, rest = ''] = String(s).split(/\s*[:\u2014\u2013\-]\s*/);
        const nodes = rest.split(/\s*[,;|]\s*/).filter(Boolean);
        return { name: name || String(s), nodes };
      });
    default:
      return value;
  }
}

// Flatten the editor's per-slide field blob into one dict keyed by
// field.key — exactly the shape Deck_sequoia_classic / Deck_yc_seed
// read. metric_grid cells get exploded by their slug-ified label so
// "TAM" → tam_usd, "MoM growth" → mom_growth, etc.
function buildTemplateData(deck, spinoutFields = null) {
  const out = {};
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  for (const s of slides) {
    if (!Array.isArray(s?.fields)) continue;
    for (const fld of s.fields) {
      if (!fld?.key) continue;
      let value = fld.value;
      if (fld.kind === 'metric_grid' && Array.isArray(value)) {
        out[fld.key] = value;
        for (const cell of value) {
          const slug = String(cell?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          if (slug && cell?.value != null) out[slug] = cell.value;
        }
        continue;
      }
      if (fld.kind === 'bullets' && Array.isArray(value)) {
        value = normalizeBullets(fld.key, value);
      }
      if (NUMERIC_KEYS.has(fld.key)) {
        const n = toNumber(value);
        if (n !== undefined) value = n;
      }
      // Don't clobber an already-set numeric expansion from a
      // metric_grid cell above.
      if (out[fld.key] === undefined) out[fld.key] = value;
    }
  }
  // Top-level fall-backs from the deck record so the Slide6/Slide11
  // header chrome always has a company name to render.
  if (!out.company && deck?.title) out.company = String(deck.title).replace(/\s*[—\-]\s*Pitch.*$/i, '');

  // Kawasaki-specific shape coercions. methods.ts emits `problem_stat`
  // as a paragraph and `bm_unit` as a metric_grid; the template reads
  // `problem_stat.{value,label}` and `bm_unit.{acv,gross_margin,
  // payback}`. Do the shape conversion here so neither side has to
  // know about the other's storage format.
  if (typeof out.problem_stat === 'string') {
    const raw = out.problem_stat;
    // "$1.2T | wasted globally each year on …" — first segment is the
    // big number, rest is the support line.
    const parts = raw.split(/\s*[|\u2014\u2013]\s*|\s+-\s+/);
    out.problem_stat = { value: parts[0] || raw, label: parts.slice(1).join(' ').trim() };
  }
  if (Array.isArray(out.bm_unit)) {
    const cells = out.bm_unit;
    const lookup = (...slugs) => {
      for (const c of cells) {
        const slug = String(c?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (slugs.includes(slug) && c?.value != null && c.value !== '') return String(c.value);
      }
      return '';
    };
    out.bm_unit = {
      acv: lookup('acv', 'avg_contract_usd', 'average_contract_value'),
      gross_margin: lookup('gross_margin', 'gross_margin_pct', 'margin'),
      payback: lookup('payback', 'payback_months', 'payback_period'),
    };
  }

  // Task #55 — merge the live flat dotted-key field map (from the
  // spinoutDeck API) into the output so the spinout template's hydrate()
  // sees real Lab data. The dotted keys take priority over the underscore
  // keys already built from the slide fields.
  if (spinoutFields && typeof spinoutFields === 'object') {
    for (const [key, val] of Object.entries(spinoutFields)) {
      if (val === undefined || val === null) continue;
      out[key] = val;
    }
  }

  return out;
}

export default function PitchDeckPrintPage({ shareMode = false, exportMode = false }) {
  const { id, token } = useParams();
  // Task #2 — when the headless Browser-Rendering session loads us, the
  // worker passes ?print_mode=pdf (stack every slide top-to-bottom for
  // Chrome's page-per-slide PDF output) or ?print_mode=single&slide=N
  // (render ONE slide for a 1920×1080 screenshot fan-out). The query
  // params are only read in exportMode; share + authenticated viewers
  // ignore them.
  const [searchParams] = useSearchParams();
  const printMode = exportMode ? (searchParams.get('print_mode') || 'pdf') : null;
  const singleSlideIdx = exportMode && printMode === 'single'
    ? Math.max(0, parseInt(searchParams.get('slide') || '0', 10) || 0)
    : null;
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null); // {current,total} | null
  const [Template, setTemplate] = useState(null);
  const [templateMeta, setTemplateMeta] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Task #55 — live SpinoutDeckData fields from the API. When the deck is a
  // spinout template, buildTemplateData() produces underscore keys (cover_eyebrow,
  // problem_headline, …) but the template's hydrate() expects dotted paths
  // (cover.thesis, problem.title, …). We fetch the flattened dotted-key field
  // map from the spinoutDeck endpoint so the print view renders real data.
  const [spinoutFields, setSpinoutFields] = useState(null);
  // Task #11 — in fullscreen we render ONE slide at a time. `currentIdx`
  // drives the translateY transform on the slide track; `slideCount`
  // is reported up by PrintStage after first render so the keyboard
  // listener and overlay readout know the bounds.
  const [currentIdx, setCurrentIdx] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  // Task #11 — inline error toast for PDF export failures. The
  // share route renders outside ProtectedLayout so there's no
  // useToast context; we render a lightweight banner that includes
  // a "Use browser print as fallback" action.
  const [exportError, setExportError] = useState(null);
  const overlayTimerRef = useRef(null);
  const viewIdRef = useRef(null);
  const startedAtRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        let d;
        if (exportMode) {
          d = await api.deckPrintExportRead(token);
        } else if (shareMode) {
          d = await api.deckShareRead(token);
        } else {
          d = await api.deckGet(parseInt(id));
        }
        setDeck(d);
        if (shareMode && d?.view_id) {
          viewIdRef.current = d.view_id;
          startedAtRef.current = Date.now();
        }
      } catch (e) {
        setError(e?.message || 'Failed to load');
        reportError('PitchDeckPrintPage:load', e);
      }
    })();
  }, [id, token, shareMode, exportMode]);

  const methodId = useMemo(() => detectMethodId(deck), [deck]);

  // Task #55 — when the deck is a spinout template, fetch live flat fields
  // from the spinoutDeck API so the print view renders real Lab data.
  // Task #28 — share + PDF-export viewers are unauthenticated and CANNOT call
  // the authed spinoutDeck endpoint, so the worker server-bakes the same flat
  // dotted-key field map onto the read response (deck.spinout_fields). Use it
  // directly in those modes; the authenticated viewer still fetches live.
  useEffect(() => {
    if (methodId !== 'axal_spinout_demoday') {
      setSpinoutFields(null);
      return undefined;
    }
    if (shareMode || exportMode) {
      setSpinoutFields(deck?.spinout_fields || null);
      return undefined;
    }
    if (!deck?.project_id) {
      setSpinoutFields(null);
      return undefined;
    }
    let alive = true;
    api.spinoutDeck(deck.project_id)
      .then((r) => {
        if (!alive) return;
        setSpinoutFields(r?.fields || null);
      })
      .catch((e) => {
        if (alive) {
          setSpinoutFields(null);
          reportError('PitchDeckPrintPage:spinoutFields', e);
        }
      });
    return () => { alive = false; };
  }, [methodId, deck?.project_id, deck?.spinout_fields, shareMode, exportMode]);

  // Task #6 — lazy-load the templates registry whenever we have a
  // method_id, regardless of which one. Only decks with no recognisable
  // method_id at all fall through to the legacy purple-card path.
  const [registryReady, setRegistryReady] = useState(false);
  useEffect(() => {
    if (!methodId) { setTemplate(null); setTemplateMeta(null); setRegistryReady(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('../decks/templates');
        if (cancelled) return;
        const meta = (mod.TEMPLATES || {})[methodId];
        if (meta) {
          setTemplate(() => meta.Component);
          setTemplateMeta(meta);
        } else {
          setTemplate(null); setTemplateMeta(null);
        }
        setRegistryReady(true);
      } catch (err) {
        console.error('PitchDeckPrintPage: failed to load template registry', err);
        setRegistryReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [methodId]);

  const isAdvanced = !!Template;

  // Task #53 — read-time heartbeat. Fires every 30s while the tab is
  // open and once more on unmount. Capped server-side at 2h per view.
  // Task #6 — fullscreen toggling uses the same Page Visibility events,
  // so visibilitychange below is still the right trigger (a fullscreen
  // tab that loses focus / minimises still flushes its heartbeat).
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

  // Task #6 — Fullscreen toggle. Uses the native Fullscreen API on the
  // root stage element so Esc exits, fullscreenchange flips state back
  // (covers Esc + browser-button exits + cross-app focus loss). Task #11
  // anchors `currentIdx` to the slide nearest the scroll viewport when
  // entering, so the user lands on the slide they were already reading.
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (stageRef.current && stageRef.current.requestFullscreen) {
        const root = stageRef.current;
        const frames = Array.from(root.querySelectorAll('[data-slide-frame]'));
        if (frames.length > 0) {
          const anchor = 60;
          let best = Infinity; let idx = 0;
          frames.forEach((el, i) => {
            const d = Math.abs(el.getBoundingClientRect().top - anchor);
            if (d < best) { best = d; idx = i; }
          });
          setCurrentIdx(idx);
        }
        await root.requestFullscreen();
        // Task #15 — Safari/Firefox route keyboard events to the
        // fullscreen element first. Without an explicit focus the
        // stage is not the activeElement, so arrow keys can be
        // swallowed by the browser's default scroll handler before our
        // document-level listener gets to preventDefault.
        try { root.focus({ preventScroll: true }); } catch { /* noop */ }
      }
    } catch { /* user gesture missing / unsupported — silently ignore */ }
  }, []);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Task #11 — auto-hide the fullscreen overlay (slide counter +
  // exit hint) after 2.5s of mouse-idle so the slide is the whole
  // canvas. Any pointer move re-shows it briefly.
  useEffect(() => {
    if (!isFullscreen) { setOverlayVisible(true); return undefined; }
    const ping = () => {
      setOverlayVisible(true);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = setTimeout(() => setOverlayVisible(false), 2500);
    };
    ping();
    document.addEventListener('mousemove', ping);
    document.addEventListener('keydown', ping);
    return () => {
      document.removeEventListener('mousemove', ping);
      document.removeEventListener('keydown', ping);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, [isFullscreen]);

  // Task #11 — keyboard navigation. Works in both fullscreen and the
  // normal scroll-through view (same scroll-snap layout). Slides are
  // enumerated via the `data-slide-frame` hook added to Slide16x9 and
  // the legacy fallback frame, so the same listener drives every
  // template. Skips when the user is typing into the CTA modal or
  // when a browser shortcut modifier is held.
  useEffect(() => {
    const NAV_NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'j']);
    const NAV_PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'k']);
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Task #11 — Shift+Space goes BACK (presenter convention).
      // We branch on Space here before the alt-key bail so the Shift
      // modifier doesn't get swallowed by the generic NAV_NEXT lookup.
      const isSpace = e.key === ' ' || e.key === 'Spacebar';
      const ae = document.activeElement;
      if (ae) {
        const tag = ae.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return;
      }
      const root = stageRef.current;
      if (!root) return;
      const isNext = NAV_NEXT.has(e.key) && !(isSpace && e.shiftKey);
      const isPrev = NAV_PREV.has(e.key) || (isSpace && e.shiftKey);
      const isHome = e.key === 'Home';
      const isEnd = e.key === 'End';
      const isFsToggle = e.key === 'f' || e.key === 'F';
      if (!isNext && !isPrev && !isHome && !isEnd && !isFsToggle) return;
      if (isFsToggle) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      const frames = Array.from(root.querySelectorAll('[data-slide-frame]'));
      const total = frames.length;
      if (total === 0) return;
      e.preventDefault();

      // Task #11 — in fullscreen we drive the single-slide viewer
      // through `currentIdx`; outside fullscreen we keep the legacy
      // scroll-anchored behaviour for the scrollable stack.
      if (document.fullscreenElement) {
        setCurrentIdx((cur) => {
          if (isNext) return Math.min(total - 1, cur + 1);
          if (isPrev) return Math.max(0, cur - 1);
          if (isHome) return 0;
          if (isEnd) return total - 1;
          return cur;
        });
        return;
      }

      // Sticky chrome occupies ~56px when not fullscreen; treat the
      // slide whose top is closest to that line as the current one.
      const anchor = 60;
      let curIdx = 0;
      let best = Infinity;
      frames.forEach((el, i) => {
        const d = Math.abs(el.getBoundingClientRect().top - anchor);
        if (d < best) { best = d; curIdx = i; }
      });
      let target = curIdx;
      if (isNext) target = Math.min(total - 1, curIdx + 1);
      else if (isPrev) target = Math.max(0, curIdx - 1);
      else if (isHome) target = 0;
      else if (isEnd) target = total - 1;
      if (target === curIdx && !isHome && !isEnd) return;
      frames[target].scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    // Task #15 — listen on `document` (not `window`) so the listener
    // also catches keys that are routed to the fullscreen element on
    // Safari/Firefox, where `window`-level listeners can miss them.
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  // Task #55 — for spinout templates, merge the live flat dotted-key fields
  // into the templateData so hydrate() sees real Lab data. For other
  // templates, the existing buildTemplateData() shape is sufficient.
  const templateData = useMemo(() => {
    if (!isAdvanced || !deck) return null;
    if (methodId === 'axal_spinout_demoday' && spinoutFields) {
      return buildTemplateData(deck, spinoutFields);
    }
    return buildTemplateData(deck);
  }, [isAdvanced, deck, methodId, spinoutFields]);

  const exportPdf = async () => {
    if (!deck) return;
    // Task #23 — commit `exporting` synchronously so the embedded Spin-Out
    // "Review the deal" CTA (rendered only when `!exporting`) is removed
    // from the DOM BEFORE downloadRasterDeckPdf snapshots [data-slide-frame],
    // rather than on a later React tick. Without flushSync the removal would
    // race the html2canvas capture and the interactive button could bake
    // into the exported slide.
    flushSync(() => {
      setExporting(true);
      setExportProgress(null);
    });
    try {
      // Task #11 — Advanced templates now rasterise each
      // `[data-slide-frame]` at native 1920×1080 via html2canvas and
      // assemble a real landscape PDF with jsPDF, bypassing the
      // browser's print dialog (and its margins/headers). Legacy
      // purple-card decks (no method_id) still use the @react-pdf
      // primitive path because they don't carry the data-slide-frame
      // contract at native size.
      if (isAdvanced) {
        if (!stageRef.current) throw new Error('Stage not ready');
        await downloadRasterDeckPdf(deck, {
          stageEl: stageRef.current,
          onProgress: (p) => setExportProgress(p),
        });
      } else {
        await downloadDeckPdf(deck);
      }
    } catch (e) {
      // Task #11 — surface an inline toast (the share route is
      // outside ProtectedLayout so the global toast context isn't
      // available). The toast offers a one-click fallback to the
      // browser's print pipeline so users are never stuck.
      // Task #33 — report the error so it reaches diagnostics.
      const msg = e?.message || 'unknown error';
      setExportError(msg);
      reportError('PitchDeckPrintPage:exportPdf', { message: msg, error: e });
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
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
  if (methodId && !registryReady) return <div className="p-8 text-gray-500">Loading template…</div>;

  // Task #2 — headless export branch. No chrome, no CTA, no scaling
  // wrappers: render each slide at the native 1920×1080 size the
  // templates were designed for so Browser Rendering captures pixel-
  // perfect output. PDF mode stacks every slide; single mode renders
  // just one. We render INSIDE a flexbox track so the template's
  // own [data-slide-frame] markers stay top-to-bottom.
  if (exportMode) {
    const fixedStageStyle = {
      width: INNER_W,
      background: '#ffffff',
      margin: 0,
      padding: 0,
    };
    const trackStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      width: INNER_W,
    };
    return (
      <div style={{ background: '#ffffff', margin: 0, padding: 0 }}>
        <style>{`
          html, body, #root { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
          /* Each slide is exactly 1920×1080 inside the template; keep
             page breaks aligned so the headless PDF emits one page per
             slide and no chrome ever appears. */
          @page { size: 1920px 1080px; margin: 0; }
          [data-slide-frame] { page-break-after: always; break-after: page; }
          [data-slide-frame]:last-child { page-break-after: auto; break-after: auto; }
        `}</style>
        <div style={fixedStageStyle} data-export-stage>
          <div style={trackStyle}>
            {isAdvanced ? (
              singleSlideIdx != null ? (
                <SingleSlideStage Template={Template} data={templateData} slideIdx={singleSlideIdx} />
              ) : (
                <Template data={templateData || {}} editable={false} />
              )
            ) : (
              // Legacy fallback (no method_id) — render each slide at
              // 1920×1080 with the same purple-card design used in the
              // interactive viewer.
              (singleSlideIdx != null
                ? (deck.slides || []).slice(singleSlideIdx, singleSlideIdx + 1)
                : (deck.slides || [])
              ).map((s, i) => (
                <div
                  key={i}
                  data-slide-frame=""
                  style={{
                    width: INNER_W,
                    height: INNER_H,
                    background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                    color: '#fff',
                    padding: 96,
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ fontSize: 24, letterSpacing: 6, textTransform: 'uppercase', color: '#ddd6fe' }}>
                    {s.subtitle || `Slide ${(singleSlideIdx ?? 0) + i + 1}`}
                  </div>
                  <h2 style={{ fontSize: 72, fontWeight: 600, marginTop: 16 }}>{s.title}</h2>
                  {s.body && (
                    <div style={{ fontSize: 28, marginTop: 24, color: '#ede9fe' }}>
                      <ReactMarkdown>{s.body}</ReactMarkdown>
                    </div>
                  )}
                  {(s.bullets || []).length > 0 && (
                    <ul style={{ marginTop: 24, fontSize: 28, listStyle: 'none', padding: 0 }}>
                      {s.bullets.map((b, j) => (
                        <li key={j} style={{ marginBottom: 12 }}>• {b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // CTA card (share mode only — never on the authenticated /deck/:id/print).
  const ctaCategory = templateMeta?.category || null;
  const shareCtaProps = (shareMode && ctaCategory && deck) ? {
    category: ctaCategory,
    shareToken: token,
    deckId: deck.id,
    viewId: viewIdRef.current,
    projectId: deck.project_id || null,
    projectName: deck.project_name || deck.title || 'this project',
    methodId,
    slides: Array.isArray(deck.slides) ? deck.slides.map((s, i) => ({
      index: i,
      title: s?.title || s?.subtitle || `Slide ${i + 1}`,
    })) : [],
  } : null;
  // Task #23 — the Axal VC Spin-Out deck surfaces the CTA *inside* its
  // "Review the deal" slide (via reviewDealSlot below) instead of as a
  // trailing page. Every other deck keeps the trailing card.
  const isSpinout = methodId === 'axal_spinout_demoday';
  const cta = (shareCtaProps && !isSpinout) ? <ShareDeckCTA {...shareCtaProps} /> : null;
  // Injected into the Spin-Out "Review the deal" slide. Suppressed while
  // exporting so the interactive button never rasterises into the PDF.
  const reviewDealSlot = (shareCtaProps && isSpinout && !exporting)
    ? <ShareDeckCTA {...shareCtaProps} embedded />
    : null;

  const Header = (
    <div className="deck-print-chrome sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="text-sm text-gray-700 font-medium truncate">{deck.title || 'Pitch deck'} · v{deck.version}</div>
      <div className="flex items-center gap-2">
        {exporting && exportProgress && (
          <div className="text-xs text-gray-600 tabular-nums hidden sm:block">
            Rendering slide {exportProgress.current} of {exportProgress.total}…
          </div>
        )}
        <button
          type="button" onClick={toggleFullscreen} disabled={exporting}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (f)'}
          className="inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
        </button>
        <button
          onClick={exportPdf} disabled={exporting}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {exporting ? 'Exporting…' : 'Save as PDF'}
        </button>
      </div>
    </div>
  );

  // Advanced — render the actual template scaled to fit.
  if (isAdvanced) {
    return (
      <div
        ref={stageRef}
        tabIndex={-1}
        className={`outline-none ${isFullscreen ? 'relative bg-black w-screen h-screen' : 'bg-gray-100 min-h-screen'}`}
      >
        {/* Print-time rules kept for the legacy Ctrl/Cmd+P pathway —
            users who still hit the browser shortcut get a clean
            1920×1080 page-per-slide PDF without margins or headers.
            The primary "Save as PDF" button now drives the html2canvas
            + jsPDF rasteriser instead. Task #11. */}
        <style>{`
          @page { size: 1920px 1080px; margin: 0; }
          @media print {
            html, body { background: #FFFFFF !important; margin: 0 !important; padding: 0 !important; }
            .deck-print-chrome { display: none !important; }
            .deck-print-cta { display: none !important; }
            .deck-print-stage { background: #FFFFFF !important; padding: 0 !important; width: 1920px !important; position: static !important; inset: auto !important; display: block !important; }
            .deck-print-scaler { width: 1920px !important; margin: 0 !important; transform: none !important; }
            .deck-print-inner { transform: none !important; width: 1920px !important; }
            .deck-print-frames { gap: 0 !important; transform: none !important; }
            [data-fullscreen-viewport] { width: 1920px !important; height: auto !important; overflow: visible !important; }
          }
          :fullscreen .deck-print-chrome { display: none !important; }
          :fullscreen { background: #000 !important; }
        `}</style>
        {!isFullscreen && Header}
        <PrintStage
          Template={Template}
          data={templateData}
          isFullscreen={isFullscreen}
          currentIdx={currentIdx}
          onSlideCount={setSlideCount}
          reviewSlot={reviewDealSlot}
        />
        {!isFullscreen && cta && <div className="deck-print-cta">{cta}</div>}
        {isFullscreen && slideCount > 0 && (
          <>
            {/* Task #11 — clickable prev/next chevrons. Vertically
                centred on the left/right edges, auto-hide with the
                rest of the overlay chrome. Disabled at deck ends so
                they never push currentIdx out of bounds. */}
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              disabled={currentIdx <= 0}
              className={`fixed left-4 top-1/2 -translate-y-1/2 z-20 grid place-items-center w-12 h-12 rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity duration-300 ${overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => setCurrentIdx((i) => Math.min(slideCount - 1, i + 1))}
              disabled={currentIdx >= slideCount - 1}
              className={`fixed right-4 top-1/2 -translate-y-1/2 z-20 grid place-items-center w-12 h-12 rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity duration-300 ${overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <ChevronRight size={24} />
            </button>
            <div
              className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-end justify-between p-6 transition-opacity duration-300 ${overlayVisible ? 'opacity-100' : 'opacity-0'}`}
            >
              <div className="pointer-events-auto rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur tabular-nums">
                {Math.min(currentIdx + 1, slideCount)} / {slideCount}
              </div>
              <div className="pointer-events-auto rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
                ← → navigate · Shift+Space back · Esc to exit
              </div>
            </div>
          </>
        )}
        {exportError && (
          <div className="fixed bottom-4 right-4 z-30 max-w-md rounded-lg border border-red-200 bg-white shadow-lg p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-red-700">PDF export failed</div>
              <div className="mt-1 text-xs text-gray-600 break-words">{exportError}</div>
              <button
                type="button"
                onClick={() => { setExportError(null); try { window.print(); } catch { /* noop */ } }}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900"
              >
                <Printer size={12} /> Use browser print as fallback
              </button>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setExportError(null)}
              className="text-gray-400 hover:text-gray-700 shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Legacy fallback — generic purple cards for decks without a method_id.
  return (
    <div ref={stageRef} tabIndex={-1} className="bg-gray-100 min-h-screen outline-none">
      <style>{`
        :fullscreen .deck-print-chrome { display: none !important; }
        :fullscreen { background: #1e1b4b !important; overflow-y: auto; }
      `}</style>
      {Header}
      <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
        {(deck.slides || []).map((s, i) => (
          <div key={i} data-slide-frame="" className="bg-gradient-to-br from-violet-600 to-violet-800 text-white rounded-xl shadow-md p-12 aspect-video flex flex-col overflow-hidden">
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
        {cta}
      </div>
    </div>
  );
}

// Task #2 — single-slide stage for the per-slide PNG fan-out path.
// Templates emit their entire slide stack as one fragment of
// [data-slide-frame] children, so to isolate slide N we render the
// whole stack inside a 1920×1080 overflow:hidden viewport and shift
// the track up by N*1080 with a CSS transform. After mount we measure
// the actual frame heights (some templates emit non-1080 frames) and
// snap the offset to the exact pixel position of the requested slide
// so the screenshot lands flush at the top of the viewport.
function SingleSlideStage({ Template, data, slideIdx }) {
  const trackRef = useRef(null);
  const [offsetY, setOffsetY] = useState(slideIdx * INNER_H);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const measure = () => {
      const frames = el.querySelectorAll('[data-slide-frame]');
      if (!frames.length) return;
      const target = frames[Math.min(slideIdx, frames.length - 1)];
      if (target) {
        const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
        setOffsetY(top);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slideIdx, data]);
  return (
    <div style={{ width: INNER_W, height: INNER_H, overflow: 'hidden', position: 'relative', background: '#ffffff' }}>
      <div
        ref={trackRef}
        style={{
          width: INNER_W,
          transform: `translateY(${-offsetY}px)`,
          willChange: 'transform',
        }}
      >
        <Template data={data || {}} editable={false} />
      </div>
    </div>
  );
}

// Scaler for the 1920×1080 Slide16x9 stack.
//
// NORMAL mode (Task #25): ResizeObserver fits the deck to the
// available width; slides stack vertically with a gap so investors can
// scroll-through the deck the same way the editor's PreviewStage does.
//
// FULLSCREEN mode (Task #11): single-slide letterboxed presentation.
// Scale = min(vw/1920, vh/1080) so the whole 16:9 slide fits the
// viewport with black bars on the dominant axis. A `translateY` on
// the slide-track (`.deck-print-frames`) pages between slides, and
// the outer viewport clips with `overflow: hidden` so neighbouring
// slides never peek through.
function PrintStage({ Template, data, isFullscreen, currentIdx, onSlideCount, reviewSlot = null }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0) return;
      // Fullscreen → fit-both so the whole 16:9 frame is visible.
      // Normal   → fit-width so we still get the scroll-through stack.
      const next = isFullscreen
        ? Math.min(w / INNER_W, h / INNER_H)
        : Math.min(1, w / INNER_W);
      if (next > 0) setScale(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  // Count real DOM frames after each render so the parent's keyboard
  // listener and overlay readout know how many slides the template
  // actually emitted (some templates emit more slides than
  // deck.slides.length — Series B has 32 vs the editor's 22).
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    const count = () => {
      const n = el.querySelectorAll('[data-slide-frame]').length;
      if (n > 0) onSlideCount?.(n);
    };
    count();
    const mo = new MutationObserver(count);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [Template, data, onSlideCount]);

  if (isFullscreen) {
    return (
      <div
        ref={outerRef}
        className="deck-print-stage"
        style={{
          position: 'absolute', inset: 0, background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          data-fullscreen-viewport
          style={{
            width: INNER_W * scale,
            height: INNER_H * scale,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            className="deck-print-scaler"
            style={{ width: INNER_W, height: INNER_H, position: 'relative' }}
          >
            <div
              ref={innerRef}
              className="deck-print-inner"
              style={{
                width: INNER_W,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              <div
                data-fullscreen-track
                className="deck-print-frames"
                style={{
                  display: 'flex', flexDirection: 'column', gap: 0,
                  transform: `translateY(${-currentIdx * INNER_H}px)`,
                  transition: 'transform 0.25s ease',
                  willChange: 'transform',
                }}
              >
                <ReviewDealSlotContext.Provider value={reviewSlot}>
                  <Template data={data || {}} editable={false} />
                </ReviewDealSlotContext.Provider>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={outerRef} className="deck-print-stage" style={{ width: '100%', padding: 16 }}>
      <div
        className="deck-print-scaler"
        style={{
          width: INNER_W * scale,
          margin: '0 auto',
          position: 'relative',
        }}
      >
        <div
          ref={innerRef}
          className="deck-print-inner"
          style={{
            width: INNER_W,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <div className="deck-print-frames" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <ReviewDealSlotContext.Provider value={reviewSlot}>
              <Template data={data || {}} editable={false} />
            </ReviewDealSlotContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
