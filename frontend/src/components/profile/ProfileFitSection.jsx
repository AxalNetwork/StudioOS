import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertCircle, Lock, Sparkles, ChevronRight } from 'lucide-react';
import { api, assessment } from '../../lib/api';
import SkillRadar from '../play/SkillRadar';
import { openPaywall } from '../PaywallModal';
import { archetypeIllustration, archetypeLicenceTitle, archetypeMeta, humanize } from '../../lib/assessmentMeta';
import { STUDIO_CHAT_ANCHOR } from '../advisor/interviewCompleteRow';
import { Unreadable } from '../../ui';

/**
 * D509 — A BEST-FIT TYPE'S COUNT, OR NULL WHEN THE READ CARRIED NONE.
 *
 * The badge used to render `Number(t.count) || 0`, so a type whose count was
 * absent read "0" — the claim that nobody fits, made about a number nobody
 * measured. Only a number, or a numeric string, counts; anything else is
 * absent and the badge is not drawn.
 */
export function fitCount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function CardShell({ title, badge, className = '', children, action, to, accent, testId, ariaLabel }) {
  const hit = Boolean(to);
  const cls = `pf-card p-[22px] bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 animate-[pfFade_0.4s_ease-out] ${hit ? 'pf-card-hit' : ''} ${className}`;
  const style = accent ? { '--arch-accent': accent } : undefined;
  const inner = (
    <>
      <div className="flex items-center justify-between mb-[14px]">
        <h4 className="pf-lbl text-[#a1a1aa] dark:text-gray-400">{title}</h4>
        {badge}
        {action || null}
      </div>
      {children}
    </>
  );
  if (hit) {
    return (
      <Link to={to} className={cls} style={style} data-testid={testId || 'archetype-preview-card'} aria-label={ariaLabel}>
        {inner}
      </Link>
    );
  }
  return <div className={cls} style={style} data-testid={testId}>{inner}</div>;
}

function Nudge({ children }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[#e4e4e7] dark:border-gray-700 bg-[#fafafa] dark:bg-gray-800/40 p-[16px] text-[12.5px] text-[#71717a] dark:text-gray-400 leading-[1.5]">
      {children}
    </div>
  );
}

function ErrorNote({ children }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] font-medium text-red-700 dark:text-red-400">
      <AlertCircle size={16} className="mt-[2px] shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ── Skills radar ────────────────────────────────────────────────────────────
