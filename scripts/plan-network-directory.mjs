/** D7672 (#7672): offline import planner. Writes restricted parameterized batches outside this public checkout; never executes them. */
import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildDirectoryPlan } from './lib/networkDirectoryPlan.mjs';

function readJson(path) {
  if (statSync(path).size > 32*1024*1024) throw new Error('Input exceeds 32 MiB');
  return JSON.parse(readFileSync(path,'utf8'));
}
function outputPath(path) {
  const absolute=resolve(path), parent=realpathSync(dirname(absolute));
  const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
  if (parent===root || parent.startsWith(root+sep)) throw new Error('Restricted output must be outside this public repository');
  return resolve(parent,basename(absolute));
}
try {
  const {values}=parseArgs({options:{records:{type:'string',multiple:true},manifest:{type:'string'},out:{type:'string'},report:{type:'string'}},strict:true,allowPositionals:false});
  if (!values.records?.length || !values.manifest || !values.out) throw new Error('Usage: node scripts/plan-network-directory.mjs --records file.json [--records file.json] --manifest reviewed.json --out outside-repo-plan.json [--report outside-repo-summary.json]');
  const out=outputPath(values.out), report=values.report?outputPath(values.report):null;
  const manifest=readJson(values.manifest);
  const records=values.records.flatMap(path=>{
    const r=readJson(path);if(!Array.isArray(r))throw new Error('Record input must be an array');
    if(manifest.source_snapshot_sha256){
      const expected=manifest.source_snapshot_sha256[basename(path)];
      const actual=createHash('sha256').update(readFileSync(path)).digest('hex');
      if(!expected || expected!==actual)throw new Error('Reviewed source snapshot mismatch');
    }
    return r;
  });
  const plan=buildDirectoryPlan({records,manifest});
  writeFileSync(out,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
  if(report)writeFileSync(report,JSON.stringify(plan.summary,null,2)+'\n',{mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify(plan.summary,null,2)+'\n');
} catch(error) {
  // Parser errors can quote a raw input/email; never print their message.
  process.stderr.write('Directory planning failed. Check input shape, review manifest and unused output paths outside the repository. No database was contacted.\n');
  process.exitCode=1;
}
