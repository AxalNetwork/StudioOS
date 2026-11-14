/** D5616: advisory path overlap, classification, landing order and safe Markdown; D5580 adds risk classes and evidence. */
import { RISK, UNMEASURED } from './prRisk.mjs';
const HUBS = new Set(['frontend/src/lib/api.js', 'cloudflare-worker/src/index.ts', 'frontend/src/App.jsx', 'frontend/src/pages/learning/CycleRoute.jsx', 'cloudflare-worker/src/routes/advisors.ts', 'package.json', 'scripts/check-folder-docs.mjs']);
export const MARKER = '<!-- studioos-pr-overlap:v1 -->';
export function classify(path) {
  if (/(^|\/)README\.md$/.test(path)) return 'union';
  if (HUBS.has(path) || /(^|\/)CycleRoute\.jsx$/.test(path)) return 'hub';
  if (path.startsWith('cloudflare-worker/sql/migrations/')) return 'migration';
  if (path.startsWith('cloudflare-worker/src/contracts/')) return 'contract';
  if (/^scripts\/(?:.*-(?:baseline|ledger)\.json$|baselines\/)/.test(path)) return 'baseline';
  if (/(^|\/)_registry\.ts$|\.generated\./.test(path)) return 'generated';
  if (/(^|\/)(?:package(?:-lock)?\.json|pyproject\.toml|uv\.lock|requirements[^/]*\.txt)$/.test(path)) return 'manifest';
  if (path.startsWith('frontend/src/lib/api/')) return 'api';
  if (path.startsWith('cloudflare-worker/sql/')) return 'schema';
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
const span = s => s.end < s.start ? `before ${s.start}` : s.start === s.end ? `${s.start}` : `${s.start}-${s.end}`;
function hunkText(h, p) {
  if (!h) return '';
  if (h.class === 'overlapping-hunks') return ` — hunks overlap: ${h.ranges.map(r => `#${p.a.number} ${span(r.a)} / #${p.b.number} ${span(r.b)}`).join(', ')}`;
  if (h.class === 'same-path-disjoint-hunks') return ` — disjoint hunks: #${p.a.number} ${h.a.map(span).join(', ') || 'none'} / #${p.b.number} ${h.b.map(span).join(', ') || 'none'}`;
  return ` — unknown hunks: ${escape(h.reason)}`;
}
function pairText(p) {
  const verdict = ['yes', 'no', 'not checked'].includes(p.verdict) ? p.verdict : 'not checked';
  const risk = RISK.includes(p.risk) ? `risk: ${p.risk}; ` : '';
  return `#${p.a.number} ↔ #${p.b.number}: ${risk}textual conflict: ${verdict}\n`
    + p.paths.map(f => `- ${RISK.includes(f.risk) && f.risk !== f.hunks?.class ? `${f.risk} (${f.class})` : f.class}: ${escape(f.path)}${f.why ? ` [${escape(f.why)}]` : ''}${hunkText(f.hunks, p)}`).join('\n')
    + (p.migrationStamps.length ? `\n- shared new migration stamp: ${p.migrationStamps.join(', ')}` : '');
}
const num = (v, unit) => Number.isFinite(v) ? `${v} ${unit}` : 'not measured';
const names = xs => xs.map(escape).join(', ');
/** One line per PR: the four evidence fields, never conflated and never 0 when unknown. */
export function evidenceText(pr) {
  if (pr.stale) return `#${pr.number}: stale (head changed during the scan); not classified`;
  if (!pr.evidence) return `#${pr.number}: evidence not read`;
  const e = { ...UNMEASURED(), ...pr.evidence };
  const c = e.checks, q = e.queue, b = e.baseAge;
  const checks = c.status === 'failed' ? `failed: ${names(c.failed)}`
    : c.status === 'pending' ? `pending${c.pending.length ? ': ' + names(c.pending) : ''}${c.missing.length ? `; not reported: ${names(c.missing)}` : ''}`
    : c.status === 'unknown' ? `unknown (${escape(c.reason)})${c.failedAny?.length ? `; failed (required set unknown): ${names(c.failedAny)}` : ''}` : escape(c.status);
  const queue = q.status === 'measured' ? `max ${num(q.maxMinutes, 'min')} over ${q.jobs} jobs${q.stillQueued ? `, ${q.stillQueued} still queued (longest ${q.longestQueuedMinutes} min)` : ''}` : `not measured (${escape(q.reason)})`;
  const base = b.status === 'measured' ? `${b.behindBy} commits behind, merge base ${num(b.ageHours, 'h')} old` : `unknown (${escape(b.reason)})`;
  return `#${pr.number}: merge vs base: ${escape(e.merge.status)}${e.merge.mergeableState !== 'unknown' ? ` (${escape(e.merge.mergeableState)})` : ''} · required checks: ${checks} · CI queue: ${queue} · base: ${base}`;
}
const notesText = notes => notes.length ? '\n\n' + notes.map(n => `- ${escape(n)}`).join('\n') : '';
export function render(pr, overlaps, { partial = false } = {}) {
  const evidence = pr.evidence || pr.stale ? `\n\nEvidence: ${evidenceText(pr)}` : '';
  const related = overlaps.filter(p => p.a.number === pr.number || p.b.number === pr.number);
  const cluster = clusters(overlaps).find(c => c.some(p => p.number === pr.number)) ?? [];
  return `${MARKER}\n### Advisory PR overlap\n${partial ? '\nPartial report: request, file or conflict-check cap reached.\n' : ''}\n`
    + (related.length ? related.map(pairText).join('\n\n') : 'No current overlap found in the scanned PRs.')
    + (cluster.length ? `\n\nSuggested landing order: ${cluster.map(p => '#' + p.number).join(' → ')} (ready, fewer files, lower number).` : '')
    + evidence
    + '\n\nShared paths are advisory; only merge-tree determines textual conflicts. No PR code was executed.';
}
export function summary(overlaps, { partial = false, notes = [] } = {}) {
  const involved = [...new Map(overlaps.flatMap(p => [p.a, p.b]).map(p => [p.number, p])).values()].filter(p => p.evidence).sort((a, b) => a.number - b.number);
  return `${MARKER}\n### Open PR overlap summary${partial ? ' (partial)' : ''}\n\n`
    + (overlaps.length ? overlaps.map(pairText).join('\n\n') : 'No overlaps found in the scanned PRs.')
    + '\n\nSuggested landing order:\n' + clusters(overlaps).map(c => '- ' + c.map(p => '#' + p.number).join(' → ')).join('\n')
    + (involved.length ? '\n\nEvidence per PR:\n' + involved.map(p => '- ' + evidenceText(p)).join('\n') : '')
    + notesText(notes)
    + '\n\nAdvisory only. Unchecked pairs are not evidence of a clean merge.';
}
