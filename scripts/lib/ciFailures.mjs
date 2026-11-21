/** D5502 (#5502): bounded test identities and conservative exact-base attribution, independent of shards and log tails. */
import { createHash } from 'node:crypto';
export const safeFile = value => typeof value === 'string' && value.length <= 240 && /^[\w./-]+\.(?:test\.(?:mjs|ts|js)|mjs|ts|js)$/.test(value) && !value.split('/').some(p => p === '..' || !p) && !value.startsWith('/') ? value : null;
const text = value => String(value ?? '').replace(/[\x00-\x1f\x7f\p{Cf}]/gu, ' ').replace(/(?:gh[pousr]_[\w]+|sk-[\w-]+|Bearer\s+\S+)/gi, '[redacted]').slice(0, 240);
export const identity = f => createHash('sha256').update(JSON.stringify(f.kind === 'guard' ? [f.kind, f.file, f.test, f.command] : [f.kind || 'test', f.file, f.test])).digest('hex').slice(0, 24);
const guardId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,99}$/.test(value);
const guardCommand = value => Array.isArray(value) && value.length > 1 && value.length <= 20 && value.every(s => typeof s === 'string' && s.length <= 240 && /^[\w./*{},:@=-]+$/.test(s) && text(s) === s);
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
export function failureReport({ failures = [], files = [], ...meta } = {}) {
  const rows = failures.slice(0, 200).filter(f => safeFile(f.file)).map(f => {
    const row = { kind: f.kind === 'guard' ? 'guard' : 'test', file: safeFile(f.file), test: text(f.test), part: text(meta.part || f.part) };
    if (row.kind === 'guard') {
      row.command = guardCommand(f.command) ? f.command : [];
      row.exitCode = Number.isInteger(f.exitCode) && f.exitCode >= 0 && f.exitCode <= 255 ? f.exitCode : null;
      row.guardStatus = ['failed', 'blocked', 'interrupted', 'not_run'].includes(f.guardStatus) ? f.guardStatus : 'not_run';
    }
    row.id = identity(row);
    const loader = row.file.startsWith('cloudflare-worker/') ? '--experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs ' : row.file.startsWith('frontend/') ? '--import ./frontend/test/_deck-loader.mjs ' : '';
    row.repro = `npm run build && node ${loader}--test --test-name-pattern ${quote(`^${row.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)} ${quote(row.file)}`;
    // Raw assertion values, stack traces and messages may contain user data or tokens. Never publish them.
    row.errorCode = /^(?:ERR_ASSERTION|ERR_TEST_FAILURE|ERR_MODULE_NOT_FOUND|ERR_UNHANDLED_REJECTION)$/.test(f.errorCode || '') ? f.errorCode : 'ERR_TEST_FAILURE';
    row.excerpt = `${row.errorCode}: node:test reported a failing test; inspect the linked job for private assertion details.`;
    if (row.kind === 'guard') {
      row.repro = `npm run build && node scripts/run-guards.mjs --guard ${quote(row.test)}`;
      row.errorCode = 'GUARD_FAILURE';
      row.excerpt = row.guardStatus === 'failed' ? `Guard exited ${row.exitCode}.` : `Guard ${row.guardStatus}; prerequisite or execution evidence is incomplete.`;
    }
    return row;
  });
  return { version: 1, scope: meta.scope === 'guards' || failures.some(f => f.kind === 'guard') || meta.coverageIds?.length ? 'guards' : 'tests', testedSha: /^[a-f0-9]{40}$/.test(meta.testedSha || '') ? meta.testedSha : null,
    headSha: /^[a-f0-9]{40}$/.test(meta.headSha || '') ? meta.headSha : null,
    baseSha: /^[a-f0-9]{40}$/.test(meta.baseSha || '') ? meta.baseSha : null,
    runId: /^\d+$/.test(String(meta.runId)) ? String(meta.runId) : null,
    attempt: /^\d+$/.test(String(meta.attempt)) ? String(meta.attempt) : null,
    part: text(meta.part), complete: meta.complete === true && failures.length <= 200 && files.length <= 20000 && failures.every(f => typeof f.test === 'string' && f.test === text(f.test) && safeFile(f.file) && (f.kind !== 'guard' || guardId(f.test) && guardCommand(f.command) && f.guardStatus === 'failed' && Number.isInteger(f.exitCode) && f.exitCode > 0 && f.exitCode <= 255)),
    status: Number.isInteger(meta.status) ? meta.status : null,
    files: [...new Set(files.filter(safeFile))].slice(0, 20000), coverageIds: Array.isArray(meta.coverageIds) ? meta.coverageIds.filter(id => /^[a-f0-9]{24}$/.test(id)).slice(0, 300) : [], failures: rows };
}
/** D5505: convert a complete full-run producer record into per-guard exact-command coverage. */
export function guardReports(result, meta, status, expected = null) {
  if (result?.version !== 1 || result.scope !== 'guards' || result.mode !== 'full' || result.complete !== true || result.exitCode !== status || !Array.isArray(result.results) || !result.results.length || result.results.length > 300) throw new Error('guard report is incomplete');
  if ((status === 0) !== result.results.every(g => g.status === 'passed')) throw new Error('guard aggregate status is inconsistent');
  if (expected && (expected.length !== result.results.length || expected.some((g, i) => g.id !== result.results[i]?.id || JSON.stringify(g.command) !== JSON.stringify(result.results[i]?.command)))) throw new Error('guard catalog coverage is incomplete');
  const seen = new Set();
  return result.results.map(g => {
    if (!guardId(g.id) || seen.has(g.id) || !safeFile(g.file) || !guardCommand(g.command) || !['passed', 'failed', 'blocked', 'interrupted', 'not_run'].includes(g.status) || g.status === 'passed' && g.exitCode !== 0 || g.status === 'failed' && (!Number.isInteger(g.exitCode) || g.exitCode <= 0 || g.exitCode > 255)) throw new Error('invalid guard result');
    seen.add(g.id);
    const f = { kind: 'guard', file: g.file, test: g.id, command: g.command, exitCode: g.exitCode, guardStatus: g.status };
    const complete = ['passed', 'failed'].includes(g.status);
    return failureReport({ ...meta, scope: 'guards', status: g.status === 'passed' ? 0 : 1, complete,
      files: complete ? [g.file] : [], coverageIds: complete ? [identity(f)] : [], failures: g.status === 'passed' ? [] : [f] });
  });
}
export function compareEvidence({ current = [], base = [], baseSha, incident = null }) {
  const available = /^[a-f0-9]{40}$/.test(baseSha || '') ? base.filter(r => r.version === 1 && r.testedSha === baseSha && r.complete === true && [0, 1, undefined].includes(r.status)) : [];
  const shared = [], own = [], unknown = [];
  const seen = new Set();
  for (const report of current) for (const f of report.failures || []) {
    const id = identity(f); if (seen.has(id)) continue; seen.add(id);
    const row = { ...f, id };
    const covers = available.filter(r => f.kind === 'guard' ? r.coverageIds?.includes(id) : r.scope !== 'guards' && r.files?.includes(f.file));
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
