#!/usr/bin/env node
// #6476 owner addition: show a confirmed merge conflict in the PR list with the existing `conflict` label, and clear it
// only on fresh, positive mergeability for the current head and base. Metadata only: no merge, model, enqueue or rerun.
/**
 *   node conflict-indicator.mjs   reads and writes labels with GH_TOKEN (the workflow's GITHUB_TOKEN)
 *
 * The label explains; it authorises nothing. The keeper, resolver, feeder and ejection handler read GitHub's own
 * mergeability and their own records, never this label, to decide what they may do (D6476-p5).
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABELS } from './rules.mjs';
import { client } from './keeper.mjs';

const SHA = /^[0-9a-f]{40}$/;
const names = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l?.name));

/**
 * What the label should do for one PR, from the list read.
 * @param pr { labels, mergeable: 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN' | null, baseRef }
 * @returns 'add' | 'confirm-clear' | 'none'
 */
export function listAction(pr) {
  if (pr?.baseRef !== 'main') return 'none';
  const labelled = names(pr?.labels).includes(LABELS.conflict);
  if (pr?.mergeable === 'CONFLICTING') return labelled ? 'none' : 'add';
  if (pr?.mergeable === 'MERGEABLE' && labelled) return 'confirm-clear';
  // Unknown, null or unread never changes the label: a stale or uncomputed answer neither adds nor clears it.
  return 'none';
}

/**
 * Whether a fresh REST read confirms the conflict is gone on exactly the head and base the list saw.
 * @param listed { headSha }   @param fresh GET pulls/{n}   @param mainSha the current main head
 */
export function confirmsClear(listed, fresh, mainSha) {
  const reasons = [];
  if (fresh?.mergeable !== true) reasons.push(`GitHub's fresh mergeable is ${fresh?.mergeable ?? 'unread'}, not true`);
  if (!SHA.test(listed?.headSha ?? '') || fresh?.head?.sha !== listed.headSha) reasons.push('the head moved since the list was read');
  if (!SHA.test(mainSha ?? '') || fresh?.base?.ref !== 'main' || fresh?.base?.sha !== mainSha) reasons.push('the base is not the current main head');
  return { ok: reasons.length === 0, reasons };
}

const Q = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100,after:$after){
  pageInfo{hasNextPage endCursor}
  nodes{number mergeable baseRefName headRefOid labels(first:50){nodes{name}}}}}}`;

/** One sweep: every open PR into main, at most 500. Returns what it did, per PR. */
export async function sweep(env, { gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }) } = {}) {
  const prs = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const repo = await gh.graph(Q, { after });
    const conn = repo.pullRequests;
    for (const n of conn.nodes) {
      prs.push({ number: n.number, mergeable: n.mergeable ?? null, baseRef: n.baseRefName, headSha: n.headRefOid, labels: (n.labels?.nodes || []).map((l) => l.name) });
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  // Read main once, after the list: a PR read before main moved can only be confirmed against the newer main if
  // GitHub has recomputed it, which the per-PR base sha check below enforces.
  const mainSha = (await gh.get('branches/main'))?.commit?.sha ?? null;
  const log = [];
  for (const pr of prs) {
    const action = listAction(pr);
    if (action === 'add') {
      await gh.post(`issues/${pr.number}/labels`, { labels: [LABELS.conflict] });
      log.push({ number: pr.number, result: 'labelled conflict' });
    } else if (action === 'confirm-clear') {
      let fresh = null;
      try { fresh = await gh.get(`pulls/${pr.number}`); } catch { /* unread: kept */ }
      const c = confirmsClear(pr, fresh, mainSha);
      if (!c.ok) { log.push({ number: pr.number, result: `kept: ${c.reasons.join('; ')}` }); continue; }
      try { await gh.del(`issues/${pr.number}/labels/${encodeURIComponent(LABELS.conflict)}`); } catch (e) { if (e?.status !== 404) throw e; }
      log.push({ number: pr.number, result: 'cleared conflict' });
    }
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, log.map((l) => `- #${l.number}: ${String(l.result).replace(/[\r\n]+/g, ' ')}`).join('\n') + '\n');
  return log;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sweep(process.env).catch((e) => { console.error(`conflict indicator: ${String(e?.message || e).slice(0, 200)}`); process.exitCode = 1; });
}
