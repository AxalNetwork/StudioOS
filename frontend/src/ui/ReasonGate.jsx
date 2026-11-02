import React, { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, List, Lock, TriangleAlert, User } from 'lucide-react';
import { reportError } from '../lib/log';
import Lightbox from './Lightbox';
import {
  END_ACCESS, END_BODY, END_FAILED, END_TITLE, EVERY_OPEN, FIELD_LABEL, FOUNDER_SEES, OPEN_LABEL, OPENING, PLACEHOLDER,
  PREVIEW_LINE, REASON_CHIPS, accessWord, bannerLine, countdown, gateQuestion, reasonCheck, refusalView, ruleLine,
} from './reasonGate';

/**
 * D1463 (#3713, boards RR00–RR22): the one gate an admin meets before reading
 * a founder's private record, and the banner that heads the record while the
 * read lasts. Words and rules: `ui/reasonGate.js`.
 *
 *   ReasonGate    the card: the venture, the record and its access pill, the
 *                 question, who sees it and the record's own duration rule,
 *                 the quick picks, the field and its counter, Open read only.
 *                 `inline` is the compact form inside a dialog (RR13): no
 *                 venture header and no preview.
 *   AccessBanner  amber, above the record: the reason, the countdown for a
 *                 grant (each minute; at zero `onExpire`) and End access now
 *                 when the record can end a read early (`onEnd`).
 *
 * Nothing of the record is drawn before the reason: `preview` is a skeleton,
 * never the record's data. A refusal no button can clear draws no form and no
 * Try again (RR17, RR18).
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PRIMARY = 'inline-flex min-h-[40px] items-center justify-center rounded-[9px] border border-axal-hairline bg-axal-ground px-4 py-2 text-[13px] font-bold text-axal-ink enabled:border-axal-violet enabled:bg-axal-violet enabled:text-white enabled:hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:enabled:bg-violet-600 dark:enabled:hover:bg-violet-700';
const GHOST = 'inline-flex min-h-[40px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[13px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const CHIP = 'min-h-[36px] rounded-full border border-violet-200 bg-white px-3 py-1 text-[12.5px] text-axal-ink hover:bg-axal-lavender aria-pressed:border-axal-violet aria-pressed:bg-axal-lavender dark:border-violet-900 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-violet-950/40 dark:aria-pressed:bg-violet-950/40';
const FIELD = 'min-h-[76px] w-full resize-y rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13.5px] text-axal-ink focus:border-axal-violet focus:outline-none read-only:bg-axal-ground dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:read-only:bg-gray-800';
export const ACCESS_PILL = 'inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200';

/** "Read only · HQ access" — beside the page title and in the gate's header. */
export function AccessPill({ viewer, testId = 'reason-access-pill' }) {
  const word = accessWord(viewer);
  return (
    <span className={ACCESS_PILL} data-testid={testId}>
      <Lock size={12} aria-hidden="true" />
      {word ? `Read only · ${word} access` : 'Read only'}
    </span>
  );
}

