import React from 'react';
import { Lock } from 'lucide-react';
import {
  AMBER, CARD, Card, Chip, Done, EYE, Failed, H2, INPUT, LINK, Pill, Refusal, SUB, TD, TH,
} from '../partners/parts';
import {
  GRANT_GLYPH, NONE_CLAIM, PLAYBOOK_ADMIN_FOOT, PLAYBOOK_SUPER_LINE, READING, SET_BY_HQ, STATUS_PILL,
} from './programsModel';

/**
 * D953 (#2371) — the pieces every Programs page draws with. The card, pills,
 * chips, result line and refusal line are Partner invitations' (D923), so the
 * admin pages read as one family; this file adds the read states D953 §2
 * asks for: a skeleton with "Reading…", Unreadable with "That is not the
 * same as none." and Try again, and a placeholder whose reason is a visible
 * line, never only a `title=`.
 */

export { AMBER, CARD, Card, Chip, Done, EYE, H2, INPUT, LINK, Pill, Refusal, SUB, TD, TH };

const SKELETON_WIDTHS = ['w-[92%]', 'w-[74%]', 'w-[86%]', 'w-[60%]', 'w-[70%]'];

/** A block whose read has not answered: its own shape, with "Reading…". */
export function Skeleton({ lines = 3, testId }) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span>
      {SKELETON_WIDTHS.slice(0, lines).map((w) => (
        <span key={w} aria-hidden="true" className={`block h-3 rounded-md bg-axal-hairline dark:bg-gray-800 ${w}`} />
      ))}
    </div>
  );
}

/** A read that failed: what could not be read, "That is not the same as none.", and Try again. */
export function BlockFailed({ what, onRetry, testId, claim = NONE_CLAIM }) {
  return <Failed what={what} claim={claim} onRetry={onRetry} testId={testId} />;
}

/** "Not recorded" or "Not read here yet", with its reason drawn as a line. */
export function Unread({ word, reason, testId }) {
  return (
    <span className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="text-[13px] font-bold italic text-axal-muted dark:text-gray-400">{word}</span>
      {reason ? <span className={SUB}>{reason}</span> : null}
    </span>
  );
}

/**
 * A tile in one of its four states: `loading`, `ready` (a value, with its
 * sub line, an amber Overdue and what a capped figure covers), `unreadable`
 * and `placeholder` (a word with its reason line).
 */
export function Tile({ t, onRetry }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`programs-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' ? (
        <>
          <span aria-hidden="true" className="block h-6 w-3/5 rounded-md bg-axal-hairline dark:bg-gray-800" />
          <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span>
        </>
      ) : null}
      {t.state === 'ready' ? (
        <span className={`font-mono text-[24px] font-medium tracking-[-.02em] ${t.amber ? AMBER : 'text-axal-ink dark:text-gray-100'}`} data-testid={`programs-tile-${t.key}-value`}>{t.value}</span>
      ) : null}
      {t.state === 'ready' && t.sub ? <span className={SUB}>{t.sub}</span> : null}
      {t.state === 'ready' && t.overdue ? (
        <span className="self-start"><Pill tone="amber" testId={`programs-tile-${t.key}-overdue`}><span aria-hidden="true">!</span>Overdue</Pill></span>
      ) : null}
      {t.state === 'ready' && t.cover ? <span className={SUB}>{t.cover}</span> : null}
      {t.state === 'unreadable' ? (
        <>
          <span role="alert" className="text-[15px] font-bold leading-snug text-red-700 dark:text-red-300">Could not be read</span>
          <span className={SUB}>{t.reason || NONE_CLAIM}</span>
          {onRetry ? <button type="button" onClick={onRetry} className="self-start text-[12px] font-semibold text-red-700 underline dark:text-red-300">Try again</button> : null}
        </>
      ) : null}
      {t.state === 'placeholder' ? <Unread word={t.word} reason={t.reason} /> : null}
      {t.extra ? <span className={SUB}>{t.extra}</span> : null}
    </div>
  );
}

/** A program's status in the canvas's words and tone. */
export function StatusPill({ status, testId }) {
  const s = STATUS_PILL[status] || { glyph: '–', tone: 'muted' };
  return <Pill tone={s.tone} testId={testId}><span aria-hidden="true">{s.glyph}</span>{status}</Pill>;
}

/** The grant badge, in the canvas's held mode (S-HELD). */
export function GrantBadge({ grant, testId }) {
  return <Pill tone="muted" testId={testId}><span aria-hidden="true">{GRANT_GLYPH[grant] || '–'}</span>{grant}</Pill>;
}

/** The moved notice under the title: `role="status"`, lavender, with Dismiss and Insights' dark pair. */
export function MovedNotice({ text, onDismiss, testId = 'programs-moved' }) {
  if (!text) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid={testId}>
      <span>{text}</span>
      <button type="button" className="font-bold text-axal-violet underline dark:text-violet-300" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/**
 * How it runs: the frontend constant's text, one card per section (S-RUN).
 * For an Admin each section carries a lock and "Set by HQ", and the foot
 * reads "HQ writes the playbook."; a Super Admin reads "Editing arrives with
 * the playbook store." where Edit would be. `fill` draws a section a read or
 * a link fills.
 */
export function HowItRuns({ sections, superAdmin, fill = () => null, testId = 'programs-how' }) {
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {superAdmin ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-super`}>{PLAYBOOK_SUPER_LINE}</p> : null}
      {sections.map((s, i) => (
        <section key={s.title} className={`${CARD} flex min-w-0 flex-col gap-2 px-[18px] py-4`} data-testid={`${testId}-${i}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={H2}>{s.title}</h2>
            {!superAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <Lock size={11} aria-hidden="true" />{SET_BY_HQ}
              </span>
            ) : null}
          </div>
          {s.lines ? s.lines.map((l) => <p key={l} className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">{l}</p>) : null}
          {s.rows ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {s.rows.map(([t, who]) => (
                <li key={t} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700">
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{t}</span>
                  <span className="text-[12.5px] font-semibold text-axal-muted dark:text-gray-400">{who}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {s.kind ? fill(s.kind) : null}
        </section>
      ))}
      {!superAdmin ? <p className={`m-0 ${SUB}`} data-testid={`${testId}-foot`}>{PLAYBOOK_ADMIN_FOOT}</p> : null}
    </div>
  );
}
