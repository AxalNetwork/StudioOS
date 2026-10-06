import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, GraduationCap } from 'lucide-react';
import { Card, EmptyState, SectionLabel, Skeleton, Unrecorded, Unreadable } from '../../ui';
import { COMING_SOON_LINE } from './learningAccess';
import { NOT_LIVE_LINE } from './learningModel';

/**
 * The pieces every Learning screen shares (D562): its frame, its header, and
 * the four states each surface draws — loading, empty, "Not recorded" and
 * "Unreadable" — plus the coming-soon card a gated profile sees.
 *
 * "NOT RECORDED" AND "UNREADABLE" STAY TWO THINGS (`ui/Honesty.jsx`). A store
 * that does not exist yet is not recorded: the course catalogue, until #1158
 * merges. A read that failed is unreadable, and is never drawn as empty.
 */

/** The canvas's header: an optional way back, the title, one line under it, one action. */
export function LearningHeader({ eyebrow = 'Learning', title, sub, back, action }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="mb-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300"
            data-testid="link-learning-back"
          >
            <ChevronLeft size={14} aria-hidden="true" /> {back.label}
          </Link>
        )}
        {eyebrow && <SectionLabel tone="faint">{eyebrow}</SectionLabel>}
        <h1 className={`${eyebrow ? 'mt-1 ' : ''}text-xl font-extrabold tracking-tight text-axal-ink dark:text-white sm:text-2xl`}>{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** A titled card, the zone every Learning section sits in. */
export function SectionCard({ title, meta, children, testid, className = '' }) {
  return (
    <Card data-testid={testid} className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</h2>
        {meta && <span className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500">{meta}</span>}
      </div>
      {children}
    </Card>
  );
}

/** Loading: the layout's own shape, never the word alone. */
export function LearningLoading({ rows = 3, what = 'this list' }) {
  return (
    <div role="status" aria-busy="true" className="space-y-2.5" data-testid="learning-loading">
      <span className="sr-only">Reading {what}…</span>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={14} w={`${92 - i * 13}%`} />)}
    </div>
  );
}

/** Not recorded: the store this surface needs does not exist yet. One plain line. */
export function NotLiveYet({ line = NOT_LIVE_LINE, testid = 'learning-not-live' }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid={testid}>
      <Unrecorded reason={line} />
      <span className="block">{line}</span>
    </p>
  );
}

/** Unreadable: the read failed, which is not a claim that nothing is there. */
export function LearningUnreadable({ what, claim, onRetry }) {
  return (
    <div data-testid="learning-unreadable">
      <Unreadable what={what} claim={claim} onRetry={onRetry} />
    </div>
  );
}

/** Empty: the store answered and holds nothing for this. */
export function LearningEmpty({ title, body, cta }) {
  return <EmptyState size="sm" title={title} body={body} cta={cta} data-testid="learning-empty" />;
}

/**
 * The one card a gated profile sees wherever Learning is closed to them
 * (`learningAccess.js`: temporary, owner's request of 2026-10-06).
 */
export function ComingSoonCard({ articlesLink = true, testid = 'learning-coming-soon' }) {
  return (
    <Card variant="accent" padding="lg" data-testid={testid}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white text-axal-violet dark:bg-violet-900/40 dark:text-violet-300">
          <GraduationCap size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Coming soon</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-axal-muted dark:text-gray-300">{COMING_SOON_LINE}</p>
          {articlesLink && (
            <Link
              to="/learning?tab=articles"
              className="mt-2 inline-flex items-center text-[12.5px] font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300"
              data-testid="link-coming-soon-articles"
            >
              Open articles
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The four states in one place, for a surface whose store is one read.
 * `status` is `loading`, `unreadable`, `unrecorded` or `ready`; `isEmpty`
 * decides empty within `ready`. Returns null when the surface should draw its
 * data.
 */
export function stateBlock({ status, reason, what, claim, onRetry, isEmpty, empty }) {
  if (status === 'loading') return <LearningLoading what={what} />;
  if (status === 'unreadable') return <LearningUnreadable what={what.replace(/^./, (c) => c.toUpperCase())} claim={claim} onRetry={onRetry} />;
  if (status === 'unrecorded' || status !== 'ready') return <NotLiveYet line={reason || NOT_LIVE_LINE} />;
  if (isEmpty) return <LearningEmpty title={empty.title} body={empty.body} cta={empty.cta} />;
  return null;
}