export function SkillsRadarCard({ state, className, audience = 'founder', onRetry }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <Unreadable what="Your skills radar" claim="This is not a claim that nothing is measured." onRetry={onRetry} />;
  } else if (!data) {
    body = <div className="h-[200px] flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const axes = Array.isArray(data.axes) ? data.axes : [];
    const hasData = axes.some((a) => Number(a.skill_count) > 0 || Number(a.score) > 0);
    if (!hasData) {
      body = <Nudge>Answer a few skill questions with Eadwyn to build your 8-axis radar.</Nudge>;
    } else {
      const skillVector = {};
      const sorted = [];
      for (const a of axes) {
        const score = (Number(a.score) || 0);
        skillVector[a.slug] = score / 20;
        sorted.push({ name: a.label || a.slug, score });
      }
      sorted.sort((a,b) => b.score - a.score);
      const topSkills = sorted.slice(0, 3);
      const weakSkills = sorted.slice(-3).reverse().map(s => ({
        ...s,
        colorClass: s.score < 45 ? 'text-[#dc2626] dark:text-red-400' : 'text-[#d97706] dark:text-amber-500'
      }));

      body = (
        <>
          <div className="text-[11.5px] text-[#a1a1aa] dark:text-gray-400 mb-[14px]">Radar of {audience === 'investor' ? 'investment' : audience === 'advisor' ? 'advisory' : audience === 'partner' ? 'operator' : 'founder'} skill dimensions</div>
          <div className="flex justify-center mb-4">
            <SkillRadar skillVector={skillVector} height={210} />
          </div>
          <div className="grid grid-cols-2 gap-[14px]">
            <div>
              <div className="pf-lbl mb-2 text-[#15803d] dark:text-green-500">Strongest</div>
              <div className="flex flex-col gap-1.5">
                {topSkills.map((s, i) => (
                  <div key={i} className="flex justify-between text-[12px]">
                    <span className="text-[#3f3f46] dark:text-gray-300">{s.name}</span>
                    <span className="pf-mono font-bold text-[#16a34a] dark:text-green-400">{Math.round(s.score)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="pf-lbl mb-2 text-[#b45309] dark:text-amber-500">Least evidenced</div>
              <div className="flex flex-col gap-1.5">
                {weakSkills.map((s, i) => (
                  <div key={i} className="flex justify-between text-[12px]">
                    <span className="text-[#3f3f46] dark:text-gray-300">{s.name}</span>
                    <span className={`pf-mono font-bold ${s.colorClass}`}>{Math.round(s.score)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      );
    }
  }
  return <CardShell title={audience === 'founder' ? 'Skills graph' : 'Skills'} className={className}>{body}</CardShell>;
}

// ── 15-dimension values lean ──────────────────────────────────────────────────
function getConfBucket(conf) {
  if (conf >= 0.66) return { label: 'High', color: 'text-[#15803d] dark:text-green-400', bar: 'bg-[#16a34a] dark:bg-green-500', fill: Math.max(5, conf * 100) };
  if (conf >= 0.33) return { label: 'Medium', color: 'text-[#b45309] dark:text-amber-500', bar: 'bg-[#d97706] dark:bg-amber-500', fill: Math.max(5, conf * 100) };
  return { label: 'Low', color: 'text-[#a1a1aa] dark:text-gray-500', bar: 'bg-[#c4b5fd] dark:bg-violet-400', fill: Math.max(5, conf * 100) };
}

// D325 — canvas 69dc42f3 draws the values as five two-pole sliders, each
// with a lean and a confidence chip. The five are the bipolar dimensions
// (migration 090's founder spectrums): the Worker sends each one's poles and a
// score from −2 to +2. |score| under 0.5 reads Balanced. The unipolar
// dimensions keep their confidence bars below.
export function valueSlider(v) {
  // Number(null) is 0, which would draw a Balanced reading nobody gave.
  const given = v?.score !== null && v?.score !== undefined && v?.score !== '';
  const raw = given ? Number(v.score) : NaN;
  if (!Number.isFinite(raw) || !v?.pole_low || !v?.pole_high) return null;
  const score = Math.max(-2, Math.min(2, raw));
  const lean = Math.abs(score) < 0.5 ? 'Balanced' : `Leans ${score < 0 ? v.pole_low : v.pole_high}`;
  return { pos: Math.round(((score + 2) / 4) * 100), lean };
}

export function ValuesLeanCard({ state, className, audience = 'founder', onRetry }) {
  const { data, error } = state;
  let body;
  if (error) {
    body = <Unreadable what="Your values" claim="This is not a claim that nothing is measured." onRetry={onRetry} />;
  } else if (!data) {
    body = <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const vector = (Array.isArray(data.vector) ? data.vector : []).filter((v) => Number(v.confidence) > 0);
    if (vector.length === 0) {
      body = <Nudge>Your values profile builds as you talk with Eadwyn — nothing measured yet.</Nudge>;
    } else {
      const top = (data.summary?.top || []).map((t) => t.label).filter(Boolean);
      const sliders = vector.filter((v) => v.is_bipolar && valueSlider(v)).slice(0, 5);
      const unipolar = vector.filter((v) => !(v.is_bipolar && valueSlider(v))).slice(0, 5);
      body = (
        <>
          <div className="text-[11.5px] text-[#a1a1aa] dark:text-gray-400 mb-[16px]">Where you lean, and how sure the reading is</div>
          {top.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {top.map((label) => (
                <span key={label} className="text-[11.5px] font-semibold px-[10px] py-1 rounded-[8px] bg-[#f5f3ff] dark:bg-violet-900/30 text-[#6d28d9] dark:text-violet-300 border border-[#ede9fe] dark:border-violet-800">
                  {label}
                </span>
              ))}
            </div>
          )}
          {sliders.length > 0 && (
            <div className="flex flex-col gap-[14px]" data-testid="values-sliders">
              {sliders.map((v) => {
                const { pos, lean } = valueSlider(v);
                const bucket = getConfBucket(Number(v.confidence) || 0);
                return (
                  <div key={v.dimension_slug} role="img" aria-label={`${v.dimension_label || v.dimension_slug}: ${lean}, ${bucket.label.toLowerCase()} confidence`}>
                    <div className="flex justify-between text-[11px] font-semibold text-[#71717a] dark:text-gray-400">
                      <span>{v.pole_low}</span><span>{v.pole_high}</span>
                    </div>
                    <div className="relative mt-1 h-[7px] rounded-full bg-[#f1f1f5] dark:bg-gray-800">
                      <span className="absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-gray-900 bg-[#7c3aed] dark:bg-violet-400" style={{ left: `${pos}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between">
                      <span className="text-[11.5px] font-bold text-[#3f3f46] dark:text-gray-200">{lean}</span>
                      <span className={`text-[10.5px] font-semibold ${bucket.color}`}>{bucket.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {unipolar.length > 0 && (
            <div className={`flex flex-col gap-[11px] ${sliders.length ? 'mt-5' : ''}`}>
              {sliders.length > 0 && <div className="pf-lbl text-[#a1a1aa] dark:text-gray-400">Working principles</div>}
              {unipolar.map((v) => {
                const conf = Number(v.confidence) || 0;
                const bucket = getConfBucket(conf);
                return (
                  <div key={v.dimension_slug}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[12px] font-semibold text-[#3f3f46] dark:text-gray-200">{v.dimension_label || v.dimension_slug}</span>
                      <span className={`text-[10.5px] font-semibold ${bucket.color}`}>{bucket.label}</span>
                    </div>
                    <div className="h-[7px] rounded-full bg-[#f1f1f5] dark:bg-gray-800 overflow-hidden">
                      <div className={`h-full rounded-full ${bucket.bar}`} style={{ width: `${bucket.fill}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      );
    }
  }
  return <CardShell title={audience === 'founder' ? 'Values graph' : 'Values'} className={className}>{body}</CardShell>;
}

// Pixel-art sprite for one gender of an archetype. Studio's 3-column band
// is ~400px, so each of the male/female pair is a 180px box (radar is 210).
// Light tile in both themes so a white PNG stays readable. Missing files
// hide that slot rather than leaving a hole.
function ArchetypeSprite({ slug, variant = 'm', compact = false, name, onMissing }) {
  const src = archetypeIllustration(slug, variant);
  const [failed, setFailed] = useState(false);
  // A file that 404s tells the pair, so it can fall back to one centred tile.
  useEffect(() => { if (failed && onMissing) onMissing(variant); }, [failed, onMissing, variant]);
  if (!src || failed) return null;
  const box = compact ? 'w-full max-w-[180px] aspect-square' : 'w-full max-w-[240px] aspect-square';
  return (
    <div
      className={`${box} mx-auto shrink-0 overflow-hidden rounded-[16px] bg-[#f8f7fb] dark:bg-[#ece8f5] border border-[#ece8f5] dark:border-[#d4cce8] flex items-end justify-center`}
      data-testid={`archetype-sprite-${variant}`}
    >
      <img
        src={src}
        alt={spriteAlt(name, variant)}
        className="pf-sprite h-full w-full object-contain object-bottom"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// D325 — "a slot with no file on disk is dropped rather than drawn empty, so
// 'both' with one sprite supplied degrades to a single centred tile" (canvas
// ec6c3ada). pt_embedded_operator has no male file, so this is a real case.
export function spriteAlt(name, variant) {
  return name ? `${name}, ${variant === 'f' ? 'woman' : 'man'}` : '';
}

export function pairTiles(slug, missing = {}) {
  return ['f', 'm'].filter((v) => archetypeIllustration(slug, v) && !missing[v]);
}

function ArchetypePair({ slug, name, compact = false }) {
  const [missing, setMissing] = useState({});
  const onMissing = useCallback((v) => setMissing((m) => (m[v] ? m : { ...m, [v]: true })), []);
  const tiles = pairTiles(slug, missing);
  if (!tiles.length) return null;
  const single = tiles.length === 1;
  return (
    <div
      className={single ? 'mx-auto w-full max-w-[180px]' : 'grid grid-cols-2 gap-2 items-end'}
      data-testid="archetype-sprites"
      data-sex="both"
      data-tiles={tiles.length}
    >
      {tiles.includes('f') && <ArchetypeSprite slug={slug} variant="f" compact={compact} name={name} onMissing={onMissing} />}
      {tiles.includes('m') && <ArchetypeSprite slug={slug} variant="m" compact={compact} name={name} onMissing={onMissing} />}
    </div>
  );
}

// Show the matching sex sprite when we know it (advisor question, Settings,
// or he/him · she/her pronouns). Unknown / they/them / "show both" keeps the pair.
function ArchetypeArt({ slug, sex, compact = false, name }) {
  if (sex === 'm' || sex === 'f') {
    return (
      <div data-testid="archetype-sprites" data-sex={sex}>
        <ArchetypeSprite slug={slug} variant={sex} compact={compact} name={name} />
      </div>
    );
  }
  return <ArchetypePair slug={slug} compact={compact} name={name} />;
}

// ── Archetype ─────────────────────────────────────────────────────────────────
export function ArchetypeCard({ state, fitState, className, audience = 'founder', compact = false, onRetry }) {
  const { data, error } = state;
  const fitData = fitState?.data;
  const conv = fitData?.archetype && fitData.archetype.slug
    ? { slug: fitData.archetype.slug, label: fitData.archetype.label, confidence: fitData.archetype.confidence }
    : null;
  let latest = conv;
  if (!latest) {
    const list = (Array.isArray(data?.results) ? data.results : []).filter((r) => r.archetype_slug);
    const g = list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0] || null;
    if (g) latest = { slug: g.archetype_slug, label: g.archetype_label, confidence: null };
  }
  const meta = latest ? archetypeMeta(latest.slug) : null;
  const clickable = Boolean(compact && latest);

  let body;
  if (error && !fitData) {
    body = <Unreadable what="Your archetype" claim="This is not a claim that you have none." onRetry={onRetry} />;
  } else if (!data && !fitData) {
    body = <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else if (!latest) {
    body = <Nudge>Answer a few archetype questions with Eadwyn to reveal your archetype.</Nudge>;
  } else {
    const pct = latest.confidence != null ? Math.round(Number(latest.confidence) * 100) : null;
    const title = latest.label || meta?.label || latest.slug;
    const sex = fitData?.archetype_sex === 'm' || fitData?.archetype_sex === 'f' || fitData?.archetype_sex === 'both'
      ? fitData.archetype_sex
      : 'both';
    const copy = (
      <>
        {meta?.tagline && (
          <div>
            <div className="pf-lbl text-[#15803d] dark:text-green-500 mb-[9px]">Core approach</div>
            <div className="text-[12.5px] text-[#3f3f46] dark:text-gray-300 leading-[1.5]">{meta.tagline}</div>
          </div>
        )}
        {(compact ? (meta?.summary || meta?.description) : meta?.description) && (
          <div>
            <div className="pf-lbl text-[#b45309] dark:text-amber-500 mb-[9px]">Description</div>
            <div className="text-[12.5px] text-[#3f3f46] dark:text-gray-300 leading-[1.5]">
              {compact ? (meta.summary || meta.description) : meta.description}
            </div>
          </div>
        )}
      </>
    );

    body = compact ? (
      <div className="flex min-w-0 flex-col gap-3">
        <ArchetypeArt slug={latest.slug} sex={sex} compact name={title} />
        <div>
          <div className="pf-lbl text-[10.5px] text-[#7c3aed] dark:text-violet-300 mb-1">Primary archetype</div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[18px] font-extrabold tracking-[-0.02em] leading-tight text-[#27272a] dark:text-gray-100">{title}</div>
            <div className="pf-mono shrink-0 text-[12px] font-bold text-[#7c3aed] dark:text-violet-300">
              {pct != null ? `${pct}%` : 'N/A'}
            </div>
          </div>
        </div>
        {copy}
        <div className="pf-lbl text-[#7c3aed] dark:text-violet-300 pt-1">View full card →</div>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-[26px] items-start">
        <div className="min-w-0">
          <ArchetypeArt slug={latest.slug} sex={sex} name={title} />
          <div className="mt-3">
            <div className="pf-lbl text-[10.5px] text-[#7c3aed] dark:text-violet-300 mb-2">Primary archetype</div>
            <div className="text-[22px] font-extrabold tracking-[-0.02em] leading-tight text-[#27272a] dark:text-gray-100">{title}</div>
          </div>
          <div className="flex gap-[10px] mt-3">
            <div className="flex-1 border border-[#f0f0f3] dark:border-gray-800 rounded-[12px] p-[13px]">
              <div className="pf-lbl text-[10px] text-[#a1a1aa] mb-1">Confidence</div>
              <div className="pf-mono text-[14px] font-bold text-[#27272a] dark:text-gray-100">
                {pct != null ? `${pct}%` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-[#f0f0f3] dark:border-gray-800 md:border-0 pt-4 md:pt-0">
          {copy}
        </div>
      </div>
    );
  }
  // D325 — the card is one hit target, so it carries one label: the canvas's
  // "Founder archetype: The Missionary, 82% confidence. View full card".
  const ariaTitle = latest ? (latest.label || meta?.label || latest.slug) : null;
  const ariaPct = latest && latest.confidence != null ? Math.round(Number(latest.confidence) * 100) : null;
  const ariaLabel = clickable
    ? `${archetypeLicenceTitle(audience)}: ${ariaTitle}${ariaPct != null ? `, ${ariaPct}% confidence` : ''}. View full card`
    : undefined;
  const previewChip = clickable ? (
    <span className="pf-lbl text-[10px] tracking-[0.08em] text-[#7c3aed] dark:text-violet-300 border border-[#ede9fe] dark:border-violet-800 rounded-full px-[10px] py-[3px]">Preview</span>
  ) : null;
  return (
    <CardShell
      title={archetypeLicenceTitle(audience)}
      className={className}
      to={clickable ? '/studio/archetype' : undefined}
      accent={clickable ? (meta?.accent || '#7c3aed') : undefined}
      badge={previewChip}
      testId={clickable ? 'archetype-preview-card' : undefined}
      ariaLabel={ariaLabel}
    >
      {body}
    </CardShell>
  );
}

// ── Completion % ──────────────────────────────────────────────────────────────
function getProgressReadyBucket(pct) {
  if (pct >= 75) return { readyColor: 'text-[#15803d] dark:text-green-400', barColor: 'bg-[#16a34a] dark:bg-green-500', readiness: 'High conf' };
  if (pct >= 40) return { readyColor: 'text-[#b45309] dark:text-amber-500', barColor: 'bg-[#d97706] dark:bg-amber-500', readiness: 'Med conf' };
  return { readyColor: 'text-[#a1a1aa] dark:text-gray-500', barColor: 'bg-[#c4b5fd] dark:bg-violet-400', readiness: 'Low conf' };
}

function CompletionBody({ state }) {
  const { data, error } = state;
  if (error) return <ErrorNote>Couldn’t load your progress. {error}</ErrorNote>;
  if (!data) return <div className="py-4 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  
  const prof = data.profiling;
  if (prof && prof.applicable === false) return <Nudge>Profiling questions don’t apply to your account type.</Nudge>;

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const pct = clamp(prof ? prof.percent : data.percent);
  const sections = Array.isArray(prof?.sections) ? prof.sections : [];
  
  const ringCirc = 2 * Math.PI * 46;
  const ringDash = `${(pct / 100 * ringCirc).toFixed(1)} ${ringCirc.toFixed(1)}`;

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="text-[11.5px] text-[#a1a1aa] dark:text-gray-400">Which sections are reliable vs still low-confidence.</div>
      <div className="flex gap-[24px] items-center flex-wrap">
        <div className="relative w-[104px] h-[104px] shrink-0">
          <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
            <circle cx="52" cy="52" r="46" fill="none" stroke="currentColor" strokeWidth="10" className="text-[#f1f1f5] dark:text-gray-800" />
            <circle cx="52" cy="52" r="46" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray={ringDash} className="text-[#7c3aed] dark:text-violet-500 transition-all duration-1000" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="pf-mono text-[24px] font-bold text-[#7c3aed] dark:text-violet-400">{pct}%</span>
            <span className="text-[10px] text-[#a1a1aa]">complete</span>
          </div>
        </div>
        <div className="flex-1 min-w-[150px]">
          <div className="text-[13.5px] text-[#3f3f46] dark:text-gray-300 leading-[1.55]">
            Keep chatting with Eadwyn to sharpen every result. Your profile completeness drives matching confidence.
          </div>
        </div>
      </div>
      
      {sections.length > 0 && (
        <div className="flex flex-col gap-[13px] mt-2">
          {sections.map((s) => {
            const sp = clamp(s.percent);
            const bucket = getProgressReadyBucket(sp);
            return (
              <div key={s.key || s.label}>
                <div className="flex justify-between mb-[5px]">
                  <span className="text-[12.5px] font-semibold text-[#3f3f46] dark:text-gray-300">{s.label}</span>
                  <span className={`text-[11px] font-semibold ${bucket.readyColor}`}>{sp}% · {bucket.readiness}</span>
                </div>
                <div className="h-[6px] rounded-full bg-[#f1f1f5] dark:bg-gray-800 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${bucket.barColor}`} style={{ width: `${sp}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Fit + Axal-5 (self: api.bestFit.me) ──────────────────────────────────────
const FIT_BAND = {
  strong_yes: { label: 'Strong yes', cls: 'bg-[#dcfce7] dark:bg-green-900/40 text-[#166534] dark:text-green-300 border-[#16a34a] dark:border-green-700' },
  yes_caution: { label: 'Yes, with caution', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700' },
  hold: { label: 'Hold — more diligence', cls: 'bg-[#fffbeb] dark:bg-amber-900/40 text-[#b45309] dark:text-amber-300 border-[#d97706] dark:border-amber-700' },
  no: { label: 'No', cls: 'bg-[#f4f4f5] dark:bg-gray-800 text-[#52525b] dark:text-gray-400 border-[#d4d4d8] dark:border-gray-600' },
};

function FitBody({ state }) {
  const { data, error } = state;
  if (error) return <ErrorNote>Couldn’t load your Axal Fit. {error}</ErrorNote>;
  if (!data) return <div className="py-4 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  
  const fit = Array.isArray(data.fit) ? data.fit : [];
  const axal = Array.isArray(data.axal_values) ? data.axal_values : [];
  const axalWithSignal = axal.filter((v) => Number(v.confidence) > 0);
  
  if (fit.length === 0 && axalWithSignal.length === 0) {
    return (
      <Nudge>
        <p className="font-medium text-[#27272a] dark:text-gray-200">Complete your profiling to unlock</p>
        <p className="mt-1">
          Your personal <strong>Axal VC Fit score &amp; band</strong> and your <strong>5 Axal VC behavioral values</strong>
          {' '}are computed once your advisor conversation has enough signal.
        </p>
      </Nudge>
    );
  }

  return (
    <div className="flex flex-col gap-[20px]">
      {fit.length > 0 && (
        <div>
          <div className="pf-lbl mb-[14px]">Axal Fit scorecard</div>
          <div className="flex flex-col gap-2.5">
            {fit.map((f) => {
              const b = FIT_BAND[f.band] || FIT_BAND.no;
              return (
                <div key={f.persona} className={`rounded-[12px] border p-[15px] ${data.primary_persona === f.persona ? 'ring-1 ring-[#7c3aed]/50' : ''} ${b.cls}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-bold capitalize">{humanize(f.persona)}</span>
                    <span className="pf-mono text-[16px] font-bold">{Math.round(Number(f.total_score) || 0)}<span className="text-[10px] font-normal opacity-70">/100</span></span>
                  </div>
                  <p className="text-[11.5px] font-bold uppercase tracking-[0.04em] mb-1.5 opacity-90">{f.band_label || b.label}</p>
                  {f.narrative_fit && <p className="text-[12.5px] leading-[1.45] opacity-90 line-clamp-3">{f.narrative_fit}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {axalWithSignal.length > 0 && (
        <div>
          <div className="pf-lbl mb-[14px]">5 Axal behavioral values</div>
          <div className="flex flex-col gap-[11px]">
            {axal.map((v) => {
              const score = Number(v.score) || 0;
              const pct = Math.max(0, Math.min(100, score / 5 * 100));
              return (
                <div key={v.value_key}>
                  <div className="flex justify-between mb-[5px]">
                    <span className="text-[12px] font-semibold text-[#3f3f46] dark:text-gray-300 capitalize">{humanize(v.value_key)}</span>
                    <span className="pf-mono text-[11px] font-bold text-[#7c3aed] dark:text-violet-400">{score.toFixed(1)}/5</span>
                  </div>
                  <div className="h-[6px] rounded-full bg-[#f1f1f5] dark:bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full bg-[#7c3aed] dark:bg-violet-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Merged card: profiling completion + fit scorecard in one shell ───────────
function FitCard({ progressState, fitState, className }) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-[20px] items-start ${className}`}>
      <CardShell title="Assessment progress">
        <CompletionBody state={progressState} />
      </CardShell>
      <CardShell title="Your Axal VC Fit & values">
        <FitBody state={fitState} />
      </CardShell>
    </div>
  );
}

// ── Match range (counts + teaser free; full list gated) ───────────────────────
const MATCH_BAND = {
  strong: { label: 'Strong', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  good: { label: 'Good', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  fair: { label: 'Fair', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  low: { label: 'Low', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' },
};
function BandPill({ band }) {
  const b = MATCH_BAND[band] || MATCH_BAND.low;
  return <span className={`text-[10px] font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-md ${b.cls}`}>{b.label}</span>;
}
function MatchSummaryCard({ className }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.matches.summary()
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(e?.message || 'Failed to load matches'); });
    return () => { alive = false; };
  }, []);

  const unlock = useCallback(() => {
    openPaywall('studio', 'Upgrade to Studio to see your full match list — names, scores, and the reasons behind every match.');
  }, []);

  let body;
  if (error) {
    body = <ErrorNote>Couldn’t load your matches. {error}</ErrorNote>;
  } else if (!data) {
    body = <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>;
  } else {
    const types = Array.isArray(data.types) ? data.types : [];
    const anyMatches = types.some((t) => Number(t.count) > 0);
    if (!anyMatches) {
      body = <Nudge>No matches yet. Complete your profile and opt in to matching to see who you fit with across the network.</Nudge>;
    } else {
      body = (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
            {types.map((t) => {
              const teaser = t.teaser || null;
              const list = Array.isArray(t.matches) ? t.matches : [];
              return (
                <div key={t.type} className="rounded-[12px] border border-[#f0f0f3] dark:border-gray-800 bg-white dark:bg-gray-800/50 p-[15px]">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12.5px] font-bold text-[#27272a] dark:text-gray-200">{t.label}</span>
                    {fitCount(t.count) !== null ? (
                      <span className="text-[11px] font-bold text-[#6d28d9] dark:text-violet-300 bg-[#f5f3ff] dark:bg-violet-900/40 px-2 py-0.5 rounded-full border border-[#ede9fe] dark:border-violet-800">{fitCount(t.count)}</span>
                    ) : null}
                  </div>
                  {data.unlocked ? (
                    list.length > 0 ? (
                      <ul className="flex flex-col gap-[6px]">
                        {list.slice(0, 3).map((m) => (
                          <li key={m.user_id} className="flex items-center justify-between gap-2 text-[12.5px]">
                            <span className="text-[#3f3f46] dark:text-gray-300 truncate font-medium">{m.name || m.uid || `#${m.user_id}`}</span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <BandPill band={m.band} />
                              <span className="pf-mono text-[12px] font-bold text-[#27272a] dark:text-gray-300">{Math.round(Number(m.match_score) || 0)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-[11.5px] text-[#a1a1aa]">No qualifying matches yet.</p>
                  ) : teaser ? (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11.5px] text-[#a1a1aa] font-medium">Top match</span>
                        <span className="flex items-center gap-1.5">
                          <BandPill band={teaser.band} />
                          <span className="pf-mono text-[12px] font-bold text-[#27272a] dark:text-gray-300">{Math.round(Number(teaser.match_score) || 0)}</span>
                        </span>
                      </div>
                      {teaser.top_reason && (
                        <p className="text-[11.5px] leading-[1.45] text-[#71717a] dark:text-gray-400 line-clamp-2">“{teaser.top_reason}”</p>
                      )}
                    </div>
                  ) : <p className="text-[11.5px] text-[#a1a1aa]">No match preview yet.</p>}
                </div>
              );
            })}
          </div>
          {!data.unlocked && (
            <button
              type="button"
              onClick={unlock}
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#7c3aed] hover:text-[#6d28d9] dark:text-violet-400 transition-colors"
            >
              <Lock size={14} strokeWidth={2.5} /> Unlock full match list
            </button>
          )}
        </>
      );
    }
  }
  return <CardShell title="Best-fit matches" className={className}>{body}</CardShell>;
}

// ── Book with Guillaume ───────────────────────────────────────────────────────
function BookConsultationCard({ className }) {
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getMyConsultations()
      .then((res) => setMine(Array.isArray(res) ? res : (res?.consultations || res?.bookings || [])))
      .catch(() => setMine([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.bookConsultation({ topic, notes });
      setTopic(''); setNotes('');
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to request consultation');
    } finally {
      setBusy(false);
    }
  }, [topic, notes, load]);

  const STATUS = {
    requested: 'bg-[#fffbeb] dark:bg-amber-900/40 text-[#b45309] dark:text-amber-300',
    confirmed: 'bg-[#dcfce7] dark:bg-green-900/40 text-[#166534] dark:text-green-300',
    completed: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    cancelled: 'bg-[#f4f4f5] dark:bg-gray-800 text-[#52525b] dark:text-gray-400',
  };

  return (
    <CardShell title="Book consultation" className={className}>
      <p className="text-[11.5px] text-[#a1a1aa] mb-4">Request a 1:1 to walk through your report.</p>
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional)"
          className="w-full rounded-[9px] border border-[#f0f0f3] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#27272a] dark:text-gray-100 px-3 py-2 text-[13px] placeholder-[#a1a1aa]"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you’d like to cover"
          rows={2}
          className="w-full rounded-[9px] border border-[#f0f0f3] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#27272a] dark:text-gray-100 px-3 py-2 text-[13px] placeholder-[#a1a1aa] resize-none"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button
          type="submit"
          disabled={busy}
          className="w-full h-[38px] flex items-center justify-center gap-2 rounded-[9px] bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-[12.5px] font-bold disabled:opacity-50 mt-1 cursor-pointer transition-colors border-none"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? 'Requesting…' : 'Request slot →'}
        </button>
      </form>
      {Array.isArray(mine) && mine.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-[#f0f0f3] dark:border-gray-800 pt-4">
          {mine.slice(0, 3).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-medium text-[#3f3f46] dark:text-gray-300 truncate">{c.topic || 'Consultation'}</span>
              <span className={`text-[10px] font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-md ${STATUS[c.status] || STATUS.requested}`}>{c.status || 'requested'}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// ── Assessment not started ───────────────────────────────────────────────────
// D324 — canvas 69dc42f3 S4 draws the band's empty state as one designed card
// with one action, "because results genuinely can be absent and a gray
// placeholder would read as breakage". It replaces the three separate nudges
// only when every read ANSWERED and every one is empty: a read still loading or
// one that failed keeps the three cards, so a failure never reads as "not
// started".
export function assessmentNotStarted({ radar, values, results, fit }) {
  const answered = (st) => st && !st.error && st.data != null;
  if (![radar, values, results, fit].every(answered)) return false;
  const axes = Array.isArray(radar.data.axes) ? radar.data.axes : [];
  if (axes.some((a) => Number(a.skill_count) > 0 || Number(a.score) > 0)) return false;
  const vector = Array.isArray(values.data.vector) ? values.data.vector : [];
  if (vector.some((v) => Number(v.confidence) > 0)) return false;
  const list = Array.isArray(results.data.results) ? results.data.results : [];
  if (list.some((r) => r.archetype_slug)) return false;
  if (fit.data.archetype && fit.data.archetype.slug) return false;
  return true;
}

function toChat(event) {
  const el = typeof document !== 'undefined' ? document.getElementById(STUDIO_CHAT_ANCHOR) : null;
  if (!el) return;
  event.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function AssessmentNotStartedCard({ audience = 'founder' }) {
  return (
    <div
      className="pf-card flex flex-wrap items-center gap-[18px] bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 p-[26px]"
      data-testid={`${audience}-assessment-empty`}
    >
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300">
        <Sparkles size={20} />
      </span>
      <div className="min-w-[240px] flex-1">
        <div className="text-[14.5px] font-extrabold tracking-[-0.015em] text-[#27272a] dark:text-gray-100">Assessment not started</div>
        <p className="mt-1 text-[12.5px] leading-[1.55] text-[#71717a] dark:text-gray-400">
          Skills, values and archetype appear here once you begin. The questions arrive through the chat above, a few at a time.
        </p>
      </div>
      <a
        href={`#${STUDIO_CHAT_ANCHOR}`}
        onClick={toChat}
        className="inline-flex items-center rounded-[9px] bg-[#7c3aed] hover:bg-[#6d28d9] px-4 py-2 text-[12.5px] font-bold text-white"
        data-testid={`button-${audience}-begin-chat`}
      >
        Begin with the chat
      </a>
    </div>
  );
}

// ── Mobile rows (canvas ec6c3ada S15) ───────────────────────────────────────
// At phone width the Skills and Values cards collapse to one-line rows above
// and below the archetype card. A row opens its card in place (D325).
export function skillsRow(state) {
  if (state?.error) return 'Could not be read';
  if (!state?.data) return 'Loading…';
  const axes = (Array.isArray(state.data.axes) ? state.data.axes : []).filter((a) => Number(a.score) > 0 || Number(a.skill_count) > 0);
  if (!axes.length) return 'Nothing measured yet';
  return [...axes].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 3).map((a) => a.label || a.slug).join(' · ');
}

export function valuesRow(state) {
  if (state?.error) return 'Could not be read';
  if (!state?.data) return 'Loading…';
  const vector = (Array.isArray(state.data.vector) ? state.data.vector : []).filter((v) => Number(v.confidence) > 0);
  if (!vector.length) return 'Nothing measured yet';
  const leans = vector.map(valueSlider).filter((x) => x && x.lean !== 'Balanced').slice(0, 2).map((x) => x.lean);
  if (leans.length) return leans.join(' · ');
  const top = (state.data.summary?.top || []).map((t) => t.label).filter(Boolean).slice(0, 2);
  return top.length ? top.join(' · ') : 'Balanced across the measured spectrums';
}

function BandRow({ title, summary, open, onToggle, testId }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="pf-card flex w-full items-center justify-between gap-3 bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 px-4 py-[14px] text-left md:hidden"
      data-testid={testId}
    >
      <span className="min-w-0">
        <span className="pf-lbl block text-[#a1a1aa] dark:text-gray-400">{title}</span>
        <span className="mt-[3px] block truncate text-[12.5px] text-[#3f3f46] dark:text-gray-300">{summary}</span>
      </span>
      <ChevronRight size={16} className={`shrink-0 text-[#c9c6d2] transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}

const READERS = {
  radar: () => api.radar.me(),
  values: () => api.values.getMe(),
  results: () => assessment.myResults(),
  fit: () => api.bestFit.me(),
  progress: () => api.advisor.progress(),
};

// ── Section ───────────────────────────────────────────────────────────────────
export default function ProfileFitSection({ className = '', compact = false, studio = false, audience = 'founder' }) {
  const condensed = compact || studio;
  const [radar, setRadar] = useState({ data: null, error: '' });
  const [values, setValues] = useState({ data: null, error: '' });
  const [results, setResults] = useState({ data: null, error: '' });
  const [progress, setProgress] = useState({ data: null, error: '' });
  const [fit, setFit] = useState({ data: null, error: '' });
  const [openRow, setOpenRow] = useState({ skills: false, values: false });
  const alive = useRef(true);

  // D325 — one reader per source, so a card whose read failed can retry its
  // own source without re-reading the others.
  const read = useCallback((which) => {
    const set = { radar: setRadar, values: setValues, results: setResults, fit: setFit, progress: setProgress }[which];
    set({ data: null, error: '' });
    READERS[which]()
      .then((d) => { if (alive.current) set({ data: d, error: '' }); })
      .catch((e) => { if (alive.current) set({ data: null, error: e?.message || 'Failed to load' }); });
  }, []);

  useEffect(() => {
    alive.current = true;
    read('radar');
    read('values');
    read('results');
    if (!condensed) read('progress');
    read('fit');
    return () => { alive.current = false; };
  }, [condensed, read]);

  if (condensed) {
    return (
      <section id="profile" className={`pf-root ${className}`}>
        <style>{`
          .pf-mono { font-family: 'Roboto Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
          .pf-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
          .pf-card { border-radius: 16px; box-shadow: 0 1px 2px rgba(24,24,27,.03); }
          .pf-sprite { image-rendering: pixelated; }
          .pf-card-hit { text-decoration: none; color: inherit; display: block; cursor: pointer; transition: transform .15s ease, border-color .15s ease; }
          .pf-card-hit:hover { transform: translateY(-2px); border-color: var(--arch-accent, #7c3aed); }
          .pf-card-hit:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
          @keyframes pfFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        `}</style>
        <div className="pf-lbl mb-3 text-[#a1a1aa] dark:text-gray-400" data-testid="profile-fit-label">Profile &amp; Fit</div>
        {assessmentNotStarted({ radar, values, results, fit }) ? (
          <div data-testid={`${audience}-assessment-band`}><AssessmentNotStartedCard audience={audience} /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[14px] items-start" data-testid={`${audience}-assessment-band`}>
            <div className="order-1 flex flex-col gap-[14px] md:order-none">
              <BandRow title="Skills" summary={skillsRow(radar)} open={openRow.skills} onToggle={() => setOpenRow((o) => ({ ...o, skills: !o.skills }))} testId="row-profile-skills" />
              <div className={openRow.skills ? '' : 'hidden md:block'}>
                <SkillsRadarCard state={radar} audience={audience} onRetry={() => read('radar')} />
              </div>
            </div>
            <div className="order-3 flex flex-col gap-[14px] md:order-none">
              <BandRow title="Values" summary={valuesRow(values)} open={openRow.values} onToggle={() => setOpenRow((o) => ({ ...o, values: !o.values }))} testId="row-profile-values" />
              <div className={openRow.values ? '' : 'hidden md:block'}>
                <ValuesLeanCard state={values} audience={audience} onRetry={() => read('values')} />
              </div>
            </div>
            <div className="order-2 md:order-none">
              <ArchetypeCard state={results} fitState={fit} audience={audience} compact onRetry={() => { read('results'); read('fit'); }} />
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section id="profile" className={`pf-root space-y-[20px] ${className}`}>
      <style>{`
        .pf-mono { font-family: 'Roboto Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
        .pf-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
        .pf-card { border-radius: 16px; box-shadow: 0 1px 2px rgba(24,24,27,.03); }
        .pf-sprite { image-rendering: pixelated; }
        .pf-card-hit { text-decoration: none; color: inherit; display: block; cursor: pointer; transition: transform .15s ease, border-color .15s ease; }
        .pf-card-hit:hover { transform: translateY(-2px); border-color: var(--arch-accent, #7c3aed); }
        .pf-card-hit:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
        @keyframes pfFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[20px] items-start">
         <SkillsRadarCard state={radar} audience={audience} onRetry={() => read('radar')} />
         <ValuesLeanCard state={values} audience={audience} onRetry={() => read('values')} />
      </div>
      
       <ArchetypeCard state={results} fitState={fit} audience={audience} onRetry={() => { read('results'); read('fit'); }} />
      
      <FitCard progressState={progress} fitState={fit} />
      
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-[20px] items-start">
        <MatchSummaryCard />
        <BookConsultationCard />
      </div>
    </section>
  );
}