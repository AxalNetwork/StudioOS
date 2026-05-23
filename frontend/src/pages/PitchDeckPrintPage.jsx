import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Download, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { downloadDeckPdf } from '../lib/deckPdf.jsx';

// Task #25 — public viewer for an investor share link, plus an authenticated
// preview at /deck/:id/print. For advanced narrative templates
// (sequoia_classic, yc_seed) we render the actual Slide16x9 template
// scaled to fit the viewport so investors see the same graphics in the
// share link, the in-app preview, and the printed PDF. For older
// templates we fall back to the generic purple card stack.
// Task #53 — in share mode, heartbeat read-seconds to the worker every
// 30s so the founder's Engagement panel can show "12 min read".

// Task #1 scope: only the rebuilt Sequoia template uses the advanced
// (live React template + window.print()) viewer path. All other
// templates — including yc_seed — continue to render via the legacy
// purple-card path + @react-pdf/renderer export below.
const ADVANCED_TEMPLATES = new Set(['sequoia_classic']);

// Slide16x9 fixed dimensions — every template renders at 1920×1080
// inside transform: scale() so the viewer fits the browser width.
const INNER_W = 1920;
const INNER_H = 1080;

// Pull the method_id out of the persisted slide blob the same way the
// editor does — /apply-method stamps every slide with method_id.
function detectMethodId(deck) {
  if (!deck) return null;
  if (typeof deck.method_id === 'string' && deck.method_id) return deck.method_id;
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  for (const s of slides) {
    if (s && typeof s.method_id === 'string' && s.method_id) return s.method_id;
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
function buildTemplateData(deck) {
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
  return out;
}

export default function PitchDeckPrintPage({ shareMode = false }) {
  const { id, token } = useParams();
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [Template, setTemplate] = useState(null);
  const [templateMeta, setTemplateMeta] = useState(null);
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

  const methodId = useMemo(() => detectMethodId(deck), [deck]);
  const isAdvanced = methodId && ADVANCED_TEMPLATES.has(methodId);

  // Lazy-load the templates registry only for advanced decks. The
  // bundle would otherwise pull every SVG illustration into the public
  // share viewer.
  useEffect(() => {
    if (!isAdvanced) { setTemplate(null); setTemplateMeta(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('../decks/templates');
        if (cancelled) return;
        const meta = (mod.TEMPLATES || {})[methodId];
        if (meta) {
          setTemplate(() => meta.Component);
          setTemplateMeta(meta);
        }
      } catch (err) {
         
        console.error('PitchDeckPrintPage: failed to load template registry', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdvanced, methodId]);

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

  const templateData = useMemo(() => (isAdvanced && deck ? buildTemplateData(deck) : null), [isAdvanced, deck]);

  const exportPdf = async () => {
    if (!deck) return;
    setExporting(true);
    try {
      // For advanced graphical templates we use the browser's native
      // print pipeline so the rendered SVG + custom typography survive
      // intact. The @react-pdf/renderer path can't reproduce the
      // custom illustrations.
      if (isAdvanced) {
        window.print();
      } else {
        await downloadDeckPdf(deck);
      }
    } finally { setExporting(false); }
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

  // Advanced (Sequoia / YC) — render the actual template scaled to fit.
  if (isAdvanced) {
    if (!Template) return <div className="p-8 text-gray-500">Loading template…</div>;
    return (
      <div className="bg-gray-100 min-h-screen">
        {/* Print-time rules — fit one Slide16x9 per A4 landscape page,
            kill margins, hide screen-only chrome. */}
        <style>{`
          @page { size: 1920px 1080px; margin: 0; }
          @media print {
            html, body { background: #FFFFFF !important; }
            .deck-print-chrome { display: none !important; }
            .deck-print-stage { background: #FFFFFF !important; padding: 0 !important; }
            .deck-print-scaler { transform: none !important; width: 1920px !important; }
            .deck-print-frame { width: 1920px !important; height: 1080px !important; }
          }
        `}</style>
        <div className="deck-print-chrome sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-700 font-medium">{deck.title || 'Pitch deck'} · v{deck.version}</div>
          <button
            onClick={exportPdf} disabled={exporting}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Save as PDF
          </button>
        </div>
        <PrintStage Template={Template} data={templateData} />
      </div>
    );
  }

  // Legacy fallback — generic purple cards for templates not yet
  // upgraded to a graphical Slide16x9 implementation.
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

// Width-fitted scaler for the 1920×1080 Slide16x9 stack. ResizeObserver
// updates `scale` so the rendered deck fills the available width on
// any viewport. Each slide gets its own scroll-snap target so investors
// can paginate by mouse wheel / arrow key the same way the editor's
// PreviewStage does.
function PrintStage({ Template, data }) {
  const outerRef = useRef(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / INNER_W));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
          style={{
            width: INNER_W,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Wrapping each emitted Slide16x9 in deck-print-frame lets
              the @media print rules above force one slide per page
              without touching DeckBase. */}
          <TemplateFrames Template={Template} data={data} />
        </div>
      </div>
    </div>
  );
}

// Renders Template(data). The template returns a React fragment of
// Slide16x9 children; each Slide16x9 already sets
// pageBreakAfter:'always' inline, so the @media print rules above
// hand us one fixed-size frame per page without any per-child wrapping
// here. On screen, the gap pushes slides apart for scroll-through
// review.
function TemplateFrames({ Template, data }) {
  return (
    <div className="deck-print-frames" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Template data={data || {}} editable={false} />
    </div>
  );
}
