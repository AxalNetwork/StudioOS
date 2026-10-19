// D716 (#1866) — the LP's Subscription Booklet on the LP workspace. An approved
// Fund I applicant opens it, reads each part on the paper, ticks what applies
// and submits it; submitting freezes it under its digest. Signing it is #1858's.
//
// L7 draws the desktop form (a rail of Parts 2 to 9 beside one part's boxes and
// paper); L12 draws the phone's Read and Check steps. `usePhoneWidth()` picks
// one; both share the state held by `SubscriptionBooklet`.
//
// Every id, title, text and group is the Worker's (`lib/api/fundBooklets.js`),
// drawn as text. Every rule is `lib/bookletFormModel.js`'s. The Done marks, the
// tick queue and the papers live in React state; nothing is stored in the browser.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../lib/log';
import { fundBookletsApi } from '../lib/api/fundBooklets.js';
import { PaperFrame } from '../components/PaperPreview.jsx';
import { usePhoneWidth } from '../ui/phone/usePhoneWidth.js';
import {
  BOOKLET_COPY as T, PART_STUB, answersOf, canSubmit, formParts, missingLine, phoneSteps,
  queueTick, railRow, submitDigest, submittedLine, tickCounts, withQueued,
} from '../lib/bookletFormModel.js';

const CARD = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900';
const MUTED = 'text-[#615c6e] dark:text-gray-400';
const PRIMARY = 'rounded-lg bg-indigo-600 px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-indigo-700 disabled:bg-[#f4f3f7] disabled:text-[#9a95a6] dark:disabled:bg-gray-800 dark:disabled:text-gray-500';
const SECONDARY = 'rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3.5 py-2 text-[12.5px] font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800';

const messageOf = (e, fallback) => e?.data?.message || e?.message || fallback;

