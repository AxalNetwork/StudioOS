// D5666: read-only context adapter; never imports a GitHub writer, claim mutator, review/repair dispatcher or merge client.
import { parseClaim } from './lib/claims.mjs';
export async function readRoutingContext({ read, repository, prNumber, linkedIssues = [] }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9]\d*$/.test(String(prNumber)) || linkedIssues.some(n => !/^[1-9]\d*$/.test(String(n)))) throw new Error('routing_context_invalid');
  const root = `/repos/${repository}`, pull = await read(`${root}/pulls/${prNumber}`);
  const pr = { number: pull.number, state: pull.state, merged: pull.merged, draft: pull.draft, head: { sha: pull.head?.sha }, base: { sha: pull.base?.sha }, user: { login: pull.user?.login }, requested_reviewers: pull.requested_reviewers?.map(r => ({ login: r.login })), fork: pull.head?.repo?.full_name !== pull.base?.repo?.full_name };
  let ruleset = null; try { ruleset = await read(`${root}/rulesets/25309597`); } catch { /* unreadable scope remains unknown */ }
  const issues = [], claims = [];
  // Linked IDs must come from approved source/closing-reference metadata; never guess from a branch/display name.
  for (const number of [...new Set(linkedIssues.map(Number))]) {
    try {
      const item = await read(`${root}/issues/${number}`); issues.push({ number: item.number, state: item.state, labels: (item.labels || []).map(l => ({ name: l.name })) });
      try {
        const ref = await read(`${root}/git/ref/heads/claim/${number}`);
        if (ref.ref !== `refs/heads/claim/${number}` || !/^[a-f0-9]{40}$/.test(ref.object?.sha || '')) continue;
        const commit = await read(`${root}/git/commits/${ref.object.sha}`), claim = parseClaim(commit.message);
        if (claim) claims.push({ issue: number, ref: ref.ref, message: JSON.stringify(claim) });
      } catch (error) { if (error.code !== 'resource_absent') claims.push({ issue: number, ref: `refs/heads/claim/${number}`, unreadable: true }); }
    } catch { issues.push({ number, labels: [], unreadable: true }); }
  }
  return { pr, ruleset, issues, claims };
}
export function readOnlyGithub({ token, fetchImpl = fetch }) {
  return async path => {
    if (!token || !/^\/repos\/[\w.-]+\/[\w.-]+\//.test(path) || /[\r\n]/.test(path)) throw new Error('read_scope_unavailable');
    const response = await fetchImpl(`https://api.github.com${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'studioos-routing-observer' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || response.headers.get('x-ratelimit-remaining') === '0') { const error = new Error('read_scope_unavailable'); error.code = response.status === 404 ? 'resource_absent' : 'scope_unreadable'; throw error; }
    return response.json();
  };
}
