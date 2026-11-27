#!/usr/bin/env node
/** D5975: read existing per-SHA scorecard artifacts; report observed latency and explicit coverage gaps, never edit settings. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const stamp = v => typeof v === 'string' ? Date.parse(v) : NaN;
const quantile = (xs, p) => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1] : null;
const stats = xs => ({ n: xs.length, p50: quantile(xs, .5), p95: quantile(xs, .95), max: xs.length ? Math.max(...xs) : null });

export function analyse(artifacts, deadlineMinutes = undefined) {
  if (!Array.isArray(artifacts)) throw new Error('Invalid report inputs');
  const recordedDeadlines = [...new Set(artifacts.map(a => a?.deadlineMinutes).filter(v => Number.isFinite(v) && v > 0))];
  deadlineMinutes ??= recordedDeadlines.length === 1 ? recordedDeadlines[0] : null;
  if (deadlineMinutes !== null && (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0)) throw new Error('Invalid deadline');
  const observations = new Map(), windows = [];
  for (const a of artifacts) {
    const start = stamp(a?.window?.start), end = stamp(a?.window?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Array.isArray(a.rows)) throw new Error('Invalid artifact/window');
    windows.push([start, end]);
    for (const row of a.rows) {
      if (!/^[a-f0-9]{40}$/.test(row?.headSha ?? '') || !Number.isFinite(stamp(row.requestedAt))) throw new Error('Invalid candidate identity');
      const old = observations.get(row.headSha);
      if (old && old.row.requestedAt !== row.requestedAt) throw new Error('Conflicting request time for one SHA');
      if (!old || old.end < end) observations.set(row.headSha, { row, end });
    }
  }
  const days = new Map(), all = [], waits = [], runtimes = [], outcomes = {};
  let expired = 0, mergedTimed = 0, mergedLate = 0, measured = 0;
  for (const { row } of observations.values()) {
    const date = row.requestedAt.slice(0, 10);
    const day = days.get(date) ?? { date, candidates: 0, latencies: [], expired: 0 };
    days.set(date, day); day.candidates++;
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
    if (row.outcome === 'deadline-expired') { expired++; day.expired++; }
    const completed = stamp(row.lastRequired?.completedAt), requested = stamp(row.requestedAt);
    if (!Number.isFinite(completed)) continue;
    if (completed < requested) throw new Error('Completion predates request');
    const latency = (completed - requested) / 60000;
    day.latencies.push(latency); all.push(latency); measured++;
    for (const [key, values] of [['waitMinutes', waits], ['runtimeMinutes', runtimes]]) {
      const value = row.lastRequired[key];
      if (Number.isFinite(value) && value >= 0) values.push(value);
    }
    if (row.outcome === 'merged') { mergedTimed++; if (deadlineMinutes !== null && latency > deadlineMinutes) mergedLate++; }
  }
  const intervals = [...windows].sort((a,b) => a[0]-b[0]); const union = [];
  for (const [start,end] of intervals) {
    const last = union.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1],end); else union.push([start,end]);
  }
  const span = union.length ? (union.at(-1)[1] - union[0][0]) / 86400000 : 0;
  const covered = union.reduce((sum,[a,b]) => sum+b-a,0) / 86400000;
  const daily = [...days.values()].sort((a,b) => a.date.localeCompare(b.date)).map(({latencies,...row}) => ({...row, ...stats(latencies)}));
  return { deadlineMinutes, artifacts: artifacts.length, candidates: observations.size, outcomes, latency: stats(all), lastCheckWait: stats(waits), lastCheckRuntime: stats(runtimes),
    missingTimings: observations.size-measured, mergedWithTiming: { n: mergedTimed, laterThanDeadline: deadlineMinutes === null ? null : mergedLate },
    healthyCompletions: { value: null, reason: 'The artifact does not include required-check conclusions; merged is not proof all required checks passed.' },
    confirmedExpiryRecords: { observedCandidates: observations.size, expired },
    coverage: { spanDays: span, coveredDays: covered, gapDays: span-covered, intervals: union.map(([a,b]) => ({start:new Date(a).toISOString(),end:new Date(b).toISOString()})) },
    busiestObservedDay: daily.reduce((best,d) => !best || d.candidates>best.candidates ? d:best,null), daily,
    recommendation: 'Insufficient evidence: fewer than seven covered days and/or incomplete required-check outcomes. No settings change justified by this report.' };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(analyse(process.argv.slice(2).map(p => JSON.parse(readFileSync(p,'utf8')))), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode=1; }
}
