// D5664: overlap and split capped REST slices; checkpoint only durable complete windows, preserving explicit gaps.
import { boundedBody } from './ingress.mjs';
export async function reconcileWindow({ list, accept, gap, start, end, scope, cap = 1000 }) {
  const first = await list({ start, end, page: 1 });
  if (first.total > cap) {
    if (end - start <= 1000) { await gap({ scope, code: 'source_density_exceeds_cap', from: start, to: end }); return false; }
    const middle = Math.floor((start + end) / 2000) * 1000;
    const a = await reconcileWindow({ list, accept, gap, start, end: middle, scope, cap });
    const b = await reconcileWindow({ list, accept, gap, start: middle + 1000, end, scope, cap });
    return a && b;
  }
  if (!Array.isArray(first.items) || !Number.isSafeInteger(first.total) || first.total < 0) throw new Error('source_shape_invalid');
  let count = 0;
  for (let page = 1; ; page++) {
    const current = page === 1 ? first : await list({ start, end, page });
    if (!Array.isArray(current.items) || current.total > cap || current.total !== first.total) throw new Error('source_window_changed');
    for (const record of current.items) { await accept(record); count++; }
    if (current.items.length < 100) break;
    if (page >= Math.ceil(cap / 100)) break;
  }
  if (count < first.total) { await gap({ scope, code: 'source_page_missing', from: start, to: end }); return false; }
  return true;
}
export async function reconcile({ ledger, source, until, overlapMs = 300_000 }) {
  const scope = source.scope, from = Math.max(source.start, ledger.cursor(scope) - overlapMs);
  try {
    for (const pending of await ledger.pending()) await source.recheck(pending, event => ledger.append(event));
    const complete = await reconcileWindow({ scope, start: from, end: until, list: options => source.list(options), accept: async event => { await ledger.append(event); await source.enrich?.(event, value => ledger.append(value)); }, gap: value => ledger.recordGap(value) });
    ledger.recordGap({ scope, code: 'poll_cannot_reconstruct_intermediate_transitions', from, to: until });
    if (complete) ledger.checkpoint(scope, until);
    return complete;
  } catch (error) {
    const code = ['permission_revoked', 'rate_limited', 'source_unavailable', 'source_window_changed', 'source_shape_invalid'].includes(error.message) ? error.message : 'reconciliation_interrupted';
    ledger.recordGap({ scope, code, from, to: until }); return false;
  }
}
export function githubReader({ token, fetchImpl = fetch }) {
  return async path => {
    if (!token || !/^\/repos\/[\w.-]+\/[\w.-]+\//.test(path) || /[\r\n]/.test(path)) throw new Error('permission_revoked');
    const response = await fetchImpl(`https://api.github.com${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'studioos-notification-reader' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') throw new Error('rate_limited');
    if ([401, 403, 404].includes(response.status)) throw new Error('permission_revoked');
    if (!response.ok) throw new Error('source_unavailable');
    return JSON.parse(new TextDecoder().decode(await boundedBody(response, 8_000_000)));
  };
}