/** One checkbox row: a label wrapping a native box, so a tap anywhere toggles it. */
export function CheckRow({ field, size = 'desktop', disabled = false, onToggle }) {
  const phone = size === 'phone';
  const shape = phone ? 'min-h-[48px] gap-3 rounded-xl text-[14px]' : 'min-h-[44px] gap-2.5 rounded-[10px] text-[12.5px]';
  const edge = field.checked ? 'border-indigo-200 dark:border-indigo-800' : 'border-gray-200 dark:border-gray-700';
  return (
    <label className={`flex items-center border bg-white px-3 text-gray-800 dark:bg-gray-900 dark:text-gray-100 ${shape} ${edge} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={!!field.checked}
        disabled={disabled}
        onChange={(e) => onToggle?.(field.id, e.target.checked)}
        className={`flex-none accent-indigo-600 ${phone ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]'}`}
      />
      <span className="leading-snug">{field.text}</span>
    </label>
  );
}

/** A part's groups of rows, each under its counsel heading; a null group draws none. */
function PartRows({ part, size, disabled, onToggle }) {
  const phone = size === 'phone';
  if (part.missing) {
    return (
      <div className={`text-[12.5px] ${MUTED}`}>
        <div className="font-semibold text-amber-800 dark:text-amber-300">{PART_STUB}</div>
        <div className="mt-0.5">{T.stubNote}</div>
      </div>
    );
  }
  if (!part.fields.length) return <div className={`text-[12.5px] ${MUTED}`}>{T.noBoxes}</div>;
  return (
    <div className="space-y-3">
      {part.groups.map((g, i) => (
        <div key={i}>
          {g.heading !== null && (
            <div className={phone
              ? 'mb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#7d7889] dark:text-gray-400'
              : `mb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] ${MUTED}`}>{g.heading}</div>
          )}
          <div className="space-y-1.5">
            {g.fields.map((f) => <CheckRow key={f.id} field={f} size={size} disabled={disabled} onToggle={onToggle} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One part's paper, from `?part=n`. The last paper stays while the next draws. */
export function BookletPaper({ part, paper, failed = false, drawing = false, onRetry }) {
  return (
    <div className="min-w-0">
      {drawing && <div className={`mb-1 text-[11px] ${MUTED}`}>{T.drawing}</div>}
      {failed && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-red-700 dark:text-red-400">
          <span>{T.paperFailed}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">{T.retry}</button>
        </div>
      )}
      {paper?.html && (
        // dark-mode-exempt: the paper stays white, as it prints.
        <div className="overflow-hidden rounded-lg border border-[#ececf1] bg-white dark:bg-white">
          <PaperFrame html={paper.html} title={T.partOf(part)} />
        </div>
      )}
    </div>
  );
}

/** The freeze line, the missing-part sentence and Submit. */
export function SubmitBlock({ view, enabled, submitting = false, onSubmit, inFooter = false }) {
  const missing = missingLine(view?.missing_parts);
  return (
    <div className="space-y-2 text-[12px]">
      {missing && <div className="text-amber-800 dark:text-amber-300">{missing}</div>}
      <div className={MUTED}>{T.freezeLine}</div>
      {!inFooter && (
        <button type="button" disabled={!enabled || submitting} onClick={onSubmit} className={`w-full ${PRIMARY}`}>
          {submitting ? T.submitting : T.submit}
        </button>
      )}
    </div>
  );
}

/** The submitted state's pill and line. */
function SubmittedNote({ view }) {
  return (
    <div className="space-y-1 text-[12px]">
      <span className="inline-block rounded-full border border-[#a7f3d0] bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-bold text-[#047857] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{T.submittedPill}</span>
      <div className={`font-mono text-[11.5px] ${MUTED}`}>{submittedLine(view)}</div>
      <div className={MUTED}>{T.frozenLine}</div>
    </div>
  );
}

const TONE = {
  current: 'bg-indigo-50 font-bold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  done: 'text-emerald-700 dark:text-emerald-400',
  muted: MUTED,
};

/** The rail: Parts 2 to 9, then the submit block. */
export function BookletRail({ parts, current, done, submitted, onPick, children }) {
  return (
    <nav className="border-r border-[#ececf1] bg-white px-3 py-4 text-[12px] dark:border-gray-800 dark:bg-gray-900" aria-label={T.railHeading}>
      <div className="mb-2 px-2 font-extrabold text-gray-900 dark:text-gray-100">{T.railHeading}</div>
      <div className="space-y-0.5">
        {parts.map((p) => {
          const row = railRow(p, { current: p.n === current, done: done.has(p.n), submitted });
          return (
            <button
              key={p.n}
              type="button"
              onClick={() => onPick(p.n)}
              aria-current={p.n === current ? 'step' : undefined}
              className={`block w-full rounded-[7px] px-2 py-[7px] text-left ${TONE[row.tone]}`}
            >
              {row.text}
              {row.stub && <span className="text-amber-800 dark:text-amber-300">{T.stub}</span>}
            </button>
          );
        })}
      </div>
      {children && <div className="mt-4 border-t border-[#ececf1] pt-3 dark:border-gray-800">{children}</div>}
    </nav>
  );
}

/** The main pane for one part: eyebrow, title, rows, paper and Next. */
export function BookletPartForm({ part, disabled, onToggle, paperProps, onNext, nextPart }) {
  return (
    <div className="min-w-0 px-5 py-[18px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-indigo-700 dark:text-indigo-300">{T.partOf(part.n)}</div>
      <h3 className="mt-0.5 text-[20px] font-extrabold text-gray-900 dark:text-gray-100">{part.title}</h3>
      <div className="mt-3 xl:grid xl:grid-cols-2 xl:gap-5">
        <div>
          {part.fields.length > 0 && !part.missing && <p className={`mb-3 text-[12.5px] ${MUTED}`}>{T.introDesktop}</p>}
          <PartRows part={part} size="desktop" disabled={disabled} onToggle={onToggle} />
        </div>
        <div className="mt-4 xl:mt-0"><BookletPaper part={part.n} {...paperProps} /></div>
      </div>
      {nextPart && (
        <div className="mt-4">
          <button type="button" onClick={onNext} className={SECONDARY}>{T.next(nextPart.n, nextPart.label)}</button>
        </div>
      )}
    </div>
  );
}

/** L7: the desktop form. */
export function BookletDesktop({ view, current, done, onPick, onToggle, paperProps, submit }) {
  const parts = formParts(view);
  const submitted = view.status === 'submitted';
  const part = parts.find((p) => p.n === current) || parts[0];
  const next = parts.find((p) => p.n === part.n + 1) || null;
  return (
    <div className="grid grid-cols-[200px_1fr] overflow-hidden rounded-xl border border-[#dcd9e3] bg-gray-50 dark:border-gray-700 dark:bg-gray-900/60">
      <BookletRail parts={parts} current={part.n} done={done} submitted={submitted} onPick={onPick}>
        {submitted ? <SubmittedNote view={view} /> : <SubmitBlock view={view} {...submit} />}
      </BookletRail>
      <BookletPartForm
        part={part}
        disabled={view.status !== 'open'}
        onToggle={onToggle}
        paperProps={paperProps}
        nextPart={next}
        onNext={() => onPick(next.n)}
      />
    </div>
  );
}

/** L12: the phone's steps, full screen. `step` indexes `phoneSteps(view)`. */
export function BookletPhone({ view, step, onStep, onClose, onToggle, paperProps, submit }) {
  const ref = useRef(null);
  const steps = phoneSteps(view);
  const at = steps[Math.min(Math.max(step, 0), steps.length - 1)];
  const parts = formParts(view);
  const part = parts.find((p) => p.n === at.part) || null;
  const counts = tickCounts(view);
  const submitted = view.status === 'submitted';

  useEffect(() => {
    ref.current?.focus?.();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const back = () => (step > 0 ? onStep(step - 1) : onClose());
  const forward = () => onStep(step + 1);
  const bar = 'flex h-11 flex-none items-center gap-2 border-b border-[#ececf1] px-[18px] text-[14px] font-bold text-gray-900 dark:border-gray-800 dark:text-gray-100';
  const right = `ml-auto flex-none text-[12px] font-semibold ${MUTED}`;
  const backButton = (label) => (
    <button type="button" onClick={back} className="min-w-0 truncate text-left">{`‹ ${label}`}</button>
  );

  let top, body, footer;
  if (at.kind === 'read') {
    top = (
      <>
        <button type="button" onClick={back} aria-label={T.back} className="flex-none">‹</button>
        <span className="min-w-0 truncate">{T.readTitle}</span>
        <span className={right}>{T.partOf(part.n)}</span>
      </>
    );
    body = (
      <>
        {part.missing && <div className="mb-2 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">{PART_STUB}</div>}
        <BookletPaper part={part.n} {...paperProps} />
      </>
    );
    footer = { label: part.fields.length ? T.toBoxes : T.continue, onClick: forward, disabled: false };
  } else if (at.kind === 'check') {
    top = (<>{backButton(part.title)}<span className={right}>{T.partOf(part.n)}</span></>);
    body = (
      <>
        <p className={`mb-3 text-[12.5px] ${MUTED}`}>{T.introPhone}</p>
        <PartRows part={part} size="phone" disabled={view.status !== 'open'} onToggle={onToggle} />
      </>
    );
    footer = { label: T.continue, onClick: forward, disabled: false };
  } else {
    top = backButton(T.review);
    body = (
      <>
        <div className="divide-y divide-[#ececf1] dark:divide-gray-800">
          {parts.map((p) => {
            const c = counts.byPart[p.n];
            return (
              <div key={p.n} className="flex min-h-[44px] items-center gap-2 text-[13px] text-gray-800 dark:text-gray-100">
                <span className="min-w-0 flex-1">{T.railRow(p.n, p.label)}</span>
                <span className={`flex-none text-[12px] ${p.missing ? 'text-amber-800 dark:text-amber-300' : MUTED}`}>
                  {p.missing ? T.partStub : c.total ? T.partTicked(c.ticked, c.total) : T.partNoBoxes}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          {submitted ? <SubmittedNote view={view} /> : <SubmitBlock view={view} {...submit} inFooter />}
        </div>
      </>
    );
    footer = submitted
      ? { label: T.continue, onClick: onClose, disabled: false }
      : { label: submit.submitting ? T.submitting : T.submit, onClick: submit.onSubmit, disabled: !submit.enabled || submit.submitting };
  }

  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={T.section} className="fixed inset-0 z-50 flex flex-col bg-white outline-none dark:bg-gray-950">
      <div className={bar}>{top}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-3.5">
        {submit.notice && <div className="mb-3 text-[12.5px] text-red-700 dark:text-red-400" role="alert">{submit.notice}</div>}
        {body}
      </div>
      <div className="flex-none border-t border-[#ececf1] px-[18px] pb-[26px] pt-3 dark:border-gray-800">
        <button
          type="button"
          onClick={footer.onClick}
          disabled={footer.disabled}
          className="min-h-[50px] w-full rounded-[14px] bg-indigo-600 text-[15px] font-bold text-white disabled:bg-[#f4f3f7] disabled:text-[#9a95a6] dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
        >
          {footer.label}
        </button>
      </div>
    </div>
  );
}

/** The section: reads the booklet, opens it, runs the tick queue and Submit. */
export function SubscriptionBooklet() {
  const phone = usePhoneWidth();
  const [state, setState] = useState('loading'); // loading | none | ready | unreadable
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queued, setQueued] = useState([]);
  const [inFlight, setInFlight] = useState(null);
  const [refused, setRefused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [current, setCurrent] = useState(2);
  const [done, setDone] = useState(() => new Set());
  const [papers, setPapers] = useState({});
  const [paperState, setPaperState] = useState({});
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [step, setStep] = useState(0);
  const opener = useRef(null);

  const load = useCallback(() => fundBookletsApi.mine().then(
    (v) => { setView(v); setState('ready'); setRefused(false); setError(''); },
    (e) => {
      if (e?.status === 404) { setView(null); setState('none'); return; }
      reportError('SpinoutLabLpBooklet:mine', e);
      setError(messageOf(e, T.unreadable)); setState('unreadable');
    },
  ), []);
  useEffect(() => { load(); }, [load]);

  const open = () => {
    setOpening(true); setError('');
    fundBookletsApi.open().then(
      (v) => { setView(v); setState('ready'); },
      (e) => setError(messageOf(e, T.unreadable)),
    ).finally(() => setOpening(false));
  };

  // One PUT in flight; taps made meanwhile go together in the next.
  useEffect(() => {
    if (inFlight || !queued.length) return;
    const batch = answersOf(queued);
    setInFlight(batch); setQueued([]);
    fundBookletsApi.answer(batch).then(
      (v) => { setView(v); setNotice(''); setInFlight(null); },
      (e) => {
        setInFlight(null); setQueued([]);
        setNotice(messageOf(e, T.unreadable));
        if (e?.code === 'booklet_not_open') load();
      },
    );
  }, [queued, inFlight, load]);

  const toggle = (fieldId, checked) => setQueued((q) => queueTick(q, view, fieldId, checked));
  const shown = withQueued(view, [...(inFlight || []), ...queued]);

  const submit = () => {
    const digest = submitDigest(view, { queued, inFlight, refused });
    if (!digest) return;
    setSubmitting(true); setNotice('');
    fundBookletsApi.submit(digest).then(
      () => load(),
      (e) => { setRefused(true); setNotice(messageOf(e, T.unreadable)); load(); },
    ).finally(() => setSubmitting(false));
  };

  // The paper of the part on screen, drawn again when the view's digest changes.
  const steps = view ? phoneSteps(view) : [];
  const phoneStep = steps[step];
  const wanted = phone ? (phoneOpen && phoneStep?.kind === 'read' ? phoneStep.part : null) : current;
  const papersRef = useRef(papers);
  papersRef.current = papers;
  const drawPaper = useCallback((n) => {
    setPaperState((s) => ({ ...s, [n]: 'drawing' }));
    fundBookletsApi.paper({ part: n }).then(
      (r) => { setPapers((p) => ({ ...p, [n]: { html: r.html, digest: r.digest } })); setPaperState((s) => ({ ...s, [n]: null })); },
      (e) => { reportError('SpinoutLabLpBooklet:paper', e); setPaperState((s) => ({ ...s, [n]: 'failed' })); },
    );
  }, []);
  const digest = view?.digest;
  useEffect(() => {
    if (!wanted || !digest || papersRef.current[wanted]?.digest === digest) return;
    drawPaper(wanted);
  }, [wanted, digest, drawPaper]);
  const paperProps = wanted ? {
    paper: papers[wanted],
    drawing: paperState[wanted] === 'drawing',
    failed: paperState[wanted] === 'failed',
    onRetry: () => drawPaper(wanted),
  } : {};

  const pick = (n) => { setDone((d) => new Set(d).add(current)); setCurrent(n); };
  const toStep = (i) => {
    const from = steps[step];
    const to = steps[i];
    if (from?.part && to && to.part !== from.part && i > step) setDone((d) => new Set(d).add(from.part));
    if (i >= steps.length) return;
    setStep(i);
  };
  const openPhone = () => {
    const first = steps.findIndex((s) => s.kind === 'review' || !done.has(s.part));
    setStep(first < 0 ? 0 : first); setPhoneOpen(true);
  };
  const closePhone = useCallback(() => { setPhoneOpen(false); opener.current?.focus?.(); }, []);

  const submitProps = { enabled: canSubmit({ view, queued, inFlight, refused }), submitting, onSubmit: submit, notice };

  let content;
  if (state === 'loading') content = <p className={`text-[12.5px] ${MUTED}`}>{T.loading}</p>;
  else if (state === 'unreadable') {
    content = (
      <div className="flex items-center gap-3 text-[12.5px] text-red-700 dark:text-red-400">
        <span>{error || T.unreadable}</span>
        <button type="button" onClick={load} className={SECONDARY}>{T.retry}</button>
      </div>
    );
  } else if (state === 'none') {
    content = (
      <div className="space-y-3 text-[12.5px]">
        <p className="text-gray-700 dark:text-gray-300">{T.openLine}</p>
        {error && <p className="text-red-700 dark:text-red-400" role="alert">{error}</p>}
        <button type="button" onClick={open} disabled={opening} className={PRIMARY}>{T.openButton}</button>
      </div>
    );
  } else if (phone) {
    const c = tickCounts(shown);
    const submitted = shown.status === 'submitted';
    const missing = missingLine(shown.missing_parts);
    content = (
      <div className="space-y-2 text-[12.5px]">
        {notice && !phoneOpen && <p className="text-red-700 dark:text-red-400" role="alert">{notice}</p>}
        {submitted ? <SubmittedNote view={shown} /> : (
          <>
            <p className="text-gray-700 dark:text-gray-300">{c.total ? T.boxesTicked(c.ticked, c.total) : T.noBoxesYet}</p>
            {missing && <p className="text-amber-800 dark:text-amber-300">{missing}</p>}
          </>
        )}
        <button ref={opener} type="button" onClick={openPhone} className={PRIMARY}>{submitted ? T.readBooklet : T.continueBooklet}</button>
        {phoneOpen && (
          <BookletPhone view={shown} step={step} onStep={toStep} onClose={closePhone} onToggle={toggle} paperProps={paperProps} submit={submitProps} />
        )}
      </div>
    );
  } else {
    content = (
      <div className="space-y-3">
        {notice && <div className="text-[12.5px] text-red-700 dark:text-red-400" role="alert">{notice}</div>}
        <BookletDesktop view={shown} current={current} done={done} onPick={pick} onToggle={toggle} paperProps={paperProps} submit={submitProps} />
      </div>
    );
  }

  return (
    <section className={`${CARD} px-6 py-5`} data-testid="lp-subscription-booklet">
      <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{T.section}</h2>
      {content}
    </section>
  );
}

export default SubscriptionBooklet;
