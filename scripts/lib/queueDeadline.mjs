/** D5974: bounded, read-only current merge-queue evidence; no absent/partial read implies recovery. */
import { queueDeadline } from './ciScorecard.mjs';
export const DEADLINE_READ_LIMITS = Object.freeze({ pages: 3, checksPages: 2, candidates: 10 });
const SHA = /^[a-f0-9]{40}$/;
const query = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){mergeQueue(branch:"main"){entries(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor} nodes{headCommit{oid} pullRequest{number}}}}}}`;
export async function readDeadlineEvidence({ rest, graph, repo }) {
  const [owner,name,...extra]=String(repo).split('/');
  if (!owner || !name || extra.length || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  async function members() {
    const heads=[];let cursor=null,count=0,total=null;
    for(let page=0;page<DEADLINE_READ_LIMITS.pages;page++) {
      const r=await graph(query,{owner,name,cursor});
      const e=r?.repository?.mergeQueue?.entries;
      if(!e || !Array.isArray(e.nodes) || !Number.isSafeInteger(e.totalCount) || e.totalCount<0 || typeof e.pageInfo?.hasNextPage!=='boolean') throw new Error('Queue membership unreadable');
      if(total!==null && total!==e.totalCount) throw new Error('Queue changed during pagination');
      total=e.totalCount;count+=e.nodes.length;
      for(const n of e.nodes) {
        if(!Number.isSafeInteger(n?.pullRequest?.number) || n.pullRequest.number<1) throw new Error('Invalid queue member');
        if(n.headCommit===null) continue; // No candidate built yet; no response clock to measure.
        if(!SHA.test(n.headCommit?.oid??'')) throw new Error('Candidate head unreadable');
        heads.push({sha:n.headCommit.oid,pr:n.pullRequest.number});
      }
      if(!e.pageInfo.hasNextPage) { if(count!==total) throw new Error('Partial queue membership'); return heads; }
      if(!e.pageInfo.endCursor || e.pageInfo.endCursor===cursor) throw new Error('Queue cursor unreadable');
      cursor=e.pageInfo.endCursor;
    }
    throw new Error('Queue page limit reached');
  }
  const rules=await rest('rules/branches/main');
  const deadlineMinutes=queueDeadline(rules);
  const required=Array.isArray(rules)?rules.filter(r=>r?.type==='required_status_checks').flatMap(r=>r.parameters?.required_status_checks??[]):null;
  if(!deadlineMinutes || !required?.length || required.some(r=>typeof r.context!=='string'||!r.context)) throw new Error('Required checks/deadline unreadable');
  const before=await members();
  if(before.length>DEADLINE_READ_LIMITS.candidates) throw new Error('Candidate limit reached');
  if(!before.length) return {runs:[],activeHeads:[],required,deadlineMinutes};
  const runs=[];
  for(let page=1;page<=DEADLINE_READ_LIMITS.pages;page++) {
    const list=await rest(`actions/workflows/ci.yml/runs?event=merge_group&per_page=100&page=${page}`);
    if(!Array.isArray(list?.workflow_runs)||!Number.isSafeInteger(list.total_count)) throw new Error('Queue runs unreadable');
    runs.push(...list.workflow_runs);
    if(before.every(h=>runs.some(r=>r.head_sha===h.sha)) || runs.length>=list.total_count) break;
  }
  const checks=new Map();
  for(const h of before) {
    try {
      const rows=[];
      for(let page=1;page<=DEADLINE_READ_LIMITS.checksPages;page++) {
        const r=await rest(`commits/${h.sha}/check-runs?filter=latest&per_page=100&page=${page}`);
        if(!Array.isArray(r?.check_runs)||!Number.isSafeInteger(r.total_count)) throw new Error('Checks unreadable');
        rows.push(...r.check_runs);
        if(rows.length>=r.total_count) {checks.set(h.sha,rows);break;}
      }
      if(!checks.has(h.sha)) checks.set(h.sha,null);
    } catch {checks.set(h.sha,null);}
  }
  const after=await members();
  // A newly appeared head was not sampled. Preserve unknown rather than closing an existing alert.
  if(after.some(h=>!before.some(b=>b.sha===h.sha))) throw new Error('Queue changed during observation');
  return {runs:runs.map(r=>({...r,checks:checks.get(r.head_sha)??null})),activeHeads:after,required,deadlineMinutes};
}
