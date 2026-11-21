/** D5502 (#5502): bounded test identities and conservative exact-base attribution, independent of shards and log tails. */
import { createHash } from 'node:crypto';
export const safeFile = value => typeof value === 'string' && value.length <= 240 && /^[\w./-]+\.(?:test\.(?:mjs|ts|js)|mjs|ts|js)$/.test(value) && !value.split('/').some(p => p === '..' || !p) && !value.startsWith('/') ? value : null;
const text = value => String(value ?? '').replace(/[\x00-\x1f\x7f\p{Cf}]/gu, ' ').replace(/(?:gh[pousr]_[\w]+|sk-[\w-]+|Bearer\s+\S+)/gi, '[redacted]').slice(0, 240);
export const identity = f => createHash('sha256').update(JSON.stringify([f.kind || 'test', f.file, f.test])).digest('hex').slice(0, 24);
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
export function failureReport({ failures = [], files = [], ...meta } = {}) {
  const rows = failures.slice(0, 200).filter(f => safeFile(f.file)).map(f => {
    const row = { kind: 'test', file: safeFile(f.file), test: text(f.test), part: text(meta.part || f.part) };
    row.id = identity(row);
    const loader = row.file.startsWith('cloudflare-worker/') ? '--experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs ' : row.file.startsWith('frontend/') ? '--import ./frontend/test/_deck-loader.mjs ' : '';
    row.repro = `npm run build && node ${loader}--test --test-name-pattern ${quote(`^${row.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)} ${quote(row.file)}`;
    // Raw assertion values, stack traces and messages may contain user data or tokens. Never publish them.
    row.errorCode = /^(?:ERR_ASSERTION|ERR_TEST_FAILURE|ERR_MODULE_NOT_FOUND|ERR_UNHANDLED_REJECTION)$/.test(f.errorCode || '') ? f.errorCode : 'ERR_TEST_FAILURE';
    row.excerpt = `${row.errorCode}: node:test reported a failing test; inspect the linked job for private assertion details.`;
    return row;
  });
  return { version: 1, testedSha: /^[a-f0-9]{40}$/.test(meta.testedSha || '') ? meta.testedSha : null,
    baseSha: /^[a-f0-9]{40}$/.test(meta.baseSha || '') ? meta.baseSha : null,
    runId: /^\d+$/.test(String(meta.runId)) ? String(meta.runId) : null,
    attempt: /^\d+$/.test(String(meta.attempt)) ? String(meta.attempt) : null,
    part: text(meta.part), complete: meta.complete === true && failures.length <= 200 && files.length <= 20000 && failures.every(f => typeof f.test === 'string' && f.test === text(f.test) && safeFile(f.file)),
    status: Number.isInteger(meta.status) ? meta.status : null,
    files: [...new Set(files.filter(safeFile))].slice(0, 20000), failures: rows };
}
export function compareEvidence({ current = [], base = [], baseSha, incident = null }) {
  const available = /^[a-f0-9]{40}$/.test(baseSha || '') ? base.filter(r => r.version === 1 && r.testedSha === baseSha && r.complete === true && [0, 1, undefined].includes(r.status)) : [];
  const shared = [], own = [], unknown = [];
  const seen = new Set();
  for (const report of current) for (const f of report.failures || []) {
    const id = identity(f); if (seen.has(id)) continue; seen.add(id);
    const row = { ...f, id };
    const covers = available.filter(r => r.files?.includes(f.file));
    if (!report.complete || !covers.length) unknown.push(row);
    else if (covers.some(r => r.failures?.some(b => identity(b) === id))) shared.push(row);
    else own.push(row);
  }
  const verdict = own.length ? 'pr_failure' : unknown.length || !shared.length ? 'main_health_unknown' : 'inherited_main_failure';
  return { verdict, shared, own, unknown, baseSha, incident };
}
const html = s => String(s ?? '').replace(/[&<>`\[\]()*_!#|~]/g, c => `&#${c.charCodeAt(0)};`);
export function renderEvidence(result) {
  const lines = [`### CI failure evidence: ${result.verdict}`, '', `Tested base: ${html(result.baseSha || 'unknown')}`, ''];
  for (const [label, rows] of [['Inherited', result.shared], ['Independent', result.own], ['Unknown', result.unknown]]) {
    for (const f of rows.slice(0, 10)) lines.push(`${label}: ${html(f.file)} — ${html(f.test)} (${html(f.part)})`, ...(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/job\/\d+$/.test(f.jobUrl || '') ? [`Job: ${f.jobUrl}`] : []), '', `<pre>${html(f.repro)}</pre>`, '');
    if (rows.length > 10) lines.push(`${rows.length - 10} more ${label.toLowerCase()} failures in the artifact.`);
  }
  if (!result.shared.length && !result.own.length && !result.unknown.length) lines.push('No complete test evidence: setup, build, guard, delegated or cancelled job. Read its job link; attribution is unknown.');
  return lines.join('\n').slice(0, 20000);
}
