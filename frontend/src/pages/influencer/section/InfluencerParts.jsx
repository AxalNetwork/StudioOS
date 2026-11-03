import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Copy, Share2 } from 'lucide-react';
import { Card, Pill } from '../../../ui';
import { Unrecorded, Unreadable } from '../../../ui/Honesty';
import { EYEBROW, SUBTITLE, TABS, TITLE } from './influencerSectionModel';

/**
 * D4289 P7 (#4296) — the pieces every Influencer tab shares: the honest values
 * (a figure, money per currency, Not recorded, Unreadable, "Fewer than 5"),
 * the panel, Copy, and IN0's header (the handle chip with Copy, the tier
 * badge, Share, and the six tabs). Words come from `influencerSectionModel.js`.
 */

export const INK = 'text-[#18181b] dark:text-gray-100';
export const BODY = 'text-[#3f3a47] dark:text-gray-300';
export const MUTED = 'text-[#6b6577] dark:text-gray-400';
export const FIELD = 'w-full rounded-lg border border-[#e2dfe8] bg-white px-3 py-2 text-sm text-[#18181b] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
export const SECONDARY = 'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#e2dfe8] bg-white px-3 text-xs font-semibold text-[#18181b] hover:bg-[#faf9fc] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** A small group, as the board draws it. */
export function FewerThan({ text }) {
  return <span className={`text-sm font-medium ${MUTED}`} data-testid="fewer-than-5">{text}</span>;
}

/**
 * One figure from the model's `figure()`: its number, "Fewer than 5", Not
 * recorded (with the store that will hold it on hover), Unreadable, or HQ reads.
 */
export function Figure({ f, className = 'text-2xl font-semibold' }) {
  if (!f) return null;
  if (f.state === 'small') return <FewerThan text={f.text} />;
  if (f.state === 'not_recorded') return <span data-testid="not-recorded"><Unrecorded reason={f.source ? `Stored once ${f.source} is recorded` : undefined} /></span>;
  if (f.state === 'unreadable') return <span className="text-sm font-medium text-red-700 dark:text-red-300" data-testid="figure-unreadable">Unreadable</span>;
  if (f.state === 'hq_reads') return <span className={`text-sm ${MUTED}`}>HQ reads</span>;
  return <span className={`font-mono ${INK} ${className}`}>{f.text}</span>;
}

/** Money from the model's `moneyFigure()`: one line per currency, never a total. */
export function MoneyLines({ m, big = false }) {
  if (!m) return null;
  if (m.state !== 'ok') return <Figure f={m} />;
  if (!m.lines.length) return <span className={`text-sm ${MUTED}`}>None yet</span>;
  return (
    <span className="flex flex-col" data-testid="money-lines">
      {m.lines.map((l) => (
        <span key={l.currency} className={`font-mono ${INK} ${big ? 'text-xl font-semibold' : 'text-sm font-semibold'}`} data-currency={l.currency}>{l.text}</span>
      ))}
    </span>
  );
}

/** A block whose read failed, with Try again. */
export function BlockUnreadable({ what, onRetry }) {
  return (
    <Card padding="md" data-testid="block-unreadable">
      <Unreadable what={what} claim="That is not the same as having none." onRetry={onRetry} />
    </Card>
  );
}

export function Loading() {
  return <p className={`text-sm ${MUTED}`} data-testid="influencer-loading">Loading…</p>;
}

/** A titled panel. */
export function Panel({ title, sub, right = null, children, testId }) {
  return (
    <Card padding="md" data-testid={testId}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className={`text-[15px] font-semibold ${INK}`}>{title}</h2>}
            {sub && <p className={`mt-0.5 text-xs ${MUTED}`}>{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </Card>
  );
}

/** The small uppercase label over a figure. */
export function Eyebrow({ children }) {
  return <span className={`block text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>{children}</span>;
}

/** Copy to the clipboard, saying so in place (no alert). */
export function CopyButton({ text, label = 'Copy', aria, className = SECONDARY, testId }) {
  const [done, setDone] = useState(null);
  const copy = async () => {
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(String(text));
      setDone('Copied');
    } catch {
      setDone('Copy it by hand');
    }
  };
  return (
    <button type="button" onClick={copy} className={className} aria-label={aria} data-testid={testId} disabled={!text}>
      <Copy size={13} aria-hidden="true" /> {done || label}
    </button>
  );
}

export function TierBadge({ tier, accent }) {
  if (!tier) return null;
  return (
    <span className={`inline-flex min-h-[24px] items-center gap-1 rounded-full border border-[#e2dfe8] bg-white px-2 text-xs font-bold dark:border-gray-600 dark:bg-gray-900 ${INK}`} data-testid="influencer-tier">
      <BadgeCheck size={13} className={accent?.link} aria-hidden="true" /> {tier}
    </span>
  );
}

export function HandleChip({ chip, accent }) {
  if (!chip) return null;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${accent.chip}`} data-testid="influencer-handle-chip">
      {chip}
      <CopyButton text={chip} aria={`Copy ${chip}`} className="inline-flex items-center gap-1 text-[11px] font-semibold underline" />
    </span>
  );
}

/** Share: the system sheet where there is one, else Copy. */
export function ShareButton({ url, accent }) {
  const [said, setSaid] = useState(null);
  const share = async () => {
    if (!url) return;
    try {
      if (navigator?.share) { await navigator.share({ title: 'Axal VC', url }); return; }
      await navigator.clipboard.writeText(url);
      setSaid('Link copied');
    } catch {
      setSaid(null);
    }
  };
  return (
    <button type="button" onClick={share} disabled={!url} className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${accent.button}`} data-testid="influencer-share">
      <Share2 size={14} aria-hidden="true" /> {said || 'Share'}
    </button>
  );
}

/** IN0's header and the tab bar (literal links, one address each). */
export function SectionHeader({ header, tab, accent }) {
  return (
    <header className="border-b border-[#ececf1] pb-0 dark:border-gray-700" data-testid="influencer-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{EYEBROW}</Eyebrow>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className={`text-2xl font-bold ${INK}`}>{TITLE}</h1>
            <HandleChip chip={header.chip} accent={accent} />
            <TierBadge tier={header.tier} accent={accent} />
            {header.paused && <Pill tone="warn">Paused by HQ</Pill>}
          </div>
          <p className={`mt-1 text-sm ${MUTED}`}>{SUBTITLE}</p>
        </div>
        <ShareButton url={header.url} accent={accent} />
      </div>
      <nav aria-label="Influencer" className="-mb-px mt-4 flex gap-1 overflow-x-auto" data-testid="influencer-tabs">
        {TABS.map((t) => (
          <Link key={t.key} to={t.to} aria-current={t.key === tab ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${t.key === tab ? accent.tab : `border-transparent ${MUTED}`}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** A two-step action, in place of a confirm dialog. */
export function TwoStep({ label, confirmLabel, onConfirm, busy = false, testId }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <button type="button" className={SECONDARY} onClick={() => setArmed(true)} data-testid={testId}>{label}</button>;
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className={SECONDARY} disabled={busy} onClick={async () => { await onConfirm(); setArmed(false); }} data-testid={testId ? `${testId}-confirm` : undefined}>{confirmLabel}</button>
      <button type="button" className={SECONDARY} onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}
