/** D7672 (#7672): offline import planner. Writes restricted parameterized batches outside this public checkout; never executes them. */
import { openSync, closeSync, fstatSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildDirectoryPlan } from './lib/networkDirectoryPlan.mjs';
import { recordsDigest } from './lib/networkDirectoryDigest.mjs';

// One descriptor per input: the size check, the snapshot hash and the parse all see the same bytes.
function readInput(path) {
  const fd=openSync(path,'r');
  try {
    if (fstatSync(fd).size > 32*1024*1024) throw new Error('Input exceeds 32 MiB');
    const bytes=readFileSync(fd);
    if (bytes.length > 32*1024*1024) throw new Error('Input exceeds 32 MiB');
    return bytes;
  } finally { closeSync(fd); }
}
const readJson=(path)=>JSON.parse(readInput(path).toString('utf8'));
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
    const bytes=readInput(path), r=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(r))throw new Error('Record input must be an array');
    if(manifest.source_snapshot_sha256){
      const expected=manifest.source_snapshot_sha256[basename(path)];
      const actual=createHash('sha256').update(bytes).digest('hex');
      if(!expected || expected!==actual)throw new Error('Reviewed source snapshot mismatch');
    }
    return r;
  });
  const plan=buildDirectoryPlan({records,manifest});
  writeFileSync(out,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
  // D7674 part 2: the snapshot an organisation apply upload names, digested as the Worker digests it.
  const summary={...plan.summary,snapshot:{record_count:records.length,records_sha256:await recordsDigest(records)}};
  if(report)writeFileSync(report,JSON.stringify(summary,null,2)+'\n',{mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
} catch(error) {
  // Parser errors can quote a raw input/email; never print their message.
  process.stderr.write('Directory planning failed. Check input shape, review manifest and unused output paths outside the repository. No database was contacted.\n');
  process.exitCode=1;
}
