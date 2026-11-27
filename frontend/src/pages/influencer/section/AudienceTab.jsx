import React from 'react';
import { HBars } from '../../../ui/Charts';
import { audienceView } from './influencerSectionModel';
import { BlockUnreadable, Eyebrow, Figure, INK, Loading, MUTED, Panel } from './InfluencerParts';

/**
 * D4289 P7 (#4296), IN5 — Audience at `/influencer/audience`. Totals only: the
 * referred members by plan family, by region and by month joined, how many of
 * each month still pay, and the time from first visit to paid. Any group of 1
 * to 4 reads "Fewer than 5", with no bar and no number; nothing names a member.
 */
export default function AudienceTab({ analytics, onRetry }) {
  if (!analytics || analytics.status === 'loading') return <Loading />;
  if (analytics.status === 'error') return <BlockUnreadable what="Your audience" onRetry={onRetry} />;
  const v = audienceView(analytics.data);
  return (
    <div className="flex flex-col gap-4" data-testid="influencer-audience">
      <p className={`text-sm ${MUTED}`}>Totals only. We never show who joined.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bars title="Referred members by plan family" view={v.planFamily} testId="audience-plan" />
        <Bars title="By region" view={v.region} testId="audience-region" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bars title="By month joined" view={v.month} testId="audience-month" />
        <Panel title="Still paying, by month joined" sub="Share of each month’s members still paying." testId="audience-retention">
          {v.retention.state !== 'ok' ? <Figure f={v.retention} /> : !v.retention.rows.length ? <span className={`text-sm ${MUTED}`}>No paid member yet</span> : (
            <div role="table" className="w-full overflow-x-auto text-xs">
              <div role="row" className={`flex gap-2 border-b border-[#ececf1] pb-1 font-semibold dark:border-gray-700 ${MUTED}`}>
                <span role="columnheader" className="w-28 shrink-0">Joined</span>
                {Array.from({ length: v.retention.width }, (_, i) => <span role="columnheader" key={i} className="w-12 shrink-0 text-right">M{i}</span>)}
              </div>
              {v.retention.rows.map((r) => (
                <div role="row" key={r.cohort} className="flex gap-2 py-1">
                  <span role="cell" className={`w-28 shrink-0 ${INK}`}>{r.cohort}</span>
                  {r.cells.map((c, i) => <span role="cell" key={i} className={`w-12 shrink-0 text-right font-mono ${c === '<5' ? MUTED : INK}`}>{c}</span>)}
                </div>
              ))}
              <p className={`mt-2 ${MUTED}`}>A month with fewer than 5 members shows “&lt;5”, never a percentage.</p>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Time from first visit to paid" testId="audience-median">
        <Eyebrow>Median</Eyebrow>
        <div className="mt-1"><Figure f={v.median} /></div>
      </Panel>
    </div>
  );
}

function Bars({ title, view, testId }) {
  return (
    <Panel title={title} testId={testId}>
      {view.state !== 'ok' ? <Figure f={view} />
        : !view.rows.length ? <span className={`text-sm ${MUTED}`}>No referred member yet</span>
          : (
            <div role="img" aria-label={`${title}: ${view.rows.map((r) => `${r.label} ${r.text}`).join(', ')}`}>
              <HBars rows={view.rows} testIdPrefix={testId} />
            </div>
          )}
    </Panel>
  );
}
