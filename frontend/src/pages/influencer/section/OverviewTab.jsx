import React from 'react';
import { Link } from 'react-router-dom';
import { WeekLine } from '../../../ui/Charts';
import { overviewView } from './influencerSectionModel';
import { BODY, BlockUnreadable, CopyButton, Eyebrow, Figure, INK, Loading, MUTED, MoneyLines, Panel, ShareButton } from './InfluencerParts';

/**
 * D4289 P7 (#4296), IN1 and IN1s — the Overview at `/influencer`: the handle
 * link, this period's money per currency, the five figures, the funnel, the
 * next milestone, the top channels and Eadwyn's line (the reply's `line`, as
 * it is). First day, Not recorded, Unreadable and "Fewer than 5" are each
 * drawn in place; nothing reads 0 unless it was counted.
 */
export default function OverviewTab({ analytics, header, accent, onRetry }) {
  if (!analytics || analytics.status === 'loading') return <Loading />;
  if (analytics.status === 'error') return <BlockUnreadable what="Your figures" onRetry={onRetry} />;
  const v = overviewView(analytics.data, header.handle);
  if (!v) return <BlockUnreadable what="Your figures" onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-4" data-testid="influencer-overview">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel testId="overview-handle">
          <Eyebrow>Your handle link</Eyebrow>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`font-mono text-lg font-semibold ${INK}`}>{header.shortUrl || 'No handle yet'}</span>
            <CopyButton text={header.url} aria="Copy your handle link" />
            <span className="sm:hidden"><ShareButton url={header.url} accent={accent} /></span>
          </div>
          <p className={`mt-3 text-xs ${MUTED}`}>Label every post as a paid partnership, with #ad.</p>
        </Panel>
        <Panel testId="overview-money">
          <Eyebrow>This period · per currency</Eyebrow>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div><span className={`text-xs ${MUTED}`}>Pending · held 30 days</span><MoneyLines m={v.pending} /></div>
            <div><span className={`text-xs ${MUTED}`}>Payable</span><MoneyLines m={v.payable} /></div>
          </div>
          <p className={`mt-2 text-xs ${MUTED}`}>Each currency is paid on its own and never added to another.</p>
          <Link to="/influencer/earnings" className={`mt-2 inline-block text-xs font-semibold ${accent.link}`}>Open Earnings ›</Link>
        </Panel>
      </div>

      {v.firstDay && (
        <Panel testId="overview-first-day">
          <span className={`block text-base font-extrabold ${INK}`}>Share your link to start</span>
          <span className={`mt-1 block text-sm ${MUTED}`}>Visits, sign-ups and paid members appear here from the first click.</span>
          <div className="mt-3"><CopyButton text={header.url} label={header.shortUrl ? `Copy ${header.shortUrl}` : 'Copy'} /></div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="overview-kpis">
        {v.kpis.map((k) => (
          <Panel key={k.key} testId={`kpi-${k.key}`}>
            <Eyebrow>{k.label}</Eyebrow>
            <div className="mt-1">{k.money ? <MoneyLines m={k} big /> : <Figure f={k} />}</div>
            {k.money && k.state === 'ok' && k.lines.length > 1 && <span className={`mt-1 block text-[11px] ${MUTED}`}>Not summed</span>}
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Funnel" sub="Visits to your links, then sign-ups, then paid members." testId="overview-funnel">
          <ol className="flex flex-col gap-2">
            {v.funnel.map((s) => (
              <li key={s.key} className="flex items-baseline justify-between gap-3">
                <span className={`text-sm ${BODY}`}>{s.label}</span>
                <span className="flex items-baseline gap-2"><Figure f={s} className="text-base font-semibold" />{s.share && <span className={`text-xs ${MUTED}`}>{s.share}</span>}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Commission · per week" sub="One chart per currency. Currencies are never added together." testId="overview-weekly">
          {v.weekly.length === 0 && <span className={`text-sm ${MUTED}`}>None yet</span>}
          {v.weekly.map((s) => (
            <div key={s.currency} className="mb-3" role="img" aria-label={`Commission earned per week in ${s.currency}`} data-testid={`weekly-${s.currency}`}>
              <Eyebrow>{s.currency}</Eyebrow>
              <WeekLine values={s.weeks.map((w) => w.cents / 100)} labels={s.weeks.map((w) => w.week.slice(5))} height={140} />
            </div>
          ))}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Next milestone" sub="Paid members you brought in, all time." testId="overview-milestone">
          {v.milestone.state === 'ok'
            ? <span className={`text-sm ${BODY}`}>{v.milestone.next || 'Every milestone is reached.'}</span>
            : <Figure f={v.milestone} />}
        </Panel>
        <Panel title="Top channels" sub="Your sub-links, ranked by paid members." testId="overview-channels">
          <ChannelTable view={v.channels} />
        </Panel>
      </div>

      {v.line && (
        <p role="note" className={`rounded-xl border border-[#ddd0fb] bg-[#f4f0fe] px-4 py-3 text-sm ${BODY} dark:border-violet-800 dark:bg-violet-950/40`} data-testid="overview-eadwyn">
          <b className={INK}>Eadwyn:</b> {v.line}
        </p>
      )}
    </div>
  );
}

/** The channels table: Not recorded or Unreadable in place, "Fewer than 5" per cell. */
export function ChannelTable({ view }) {
  if (view.state !== 'ok') return <Figure f={view} />;
  if (!view.rows.length) return <span className={`text-sm ${MUTED}`}>No channel has a visit yet.</span>;
  const rows = [...view.rows].sort((a, b) => (b.paid.value ?? -1) - (a.paid.value ?? -1));
  return (
    <div role="table" className="w-full text-sm" data-testid="channel-table">
      <div role="row" className={`grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-2 border-b border-[#ececf1] pb-1 text-xs font-semibold dark:border-gray-700 ${MUTED}`}>
        <span role="columnheader">Link</span><span role="columnheader" className="text-right">Visits</span><span role="columnheader" className="text-right">Sign-ups</span><span role="columnheader" className="text-right">Paid</span>
      </div>
      {rows.map((r) => (
        <div role="row" key={r.key} className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-2 py-1.5">
          <span role="cell" className={`truncate font-mono text-xs ${INK}`}>{r.label}</span>
          <span role="cell" className="text-right"><Figure f={r.visits} className="text-sm" /></span>
          <span role="cell" className="text-right"><Figure f={r.signups} className="text-sm" /></span>
          <span role="cell" className="text-right"><Figure f={r.paid} className="text-sm" /></span>
        </div>
      ))}
    </div>
  );
}
