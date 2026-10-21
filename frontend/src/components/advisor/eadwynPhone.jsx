/**
 * D701 (#1663) — Eadwyn's phone pieces, in a module a Node test can import.
 *
 * WHY A SEPARATE MODULE. `PersonalAdvisor`, `StudioInterview`,
 * `FounderStudioHome` and `AdvisorProgressWidget` all reach
 * `lib/advisor/router.js`, which imports `banks.manifest.json` with no import
 * attribute, so `node --test` throws before the first assertion. What the phone
 * layout needs, and what a test must render, lives here instead. Nothing in
 * this file may import anything that reaches `lib/advisor/router.js`: the
 * cards `PhoneBuckets` draws arrive with their labels and links already
 * worked out by the widget.
 *
 * The pieces are boards S1m, S2m and S4m of `Studio Mobile Page.dc.html`:
 *   threadLabel     "Today · <venture>" over the thread (decision 10)
 *   PhoneFocus      "Focus a section" and its chips (SMP:39-42)
 *   PhoneBuckets    Proposed, Pending and Completed (SMP:44-56)
 *   PhoneTicketCard "New ticket" (SMP:38), with no default type (D544)
 *   useFootFill     the chat's least height, so the composer stands at the foot
 */
import React, { useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, Loader2, Lock, Sparkles } from 'lucide-react';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { TICKET_PRIORITIES, TICKET_TYPES } from '../../lib/ticketScreens';
import { dayText, sameDay, storedDate } from '../../pages/founder/studioPhoneModel.js';

/**
 * One breakpoint (D701 decision 2, epic D-l): the shell's `PHONE_QUERY`,
 * below 1024px, followed through D699's `usePhoneWidth` with a `change`
 * listener. It replaced `innerWidth >= 768`, which left 768–1023px with a
 * phone shell around a desktop chat. Without `matchMedia` (a server render)
 * it is desktop, as `usePhoneWidth` is not a phone there.
 */
export function useIsDesktop() {
  return !usePhoneWidth();
}

/**
 * The chat's least height on a phone (the owner, 2026-10-21: the composer was
 * "in the middle of the screen"): from the frame's top to the scroll's visible
 * foot, less the tab bar's clearance (`[data-app-scroll]`'s bottom padding,
 * mobileTabBar.css). The frame is a column whose last row, the composer, has
 * `mt-auto`, so on a short thread the composer stands at the foot and the
 * shell's footer goes below the fold; on a long one its `sticky` holds it
 * there. Measured, not a `calc`: the band, any strip, the Studio bar and a
 * notice sit above the frame at heights only layout knows. Null without a
 * scroll container (a test, a server render): the frame keeps its own height.
 */
export function footFill(frame, scroller, view = globalThis) {
  if (!frame || !scroller) return null;
  const pad = Number.parseFloat(view.getComputedStyle?.(scroller)?.paddingBottom) || 0;
  const top = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return Math.max(0, Math.floor(scroller.clientHeight - pad - top));
}

/**
 * `footFill` for the frame its callback ref lands on, measured again whenever
 * the scroll or the content above can have moved it. A callback ref, not a ref
 * object: the frame mounts after the chat's first read, not on its first render.
 */
