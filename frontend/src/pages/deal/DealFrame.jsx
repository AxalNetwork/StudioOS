/**
 * D1152 (#3057) — the deal page's frame (DL1, DL2, DL19–DL22), redrawn to
 * board DE04 by D4815 part 4 (#5903): the header's chips (company stage, the
 * website, the investor's own progress), the one financial strip, the
 * investment progress sequence with its short reason, the eight tabs with a
 * second row where a tab holds more than one view, Your position, the
 * respond dialog, and the states a deal page can be in. The words and the
 * shapes come from `dealFrameModel.js` and `../dealPageModel.js`; this file
 * only draws them.
 *
 * ONE NEXT ACTION. The Worker's `next_action` is drawn once
 * (`deal-next-action`): in the header on a desktop, fixed at the foot on a
 * phone (DE15). A link for a step that opens another page, a button for
 * "I'm interested", which opens an in-page dialog saying what it tells the
 * founder. The sequence itself draws no action.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, ExternalLink, Globe } from 'lucide-react';
import { Lightbox, Unreadable, actionPrimary, actionGhost, usePhoneWidth } from '../../ui';
import { HeaderMenuItem, MoreMenu } from '../../ui/AdminPageHeader';
import { NO_PERMISSION, NOT_FOUND, DEAL_UNREADABLE, ROUTE_NOT_RECORDED, progressChip } from './dealFrameModel';
import { dealGroupsFor, dealViewsIn, groupHref, groupOf, tabHref } from '../dealPageModel';

export const CARD = 'rounded-axal-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
export const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-axal-sm px-3.5 text-[13px] font-bold whitespace-nowrap';
export const BTN_P = `${BTN} border border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:border-violet-400 dark:bg-violet-500 dark:hover:bg-violet-400`;
export const BTN_S = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

/** DE04's chip for each status family: the company's stage, and my investment process. */
const CHIP = 'inline-flex min-h-[24px] items-center gap-1 rounded-axal-pill border px-2.5 py-0.5 text-[11.5px] font-bold';
const CHIP_CO = `${CHIP} border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100`;
const CHIP_ME = `${CHIP} border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const CHIP_MUTED = `${CHIP} border-dashed border-axal-hairline bg-white text-axal-muted dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400`;

/** The company-stage chip: its value, or Not recorded with why on hover. */
export function CompanyStageChip({ stage }) {
  return (
    <span className={stage.missing ? CHIP_MUTED : CHIP_CO} title={stage.missing ? `Company stage: ${stage.reason}` : 'Company stage'} data-testid="deal-company-stage">
      {stage.missing ? `Company stage · ${stage.value}` : stage.value}
    </span>
  );
}

/** The website icon: a link out when the deal records an http(s) address, otherwise said. */
export function WebsiteIcon({ href }) {
  const box = 'inline-flex h-11 w-11 flex-none items-center justify-center rounded-axal-sm border md:h-8 md:w-8';
  if (!href) {
    return (
      <span className={`${box} border-dashed border-axal-hairline text-axal-muted dark:border-gray-600 dark:text-gray-500`} role="img" aria-label="Company website: Not recorded" title="Company website: Not recorded" data-testid="deal-website-none">
        <Globe size={14} aria-hidden="true" />
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Company website" title="Company website" data-testid="deal-website"
      className={`${box} border-axal-hairline text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800`}>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

/** The investor's progress, its own element ("Diligence · Step 3 of 8"). */
export function ProgressChip({ track }) {
  const c = progressChip(track);
  return (
    <span className={c.state === 'ready' ? CHIP_ME : CHIP_MUTED} title="My investment process" data-testid="deal-progress-chip" data-state={c.state}>
      {c.text}
    </span>
  );
}

/**
 * DE04's one financial strip: Round, Instrument, Committed, Minimum, Closes.
 * Not recorded and Unreadable each say so in words, with why on hover.
 */
export function FinancialStrip({ cells }) {
  return (
    <dl className={`${CARD} m-0 grid grid-cols-2 overflow-hidden md:grid-cols-5`} data-testid="deal-strip">
      {cells.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col gap-0.5 border-b border-r border-axal-hairline px-3 py-2.5 md:border-b-0 md:px-4 dark:border-gray-700" title={c.reason || undefined} data-testid={`deal-strip-${c.key}`} data-state={c.state}>
          <dt className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{c.label}</dt>
          <dd className={`m-0 ${MONO} ${c.state === 'value' ? 'text-[17px] font-bold text-axal-ink md:text-[18px] dark:text-gray-100' : c.state === 'ur' ? 'text-[13px] font-bold text-axal-destructive dark:text-red-300' : 'text-[13px] font-semibold italic text-axal-muted dark:text-gray-400'}`}>{c.value}</dd>
          {c.sub && <span className="text-[11px] text-axal-muted dark:text-gray-400">{c.sub}</span>}
        </div>
      ))}
    </dl>
  );
}

/**
 * The eight tabs (DE04), and a second row of links where the tab on screen
 * holds more than one view for this role. Each view keeps its own address.
 */
export function DealTabs({ dealId, role, tab }) {
  const groups = dealGroupsFor(role);
  const current = groupOf(tab);
  const views = dealViewsIn(current, role);
  const link = (on) => `-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3.5 text-[13.5px] md:min-h-[38px] ${on ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-200'}`;
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Deal" className="flex gap-0.5 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="deal-tabs">
        {groups.map((g) => (
          <Link key={g.id} to={groupHref(dealId, g.id)} aria-current={current === g.id ? 'page' : undefined} data-testid={`deal-tab-${g.id}`} className={link(current === g.id)}>
            {g.label}
          </Link>
        ))}
      </nav>
      {views.length > 0 && (
        <nav aria-label={`${groups.find((g) => g.id === current)?.label || 'Deal'} views`} className="flex flex-wrap gap-1.5" data-testid="deal-subtabs">
          {views.map((v) => (
            <Link key={v.id} to={tabHref(dealId, v.id)} aria-current={tab === v.id ? 'page' : undefined} data-testid={`deal-subtab-${v.id}`}
              className={`inline-flex min-h-[44px] items-center rounded-axal-pill border px-3 text-[12.5px] font-bold md:min-h-[30px] ${tab === v.id ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}>
              {v.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/** Sharing actions for the authorized deal header. */
export function DealMoreActions({ profileUrl }) {
  const { key } = useLocation();
  const [feedback, setFeedback] = useState(null);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setFeedback({ key, text: 'Link copied.' });
    } catch {
      setFeedback({ key, text: 'Could not copy the link. Copy it from the address bar.' });
    }
  };

  return (
    <div className="relative">
      <MoreMenu className="" testId="deal-more">
        {profileUrl && <HeaderMenuItem to={profileUrl} data-testid="deal-open-company-profile">Open company profile</HeaderMenuItem>}
        <HeaderMenuItem onSelect={copyLink} data-testid="deal-copy-link">Copy link</HeaderMenuItem>
      </MoreMenu>
      <span role="status" className={`absolute right-0 top-full z-20 mt-1 w-max max-w-56 rounded-axal-sm bg-white text-[12px] text-axal-ink dark:bg-gray-900 dark:text-gray-100 ${feedback?.key === key ? 'border border-axal-hairline px-2 py-1 dark:border-gray-700' : 'sr-only'}`}>
        {feedback?.key === key ? feedback.text : ''}
      </span>
    </div>
  );
}

/** The one next action: a link, or "I'm interested" as a button that asks first. */
export function NextAction({ next, onRespond, wide = false }) {
  if (!next) return null;
  const cls = `${BTN_P}${wide ? ' w-full min-h-[48px]' : ''}`;
  if (next.kind === 'respond_interest') {
    return <button type="button" className={cls} onClick={() => onRespond?.('interested')} data-testid="deal-next-action">{next.label}</button>;
  }
  return <Link to={next.href} className={cls} data-testid="deal-next-action">{next.label}</Link>;
}

/** The step's chip in DE04's sequence: done quiet with a tick, the current one highlighted, ahead muted. */
const STEP_CHIP = {
  done: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
  now: 'border-axal-violet bg-axal-lavender font-extrabold text-axal-violet-deep dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-300',
  nr: 'border-dashed border-axal-muted bg-white text-axal-muted dark:border-gray-500 dark:bg-gray-900 dark:text-gray-400',
  ahead: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-500',
};

/**
 * DE04's investment progress: the eight steps from the stage read, the
 * current one highlighted, and a short reason under them. The one next
 * action is the header's (desktop) or the foot bar's (phone, DE15); this
 * section draws no second one. A failed stage read is Unreadable with Try
 * again and leaves the rest of the page standing.
 */
export function StageTrack({ track, onRetry, onRespond }) {
  const phone = usePhoneWidth();
  const bar = phone && (track.state === 'ready' || track.state === 'none') && track.next && (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-axal-hairline bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900" data-testid="deal-next-bar">
      <NextAction next={track.next} onRespond={onRespond} wide />
    </div>
  );
  const head = <h2 className={H3}>Investment progress</h2>;
  if (track.state === 'loading') {
    return <section className={`${CARD} flex flex-col gap-2 px-4 py-3.5`} aria-label="Investment progress" data-testid="deal-track-loading">{head}<p className={`m-0 ${SUB}`}>Reading your step on this deal…</p></section>;
  }
  if (track.state === 'unreadable') {
    return (
      <section className={`${CARD} flex flex-col gap-2 px-4 py-3.5`} aria-label="Investment progress" data-testid="deal-track-unreadable">
        {head}
        <Unreadable what="Your step on this deal" claim="That is not a claim that you have none." onRetry={onRetry} />
      </section>
    );
  }
  if (track.state === 'none') {
    return (
      <section className={`${CARD} flex flex-col gap-2 px-4 py-3.5`} aria-label="Investment progress" data-testid="deal-track-none">
        {head}
        <p className={`m-0 ${SUB}`} data-testid="deal-track-why">{track.reason}</p>
        {bar}
      </section>
    );
  }
  return (
    <section className={`${CARD} flex flex-col gap-3 px-4 py-3.5`} aria-label="Investment progress" data-testid="deal-track">
      {head}
      <ol className={`m-0 flex list-none gap-1.5 p-0 ${phone ? 'flex-col' : 'flex-wrap'}`}>
        {track.steps.map((s) => (
          <li key={s.word} aria-label={s.label} aria-current={s.kind === 'now' ? 'step' : undefined} title={s.kind === 'nr' ? track.icNote || 'Not recorded' : undefined} data-testid={`deal-step-${s.kind}`}
            className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-axal-pill border px-3 text-[12.5px] font-bold ${phone ? 'min-h-[44px] w-full' : ''} ${STEP_CHIP[s.kind]}`}>
            {s.kind === 'done' && <Check size={12} aria-hidden="true" />}
            <span>{s.word}</span>
            {s.kind === 'nr' && <span className="font-semibold italic">· Not recorded</span>}
          </li>
        ))}
      </ol>
      <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100" data-testid="deal-track-why">{track.why || (track.passed ? track.passed : '')}</p>
      {bar}
    </section>
  );
}

/**
 * Your position (DE04): the viewer's own live commitment in the firm the
 * page reads for, its status and whom it is held for, with the door to
 * Investment. Never another investor's or another firm's.
 */
export function YourPosition({ position, dealId, onRetry }) {
  return (
    <section className={`${CARD} flex h-full flex-col gap-2 px-4 py-3.5`} aria-label="Your position" data-testid="deal-position">
      <h2 className={H3}>Your position</h2>
      {position.state === 'loading' && <p className={`m-0 ${SUB}`}>Reading your commitment…</p>}
      {position.state === 'unreadable' && <Unreadable what="Your commitment" claim="That is not a claim that you have none." onRetry={onRetry} />}
      {position.state === 'none' && <p className={`m-0 ${SUB}`} data-testid="deal-position-none">You have not committed to this deal in the firm you are working in.</p>}
      {position.state === 'ready' && (
        <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-axal-muted dark:text-gray-400">Your commitment</dt>
          <dd className={`m-0 ${MONO} font-bold text-axal-ink dark:text-gray-100`} data-testid="deal-position-amount">{position.amount} · {position.status}</dd>
          <dt className="text-axal-muted dark:text-gray-400">Firm</dt>
          <dd className="m-0 text-axal-ink dark:text-gray-100" data-testid="deal-position-firm">{position.firm}</dd>
          <dt className="text-axal-muted dark:text-gray-400">Route</dt>
          {/* D4815 part 41 (#5904): DE04 draws a route ("Direct"); the commitments read carries none. */}
          <dd className="m-0 text-axal-muted dark:text-gray-400" title={ROUTE_NOT_RECORDED} data-testid="deal-position-route">Not recorded</dd>
        </dl>
      )}
      <Link to={groupHref(dealId, 'investment')} className={`${BTN_S} w-fit`} data-testid="deal-position-open">Open investment</Link>
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

/** DL19: the tabs draw at once; the header and the strip are skeletons in their own shape. */
export function DealLoading({ tabs }) {
  return (
    <div className="flex flex-col gap-4" data-testid="deal-loading">
      <span aria-label="Reading" className="block h-7 w-1/3 rounded-axal-xs bg-axal-hairline dark:bg-gray-700" />
      <div className={`${CARD} grid grid-cols-2 overflow-hidden md:grid-cols-5`}>
        {['Round', 'Instrument', 'Committed', 'Minimum', 'Closes'].map((e) => (
          <div key={e} className="flex flex-col gap-1.5 border-b border-r border-axal-hairline px-4 py-2.5 md:border-b-0 dark:border-gray-700">
            <span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{e}</span>
            <span className="block h-5 w-2/3 rounded-axal-xs bg-axal-hairline dark:bg-gray-700" />
          </div>
        ))}
      </div>
      {tabs}
    </div>
  );
}
