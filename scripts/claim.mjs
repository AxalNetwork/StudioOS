#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { claimRef, claimMessage, parseClaim, isExpired } from './lib/claims.mjs';

export function githubApi(repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid repository');
  return async (method, path, body) => {
    try {
      return JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${path}`, '--method', method,
        ...(body === undefined ? [] : ['--input', '-'])], { input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) || 'null');
    } catch (error) {
      error.status = Number(/HTTP (\d{3})/.exec(String(error.stderr))?.[1]);
      throw error;
    }
  };
}
async function pages(api, path) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw new Error('pagination cap reached');
}
export async function runClaim({ command, issue, slot, agent, session, ttlHours = 24, now = new Date(), api, log = console.log }) {
  const read = async number => {
    try {
      const ref = await api('GET', `git/ref/heads/claim/${number}`);
      const commit = await api('GET', `git/commits/${ref.object.sha}`);
      return { sha: ref.object.sha, claim: parseClaim(commit.message) };
    } catch (e) { if (e.status === 404) return null; throw e; }
  };
  if (command === 'reap') {
    const refs = await pages(api, 'git/matching-refs/heads/claim/');
    for (const ref of refs) {
      const match = /^refs\/heads\/claim\/([1-9]\d*)$/.exec(ref.ref);
      if (!match) continue;
      const commit = await api('GET', `git/commits/${ref.object.sha}`);
      const claim = parseClaim(commit.message);
      if (!isExpired(claim, now)) continue;
      const marker = `<!-- expired-claim:${match[1]}:${ref.object.sha} -->`;
      const comments = await pages(api, `issues/${match[1]}/comments`);
      if (comments.some(c => c.body?.includes(marker))) continue;
      await api('POST', `issues/${match[1]}/comments`, { body: `${marker}\nClaim expired. The holder must renew or release it; this reaper deletes nothing.` });
    }
    return 0;
  }
  const ref = claimRef(issue);
  if (!['claim', 'renew', 'release', 'show'].includes(command)) throw new Error('expected claim, renew, release, show or reap');
  const current = await read(issue);
  if (command === 'show') { log(current); return 0; }
  if (command === 'claim' && current) { log({ held: current }); return 3; }
  if (command !== 'claim') {
    if (!current || !current.claim || current.claim.issue !== Number(issue) || current.claim.session !== session || current.claim.agent !== agent || current.claim.slot !== slot) {
      log({ held: current, error: 'holder identity does not match' }); return 3;
    }
    if (command === 'release') { await api('DELETE', `git/refs/heads/claim/${issue}`); return 0; }
    if (isExpired(current.claim, now)) { log({ error: 'expired; release and acquire again' }); return 3; }
  }
  const message = claimMessage({ issue, slot, agent, session, at: now, ttlHours });
  try {
    const parent = current?.sha ?? (await api('GET', 'git/ref/heads/main')).object.sha;
    const base = await api('GET', `git/commits/${parent}`);
    const commit = await api('POST', 'git/commits', { message, tree: base.tree.sha, parents: [parent] });
    if (command === 'claim') await api('POST', 'git/refs', { ref, sha: commit.sha });
    else await api('PATCH', `git/refs/heads/claim/${issue}`, { sha: commit.sha, force: false });
    log({ acquired: parseClaim(message), sha: commit.sha });
    return 0;
  } catch (e) {
    if (e.status === 422) { log({ held: await read(issue) }); return 3; }
    if (e.status === 403) { log('Ref permission denied: use the label claim and explicitly record the 403 fallback in STATUS.'); return 4; }
    throw e;
  }
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const issue = args[0] && !args[0].startsWith('--') ? args.shift() : undefined;
  const rest = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--(slot|agent|session|ttl-hours|repo)$/.test(rest[i]) || !rest[i + 1]) throw new Error('invalid option');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return runClaim({ command, issue, slot: options.slot ?? process.env.AGENT_SLOT, agent: options.agent ?? process.env.AGENT_NAME,
    session: options.session ?? process.env.AGENT_SESSION, ttlHours: Number(options['ttl-hours'] ?? 24),
    api: githubApi(options.repo ?? process.env.GH_REPO ?? 'AxalNetwork/StudioOS') });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 1; });
