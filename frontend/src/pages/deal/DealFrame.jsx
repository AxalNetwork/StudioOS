/**
 * D1152 (#3057) — the deal page's frame (DL1, DL2, DL19–DL22): the key strip,
 * the stage track with its one next action, the respond dialog, and the
 * states a deal page can be in. The words and the shapes come from
 * `dealFrameModel.js`; this file only draws them.
 *
 * ONE NEXT ACTION. The track draws the Worker's `next_action` once
 * (`deal-next-action`): a link for a step that opens another page, a button
 * for "I'm interested", which opens an in-page dialog saying what it tells
 * the founder. On a phone the track is a list and the next action sits fixed
 * at the foot (DL21a).
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionPrimary, actionGhost, usePhoneWidth } from '../../ui';
import { NO_PERMISSION, NOT_FOUND, DEAL_UNREADABLE } from './dealFrameModel';

export const CARD = 'rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
export const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-axal-sm px-3.5 text-[13px] font-bold whitespace-nowrap';
export const BTN_P = `${BTN} border border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:border-violet-400 dark:bg-violet-500`;
export const BTN_S = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

/** DL1's key strip: four tiles, a missing figure says so, a bar only when the share is known. */
export function KeyStrip({ tiles }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3.5" data-testid="deal-keys">
      {tiles.map((t) => (
        <div key={t.key} className={`${CARD} flex min-w-0 flex-col gap-1.5 px-3 py-3 md:px-4`} title={t.reason || ''} data-testid={`deal-key-${t.key}`}>
          <span className={EYE}>{t.label}</span>
          {t.loading
            ? <span aria-label="Reading" className="block h-5 w-2/3 rounded-axal-xs bg-axal-hairline dark:bg-gray-700" />
            : <span className={`${MONO} text-[16px] font-bold leading-snug md:text-[18px] ${t.missing ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`}>{t.value}</span>}
          {t.bar != null && (
            <span className="block h-1.5 w-full overflow-hidden rounded-axal-pill bg-axal-ground dark:bg-gray-800">
              <span className="block h-full rounded-axal-pill bg-axal-violet dark:bg-violet-400" style={{ width: `${t.bar}%` }} />
            </span>
          )}
          {t.sub && <span className={SUB}>{t.missing && t.reason ? t.reason : t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function StepDot({ kind }) {
  const cls = {
    done: 'bg-axal-violet dark:bg-violet-400',
    now: 'border-4 border-axal-violet bg-white dark:border-violet-400 dark:bg-gray-900',
    nr: 'border-[1.5px] border-dashed border-axal-muted bg-white dark:border-gray-500 dark:bg-gray-900',
    ahead: 'border-[1.5px] border-axal-muted bg-white dark:border-gray-500 dark:bg-gray-900',
  }[kind];
  return <span aria-hidden="true" className={`block h-4 w-4 flex-none rounded-full ${cls}`} />;
}

/** The one next action: a link, or "I'm interested" as a button that asks first. */
export function NextAction({ next, onRespond, wide = false }) {
  if (!next) return null;
  const cls = `${BTN_P}${wide ? ' w-full' : ''}`;
  if (next.kind === 'respond_interest') {
    return <button type="button" className={cls} onClick={() => onRespond?.('interested')} data-testid="deal-next-action">{next.label}</button>;
  }
  return <Link to={next.href} className={cls} data-testid="deal-next-action">{next.label}</Link>;
}

/**
 * DL2: the eight steps and the one next action. A failed stage read is
 * Unreadable with Try again and leaves the rest of the page standing.
 */
export function StageTrack({ track, onRetry, onRespond }) {
  const phone = usePhoneWidth();
  if (track.state === 'loading') {
    return <div className={`${CARD} px-4 py-3 ${SUB}`} data-testid="deal-track-loading">Reading your step on this deal…</div>;
  }
  if (track.state === 'unreadable') {
    return (
      <div data-testid="deal-track-unreadable">
        <Unreadable what="Your step on this deal" claim="That is not a claim that you have none." onRetry={onRetry} />
      </div>
    );
  }
  if (track.state === 'none') {
    return (
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3`} data-testid="deal-track-none">
        <span className={SUB}>{track.reason}</span>
        <NextAction next={track.next} onRespond={onRespond} />
      </div>
    );
  }
  return (
    <section className={`${CARD} flex flex-col gap-3 px-2 py-2 md:px-4 md:py-3.5`} aria-label="Your step on this deal" data-testid="deal-track">
      <ol className={`m-0 flex list-none p-0 ${phone ? 'flex-col gap-1' : 'gap-0'}`}>
        {track.steps.map((s) => (
          <li key={s.word} aria-label={s.label} title={s.kind === 'nr' ? track.icNote || 'Not recorded' : undefined} data-testid={`deal-step-${s.kind}`}
            className={phone
              ? `flex flex-wrap items-center gap-x-2.5 rounded-axal-md border px-2.5 py-2 ${s.kind === 'now' ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/40' : 'border-transparent'}`
              : 'flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center'}>
            <StepDot kind={s.kind} />
            <span className={`text-[12.5px] font-bold leading-tight ${s.kind === 'now' ? 'text-axal-violet-deep dark:text-violet-300' : s.kind === 'done' ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{s.word}</span>
            <span className={`${MONO} text-[11px] ${s.kind === 'now' ? 'text-axal-violet-deep dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>{s.line}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline px-2 pt-3 dark:border-gray-700">
        <p className={`m-0 ${SUB}`} data-testid="deal-track-why">{track.passed || `Step ${track.current + 1} of 8 · ${track.stage}`}{track.why ? ` · ${track.why}` : ''}</p>
        {!phone && <NextAction next={track.next} onRespond={onRespond} />}
      </div>
      {phone && track.next && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-axal-hairline bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900" data-testid="deal-next-bar">
          <NextAction next={track.next} onRespond={onRespond} wide />
        </div>
      )}
    </section>
  );
}

const RESPOND = {
  interested: { title: 'Tell the founder you’re interested?', line: 'The founder and the studio see that you’re interested. Your step moves to Reviewing.', act: 'I’m interested' },
  passed: { title: 'Pass on this deal?', line: 'The founder and the studio see that you passed. You keep read access to what you could already open.', act: 'Pass' },
};

/** The in-page dialog before an answer to an invitation is sent. */
export function RespondDialog({ answer, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const w = RESPOND[answer];
  if (!w) return null;
  const go = async () => {
    setBusy(true); setErr('');
    try { await onConfirm(answer); onClose(); } catch (e) { setErr(e?.message || 'That did not save. Try again.'); } finally { setBusy(false); }
  };
  return (
    <Lightbox label={w.title} title={w.title} sub={w.line} onClose={onClose} testId="deal-respond-dialog"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose}>Back</button>
          <button type="button" className={actionPrimary} disabled={busy} onClick={go} data-testid="deal-respond-confirm">{w.act}</button>
        </div>
      )}>
      {err && <p role="alert" className="mx-5 mt-4 text-[12.5px] text-axal-destructive dark:text-red-300">{err}</p>}
    </Lightbox>
  );
}

/** A centred card: DL22's refusals and the deal that is not here. */
function Centered({ glyph, title, line, children, testId }) {
  return (
    <section className={`${CARD} mx-auto mt-6 flex w-full max-w-[600px] flex-col items-center gap-3 px-7 py-9 text-center`} data-testid={testId}>
      <span aria-hidden="true" className="text-[22px] text-axal-muted dark:text-gray-400">{glyph}</span>
      <h2 className="m-0 text-[16px] font-extrabold leading-snug text-axal-ink dark:text-gray-100">{title}</h2>
      <p className={`m-0 ${SUB}`}>{line}</p>
      {children}
    </section>
  );
}

/** DL22: who cannot open a deal page, in the canvas's words. */
export function NoPermission({ kind }) {
  const w = NO_PERMISSION[kind];
  return (
    <Centered glyph="⊘" title={w.title} line={w.line} testId={`deal-no-permission-${kind}`}>
      <Link to={w.action.to} className={kind === 'advisor' ? BTN_S : BTN_P}>{w.action.text}</Link>
    </Centered>
  );
}

export function DealNotFound({ back }) {
  return (
    <Centered glyph="○" title={NOT_FOUND.title} line={NOT_FOUND.line} testId="deal-not-found">
      <Link to={back.path} className={BTN_S}>{back.label}</Link>
    </Centered>
  );
}

/** DL20b: the deal read failed. Never "not found". */
export function DealUnreadable({ onRetry }) {
  return (
    <div className="mx-auto mt-6 w-full max-w-[600px]" data-testid="deal-unreadable">
      <Unreadable what="This deal" claim={DEAL_UNREADABLE.replace('This deal could not be read. ', '')} onRetry={onRetry} />
    </div>
  );
}

/** DL19: the tabs draw at once; the key strip and the cards read. */
export function DealLoading({ tabs }) {
  return (
    <div className="flex flex-col gap-4" data-testid="deal-loading">
      <span aria-label="Reading" className="block h-7 w-1/3 rounded-axal-xs bg-axal-hairline dark:bg-gray-700" />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3.5">
        {['Round', 'Committed', 'Your commitment', 'Closes'].map((e) => (
          <div key={e} className={`${CARD} flex flex-col gap-1.5 px-4 py-3`}>
            <span className={EYE}>{e}</span>
            <span className="block h-5 w-2/3 rounded-axal-xs bg-axal-hairline dark:bg-gray-700" />
            <span className={SUB}>Reading…</span>
          </div>
        ))}
      </div>
      {tabs}
    </div>
  );
}