function VentureHead({ venture, record, viewer }) {
  const name = venture?.name || null;
  const initials = name ? name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-axal-hairline pb-4 dark:border-gray-800" data-testid="reason-gate-venture">
      <div className="flex min-w-0 items-center gap-3">
        {venture?.logo_url
          ? <img src={venture.logo_url} alt="" width="40" height="40" className="h-10 w-10 flex-none rounded-[10px] object-cover" />
          : <span aria-hidden="true" className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-axal-lavender text-[13px] font-extrabold text-axal-violet dark:bg-violet-950/50 dark:text-violet-300">{initials || '·'}</span>}
        <div className="flex min-w-0 flex-col">
          <span className={`truncate text-[15px] font-extrabold ${INK}`}>{name || 'This venture'}</span>
          {/* G2: a founder line only when the Worker names exactly one founder; never a guess. */}
          {venture?.founder_name ? <span className={`text-[12.5px] ${MUTED}`} data-testid="reason-gate-founder">Founder: {venture.founder_name}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[13px] font-bold ${INK}`}>{record}</span>
        <AccessPill viewer={viewer} />
      </div>
    </div>
  );
}

/**
 * The reason gate.
 *   record     the record's name ("Investor narrative")
 *   what       "this narrative" — the question's object
 *   venture    `{ name, logo_url?, founder_name? }` (G2), or `{ name }` from the projects list
 *   viewer     'admin' | 'super_admin' — the access pill
 *   rule       `{ kind: 'grant', hours }` | `{ kind: 'per_open' }`
 *   min, max   the record's Worker limits; `short` its own too-short sentence
 *   chips      the quick picks (Q5 A); [] for none
 *   onSubmit   (reason) → Promise; a rejection draws `refusalView`
 *   back       `{ to, label }` — "Back to <venture>"
 *   onCancel   the inline form's Cancel
 *   preview    a skeleton under the card, never record data
 *   notice     a line above the card (RR06: "Your 8-hour read ended at …")
 *   inline     the compact form (RR13)
 */
export default function ReasonGate({
  record, what, venture = null, viewer = null, rule, min = 1, max = 500, short = null, chips = REASON_CHIPS,
  onSubmit, back = null, onCancel = null, preview = null, notice = null, inline = false, submitLabel = OPEN_LABEL,
  testId = 'reason-gate',
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const fieldId = `${useId()}-reason`;
  const hintId = `${fieldId}-hint`;
  const check = reasonCheck(text, { min, max, short });
  const rules = ruleLine(rule);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!check.ok || busy) return;
    setBusy(true); setRefused(null);
    try {
      await onSubmit(text.replace(/\s+/g, ' ').trim());
    } catch (err) {
      reportError(`ReasonGate:${record}`, err);
      setRefused(refusalView(err));
    } finally { setBusy(false); }
  };

  // RR17, RR18: a refusal no button can clear — no form, no Try again.
  if (refused && !refused.retry) {
    return (
      <section className={`${CARD} mx-auto flex w-full max-w-[720px] flex-col gap-3 p-6`} data-testid={`${testId}-refused`} data-kind={refused.kind}>
        <p className={`m-0 text-[13.5px] ${refused.kind === 'owner' ? MUTED : INK}`}>{refused.message}</p>
        {back ? <Link className={`w-fit text-[13px] font-bold ${INK} hover:underline`} to={back.to}>{back.label}</Link> : null}
      </section>
    );
  }

  const line = check.message
    ? <span id={hintId} className={`text-[12px] ${check.tone === 'error' ? 'font-semibold text-axal-destructive dark:text-red-400' : MUTED}`} data-testid={`${testId}-hint`} data-tone={check.tone}>{check.message}</span>
    : <span />;

  const form = (
    <form onSubmit={submit} className={inline ? 'flex flex-col gap-3' : `${CARD} flex w-full flex-col gap-4 p-6`} data-testid={testId} data-rule={rule?.kind || ''}>
      {!inline ? <VentureHead venture={venture} record={record} viewer={viewer} /> : null}
      <h2 className={`m-0 text-[19px] font-extrabold tracking-[-.015em] ${INK}`}>{gateQuestion(what)}</h2>
      <ul className={`m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] ${INK}`}>
        <li className="flex items-center gap-2"><User size={13} aria-hidden="true" className={MUTED} />{FOUNDER_SEES}</li>
        {rules ? <li className="flex items-center gap-2" data-testid={`${testId}-rule`}><Clock size={13} aria-hidden="true" className={MUTED} />{rules}</li> : null}
        <li className="flex items-center gap-2"><List size={13} aria-hidden="true" className={MUTED} />{EVERY_OPEN}</li>
      </ul>
      {chips.length ? (
        <div className="flex flex-col gap-2">
          <span className={EYEBROW}>Quick picks</span>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button key={c} type="button" className={CHIP} aria-pressed={text === c} disabled={busy}
                onClick={() => { setText(c); setRefused(null); }} data-testid={`${testId}-chip`}>{c}</button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className={`text-[12.5px] font-bold ${INK}`}>{FIELD_LABEL}</label>
        <textarea id={fieldId} className={FIELD} value={text} placeholder={PLACEHOLDER} readOnly={busy}
          aria-describedby={check.message || refused ? hintId : undefined} aria-invalid={check.tone === 'error' || refused ? 'true' : undefined}
          onChange={(e) => { setText(e.target.value); setRefused(null); }} data-testid={`${testId}-input`} />
        <div className="flex items-start justify-between gap-3">
          {refused
            ? <span id={hintId} role="alert" className="text-[12px] font-semibold text-axal-destructive dark:text-red-400" data-testid={`${testId}-refusal`}>{refused.message}</span>
            : line}
          <span className={`flex-none font-mono text-[11.5px] ${check.tone === 'error' ? 'text-axal-destructive dark:text-red-400' : MUTED}`} data-testid={`${testId}-count`}>{check.count} / {max}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARY} disabled={!check.ok || busy} data-testid={`${testId}-open`}>{busy ? OPENING : submitLabel}</button>
        {onCancel ? <button type="button" className={GHOST} onClick={onCancel} disabled={busy} data-testid={`${testId}-cancel`}>Cancel</button> : null}
        {!inline && back ? <Link className={`text-[13px] font-bold ${INK} hover:underline`} to={back.to} data-testid={`${testId}-back`}>{back.label}</Link> : null}
      </div>
    </form>
  );

  if (inline) return form;
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3" data-testid={`${testId}-page`}>
      {notice ? <p className="m-0 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400" role="status" data-testid={`${testId}-notice`}>{notice}</p> : null}
      {form}
      {preview ? (
        <>
          <p className={`m-0 text-center text-[12.5px] ${MUTED}`}>{PREVIEW_LINE}</p>
          <div aria-hidden="true" inert="" className="pointer-events-none select-none opacity-60 blur-[1.5px]" data-testid={`${testId}-preview`}>{preview}</div>
        </>
      ) : null}
    </div>
  );
}

/** A skeleton of a record: grey bars only, never the record's data. */
export function RecordSkeleton({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className={`${CARD} flex flex-col gap-2 p-4`}>{Array.from({ length: rows + 2 }, (_, i) => <span key={i} className="h-2.5 rounded bg-axal-ground dark:bg-gray-800" style={{ width: `${90 - i * 9}%` }} />)}</div>
        <div className={`${CARD} flex flex-col gap-2 p-4`}><span className="h-2.5 w-1/2 rounded bg-axal-ground dark:bg-gray-800" /><span className="h-8 rounded bg-axal-ground dark:bg-gray-800" /><span className="h-8 rounded bg-axal-ground dark:bg-gray-800" /></div>
      </div>
    </div>
  );
}

/** Re-renders each minute, so a countdown moves without the page asking. */
function useMinuteClock(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The amber banner above the record while the read lasts (RR04).
 *   reason   the reason given
 *   viewer   'admin' | 'super_admin'
 *   endsAt   a grant's end (`mine.expires_at`); omitted for a per-open read
 *   onExpire called once when the countdown reaches zero (the page re-reads, the gate returns: RR06)
 *   onEnd    () → Promise, End access now (G1); omitted where the record cannot end a read early
 *   now      a fixed clock (tests)
 */
export function AccessBanner({ reason, viewer, endsAt = null, onExpire, onEnd = null, now: fixed = null, testId = 'access-banner' }) {
  const ticking = Boolean(endsAt) && fixed == null;
  const now = useMinuteClock(ticking);
  const left = endsAt ? countdown(endsAt, fixed ?? now) : null;
  const [confirm, setConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [failed, setFailed] = useState(false);
  const over = Boolean(left?.over);
  useEffect(() => { if (over) onExpire?.(); }, [over, onExpire]);

  const end = async () => {
    setEnding(true); setFailed(false);
    try { await onEnd(); setConfirm(false); } catch (e) { reportError('AccessBanner:end', e); setConfirm(false); setFailed(true); } finally { setEnding(false); }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex flex-col gap-2 rounded-xl bg-amber-300 px-4 py-3 text-amber-950 dark:bg-amber-400 dark:text-amber-950" role="status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-bold">
            <Lock size={13} aria-hidden="true" />
            <span data-testid={`${testId}-line`}>
              {bannerLine({ access: accessWord(viewer), reason })}
              {left && !left.over ? <> · ends in <span className="font-mono" data-testid={`${testId}-left`} data-last={left.lastMinute ? 'true' : 'false'}>{left.text}</span></> : null}
            </span>
          </span>
          {onEnd ? <button type="button" className="min-h-[32px] text-[13px] font-bold underline underline-offset-2" onClick={() => setConfirm(true)} data-testid={`${testId}-end`}>{END_ACCESS}</button> : null}
        </div>
        {failed ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-gray-900" role="alert" data-testid={`${testId}-end-failed`}>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-axal-destructive dark:text-red-400"><TriangleAlert size={13} aria-hidden="true" />{END_FAILED}</span>
            <button type="button" className={GHOST} onClick={end} disabled={ending}>Try again</button>
          </div>
        ) : null}
      </div>
      {confirm ? (
        <Lightbox label={END_TITLE} title={END_TITLE} width={440} onClose={() => !ending && setConfirm(false)} testId={`${testId}-confirm`}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(false)} disabled={ending}>Cancel</button>
              <button type="button" className="inline-flex min-h-[40px] items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[13px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 dark:bg-violet-600 dark:hover:bg-violet-700" onClick={end} disabled={ending} data-testid={`${testId}-end-confirm`}>{ending ? 'Ending…' : 'End access'}</button>
            </div>
          )}>
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{END_BODY}</p>
        </Lightbox>
      ) : null}
    </div>
  );
}
