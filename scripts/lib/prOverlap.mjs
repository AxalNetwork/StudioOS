/** D5616: advisory path overlap, classification, landing order and safe Markdown. */
const HUBS = new Set(['frontend/src/lib/api.js', 'cloudflare-worker/src/index.ts', 'frontend/src/App.jsx', 'frontend/src/pages/learning/CycleRoute.jsx', 'cloudflare-worker/src/routes/advisors.ts', 'package.json', 'scripts/check-folder-docs.mjs']);
export const MARKER = '<!-- studioos-pr-overlap:v1 -->';
export function classify(path) {
  if (/(^|\/)README\.md$/.test(path)) return 'union';
  if (HUBS.has(path) || /(^|\/)CycleRoute\.jsx$/.test(path)) return 'hub';
  if (path.startsWith('cloudflare-worker/sql/migrations/')) return 'migration';
  if (path.startsWith('cloudflare-worker/src/contracts/')) return 'contract';
  if (/^scripts\/(?:.*-(?:baseline|ledger)\.json$|baselines\/)/.test(path)) return 'baseline';
  if (/(^|\/)_registry\.ts$|\.generated\./.test(path)) return 'generated';
  return 'path';
}
const filesOf = pr => (pr.files ?? []).map(f => typeof f === 'string' ? { filename: f, status: 'added' } : f);
export function pairs(prs) {
  const result = [];
  for (let i = 0; i < prs.length; i++) for (let j = i + 1; j < prs.length; j++) {
    const a = prs[i], b = prs[j], af = filesOf(a), bf = filesOf(b);
    const right = new Set(bf.flatMap(f => [f.filename, f.previous_filename].filter(Boolean)));
    const paths = [...new Set(af.flatMap(f => [f.filename, f.previous_filename].filter(p => p && right.has(p))))]
      .filter(p => classify(p) !== 'union').sort().map(path => ({ path, class: classify(path) }));
    const stamps = fs => new Set(fs.filter(f => f.status === 'added' && classify(f.filename) === 'migration')
      .map(f => /\/(\d{12})_/.exec(f.filename)?.[1]).filter(Boolean));
    const bs = stamps(bf), migrationStamps = [...stamps(af)].filter(s => bs.has(s)).sort();
    if (paths.length || migrationStamps.length) result.push({ a, b, paths, migrationStamps, verdict: 'not checked' });
  }
  return result;
}
export function order(cluster) {
  return [...cluster].sort((a, b) => Number(Boolean(a.draft)) - Number(Boolean(b.draft))
    || (a.changed_files ?? a.files?.length ?? 0) - (b.changed_files ?? b.files?.length ?? 0) || a.number - b.number);
}
export function clusters(overlaps) {
  const nodes = new Map();
  for (const p of overlaps) for (const pr of [p.a, p.b]) nodes.set(pr.number, pr);
  const seen = new Set(), result = [];
  for (const [id, pr] of nodes) {
    if (seen.has(id)) continue;
    const group = [], queue = [pr];
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next.number)) continue;
      seen.add(next.number); group.push(next);
      for (const p of overlaps) if (p.a.number === next.number) queue.push(p.b); else if (p.b.number === next.number) queue.push(p.a);
    }
    result.push(order(group));
  }
  return result;
}
export function escape(value) {
  return String(value ?? '').replace(/[&<>@`|\[\]\\*_~\r\n]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '@': '&#64;', '`': '&#96;', '|': '&#124;', '[': '&#91;', ']': '&#93;', '\\': '&#92;', '*': '&#42;', '_': '&#95;', '~': '&#126;', '\r': ' ', '\n': ' ' }[c]));
}
function pairText(p) {
  const verdict = ['yes', 'no', 'not checked'].includes(p.verdict) ? p.verdict : 'not checked';
  return `#${p.a.number} ↔ #${p.b.number}: textual conflict: ${verdict}\n`
    + p.paths.map(f => `- ${f.class}: ${escape(f.path)}`).join('\n')
    + (p.migrationStamps.length ? `\n- shared new migration stamp: ${p.migrationStamps.join(', ')}` : '');
}
export function render(pr, overlaps, { partial = false } = {}) {
  const related = overlaps.filter(p => p.a.number === pr.number || p.b.number === pr.number);
  const cluster = clusters(overlaps).find(c => c.some(p => p.number === pr.number)) ?? [];
  return `${MARKER}\n### Advisory PR overlap\n${partial ? '\nPartial report: request, file or conflict-check cap reached.\n' : ''}\n`
    + (related.length ? related.map(pairText).join('\n\n') : 'No current overlap found in the scanned PRs.')
    + (cluster.length ? `\n\nSuggested landing order: ${cluster.map(p => '#' + p.number).join(' → ')} (ready, fewer files, lower number).` : '')
    + '\n\nShared paths are advisory; only merge-tree determines textual conflicts. No PR code was executed.';
}
export function summary(overlaps, { partial = false } = {}) {
  return `${MARKER}\n### Open PR overlap summary${partial ? ' (partial)' : ''}\n\n`
    + (overlaps.length ? overlaps.map(pairText).join('\n\n') : 'No overlaps found in the scanned PRs.')
    + '\n\nSuggested landing order:\n' + clusters(overlaps).map(c => '- ' + c.map(p => '#' + p.number).join(' → ')).join('\n')
    + '\n\nAdvisory only. Unchecked pairs are not evidence of a clean merge.';
}
