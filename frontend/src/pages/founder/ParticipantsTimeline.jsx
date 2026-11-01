import React, { useEffect, useState } from 'react';
import { clock, timelineOf } from './participantsTimeline.js';

/**
 * #4018 (#3710 REC3): who was on the call, when, and how much each spoke.
 * One bar per person across the call's length, the bot's own bar, ticks at 0
 * and the call's length, and "[42%]" beside a person once the transcript
 * names them. `participantsTimeline.js` holds the rules; this draws them.
 * While the bot records, the page's bot poll refreshes `participants` and an
 * open bar grows with the clock.
 */
export default function ParticipantsTimeline({ participants, bot = null, segments = [], now: fixed = null }) {
  const recording = bot?.status === 'recording';
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!recording || fixed !== null) return undefined;
    const t = setInterval(() => setTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, [recording, fixed]);
  const view = timelineOf({ participants, bot, segments, now: fixed ?? tick });
  return (
    <section className="space-y-3 rounded-2xl border border-axal-hairline bg-white p-5 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
      data-testid="participants-timeline" data-state={view.state}>
      <h2 className="m-0 text-[16px] font-bold">Participants</h2>
      {view.line && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" role="status" data-testid="participants-timeline-line">{view.line}</p>}
      {view.state === 'ready' && (
        <ol className="m-0 list-none space-y-2 p-0" data-testid="participants-timeline-rows">
          {view.rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]" data-testid={`timeline-row-${r.key}`}>
              <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                <span className="truncate font-semibold" title={r.name}>{r.name}</span>
                {r.share !== null && <span className="flex-none font-mono text-[12px] tabular-nums text-axal-muted dark:text-gray-400" data-testid={`timeline-share-${r.key}`}>[{r.share}%]</span>}
              </span>
              <span className="relative block h-3 rounded-full bg-axal-ground dark:bg-gray-800"
                aria-label={r.from === null ? `${r.name}: times not recorded` : `${r.name}: joined ${clock(r.joined) ?? 'Not recorded'}, ${r.open ? (recording ? 'still on the call' : 'stayed to the end') : `left ${clock(r.left)}`}`}>
                {r.from !== null && (
                  <span className={`absolute inset-y-0 rounded-full ${r.bot ? 'bg-violet-300 dark:bg-violet-700' : 'bg-violet-700 dark:bg-violet-400'}`}
                    style={{ left: `${r.from}%`, width: `${Math.max(r.width, 0.5)}%` }} data-testid={`timeline-bar-${r.key}`} data-from={r.from.toFixed(2)} data-width={r.width.toFixed(2)} data-open={r.open ? 'true' : 'false'} />
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {view.ticks && (
        <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]" aria-hidden="true">
          <span />
          <span className="flex justify-between font-mono text-[11px] tabular-nums text-axal-faint dark:text-gray-500" data-testid="participants-timeline-ticks">
            <span>{view.ticks[0]}</span><span>{view.ticks[1]}</span>
          </span>
        </div>
      )}
    </section>
  );
}
