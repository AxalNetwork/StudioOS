// Benchmark comparison — bars against the engine's REAL tier thresholds, with
// the composite marker overlaid on every bar.
//
// The cohort row is added by the view model only when the Worker returned a
// median (D589). The tier rows stay. A small cohort passes cohortNote, a
// reason, and no extra bar.

export default function BenchmarkBars({ benchmarks, markerPct, gapSentence, cohortNote }) {
  if (!benchmarks || !benchmarks.length) return null;

  return (
    <>
      <div className="space-y-3">
        {benchmarks.map((b) => (
          <div key={b.id} data-testid={`bench-${b.id}`}>
            <div className="flex justify-between mb-1 gap-2">
              <span className="text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">{b.label}</span>
              <span className="text-[11.5px] font-bold text-gray-900 dark:text-gray-50 tabular-nums">{b.value}</span>
            </div>
            <div className="relative h-2 rounded-full bg-gray-100 dark:bg-gray-800">
              <div className={`absolute inset-y-0 left-0 rounded-full ${b.barClass}`} style={{ width: b.pct }} />
              <span
                aria-hidden="true"
                data-testid={`marker-bench-${b.id}`}
                className="absolute -top-[3px] -bottom-[3px] w-[2px] rounded-sm bg-gray-900 dark:bg-gray-100 -translate-x-1/2"
                style={{ left: markerPct }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-3" data-testid="text-benchmark-gap">{gapSentence}</p>
      {cohortNote ? (
        <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-2" data-testid="text-cohort-benchmark">{cohortNote}</p>
      ) : null}
    </>
  );
}
