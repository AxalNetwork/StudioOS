/**
 * Task #2 (CC) — Personal Advisor right-rail progress widget.
 *
 * Three buckets — Proposed, Pending, Completed — driven by the
 * deterministic state machine's queue (`GET /api/advisor/queue`)
 * and the field_sources audit (`GET /api/advisor/sources`).
 *
 * Buckets:
 *   - Proposed: queue items the user has not started, sorted by
 *     server-side priority (queue is already pre-ranked). Tier-blocked
 *     questions arrive as `paywall_ctas` with a Studio-only lock pill.
 *   - Pending: the currently-asked question (current `next_question`)
 *     plus any `pendingEvidence`-flagged items the chat host passes in.
 *     Sorted by completion % desc, then priority.
 *   - Completed: most recent 10 entries from /sources, newest first.
 *
 * Spin-Out variant: when `labState.active`, a week badge and a
 * per-week milestone strip render above the buckets, with progress
 * bars and a tooltip listing missing milestone keys.
 *
 * Realtime: the host page passes a `progressBumpToken` that bumps any
 * time the OnboardingChat WS emits an `advisor-progress` frame; the
 * widget re-fetches its queue + sources on each bump.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, Lock, ChevronDown, ChevronRight, ArrowRight, CheckCircle2,
  Hammer, DollarSign, ScrollText, Search, Users, Palette, BookOpen,
  Briefcase, Compass, Clock,
} from 'lucide-react';
import { api } from '../../lib/api';
import { predictTarget, pageLabel } from '../../lib/advisor/router';

// FLIP animation: items leaving one bucket and arriving in another get
// a < 500ms inverse-translate transition so the move reads as motion
// rather than a pop. We track the previous bounding rect of every
// `[data-qid]` card under the widget root and, on the next frame after
// commit, apply transform: translate(dx, dy) → identity with a 320ms
// ease-out. Cards that didn't exist before just fade in.
function useFlipMove(rootRef, depKey) {
  const prevRectsRef = useRef(new Map());
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = root.querySelectorAll('[data-qid]');
    const prev = prevRectsRef.current;
    const next = new Map();
    cards.forEach((el) => {
      const qid = el.getAttribute('data-qid');
      const rect = el.getBoundingClientRect();
      next.set(qid, rect);
      const before = prev.get(qid);
      if (before) {
        const dx = before.left - rect.left;
        const dy = before.top - rect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.style.transition = 'none';
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          // Force reflow so the next style write actually animates.
          // eslint-disable-next-line no-unused-expressions
          el.getBoundingClientRect();
          requestAnimationFrame(() => {
            el.style.transition = 'transform 320ms cubic-bezier(.2,.8,.2,1)';
            el.style.transform = '';
          });
        }
      } else {
        // Newly-mounted card: short fade-in (also < 500ms).
        el.style.opacity = '0';
        requestAnimationFrame(() => {
          el.style.transition = 'opacity 240ms ease-out';
          el.style.opacity = '1';
        });
      }
    });
    prevRectsRef.current = next;
  }, [depKey, rootRef]);
}

// Spin-Out Lab milestone catalog — duplicated here as a small literal
// because the worker module is server-only. Kept aligned with
// `cloudflare-worker/src/services/spinoutLabCatalog.ts`. Drift is
// non-fatal (worse copy text on the tooltip, never a crash).
const SPINOUT_WEEKS = [
  { week: 1, label: 'Customer Discovery', requiredAll: ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3'], requiredAny: [] },
  { week: 2, label: 'Build', requiredAll: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'], requiredAny: [] },
  { week: 3, label: 'Network', requiredAll: ['scoring_run_completed'], requiredAny: ['mentor_meeting_booked', 'cofounder_request_sent'] },
  { week: 4, label: 'Incorporate', requiredAll: ['incorporation_completed'], requiredAny: [] },
];

const MILESTONE_LABELS = {
  project_created: 'Create your project',
  customer_interview_logged_1: 'Log interview #1',
  customer_interview_logged_2: 'Log interview #2',
  customer_interview_logged_3: 'Log interview #3',
  okrs_created: 'Draft OKRs',
  brand_basics_filled: 'Brand basics',
  pitch_deck_drafted: 'Draft pitch deck',
  scoring_run_completed: 'Run an AI score',
  mentor_meeting_booked: 'Book a mentor meeting',
  cofounder_request_sent: 'Send a cofounder request',
  incorporation_completed: 'Complete incorporation',
};

const SECTION_ICONS = {
  BUILD: Hammer,
  CAPITAL: DollarSign,
  LEGAL: ScrollText,
  DISCOVERY: Search,
  NETWORK: Users,
  BRAND: Palette,
  PITCH: BookOpen,
  PORTFOLIO: Briefcase,
  PERSONA: Compass,
};
function sectionIcon(section) {
  if (!section) return Sparkles;
  return SECTION_ICONS[String(section).toUpperCase()] || Sparkles;
}

const IMPORTANCE_RANK = { critical: 4, high: 3, normal: 2, low: 1 };
function importanceRank(imp) { return IMPORTANCE_RANK[imp] || 2; }
function importancePill(importance) {
  const map = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    high: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    normal: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };
  return map[importance] || map.normal;
}

function ProgressBar({ percent, done }) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const color = done ? 'bg-emerald-500' : pct > 0 ? 'bg-violet-500' : 'bg-gray-300 dark:bg-gray-700';
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
      <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ConfettiSVG() {
  return (
    <svg viewBox="0 0 64 64" className="w-12 h-12 mx-auto" aria-hidden="true">
      <g>
        <rect x="6" y="10" width="4" height="8" fill="#a78bfa" transform="rotate(20 8 14)" />
        <rect x="54" y="14" width="4" height="8" fill="#34d399" transform="rotate(-30 56 18)" />
        <rect x="14" y="46" width="4" height="8" fill="#f59e0b" transform="rotate(45 16 50)" />
        <rect x="46" y="44" width="4" height="8" fill="#ec4899" transform="rotate(-15 48 48)" />
        <circle cx="32" cy="32" r="9" fill="#ede9fe" stroke="#7c3aed" strokeWidth="2" />
        <path d="M28 32l3 3 5-6" stroke="#7c3aed" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="22" cy="20" r="1.5" fill="#60a5fa" />
        <circle cx="44" cy="22" r="1.5" fill="#f472b6" />
        <circle cx="20" cy="42" r="1.5" fill="#34d399" />
        <circle cx="44" cy="42" r="1.5" fill="#fbbf24" />
      </g>
    </svg>
  );
}

function Bucket({ title, count, openLink, openLabel, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1 text-left">{title}</span>
        <span className="px-1.5 py-px rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[10px] font-bold normal-case">
          {count}
        </span>
        {openLink && (
          <Link
            to={openLink}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] font-medium normal-case text-violet-700 dark:text-violet-300 hover:underline"
          >
            {openLabel || 'Open page →'}
          </Link>
        )}
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function ItemCard({
  item, onClick, locked, lockTier, upgradeLink, completion,
  completedAt, dim,
}) {
  const Icon = sectionIcon(item.section);
  const target = item.page_target || (predictTarget(item.id || item.question_id)?.page_target ?? null);
  const docAnchor = predictTarget(item.id || item.question_id)?.doc_anchor || null;
  const importance = item.importance || 'normal';
  const label = item.prompt || (predictTarget(item.id || item.question_id)?.label ?? item.question_id) || 'Question';
  const explainer = item.hint || (predictTarget(item.id || item.question_id)?.label ?? null);
  const pct = typeof completion === 'number' ? completion : 0;

  return (
    <div
      data-qid={item.id || item.question_id}
      data-card-anim
      className={`p-2 rounded-lg border transition-all duration-300 ${
        locked
          ? 'border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-violet-300 dark:hover:border-violet-700'
      } ${dim ? 'opacity-80' : ''}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={locked}
        className="w-full text-left disabled:cursor-default"
        title={explainer || undefined}
      >
        <div className="flex items-start gap-2">
          <Icon size={14} className="text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{label}</span>
              {!locked && (
                <span className={`text-[9px] uppercase font-semibold px-1.5 py-px rounded ${importancePill(importance)}`}>
                  {importance}
                </span>
              )}
              {locked && (
                <span className="inline-flex items-center gap-0.5 text-[9px] uppercase font-semibold px-1.5 py-px rounded bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                  <Lock size={9} /> {lockTier || 'locked'}
                </span>
              )}
            </div>
            {completedAt ? (
              <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <CheckCircle2 size={10} className="text-emerald-500" />
                <span>Completed {formatRelative(completedAt)}</span>
              </div>
            ) : (
              <ProgressBar percent={pct} done={pct >= 100} />
            )}
          </div>
        </div>
      </button>

      {/* Hover explainer removed — kept as title attr on the button above */}

      {/* Locked → Upgrade CTA */}
      {locked && (
        <div className="mt-1.5">
          <Link
            to={upgradeLink || '/billing/upgrade'}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-800 dark:text-amber-300 hover:underline"
          >
            Upgrade to unlock <ArrowRight size={10} />
          </Link>
        </div>
      )}

      {/* Open page link, when the question maps to a page */}
      {!locked && target && (
        <div className="mt-1 text-right">
          <Link
            to={target}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10px] text-violet-700 dark:text-violet-300 hover:underline"
            title={`Open ${pageLabel(target)}`}
          >
            Open {pageLabel(target)} <ArrowRight size={10} />
          </Link>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso) {
  if (!iso) return '';
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

function SpinoutWeekStrip({ week, completedKeys }) {
  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-900/40 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-violet-800 dark:text-violet-200">
          Spin-Out Lab
        </span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-600 text-white">
          Week {week} of 4
        </span>
      </div>
      <div className="space-y-1.5">
        {SPINOUT_WEEKS.map((w) => {
          const all = [...w.requiredAll, ...(w.requiredAny || [])];
          const done = w.requiredAll.filter((k) => completedKeys.has(k)).length
            + ((w.requiredAny || []).some((k) => completedKeys.has(k)) ? 1 : 0);
          const total = w.requiredAll.length + ((w.requiredAny || []).length > 0 ? 1 : 0);
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const missing = all.filter((k) => !completedKeys.has(k));
          const tooltip = missing.length === 0
            ? `Week ${w.week} complete`
            : `Missing: ${missing.map((m) => MILESTONE_LABELS[m] || m).join(', ')}`;
          const current = w.week === week;
          return (
            <div key={w.week} title={tooltip}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-medium flex-shrink-0 ${current ? 'text-violet-800 dark:text-violet-200' : 'text-gray-600 dark:text-gray-400'}`}>
                  W{w.week}
                </span>
                <span className={`text-[10px] flex-1 truncate ${current ? 'text-violet-800 dark:text-violet-200 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                  {w.label}
                </span>
                <span className="text-[9px] text-gray-500 dark:text-gray-400 flex-shrink-0">{done}/{total}</span>
              </div>
              <ProgressBar percent={pct} done={pct >= 100} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdvisorProgressWidget({
  focusSection,
  pendingEvidence,
  currentQuestion,
  labState,
  progressBumpToken,
  onPickQuestion,
}) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState({ next_question: null, queue: [], paywall_ctas: [], complete: false });
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [q, s] = await Promise.allSettled([
        api.advisor.queue(focusSection || undefined),
        api.advisor.sources(),
      ]);
      if (q.status === 'fulfilled' && q.value) {
        setQueue({
          next_question: q.value.next_question || null,
          queue: Array.isArray(q.value.queue) ? q.value.queue : [],
          paywall_ctas: Array.isArray(q.value.paywall_ctas) ? q.value.paywall_ctas : [],
          complete: !!q.value.complete,
        });
      }
      if (s.status === 'fulfilled' && s.value && Array.isArray(s.value.sources)) {
        setSources(s.value.sources);
      }
    } catch { /* non-fatal — widget degrades to empty buckets */ }
    finally { setLoading(false); }
  }, [focusSection]);

  // Initial + refocus + WS-driven refresh.
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (progressBumpToken == null) return;
    // Coalesce bursty bumps — queue endpoint is a few SQL reads, but
    // fanning out one fetch per WS frame is wasteful when an answer
    // commit triggers both page-fill AND advisor-progress events.
    const t = setTimeout(refresh, 150);
    return () => clearTimeout(t);
  }, [progressBumpToken, refresh]);

  // ---------- Bucket assembly ------------------------------------------
  const completedSet = useMemo(() => {
    const s = new Set();
    for (const r of sources) if (r.question_id) s.add(r.question_id);
    return s;
  }, [sources]);

  const proposedItems = useMemo(() => {
    // Drop the current question (rendered in Pending) and anything
    // already completed. Queue is pre-sorted by score; preserve order.
    const out = [];
    const currentId = currentQuestion?.id || queue.next_question?.id;
    for (const c of queue.queue) {
      if (c.id === currentId) continue;
      if (completedSet.has(c.id)) continue;
      out.push(c);
    }
    return out;
  }, [queue.queue, queue.next_question, currentQuestion, completedSet]);

  const pendingItems = useMemo(() => {
    const list = [];
    const cur = currentQuestion || queue.next_question;
    if (cur && !completedSet.has(cur.id)) {
      list.push({
        ...cur,
        completion: pendingEvidence && pendingEvidence.qid === cur.id ? 60 : 30,
        evidence_required: !!(pendingEvidence && pendingEvidence.qid === cur.id),
      });
    }
    // Sort: completion % desc, then importance.
    list.sort((a, b) => {
      const c = (b.completion || 0) - (a.completion || 0);
      if (c !== 0) return c;
      return importanceRank(b.importance) - importanceRank(a.importance);
    });
    return list;
  }, [currentQuestion, queue.next_question, pendingEvidence, completedSet]);

  const completedItems = useMemo(() => {
    // Newest first, last 10. Field source rows are already sorted desc.
    return sources.slice(0, 10).map((r) => ({
      id: r.question_id,
      question_id: r.question_id,
      prompt: r.label || r.question_id,
      section: r.section || null,
      page_target: r.page_target || null,
      importance: 'normal',
      completed_at: r.filled_at || null,
    }));
  }, [sources]);

  const lockedCtas = queue.paywall_ctas || [];

  const handleClickQuestion = useCallback((q) => {
    if (!onPickQuestion) return;
    onPickQuestion(q);
  }, [onPickQuestion]);

  // ---------- Render ----------------------------------------------------
  const lab = labState && labState.active ? labState : null;
  const completedKeys = useMemo(() => {
    const s = new Set();
    if (lab && Array.isArray(lab.milestones)) {
      for (const m of lab.milestones) if (m?.key) s.add(m.key);
    }
    return s;
  }, [lab]);

  // FLIP key: any change in the membership of the three buckets bumps
  // it. When a question moves Pending → Completed (or Proposed →
  // Pending) the key changes and useFlipMove animates the card from
  // its old position to its new one in <500ms.
  const flipKey = useMemo(() => {
    const p = proposedItems.map((q) => q.id).join(',');
    const n = pendingItems.map((q) => q.id).join(',');
    const c = completedItems.map((q) => q.id).join(',');
    return `${p}|${n}|${c}`;
  }, [proposedItems, pendingItems, completedItems]);
  useFlipMove(rootRef, flipKey);

  // Bucket-level "Open page →" link: when the user has pinned a
  // section AND the worker exposes a canonical page for it via
  // predictTarget(), surface a single link in the Proposed header.
  // The Pending bucket reuses the same target since the current
  // question lives in the same focused scope.
  const focusPage = useMemo(() => {
    if (!focusSection) return null;
    // Try the first proposed/pending item's page_target; fall back to
    // predictTarget on any q.id we know about.
    const sample = proposedItems[0] || pendingItems[0];
    if (sample?.page_target) return { to: sample.page_target, label: pageLabel(sample.page_target) };
    return null;
  }, [focusSection, proposedItems, pendingItems]);

  return (
    <div className="space-y-4" ref={rootRef}>
      {lab && <SpinoutWeekStrip week={Math.max(1, Math.min(4, Number(lab.week) || 1))} completedKeys={completedKeys} />}

      {/* Proposed */}
      <Bucket
        title="Proposed"
        count={proposedItems.length + lockedCtas.length}
        openLink={focusPage?.to}
        openLabel={focusPage ? `Open ${focusPage.label} →` : undefined}
        defaultOpen
      >
        {proposedItems.length === 0 && lockedCtas.length === 0 ? (
          loading ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">Loading…</div>
          ) : (
            <div className="text-center py-3">
              <ConfettiSVG />
              <div className="text-xs text-gray-700 dark:text-gray-300 font-medium mt-1">You're all caught up!</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">New questions appear here as your work unlocks them.</div>
            </div>
          )
        ) : (
          <>
            {proposedItems.map((q) => (
              <ItemCard key={q.id} item={q} onClick={() => handleClickQuestion(q)} />
            ))}
            {lockedCtas.map((c) => (
              <ItemCard
                key={`lock:${c.question_id}`}
                item={{ ...c, id: c.question_id }}
                locked
                lockTier={c.tier_required || 'studio'}
                upgradeLink={c.upgrade_link}
                onClick={() => navigate(c.upgrade_link || '/billing/upgrade')}
              />
            ))}
          </>
        )}
      </Bucket>

      {/* Pending */}
      <Bucket title="Pending" count={pendingItems.length} defaultOpen>
        {pendingItems.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 italic">
            Nothing in flight. Your next answer lands here once you start typing.
          </div>
        ) : (
          pendingItems.map((q) => (
            <ItemCard
              key={q.id}
              item={q}
              completion={q.completion}
              onClick={() => handleClickQuestion(q)}
            />
          ))
        )}
      </Bucket>

      {/* Completed */}
      <Bucket
        title="Completed"
        count={completedItems.length}
        defaultOpen={false}
      >
        {completedItems.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 italic flex items-center gap-1.5">
            <Clock size={12} /> No completed answers yet — your finished items will collect here.
          </div>
        ) : (
          completedItems.map((q) => (
            <ItemCard
              key={`${q.id}:${q.completed_at}`}
              item={q}
              completedAt={q.completed_at}
              dim
              onClick={() => {
                if (q.page_target) navigate(q.page_target);
              }}
            />
          ))
        )}
      </Bucket>
    </div>
  );
}
