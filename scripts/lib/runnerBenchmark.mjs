// D5611: pure runner-lane measurements and explicitly gated benchmark lanes.
import { runnerWait } from './ciScorecard.mjs';

export const PRICES = Object.freeze({
  free: { usdPerMinute: 0, url: 'https://docs.github.com/en/billing/concepts/product-billing/github-actions', asOf: '2026-11-12' },
  github8: { usdPerMinute: 0.022, url: 'https://docs.github.com/en/billing/reference/actions-runner-pricing', asOf: '2026-11-12' },
  ephemeral: { usdPerMinute: 0.008, url: 'https://www.warpbuild.com/docs/ci/cloud-runners', asOf: '2026-11-12' },
});

export function benchmarkLanes({ spendingCapVerified, github8Ready, ephemeralReady } = {}) {
  const lanes = [{ lane: 'free', runner: 'ubuntu-latest' }];
  if (spendingCapVerified !== 'true') return lanes;
  if (github8Ready === 'true') lanes.push({ lane: 'github8', runner: 'studioos-bench-linux-8' });
  if (ephemeralReady === 'true') lanes.push({ lane: 'ephemeral', runner: 'warp-ubuntu-latest-x64-4x' });
  return lanes;
}
const duration = (a, b) => {
  const value = (Date.parse(b) - Date.parse(a)) / 60_000;
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Jobs are flat Actions job records with an explicit lane. Missing evidence stays null. */
export function summarise(jobs, prices = PRICES) {
  const groups = new Map();
  for (const job of jobs) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(job.lane || '')) throw new Error('invalid benchmark lane');
    if (!groups.has(job.lane)) groups.set(job.lane, []);
    groups.get(job.lane).push(job);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([lane, rows]) => {
    const timed = rows.filter(j => j.conclusion !== 'skipped' && duration(j.created_at, j.started_at) !== null && duration(j.started_at, j.completed_at) !== null);
    const complete = timed.length === rows.length;
    const billedMinutes = complete ? timed.reduce((n, j) => n + Math.ceil(duration(j.started_at, j.completed_at)), 0) : null;
    const price = prices[lane];
    if (price && (!Number.isFinite(price.usdPerMinute) || price.usdPerMinute < 0 || !/^https:\/\//.test(price.url || '') || !/^\d{4}-\d{2}-\d{2}$/.test(price.asOf || ''))) throw new Error('invalid price provenance');
    return {
      lane, jobs: rows.length, timedJobs: timed.length, complete,
      success: complete && rows.every(j => j.conclusion === 'success'),
      wallMin: complete ? (Math.max(...timed.map(j => Date.parse(j.completed_at))) - Math.min(...timed.map(j => Date.parse(j.created_at)))) / 60_000 : null,
      runtimeMin: complete ? timed.reduce((n, j) => n + duration(j.started_at, j.completed_at), 0) : null,
      wait: runnerWait([{ jobs: rows }]), billedMinutes,
      costUsd: billedMinutes !== null && price ? Math.round(billedMinutes * price.usdPerMinute * 1e6) / 1e6 : null,
      price: price || null,
    };
  });
}

/** Conservative source audit for static workflow jobs; dynamic runner labels need explicit review. */
export function secretJobs(source) {
  const section = /^jobs:\s*$/m.exec(source);
  if (!section) return [];
  const inherited = source.slice(0, section.index);
  const chunks = source.slice(section.index + section[0].length).split(/^  ([\w-]+):\s*$/m);
  return Array.from({ length: Math.floor(chunks.length / 2) }, (_, i) => {
    const id = chunks[1 + i * 2], body = inherited + '\n' + chunks[2 + i * 2];
    const names = [...body.matchAll(/secrets(?:\.([A-Za-z_][\w]*)|\[['"]([^'"]+)['"]\])/g)].map(m => m[1] || m[2]);
    const unknown = /\bsecrets\b/.test(body.replace(/secrets(?:\.([A-Za-z_][\w]*)|\[['"]([^'"]+)['"]\])/g, ''));
    return { id, secrets: names.filter(n => n !== 'GITHUB_TOKEN'), unknown, runner: /^    runs-on:\s*(.+)$/m.exec(body)?.[1]?.trim() || null };
  }).filter(j => j.secrets.length || j.unknown);
}
