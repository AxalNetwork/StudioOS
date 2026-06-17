// Task #2 — Shareable founder "trading card" (/play/card). Renders the caller's
// (or, with ?u=<userId>, another user's PUBLISHED) Scout Report as a card that
// exports to PNG via html2canvas. The capture node uses ONLY inline hex styles +
// an inline-SVG radar (CardRadar) because html2canvas 1.4.1 cannot parse
// Tailwind 4's oklch color functions — any Tailwind color utility inside the
// node throws during rasterization. Sharing publishes the result (consent gate)
// and copies a ?u= deep link; another user's card is only visible once published.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Share2, Loader2, ArrowLeft, Trophy } from 'lucide-react';
import html2canvas from 'html2canvas';
import { assessment } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { useToast } from '../../components/useToast';
import CardRadar from '../../components/play/CardRadar';
import {
  archetypeMeta, iconFor, topValues, topSkills, spectrumLean, levelProgress,
} from '../../lib/assessmentMeta';

const C = {
  bg: '#0f172a',
  text: '#e2e8f0',
  sub: '#94a3b8',
  bright: '#f8fafc',
  line: '#1e293b',
  chip: '#1e1b4b',
};

function CardView({ cardRef, result, level, displayName }) {
  const meta = archetypeMeta(result?.archetype_slug);
  const label = meta?.label || result?.archetype_label || 'Founder';
  const Icon = iconFor(meta?.icon);
  const accent = meta?.accent || '#7c3aed';
  const values = topValues(result?.value_vector || {}, 3);
  const skills = topSkills(result?.skill_vector || {}, 3);

  return (
    <div
      ref={cardRef}
      style={{
        width: 360,
        boxSizing: 'border-box',
        borderRadius: 24,
        padding: 24,
        background: `linear-gradient(160deg, ${C.chip} 0%, ${C.bg} 70%)`,
        color: C.text,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        border: `1px solid ${accent}55`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, letterSpacing: 2, color: accent, fontWeight: 700 }}>
        <span>AXAL · SCOUT REPORT</span>
        <span style={{ color: C.sub }}>{result?.track || ''}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon color="#ffffff" size={26} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.bright, lineHeight: 1.1 }}>{label}</div>
          {meta?.tagline && <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{meta.tagline}</div>}
        </div>
      </div>

      {result?.skill_vector && Object.keys(result.skill_vector).length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <CardRadar skillVector={result.skill_vector} size={240} accent={accent} />
        </div>
      )}

      {values.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.sub, fontWeight: 700, marginBottom: 8 }}>WHERE YOU LEAN</div>
          {values.map((v) => (
            <div key={v.slug} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderTop: `1px solid ${C.line}` }}>
              <span style={{ color: C.sub }}>{v.label}</span>
              <span style={{ color: C.bright, fontWeight: 600 }}>{spectrumLean(v.slug, v.value)}</span>
            </div>
          ))}
        </div>
      )}

      {skills.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.sub, fontWeight: 700, marginBottom: 8 }}>TOP SKILLS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skills.map((s) => (
              <span key={s.slug} style={{ fontSize: 11, fontWeight: 600, color: '#ddd6fe', background: '#4c1d9555', border: `1px solid ${accent}66`, borderRadius: 999, padding: '3px 10px' }}>
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 12, color: C.sub }}>{displayName || 'Axal founder'}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, background: `${accent}22`, borderRadius: 999, padding: '3px 10px' }}>
          LEVEL {level}
        </span>
      </div>
    </div>
  );
}

export default function ProfileCardPage() {
  const [params] = useSearchParams();
  const { user } = useAuth() || {};
  const { toast, showToast } = useToast();
  const cardRef = useRef(null);

  const viewUserId = params.get('u');
  const isSelf = !viewUserId || String(viewUserId) === String(user?.id);

  const [result, setResult] = useState(null);
  const [level, setLevel] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notShared, setNotShared] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotShared(false);
    try {
      if (isSelf) {
        const [r, b] = await Promise.all([
          assessment.myResults().catch(() => ({ results: [] })),
          assessment.myBadges().catch(() => ({ level: 1 })),
        ]);
        const results = Array.isArray(r?.results) ? r.results : [];
        setResult(results[0] || null);
        setLevel(Number(b?.level) || levelProgress(b?.xp ?? 0).level);
      } else {
        const r = await assessment.results(viewUserId).catch(() => ({ results: [] }));
        const results = Array.isArray(r?.results) ? r.results : [];
        if (results.length === 0) setNotShared(true);
        setResult(results[0] || null);
        setLevel(1);
      }
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load this card.' });
    } finally {
      setLoading(false);
    }
  }, [isSelf, viewUserId, showToast]);
  useEffect(() => { load(); }, [load]);

  const exportPng = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: C.bg,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `axal-scout-report-${result?.archetype_slug || 'card'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      showToast({ kind: 'error', msg: 'Could not export the image.' });
    } finally {
      setExporting(false);
    }
  }, [result, showToast]);

  const share = useCallback(async () => {
    if (!result) return;
    setSharing(true);
    try {
      await assessment.publish({ track: result.track, published: true });
      const url = `${window.location.origin}/play/card?u=${user?.id}`;
      try { await navigator.clipboard.writeText(url); } catch { /* clipboard may be blocked */ }
      showToast({ kind: 'success', msg: 'Card published — link copied to clipboard.' });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not publish your card.' });
    } finally {
      setSharing(false);
    }
  }, [result, user, showToast]);

  const displayName = isSelf ? (user?.name || user?.email || 'You') : 'Axal founder';

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to="/play" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <ArrowLeft className="h-4 w-4" /> Back to hub
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-gray-50">
        {isSelf ? 'Your card' : 'Founder card'}
      </h1>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : notShared ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          This card hasn’t been shared, or doesn’t exist yet.
        </div>
      ) : !result ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-800">
          <Trophy className="mx-auto mb-2 h-7 w-7 text-violet-500" />
          <p className="text-sm text-gray-600 dark:text-gray-300">You don’t have a Scout Report yet.</p>
          <Link to="/play" className="mt-4 inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
            Play a game
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-6">
          <CardView cardRef={cardRef} result={result} level={level} displayName={displayName} />
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={exportPng}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PNG
            </button>
            {isSelf && (
              <button
                type="button"
                onClick={share}
                disabled={sharing}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                {result.published ? 'Re-copy share link' : 'Publish & copy link'}
              </button>
            )}
          </div>
          {isSelf && (
            <p className="max-w-sm text-center text-xs text-gray-500 dark:text-gray-400">
              Publishing makes your card visible to anyone with the link. You can unpublish anytime from your settings.
            </p>
          )}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-red-600' : toast.kind === 'success' ? 'bg-emerald-600' : 'bg-gray-900 dark:bg-gray-700'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
