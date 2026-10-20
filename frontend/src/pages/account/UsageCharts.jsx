import { useState } from 'react';
import { EmptyState, Unrecorded } from '../../ui';
import { dailySeries } from './costModel';
import { dayLabel, shortTokens, usd } from './usageModel';

function Dot({ colour }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />;
}

/** Same component and colour map on B1 and B2. Tap, keyboard-focus or hover a day. */
export function DailyCostChart({ data, model = '' }) {
  const [selected, setSelected] = useState(null);
  const series = dailySeries(data, model);
  if (!series) return <Unrecorded reason="The daily model breakdown was not returned.">Not recorded</Unrecorded>;
  if (!data.totals.runs) return <EmptyState size="sm" title="No AI runs in this range." />;
  const active = series.days.find((d) => d.day === selected);
  return (
    <div className="min-w-0" data-testid="daily-cost-chart">
      <p className="mb-2 text-xs text-axal-muted dark:text-gray-400">Cloudflare cost · UTC · hover, focus or tap a day</p>
      <div className="flex h-40 items-stretch gap-1 border-b border-axal-hairline dark:border-gray-700">
        {series.days.map((d) => (
          <button key={d.day} type="button" onMouseEnter={() => setSelected(d.day)} onFocus={() => setSelected(d.day)} onClick={() => setSelected(d.day)}
            className="flex min-w-0 flex-1 flex-col justify-end rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet"
            aria-label={`${d.day}: ${usd(d.cost) ?? 'Not recorded'}. ${d.segments.map((s) => `${s.name}: ${usd(s.cost) ?? 'Not recorded'}`).join('; ')}`}
            title={`${d.day} · ${usd(d.cost) ?? 'Not recorded'}`} data-day={d.day}>
            {d.segments.map((s) => (
              <span key={s.model} data-model={s.model} data-cost={s.cost} data-testid="daily-cost-segment"
                className="block w-full shrink-0" style={{ backgroundColor: s.colour, boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55)', height: `${series.max > 0 && s.cost != null ? s.cost / series.max * 100 : 0}%` }} />
            ))}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-axal-muted dark:text-gray-400">
        <span>{dayLabel(series.days[0]?.day)}</span><span>{dayLabel(series.days.at(-1)?.day)}</span>
      </div>
      {series.days.some((d) => d.cost == null) && <Unrecorded reason="A day's model cost was not returned.">Not recorded</Unrecorded>}
      <div className="my-2 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {series.legend.map((m) => <span key={m.model} className="flex items-center gap-1.5"><Dot colour={m.colour} />{m.name}</span>)}
      </div>
      {active && <div className="rounded-lg border border-axal-hairline p-3 text-xs dark:border-gray-700" role="status" data-testid="daily-cost-tooltip">
        <strong>{dayLabel(active.day)} · {usd(active.cost) ?? 'Not recorded'}</strong>
        {active.segments.map((s) => <div key={s.model} className="mt-1 flex justify-between gap-3"><span className="flex items-center gap-1.5"><Dot colour={s.colour} />{s.name}</span><span className="font-mono">{usd(s.cost) ?? 'Not recorded'}</span></div>)}
        {!active.segments.length && <p>No AI runs this day.</p>}
      </div>}
    </div>
  );
}

/** Null counts break the line; real zero counts remain on the baseline. */
export function TokenUsageChart({ data }) {
  const series = dailySeries(data);
  if (!series) return <Unrecorded reason="Daily token counts were not returned.">Not recorded</Unrecorded>;
  if (!data.totals.runs) return <EmptyState size="sm" title="No AI runs in this range." />;
  const n = series.days.length;
  const max = Math.max(1, ...series.days.flatMap((d) => [d.input ?? 0, d.output ?? 0]));
  const x = (i) => 12 + (n > 1 ? i / (n - 1) * 520 : 260);
  const y = (v) => 130 - v / max * 115;
  const last = series.days.at(-1);
  return <div data-testid="token-usage-chart">
    <svg viewBox="0 0 550 150" role="img" aria-label="Daily input and output tokens, last 30 days, UTC" className="w-full">
      <line x1="12" x2="532" y1="130" y2="130" className="stroke-gray-200 dark:stroke-gray-700" />
      {['input', 'output'].map((key) => <g key={key} className={key === 'input' ? 'text-gray-800 dark:text-gray-200' : 'text-violet-600 dark:text-violet-400'} fill="currentColor" stroke="currentColor">
        {series.days.map((d, i) => d[key] == null ? null : <g key={d.day}>
          {i > 0 && series.days[i - 1][key] != null && <line x1={x(i - 1)} y1={y(series.days[i - 1][key])} x2={x(i)} y2={y(d[key])} strokeWidth="2" />}
          <circle cx={x(i)} cy={y(d[key])} r="2"><title>{d.day} · {key}: {d[key]}</title></circle>
        </g>)}
      </g>)}
    </svg>
    <div className="flex flex-wrap justify-between gap-2 text-xs">
      <span>Input: <strong>{shortTokens(last?.input) ?? 'Not recorded'}</strong></span>
      <span className="text-violet-700 dark:text-violet-300">Output: <strong>{shortTokens(last?.output) ?? 'Not recorded'}</strong></span>
    </div>
    <p className="mt-2 text-xs text-axal-muted dark:text-gray-400">Last day · {dayLabel(last?.day)} UTC. Counts shown are those the run log recorded.</p>
  </div>;
}
