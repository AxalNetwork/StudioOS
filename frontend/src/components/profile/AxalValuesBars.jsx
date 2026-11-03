import React from 'react';

/**
 * D4119 (#4119; owner revision of 2026-11-02 on #4119): the Axal behavioral
 * values block, one component for people and agents.
 *
 *   people  `ProfileFitSection`'s "Axal behavioral values": each value's
 *           score from the member's profiling, out of 5.
 *   agents  the persona's fixed values (D4117): the same labels, descriptions,
 *           bars and colours, the top three highlighted, the caption "Fixed ·
 *           part of who [Name] is", and no confidence state.
 *
 * `bars` is `[{ key, label, description, score: 0..1 | null, top? }]`. A score
 * the read did not carry is "Not recorded", never a 0-width bar.
 */
export default function AxalValuesBars({ bars, title, caption, scale = 'fraction', highlight = false, testId = 'axal-values' }) {
  const list = Array.isArray(bars) ? bars : [];
  return (
    <div data-testid={testId}>
      {title ? <div className="pf-lbl mb-[14px]">{title}</div> : null}
      <div className="flex flex-col gap-[11px]">
        {list.map((v) => {
          const known = v.score != null && Number.isFinite(Number(v.score));
          const pct = known ? Math.max(0, Math.min(100, Number(v.score) * 100)) : 0;
          const strong = highlight && v.top;
          return (
            <div key={v.key} title={v.description || undefined} data-testid={`${testId}-bar`} data-top={strong ? 'true' : undefined}>
              <div className="mb-[5px] flex justify-between">
                <span className={`text-[12px] font-semibold ${strong ? 'text-[#7c3aed] dark:text-violet-300' : 'text-[#3f3f46] dark:text-gray-300'}`}>{v.label}</span>
                <span className="pf-mono text-[11px] font-bold text-[#7c3aed] dark:text-violet-400">
                  {!known ? 'Not recorded' : scale === 'five' ? `${(Number(v.score) * 5).toFixed(1)}/5` : strong ? 'Top 3' : ''}
                </span>
              </div>
              <div className="h-[6px] overflow-hidden rounded-full bg-[#f1f1f5] dark:bg-gray-800" role={known ? 'img' : undefined}
                aria-label={known ? `${v.label}${scale === 'five' ? `, ${(Number(v.score) * 5).toFixed(1)} of 5` : strong ? ', one of the top three' : ''}` : undefined}>
                {known ? (
                  <div className={`h-full rounded-full transition-all duration-700 ${highlight && !strong ? 'bg-[#c4b5fd] dark:bg-violet-800' : 'bg-[#7c3aed] dark:bg-violet-500'}`} style={{ width: `${pct}%` }} />
                ) : null}
              </div>
              {v.description ? <p className="sr-only">{v.description}</p> : null}
            </div>
          );
        })}
      </div>
      {caption ? <p className="m-0 mt-2.5 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-caption`}>{caption}</p> : null}
    </div>
  );
}
