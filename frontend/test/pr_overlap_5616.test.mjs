/** D5616: path overlap is advisory; actual git merges determine conflicts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classify, pairs, order, render, summary, escape } from '../../scripts/lib/prOverlap.mjs';
import { mergeTree, report, upsert, makeApi } from '../../scripts/pr-overlap.mjs';
const pr = (number, files, draft = false) => ({ number, files, draft });
const path = 'cloudflare-worker/src/routes/partner_delivery.ts';
test('the four partner delivery PRs form six pairs; README-only shares are ignored', () => {
  const ps = [5562, 5563, 5553, 5523].map(n => pr(n, [path]));
  const result = pairs(ps);
  assert.equal(result.length, 6);
  for (const p of result) assert.deepEqual(p.paths, [{ path, class: 'path' }]);
  assert.deepEqual(pairs([pr(1, ['README.md']), pr(2, ['README.md'])]), []);
  assert.deepEqual(pairs([pr(1, ['a/README.md']), pr(2, ['a/README.md'])]), []);
});
test('classifies hubs, contracts, baselines, generated paths and new migration stamps', () => {
  for (const [p, expected] of [['package.json','hub'],['scripts/check-folder-docs.mjs','hub'],['frontend/src/lib/api.js','hub'],['cloudflare-worker/src/contracts/a.ts','contract'],['scripts/x-baseline.json','baseline'],['scripts/a-ledger.json','baseline'],['scripts/baselines/a.json','baseline'],['a/_registry.ts','generated'],['a.generated.js','generated'],['x.ts','path']]) assert.equal(classify(p), expected);
  const result = pairs([pr(1, ['cloudflare-worker/sql/migrations/202611112000_1_a.sql']), pr(2, ['cloudflare-worker/sql/migrations/202611112000_2_b.sql'])]);
  assert.deepEqual(result[0].migrationStamps, ['202611112000']);
  assert.equal(result[0].paths.length, 0);
  assert.equal(pairs([pr(1, [{ filename:'cloudflare-worker/sql/migrations/202611112000_1_a.sql',status:'modified' }]),pr(2,['cloudflare-worker/sql/migrations/202611112000_2_b.sql'])]).length, 0);
});
test('landing order prefers ready, fewer changed files, then issue number', () => {
  assert.deepEqual(order([pr(4,[],true),pr(3,['x']),pr(2,['x']),pr(1,['x','y'])]).map(p=>p.number),[2,3,1,4]);
});
test('renders the supplied clean verdict and escapes paths, mentions and titles', () => {
  const ps = [pr(1, [path]), pr(2,[path])];
  const result = pairs(ps); result[0].verdict = 'no';
  result[0].paths.push({ path:'[x]`|@name<SCRIPT>\n',class:'path' });
  const text = render(ps[0],result);
  assert.match(text,/textual conflict: no/); assert.doesNotMatch(text,/textual conflict: yes|@name|<script>|\[x\]/i);
  assert.match(text,/&#64;name/); assert.match(summary(result),/#1 → #2/);
  assert.equal(escape('a|b'), 'a&#124;b');
});
test('merge-tree in a real temp repository identifies clean and conflicting pairs', () => {
  const cwd=mkdtempSync(join(tmpdir(),'overlap-'));
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try {
    git('init','-b','main'); git('config','user.name','test'); git('config','user.email','test@example.invalid');
    writeFileSync(join(cwd,'x'),'base\n');git('add','.');git('commit','-m','base');
    const base=git('rev-parse','HEAD');
    writeFileSync(join(cwd,'x'),'left\n');git('commit','-am','left');const left=git('rev-parse','HEAD');
    git('checkout','-b','right',base);writeFileSync(join(cwd,'x'),'right\n');git('commit','-am','right');const right=git('rev-parse','HEAD');
    git('checkout','-b','clean',base);writeFileSync(join(cwd,'y'),'clean\n');git('add','.');git('commit','-m','clean');const clean=git('rev-parse','HEAD');
    assert.equal(mergeTree(left,right,{cwd}),'yes');assert.equal(mergeTree(left,clean,{cwd}),'no');
    assert.equal(mergeTree('--help',clean,{cwd}),'not checked');
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});
test('marker comments update only on change; dry run and second unchanged report write nothing',async()=>{
  const comments=new Map(),writes=[];let id=0;
  const api=async(method,path,body)=>{
    if(method==='GET' && path.startsWith('pulls?'))return [pr(1,[]),pr(2,[])];
    if(method==='GET' && path.includes('/files?'))return [{filename:'shared.ts',status:'modified'}];
    if(method==='GET')return comments.get(Number(path.split('/')[1]))??[];
    writes.push({method,path,body});
    const number=Number(path.split('/')[1]);
    if(method==='POST')comments.set(number,[{id:++id,body:body.body,user:{type:'Bot',login:'github-actions[bot]'}}]);
    else for(const rows of comments.values())for(const row of rows)if(row.id===Number(path.split('/').at(-1)))row.body=body.body;
    return {};
  };
  const options={api,checkPair:async()=> 'no',log() {}};
  assert.equal((await report({...options,dryRun:true})).writes,0);
  assert.equal(writes.length,0);
  assert.equal((await report({...options,dryRun:false})).writes,3);
  assert.equal((await report({...options,dryRun:false})).writes,0);
  assert.equal(await upsert(api,1,'<!-- studioos-pr-overlap:v1 -->\nchanged'),1);
  assert.equal(writes.at(-1).method,'PATCH');
});
test('caps produce partial summaries and rate-limit headers stop further requests',async()=>{
  let calls=0;
  const api=makeApi('AxalNetwork/StudioOS',{exec:()=>{calls++;return 'HTTP/2 200\nx-ratelimit-remaining: 10\n\n[]';}});
  await api('GET','pulls');await assert.rejects(api('GET','pulls'),/cap/);assert.equal(calls,1);
  const result=await report({api:async(m,p)=>p.startsWith('pulls?')?[pr(1,[]),pr(2,[])]:[{filename:'x'}],maxPairs:0,log(){}});
  assert.equal(result.partial,true);assert.equal(result.overlaps[0].verdict,'not checked');
});
test('workflow has exact read/comment permissions, pinned actions, and safe triggers',()=>{
  const source=readFileSync('.github/workflows/pr-overlap.yml','utf8');
  assert.match(source,/^permissions: \{\}$/m);
  const permissions=[...source.matchAll(/^      (contents|issues|pull-requests): (\w+)$/gm)].map(m=>m.slice(1));
  assert.deepEqual(permissions,[['contents','read'],['issues','write'],['pull-requests','write']]);
  assert.doesNotMatch(source,/workflow_run|pull_request_target/);
  assert.match(source,/filter: blob:none/);assert.match(source,/if: github.ref == 'refs\/heads\/main'/);
  for(const match of source.matchAll(/uses: (\S+)/g))assert.match(match[1],/@[a-f0-9]{40}$/);
});