export function useFootFill() {
  const [frame, setFrame] = useState(null);
  const [minHeight, setMinHeight] = useState(null);
  useLayoutEffect(() => {
    const scroller = frame?.closest?.('[data-app-scroll]');
    if (!scroller) return undefined;
    const measure = () => setMinHeight(footFill(frame, scroller));
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(scroller);
    const content = frame.closest('[data-app-main]');
    if (content) ro?.observe(content);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [frame]);
  return [setFrame, minHeight];
}

/**
 * The thread's label (decision 10): "<day> · <venture>", the day "Today" when
 * the last message is from the viewer's today, else its date. `at` is that
 * message's stored `created_at`, read as UTC; a message sent in this tab has
 * none and counts as now. With no venture the label is the day alone.
 */
export function threadLabel({ at = null, venture = null, now = new Date() } = {}) {
  const last = at ? storedDate(at) : now;
  const day = last ? (sameDay(last, now) ? 'Today' : dayText(last, now)) : null;
  const name = typeof venture === 'string' ? venture.trim() : '';
  return [day, name].filter(Boolean).join(' · ');
}

const HEADING = 'text-[11px] font-bold uppercase tracking-[.1em] text-[#7d7889] dark:text-gray-400';

/** "Focus a section" (SMP:39-42), over the same section stats as the desktop chips. */
export function PhoneFocus({ sectionStats, focusSection, pickFocus }) {
  if (!Array.isArray(sectionStats) || sectionStats.length <= 1) return null;
  return (
    <div className="flex flex-col gap-2.5 pt-4" data-testid="eadwyn-phone-focus">
      <div className={HEADING}>Focus a section</div>
      <div className="flex flex-wrap gap-2">
        {sectionStats.map((s) => {
          const on = focusSection === s.section;
          return (
            <button
              key={s.section}
              type="button"
              aria-pressed={on ? 'true' : 'false'}
              onClick={() => pickFocus(s.section)}
              className={`inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-[12.5px] font-semibold uppercase tracking-[.02em] ${on
                ? 'border-violet-600 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300'
                : 'border-[#ececf1] bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
            >
              {s.percent > 0 ? `${s.section} · ${s.percent}%` : s.section}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const IMPORTANCE = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  high: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  normal: 'bg-[#f6f2ff] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

/**
 * One card (SMP:49-52). `card` is plain data the widget works out:
 * `{ key, title, importance, pct, when, learn, link: { to, label }, locked,
 * lockTier, upgrade, onClick }`.
 */
function PhoneCard({ card }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#ececf1] bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid="eadwyn-phone-card">
      <button type="button" onClick={card.onClick} disabled={card.locked} className="flex w-full items-center gap-2.5 text-left disabled:cursor-default">
        <Sparkles size={18} className="shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gray-900 dark:text-gray-100">{card.title}</span>
        {card.locked
          ? <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-[7px] py-[3px] text-[10.5px] font-bold uppercase tracking-[.04em] text-amber-900 dark:bg-amber-900/60 dark:text-amber-200"><Lock size={10} aria-hidden="true" /> {card.lockTier || 'locked'}</span>
          : <span className={`shrink-0 rounded-md px-[7px] py-[3px] text-[10.5px] font-bold uppercase tracking-[.04em] ${IMPORTANCE[card.importance] || IMPORTANCE.normal}`}>{card.importance || 'normal'}</span>}
      </button>
      {typeof card.pct === 'number' && (
        <div className="ml-7 h-1.5 rounded-full bg-[#ececf1] dark:bg-gray-800">
          <div className="h-1.5 rounded-full bg-violet-600" style={{ width: `${Math.max(0, Math.min(100, card.pct))}%` }} />
        </div>
      )}
      {card.when && (
        <div className="ml-7 flex items-center gap-1.5 text-[12.5px] text-[#615c6e] dark:text-gray-400">
          <CheckCircle2 size={14} className="text-emerald-700 dark:text-emerald-400" aria-hidden="true" />{card.when}
        </div>
      )}
      {card.locked ? (
        <Link to={card.upgrade || '/billing/upgrade'} className="ml-7 text-[13px] font-semibold text-amber-800 dark:text-amber-300">Upgrade to unlock →</Link>
      ) : (card.learn || card.link) && (
        <div className="flex min-h-[32px] items-center justify-end gap-4">
          {card.learn && (
            <Link to={card.learn} className="flex items-center gap-1.5 text-[13px] text-[#615c6e] dark:text-gray-400">
              <BookOpen size={14} aria-hidden="true" />Learn
            </Link>
          )}
          {card.link && <Link to={card.link.to} className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">{card.link.label} →</Link>}
        </div>
      )}
    </div>
  );
}

/** How many of a long bucket show before "Show all <n>" (SMP:116). */
export const BUCKET_PREVIEW = 3;

const EMPTY = {
  pending: 'Nothing in flight. Your next answer lands here once you start typing.',
  completed: 'No completed answers yet — your finished items will collect here.',
};

/**
 * Proposed, Pending and Completed (SMP:44-56), the widget's own buckets drawn
 * the canvas's way. Completed shows its three newest and "Show all <n>".
 */
export function PhoneBuckets({ buckets = [], loading = false }) {
  const [open, setOpen] = useState({});
  const [all, setAll] = useState({});
  return (
    <div data-testid="eadwyn-phone-buckets">
      {buckets.map((b) => {
        const shut = open[b.id] === false;
        const cut = b.id === 'completed' && !all[b.id] && b.cards.length > BUCKET_PREVIEW;
        const cards = cut ? b.cards.slice(0, BUCKET_PREVIEW) : b.cards;
        return (
          <section key={b.id} className="flex flex-col gap-2.5 pt-5" data-testid={`eadwyn-phone-bucket-${b.id}`}>
            <button type="button" aria-expanded={shut ? 'false' : 'true'} onClick={() => setOpen((o) => ({ ...o, [b.id]: shut }))} className="flex min-h-[28px] items-center gap-2 text-left">
              {shut ? <ChevronRight size={14} className="text-[#7d7889] dark:text-gray-400" aria-hidden="true" /> : <ChevronDown size={14} className="text-[#7d7889] dark:text-gray-400" aria-hidden="true" />}
              <span className="flex-1 text-[12px] font-bold uppercase tracking-[.1em] text-[#615c6e] dark:text-gray-400">{b.label}</span>
              <span className="rounded-md bg-[#f4f3f7] px-2 py-0.5 text-[12px] font-bold text-[#4a4553] dark:bg-gray-800 dark:text-gray-300">{b.count}</span>
            </button>
            {!shut && (cards.length ? cards.map((c) => <PhoneCard key={c.key} card={c} />)
              : b.id === 'proposed' ? (loading
                ? <p className="text-[13px] text-[#615c6e] dark:text-gray-400">Loading…</p>
                : (
                  <div className="flex flex-col items-center gap-1.5 pb-1 pt-3 text-center">
                    <CheckCircle2 size={28} className="text-violet-600 dark:text-violet-400" aria-hidden="true" />
                    <span className="text-[15px] font-bold text-gray-900 dark:text-gray-100">You’re all caught up!</span>
                    <span className="text-[13px] leading-snug text-[#615c6e] dark:text-gray-400">New questions appear here as your work unlocks them.</span>
                  </div>
                ))
                : <p className="text-[13px] text-[#615c6e] dark:text-gray-400">{EMPTY[b.id]}</p>)}
            {!shut && cut && (
              <button type="button" onClick={() => setAll((a) => ({ ...a, [b.id]: true }))} className="flex min-h-[32px] items-center text-[13px] font-semibold text-violet-700 dark:text-violet-300">
                Show all {b.cards.length}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

const CHIP = 'inline-flex min-h-[36px] items-center rounded-full border px-3 text-[12.5px] font-semibold';
const CHIP_ON = 'border-violet-600 bg-[#f4f0fe] text-violet-700 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300';
const CHIP_OFF = 'border-[#ececf1] bg-white text-[#4a4553] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';

/** A row of chips that is one choice: a radio group (decision 7 of step 7). */
function ChipChoice({ label, options, value, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id ? 'true' : 'false'}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`${CHIP} ${value === o.id ? CHIP_ON : CHIP_OFF}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * S4m's "New ticket" card (SMP:38). Its words and checks are the desktop
 * form's (`AdvisorTicketPanel`): the type has no default, as D544 and D606
 * require, unless the card was opened on Task; priority starts on Medium; File
 * ticket waits for a title. It files through `POST /api/tickets`, as today.
 * The canvas's Bug-on chip is a sample state and is not copied.
 */
export function PhoneTicketCard({ initialType = null, onFiled, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState(TICKET_TYPES.some((t) => t.id === initialType) ? initialType : '');
  const [priority, setPriority] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Please enter a short summary for your ticket.');
      return;
    }
    if (!TICKET_TYPES.some((t) => t.id === type)) {
      setError('Choose a type: Task, Bug or Feature.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await api.createTicket({ title: trimmed, priority, type, description: description.trim() || undefined });
      onFiled(ticket);
    } catch (e) {
      reportError('PhoneTicketCard:submit', e);
      setError(e?.message || 'Could not file your ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const field = 'w-full rounded-xl border border-[#ececf1] bg-white px-3.5 py-3 text-[15px] text-gray-900 placeholder-[#a1a1aa] focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500';
  return (
    <div className="mx-[22px] mt-3.5 flex flex-col gap-2.5 rounded-[14px] border border-[#e6dcff] bg-white p-3.5 dark:border-violet-900 dark:bg-gray-950" data-testid="eadwyn-phone-ticket">
      <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-100">New ticket</div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Title"
        maxLength={200}
        disabled={submitting}
        className={field}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What happened, or what you need"
        aria-label="What happened, or what you need"
        rows={2}
        disabled={submitting}
        className={`${field} min-h-[56px] resize-none`}
      />
      <ChipChoice label="Type" options={TICKET_TYPES} value={type} onChange={setType} disabled={submitting} />
      <ChipChoice label="Priority" options={TICKET_PRIORITIES} value={priority} onChange={setPriority} disabled={submitting} />
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || !title.trim()}
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-violet-700 text-[15px] font-bold text-white disabled:opacity-50"
      >
        {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
        {submitting ? 'Filing…' : 'File ticket'}
      </button>
      <button type="button" onClick={onClose} disabled={submitting} className="self-center px-3 py-1 text-[13px] font-semibold text-[#615c6e] disabled:opacity-50 dark:text-gray-400">
        Cancel
      </button>
    </div>
  );
}
