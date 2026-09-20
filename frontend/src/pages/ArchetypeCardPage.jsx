/**
 * Full archetype page — `/studio/archetype`.
 *
 * Compact /studio stays the pixel-art preview. This route is the cinematic
 * card: a 21:9 banner (sex-aware; `both` is a 50/50 split), overlay well on
 * the left, and the locked ARCHETYPES strengths / blind spots / complements.
 * Copy is static per-slug metadata, not user data. Missing banner files hide
 * that slot rather than leaving a hole.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { api, assessment } from '../lib/api';
import { reportError } from '../lib/log';
import {
  archetypeAudienceFromRole,
  archetypeBanner,
  archetypeLicenceTitle,
  archetypeMeta,
} from '../lib/assessmentMeta';

function confidencePct(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value * 100))) : null;
  }
  if (typeof value === 'object') {
    const nums = Object.values(value).map(Number).filter(Number.isFinite);
    if (!nums.length) return null;
    return Math.max(0, Math.min(100, Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100)));
  }
  return null;
}

function BannerImg({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      className={className}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default function ArchetypeCardPage({ activeRole }) {
  const audience = archetypeAudienceFromRole(activeRole);
  const [fit, setFit] = useState({ data: null, error: '' });
  const [results, setResults] = useState({ data: null, error: '' });

  useEffect(() => {
    let alive = true;
    const wire = (p, set, scope) => p
      .then((d) => { if (alive) set({ data: d, error: '' }); })
      .catch((e) => {
        reportError(scope, e);
        if (alive) set({ data: null, error: e?.message || 'Failed to load' });
      });
    wire(api.bestFit.me(), setFit, 'ArchetypeCard:bestFit');
    wire(assessment.myResults(), setResults, 'ArchetypeCard:results');
    return () => { alive = false; };
  }, []);

  const fitData = fit.data;
  const conv = fitData?.archetype && fitData.archetype.slug
    ? { slug: fitData.archetype.slug, label: fitData.archetype.label, confidence: fitData.archetype.confidence }
    : null;
  let latest = conv;
  if (!latest) {
    const list = (Array.isArray(results.data?.results) ? results.data.results : []).filter((r) => r.archetype_slug);
    const g = list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0] || null;
    if (g) latest = { slug: g.archetype_slug, label: g.archetype_label, confidence: g.confidence };
  }
  const meta = latest ? archetypeMeta(latest.slug) : null;
  const sex = fitData?.archetype_sex === 'm' || fitData?.archetype_sex === 'f' || fitData?.archetype_sex === 'both'
    ? fitData.archetype_sex
    : 'both';
  const loading = !fit.data && !fit.error && !results.data && !results.error;
  const failed = !latest && (fit.error || results.error) && !loading;
  const pct = latest ? confidencePct(latest.confidence) : null;
  const title = latest?.label || meta?.label || latest?.slug;
  const accent = meta?.accent || '#7c3aed';

  return (
    <div className="acp-root max-w-5xl mx-auto" data-testid="archetype-card-page">
      <style>{`
        .acp-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
        .acp-mono { font-family: 'Roboto Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
        .acp-card { border-radius: 16px; box-shadow: 0 1px 2px rgba(24,24,27,.03); overflow: hidden; }
        .acp-hero { position: relative; aspect-ratio: 21 / 9; background: linear-gradient(115deg, #5b21b6 0%, #7c3aed 48%, #6d28d9 100%); overflow: hidden; }
        .acp-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
        .acp-split { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr; }
        .acp-split img { position: relative; width: 100%; height: 100%; object-fit: cover; }
        .acp-well {
          position: absolute; inset: 0 auto 0 0; width: min(46%, 440px);
          padding: 28px 26px 24px;
          background: linear-gradient(115deg, rgba(20,12,38,.94) 0%, rgba(91,33,182,.62) 58%, rgba(20,12,38,.06) 100%);
          color: #f5f3ff;
          display: flex; flex-direction: column; justify-content: flex-end;
          pointer-events: none;
        }
        .acp-bloom { color: #c4b5fd; }
        @media (max-width: 720px) {
          .acp-hero { aspect-ratio: 4 / 3; }
          .acp-well {
            inset: auto 0 0 0; width: 100%;
            background: linear-gradient(180deg, rgba(20,12,38,0) 0%, rgba(20,12,38,.94) 55%);
          }
        }
      `}</style>

      <Link
        to="/studio"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#7c3aed] dark:text-violet-300 hover:text-[#6d28d9] mb-4"
        data-testid="archetype-back"
      >
        <ArrowLeft size={14} strokeWidth={2.5} /> Back to studio
      </Link>

      {loading && (
        <div className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 p-[48px] flex justify-center text-gray-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      )}

      {failed && (
        <div className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 p-[22px] flex items-start gap-2 text-[12.5px] font-medium text-red-700 dark:text-red-400">
          <AlertCircle size={16} className="mt-[2px] shrink-0" />
          <span>Couldn’t load your archetype. {fit.error || results.error}</span>
        </div>
      )}

      {!loading && !failed && !latest && (
        <div className="acp-card border border-dashed border-[#e4e4e7] dark:border-gray-700 bg-[#fafafa] dark:bg-gray-800/40 p-[22px] text-[12.5px] text-[#71717a] dark:text-gray-400 leading-[1.5]">
          Answer a few archetype questions in the advisor to reveal your archetype.
        </div>
      )}

      {latest && (
        <article className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700" style={{ '--arch-accent': accent }}>
          <div className="acp-hero" data-testid="archetype-banner" data-sex={sex}>
            {sex === 'both' ? (
              <div className="acp-split">
                <BannerImg src={archetypeBanner(latest.slug, 'f')} />
                <BannerImg src={archetypeBanner(latest.slug, 'm')} />
              </div>
            ) : (
              <BannerImg src={archetypeBanner(latest.slug, sex)} />
            )}
            <div className="acp-well">
              <div className="acp-lbl acp-bloom mb-2">{archetypeLicenceTitle(audience)}</div>
              <h1 className="text-[28px] font-extrabold tracking-[-0.03em] leading-tight text-white" data-testid="archetype-title">
                {title}
              </h1>
              {meta?.tagline && (
                <p className="mt-1.5 text-[13.5px] text-[#e9d5ff] leading-snug">{meta.tagline}</p>
              )}
              <div className="mt-3 acp-mono text-[12px] font-bold text-[#c4b5fd]">
                {pct != null ? `${pct}% confidence` : 'Confidence not recorded'}
              </div>
            </div>
          </div>

          <div className="p-[22px] flex flex-col gap-5">
            {meta?.description && (
              <p className="text-[13.5px] text-[#3f3f46] dark:text-gray-300 leading-[1.55]">{meta.description}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div data-testid="archetype-strengths">
                <div className="acp-lbl text-[#15803d] dark:text-green-500 mb-2">Strengths</div>
                <div className="flex flex-col gap-1.5">
                  {(meta?.strengths || []).map((s) => (
                    <div key={s} className="text-[12.5px] text-[#3f3f46] dark:text-gray-300 flex gap-2">
                      <span className="font-bold text-[#16a34a] dark:text-green-400">+</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div data-testid="archetype-blindspots">
                <div className="acp-lbl text-[#b45309] dark:text-amber-500 mb-2">Likely blind spots</div>
                <div className="flex flex-col gap-1.5">
                  {(meta?.blindSpots || []).map((b) => (
                    <div key={b} className="text-[12.5px] text-[#3f3f46] dark:text-gray-300 flex gap-2">
                      <span className="font-bold text-[#d97706] dark:text-amber-500">!</span>
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div data-testid="archetype-complements">
                <div className="acp-lbl text-[#7c3aed] dark:text-violet-300 mb-2">Compatible complements</div>
                <div className="flex flex-wrap gap-1.5">
                  {(meta?.complements || []).map((c) => (
                    <span
                      key={c}
                      className="text-[11.5px] font-semibold text-[#6d28d9] dark:text-violet-300 bg-[#f5f3ff] dark:bg-violet-900/30 border border-[#ede9fe] dark:border-violet-800 rounded-lg px-2.5 py-1"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
