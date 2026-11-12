// D5623: pure capacity and binary-bisection cost model; a decision trigger, never a queue controller.
const positive = (name, value, zero = false) => {
  if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new RangeError(`${name} must be ${zero ? 'nonnegative' : 'positive'} and finite`);
  return value;
};
const batchSize = value => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('batch must be a positive safe integer');
  return value;
};
export function ceilingPerDay({ batch = 1, builds, wallMin }) {
  return batchSize(batch) * positive('builds', builds, true) * 1440 / positive('wallMin', wallMin);
}
export function buildsNeeded({ perDay, peak, wallMin, batch = 1 }) {
  if (!Number.isFinite(peak) || peak < 1) throw new RangeError('peak must be at least one');
  return positive('perDay', perDay, true) * peak * positive('wallMin', wallMin) / (batchSize(batch) * 1440);
}

/**
 * Expected full-suite runs per successfully merged PR. Independent per-PR
 * deterministic culprit probability q; a failed node tests both halves.
 * Every internal node's children run iff that node contains a culprit.
 * This is an idealized binary splitter, not a vendor algorithm or flake model.
 */
export function runsPerPr({ batch, culpritRate }) {
  batchSize(batch);
  if (!Number.isFinite(culpritRate) || culpritRate < 0 || culpritRate >= 1) throw new RangeError('culpritRate must be in [0, 1)');
  const memo = new Map([[1, 0]]);
  const descendants = n => {
    if (!memo.has(n)) {
      const left = Math.floor(n / 2);
      memo.set(n, 2 * (1 - (1 - culpritRate) ** n) + descendants(left) + descendants(n - left));
    }
    return memo.get(n);
  };
  return (1 + descendants(batch)) / (batch * (1 - culpritRate));
}

/** Latest 14 complete consecutive #5603 windows wholly after W0–W2; unknowns never trigger. */
export function triggerMet(days) {
  if (!Array.isArray(days) || days.length < 14) return false;
  const dates = new Set();
  const rows = [];
  for (const day of days) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date || '') || dates.has(day.date)) return false;
    const stamp = Date.parse(`${day.date}T00:00:00Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== day.date) return false;
    dates.add(day.date); rows.push({ ...day, stamp });
  }
  rows.sort((a, b) => a.stamp - b.stamp);
  const window = rows.slice(-14);
  return window.every((day, i) => {
    if (day.sourceIssue !== 5603 || day.afterWaves !== true || day.complete !== true) return false;
    if (i && day.stamp - window[i - 1].stamp !== 86_400_000) return false;
    const slow = Number.isFinite(day.entryToMergeP90Min) && day.entryToMergeP90Min > 30
      && Number.isFinite(day.merged) && day.merged >= 200;
    const expensive = Number.isFinite(day.runnerMinPerMergedPr) && day.runnerMinPerMergedPr > 250;
    return slow || expensive;
  });
}

export function table() {
  const lines = [
    '| Merges/day | Builds, batch 1 | Builds, batch 8 | Landing runner-min/day, batch 1, 3% culprit rate |',
    '| ---: | ---: | ---: | ---: |',
  ];
  for (const perDay of [300, 600, 1000]) {
    const builds = batch => buildsNeeded({ perDay, peak: 3, wallMin: 12, batch }).toFixed(1);
    const minutes = Math.round(perDay * 108 * runsPerPr({ batch: 1, culpritRate: 0.03 }));
    lines.push(`| ${perDay} | ${builds(1)} | ${builds(8)} | ${minutes} |`);
  }
  return lines.join('\n');
}
