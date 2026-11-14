import React, { useState } from 'react';
import { Unreadable } from '../../../ui';
import StatusBadge from './StatusBadge.jsx';
import { contentSafety, deliveryEnforcement, recentVerdicts, shortWhen, usageAnomalies } from './aiSafetyModel.js';

/**
 * D4803 (#4803, canvas SE08 AI Safety, SE11f phone) — "What the guard decided,
 * what delivery enforced, and unusual usage."
 *
 *   three blocks   content safety, delivery enforcement and usage anomalies,
 *                  each "x of n" with its own state and its own source; a small
 *                  sample is said to be one, never drawn as a rate
 *   recent         the newest guard verdicts with what reached the person
 *   limits         HQ only: AI records carry no branch
 *   explanation    the previous zone's full detail (rules, legacy audit, the
 *                  list of what is not counted) behind "How this is measured"
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

function Frac({ x, n, line, testid }) {
  return (
    <div className="flex flex-col" data-testid={testid}>
      <span className="text-[24px] font-extrabold tabular-nums tracking-tight text-axal-ink dark:text-white">
        {x} <span className="text-[15px] font-bold text-axal-muted dark:text-gray-400">of {n}</span>
      </span>
      <small className="text-[12px] text-axal-muted dark:text-gray-300">{line}</small>
    </div>
  );
}

function Block({ id, title, state, label, children, testid }) {
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col gap-3`} data-testid={testid} data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">{title}</h2>
        {state !== 'pending' && <StatusBadge state={state} label={label} />}
      </div>
      {children}
    </section>
  );
}

const Reading = () => <p className="text-[12px] text-axal-muted dark:text-gray-400">Reading…</p>;
const Unread = ({ reason }) => <p className="text-[12px] text-axal-muted dark:text-gray-300">{reason} This is not a zero.</p>;

export default function AiSafetyWorkspace({ block, unreadable, onRetry, children }) {
  const [howThreshold, setHowThreshold] = useState(false);
  const c = contentSafety(block);
  const d = deliveryEnforcement(block);
  const u = usageAnomalies(block);
  const recent = recentVerdicts(block);
  const days = block?.window_days;
  return (
    <div className="flex flex-col gap-4" data-testid="ai-safety-workspace">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-white">AI Safety</h2>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-300">What the guard decided, what delivery enforced, and unusual usage.</p>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-950" data-testid="ai-hq-only">
        <StatusBadge state="not_applicable" label="HQ only" />
        <span className="text-axal-muted dark:text-gray-300">AI records carry no branch, so these figures can&apos;t be split by branch or tenant.</span>
      </div>

      {unreadable ? (
        <Unreadable what="The AI safety figures" claim="This is not a claim that nothing was blocked or flagged." onRetry={onRetry} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Block id="ai-content-h" title="Content safety" state={c.state} testid="ai-content">
              {c.state === 'pending' && <Reading />}
              {c.state === 'unavailable' && <Unread reason={c.reason} />}
              {c.n !== undefined && (
                <>
                  <Frac x={c.x} n={c.n} line={`evaluated outputs received a safe verdict in the last ${c.windowDays} days`} testid="ai-content-frac" />
                  {c.small && <span className="self-start rounded-md border border-dashed border-axal-hairline px-1.5 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-300" data-testid="ai-small-sample">◆ Small sample — not a rate</span>}
                  <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-axal-muted dark:text-gray-400">Unsafe verdicts</dt>
                    <dd>{c.unsafe === 0 ? <StatusBadge state="measured_zero" label="0" /> : <span className="font-semibold">{c.unsafe}</span>}</dd>
                    <dt className="text-axal-muted dark:text-gray-400">Rules violated</dt>
                    <dd>{c.rules === null ? 'Unavailable: the rule breakdown could not be read' : c.rules.length ? c.rules.map((r) => `${r.category} (${r.turns})`).join(', ') : 'None'}</dd>
                    {c.noVerdict !== null && <><dt className="text-axal-muted dark:text-gray-400">Without a verdict</dt><dd>{c.noVerdict}, not counted above</dd></>}
                  </dl>
                </>
              )}
            </Block>

            <Block id="ai-delivery-h" title="Delivery enforcement" state={d.state} label={d.label} testid="ai-delivery">
              {d.state === 'pending' && <Reading />}
              {d.state === 'unavailable' && <Unread reason={d.reason} />}
              {d.checks !== undefined && (
                <>
                  <Frac x={d.blocked} n={d.checks} line="guard checks blocked the input before it reached the model" testid="ai-blocked-frac" />
                  <Frac x={d.withheld} n={d.checks} line="guard checks withheld the output from the user" testid="ai-withheld-frac" />
                  {d.unavailableGuard > 0 && <p className="text-[12px] text-axal-muted dark:text-gray-300">{d.unavailableGuard} calls ran while the guard was unavailable.</p>}
                  {d.legacy && <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Legacy chat audit, counted apart: {d.legacy.blocked} turns blocked, {d.legacy.flagged} flagged.</p>}
                </>
              )}
            </Block>

            <Block id="ai-usage-h" title="Usage anomalies" state={u.state} label={u.label} testid="ai-usage">
              {u.state === 'pending' && <Reading />}
              {u.state === 'unavailable' && <Unread reason={u.reason} />}
              {u.n !== undefined && (
                <>
                  <Frac x={u.x} n={u.n} line={`accounts checked used more than ${u.multiple}× their ${u.baselineDays}-day daily average in the last ${u.windowHours} hours`} testid="ai-usage-frac" />
                  {u.how && (
                    <div>
                      <button type="button" className="text-[12px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300" aria-expanded={howThreshold} aria-controls="ai-threshold" onClick={() => setHowThreshold((v) => !v)}>
                        How the threshold works {howThreshold ? '▴' : '▾'}
                      </button>
                      {howThreshold && <p id="ai-threshold" className="mt-1 text-[12px] text-axal-muted dark:text-gray-300">{u.how}</p>}
                    </div>
                  )}
                </>
              )}
            </Block>
          </div>

          <section aria-labelledby="ai-recent-h" className={`${CARD} flex flex-col gap-2`} data-testid="ai-recent">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ai-recent-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Recent guard verdicts</h2>
              {recent.rows && <span className="text-[12px] text-axal-muted dark:text-gray-400">newest {recent.rows.length} in {recent.windowDays || days} days</span>}
            </div>
            {recent.state === 'pending' && <Reading />}
            {recent.state === 'unavailable' && <Unread reason={recent.reason} />}
            {recent.state === 'empty' && (
              <div className="flex items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="ai-recent-empty">
                <StatusBadge state="measured_zero" label="None" /> No guard verdict was recorded in {recent.windowDays} days.
              </div>
            )}
            {recent.state === 'ready' && (
              <>
                <table className="hidden w-full text-left text-[12.5px] md:table" data-testid="ai-recent-table">
                  <thead>
                    <tr className="border-b border-axal-hairline text-[11px] text-axal-muted dark:border-gray-800 dark:text-gray-400">
                      <th scope="col" className="py-1.5 pr-3 font-semibold">When (UTC)</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Feature</th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">Verdict</th>
                      <th scope="col" className="py-1.5 font-semibold">Delivered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.rows.map((r, i) => (
                      <tr key={`${r.at}-${i}`} className="border-t border-axal-hairline dark:border-gray-800">
                        <td className="py-1.5 pr-3 font-mono text-[11.5px]">{shortWhen(r.at) || 'No time'}</td>
                        <td className="py-1.5 pr-3">{r.feature}</td>
                        <td className="py-1.5 pr-3"><StatusBadge state={r.verdict.state} label={r.verdict.word} /></td>
                        <td className="py-1.5">{r.delivery}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="flex flex-col gap-2 md:hidden">
                  {recent.rows.map((r, i) => (
                    <li key={`${r.at}-${i}`} className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
                      <span className="flex items-center justify-between gap-2"><b>{r.feature}</b><StatusBadge state={r.verdict.state} label={r.verdict.word} /></span>
                      <small className="text-axal-muted dark:text-gray-300">{shortWhen(r.at) || 'No time'} UTC · {r.delivery}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}

      {children && (
        <details className={`${CARD} text-[12px]`} data-testid="ai-how">
          <summary className="cursor-pointer font-semibold text-axal-ink dark:text-gray-100">How this is measured</summary>
          <div className="mt-3">{children}</div>
        </details>
      )}
    </div>
  );
}
