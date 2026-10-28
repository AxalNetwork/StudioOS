import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assetPath, assetProblem, entriesFromLedger, entryRefsFromHtml, parseViteMapDeps } from './spaChunks.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Actual Vite 8.3.4 output from a two-module app with lazy CSS; never executed.
const built = readFileSync(new URL('../fixtures/vite-lazy-entry.js', import.meta.url), 'utf8');
const map = refs => `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${JSON.stringify(refs)})))=>i.map(i=>d[i]);`;

test('#3590: the built Vite fixture names its lazy JS and CSS', () => {
  assert.deepEqual(parseViteMapDeps(built), ['/assets/lazy-DjuSBO6k.js', '/assets/lazy-C9phDneD.css']);
});

test('#3590: decode JSON escapes and deduplicate without executing the entry', () => {
  const source = String.raw`const __vite__mapDeps=(x,c=__vite__mapDeps,d=(c.f||(c.f=["assets\/one.js","assets/one.js","./assets/two.css"])))=>x.map(x=>d[x]);globalThis.__spaParserExecuted=true;`;
  assert.deepEqual({ refs: parseViteMapDeps(source), executed: globalThis.__spaParserExecuted }, {
    refs: ['/assets/one.js', '/assets/two.css'], executed: undefined,
  });
});

test('#3590: missing, empty, malformed and unsafe dependency lists fail closed', () => {
  for (const source of [
    'export const unrelated=[];', map([]), map([null]), map([1]),
    map(['https://other.test/assets/one.js']), map(['assets/../one.js']),
    map(['assets/%2e%2e/one.js']), map(['assets/image.svg']),
    'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[compute()])))=>i.map(i=>d[i]);',
    'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/one.js",])))=>i.map(i=>d[i]);',
    'const __vite__mapDeps=bad; const unrelated=(m.f||(m.f=["assets/one.js"]));',
  ]) assert.throws(() => parseViteMapDeps(source), Error);
  assert.throws(() => assetPath('../assets/one.js'), /Invalid/);
});

test('#3590: only module-script entries, in either attribute order, seed the graph', () => {
  assert.deepEqual(entryRefsFromHtml(`<link rel="modulepreload" href="/assets/shared.js"><link href="/assets/style.css">
    <script src='/assets/current.js' type='module'></script><script type="module" src="/assets/current.js"></script>
    <script src="/assets/legacy.js"></script>`), ['/assets/current.js']);
  assert.deepEqual(entryRefsFromHtml(`<script type="module" src="https://apex.test/assets/current.js?version=2"></script>
    <script type="module" src="/assets/current.js#module"></script><script type="module" src="https://other.test/assets/vendor.js"></script>
    <script type="module" src="/telemetry.js"></script>`, 'https://apex.test'), ['/assets/current.js']);
});

const ledger = { builds: [
  { files: ['index-new.js', 'helper.js', 'style.css'] },
  { files: ['index-old.js', 'helper.js', 'style.css'] },
] };
const readAsset = file => file.startsWith('index-') ? built : 'export const helper=1;';

test('#3590: pre-build capture selects newest; the scheduled cache selects previous', () => {
  assert.deepEqual([
    entriesFromLedger({ ledger, readAsset }),
    entriesFromLedger({ ledger, readAsset, generation: 1 }),
    entriesFromLedger({ ledger: { builds: [ledger.builds[0]] }, readAsset, generation: 1 }),
  ], [
    { entries: ['/assets/index-new.js'], reason: null },
    { entries: ['/assets/index-old.js'], reason: null },
    { entries: [], reason: 'no-previous-build' },
  ]);
});

test('#3590: an unreadable retained generation is not silently omitted', () => {
  for (const bad of [{}, { builds: [] }, { builds: [{}] }, { builds: [{ files: [] }] },
    { builds: [{ files: ['../index.js'] }] }, { builds: [{ files: [42] }] },
    { builds: [{ files: ['helper.js'] }] }]) {
    assert.throws(() => entriesFromLedger({ ledger: bad, readAsset }), Error);
  }
  assert.throws(() => entriesFromLedger({ ledger, readAsset() { throw new Error('missing retained asset'); } }), /missing retained/);
  assert.throws(() => entriesFromLedger({ ledger, readAsset: () => 'const __vite__mapDeps=bad;' }), /Unreadable/);
  assert.throws(() => entriesFromLedger({ ledger: { builds: [{}] }, generation: 1, readAsset }), /Unreadable/);
});

test('#3590: HTTP 200 and the right JS/CSS MIME type are both required', () => {
  const cases = [
    [200, 'application/javascript; charset=utf-8', '/assets/a.js', false],
    [200, 'text/javascript', '/assets/a.js', false],
    [200, 'text/css; charset=utf-8', '/assets/a.css', false],
    [404, 'application/javascript', '/assets/a.js', true],
    [200, 'text/html', '/assets/a.js', true],
    [200, 'application/javascript', '/assets/a.css', true],
    [200, 'application/not-javascript', '/assets/a.js', true],
    [200, '', '/assets/a.js', true],
  ];
  assert.deepEqual(cases.map(([status, ctype, ref]) => assetProblem({ status, ctype }, ref) !== null), cases.map(c => c[3]));
});

function run(script, cwd, env, args = []) {
  return spawnSync(process.execPath, [...args, join(ROOT, script)], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000,
  });
}

test('#3590: capture CLI preserves entry identity and distinguishes an absent cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spa-capture-3590-'));
  try {
    mkdirSync(join(dir, 'docs/assets'), { recursive: true });
    writeFileSync(join(dir, 'docs/.asset-retention.json'), JSON.stringify(ledger));
    for (const f of ['index-new.js', 'index-old.js', 'helper.js']) writeFileSync(join(dir, 'docs/assets', f), readAsset(f));
    const output = join(dir, 'previous.json');
    const command = (...extra) => spawnSync(process.execPath, [join(ROOT, 'scripts/capture-spa-previous.mjs'), output, ...extra], {
      cwd: dir, env: { ...process.env, SMOKE_CACHE_RESTORED: 'cache-key' }, encoding: 'utf8', timeout: 10000,
    });
    const first = command();
    const latest = JSON.parse(readFileSync(output, 'utf8'));
    const second = command('--previous-generation');
    const previous = JSON.parse(readFileSync(output, 'utf8'));
    const miss = spawnSync(process.execPath, [join(ROOT, 'scripts/capture-spa-previous.mjs'), output], {
      cwd: dir, env: { ...process.env, SMOKE_CACHE_RESTORED: '' }, encoding: 'utf8', timeout: 10000,
    });
    assert.deepEqual([first.status, latest, second.status, previous, miss.status, JSON.parse(readFileSync(output, 'utf8'))], [
      0, { entries: ['/assets/index-new.js'], reason: null }, 0, { entries: ['/assets/index-old.js'], reason: null },
      0, { entries: [], reason: 'cache-miss' },
    ]);
    writeFileSync(join(dir, 'docs/index.html'), '<script type="module" src="/assets/exact-entry.js"></script>');
    const withShell = command();
    const shellManifest = JSON.parse(readFileSync(output, 'utf8'));
    const oldGeneration = command('--previous-generation');
    assert.deepEqual([withShell.status, shellManifest, oldGeneration.status, JSON.parse(readFileSync(output, 'utf8'))], [
      0, { entries: ['/assets/index-new.js', '/assets/exact-entry.js'], reason: null },
      0, { entries: ['/assets/index-old.js'], reason: null },
    ]);
    writeFileSync(join(dir, 'docs/.asset-retention.json'), '{}');
    const corrupt = command();
    assert.deepEqual([corrupt.status, JSON.parse(readFileSync(output, 'utf8'))], [0, { entries: [], reason: 'capture-failed' }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const FAKE_FETCH = `
import {appendFileSync} from 'node:fs';
const attempts=new Map();
const realTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{
 if(ms===7) appendFileSync(process.env.REQUEST_LOG, JSON.stringify(['sleep',String(ms)])+'\\n');
 return realTimeout(fn,ms,...args);
};
const map=refs=>'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f='+JSON.stringify(refs)+'))) => i.map(i=>d[i]);';
globalThis.fetch=async(input,init={})=>{
 const u=new URL(typeof input==='string'?input:input.url), p=u.pathname;
 appendFileSync(process.env.REQUEST_LOG, JSON.stringify([u.origin,p])+'\\n');
 const js='application/javascript', headers={'strict-transport-security':'max-age=31536000','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin'};
 if(p==='/api/auth/google/config') return Response.json({configured:false,popup:false,client_id:null});
 if(p==='/api/health') return Response.json({connectors_oauth:{github:true}});
 if(p.startsWith('/api/')) return Response.json({}, {status:503});
 if(p.startsWith('/assets/')) {
  if(process.env.FAULT==='retry' && ['/assets/index-current.js','/assets/lazy-current.js'].includes(p)) {
   const key=u.origin+p, n=(attempts.get(key)||0)+1; attempts.set(key,n);
   if(n===1) return new Response('',{status:404});
  }
  if(process.env.FAULT==='entry-mime' && p==='/assets/index-current.js') return new Response(map(['assets/lazy-current.js']),{headers:{'content-type':'text/html'}});
  if(p==='/assets/nested-current.js') return new Response(map(['assets/nested-leaf.js']),{headers:{'content-type':js}});
  if(process.env.FAULT==='timeout' && u.host==='app.test' && p==='/assets/lazy-current.js') return new Promise((resolve,reject)=>{
   if(init.signal.aborted) reject(new Error('fixture aborted'));
   else init.signal.addEventListener('abort',()=>reject(new Error('fixture aborted')),{once:true});
  });
  if(process.env.FAULT==='missing' && u.host==='app.test' && p==='/assets/lazy-current.js') return new Response('',{status:404});
  if(process.env.FAULT==='css-mime' && p==='/assets/lazy-previous.css') return new Response('html',{headers:{'content-type':'text/html'}});
  if(process.env.FAULT==='previous-entry' && p==='/assets/index-previous.js') return new Response('',{status:404});
  if(['many','many-retry'].includes(process.env.FAULT) && p.startsWith('/assets/missing-')) return new Response('',{status:404});
  if(p==='/assets/index-current.js' || p==='/assets/index-previous.js') {
   const kind=p.includes('current')?'current':'previous';
   const refs=['many','many-retry'].includes(process.env.FAULT) && kind==='current'?Array.from({length:30},(_,i)=>'assets/missing-'+i+'.js'):['assets/lazy-'+kind+'.js','assets/lazy-'+kind+'.css','assets/shared.js'];
   return new Response(process.env.FAULT==='map' && kind==='current'?'export const noMap=1;':map(refs),{headers:{'content-type':js}});
  }
  return new Response('fixture',{headers:{'content-type':p.endsWith('.css')?'text/css':js}});
 }
 const entry=process.env.STALE_SHELL==='1'?'previous':'current';
 return new Response('<html><div id="root"></div><script type="module" src="/assets/index-'+entry+'.js"></script><link href="/assets/style.css"></html>',{headers:{...headers,'content-type':'text/html'}});
};`;

function smoke(fault = '', stale = false, malformed = false, absent = false, nested = false, artifact = false) {
  const dir = mkdtempSync(join(tmpdir(), 'spa-live-3590-'));
  try {
    writeFileSync(join(dir, 'fake.mjs'), FAKE_FETCH);
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/index-current.js"></script>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/index-current.js'), map(['assets/lazy-current.js','assets/lazy-current.css','assets/shared.js']));
    const files = ['index-current.js'];
    if (nested) {
      files.push('nested-current.js');
      writeFileSync(join(dir, 'assets/nested-current.js'), map(['assets/nested-leaf.js']));
    }
    writeFileSync(join(dir, '.asset-retention.json'), JSON.stringify({ builds: [{ files }] }));
    writeFileSync(join(dir, 'previous.json'), malformed ? '{}' : JSON.stringify(absent ? { entries: [], reason: 'cache-miss' } : { entries: ['/assets/index-previous.js'], reason: null }));
    writeFileSync(join(dir, 'current.json'), fault === 'current-input' ? '{}' : JSON.stringify({ entries: files.map(f => '/assets/'+f), reason: null }));
    if (fault === 'capture-failed') writeFileSync(join(dir, 'previous.json'), JSON.stringify({ entries: [], reason: 'capture-failed' }));
    writeFileSync(join(dir, 'requests.jsonl'), '');
    writeFileSync(join(dir, 'summary.md'), '');
    const result = run('scripts/check-spa-live.mjs', ROOT, {
      SMOKE_HOSTS: 'https://apex.test https://app.test', SMOKE_RETRIES: fault === 'many-retry' ? '3' : fault === 'retry' ? '2' : '1', SMOKE_RETRY_MS: fault === 'retry' ? '7' : '1',
      SMOKE_TIMEOUT_MS: '100', SKIP_LIVE_SMOKE: '0', SMOKE_BUILD_DIR: dir, SMOKE_PREVIOUS_BUILD: join(dir, 'previous.json'),
      SMOKE_CURRENT_BUILD: artifact || ['current-input', 'missing-current'].includes(fault) ? join(dir, fault === 'missing-current' ? 'missing.json' : 'current.json') : '',
      SMOKE_API_PROBE: '', SMOKE_API_PROBE_LIMITED: '', SMOKE_CONNECTORS_STRICT: '',
      GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
      REQUEST_LOG: join(dir, 'requests.jsonl'), FAULT: fault, STALE_SHELL: stale ? '1' : '',
    }, ['--import', pathToFileURL(join(dir, 'fake.mjs')).href]);
    return { ...result, summary: readFileSync(join(dir, 'summary.md'), 'utf8'), requests: readFileSync(join(dir, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('#3590: the CLI probes both generations on both hosts, deduplicates leaves and includes /hq', () => {
  const result = smoke();
  const checked = result.requests.filter(([,p]) => p.startsWith('/assets/') || p==='/hq');
  const files = ['/hq','/assets/style.css','/assets/index-current.js','/assets/lazy-current.js','/assets/lazy-current.css','/assets/shared.js','/assets/index-previous.js','/assets/lazy-previous.js','/assets/lazy-previous.css'];
  assert.deepEqual({ status: result.status, checked }, { status: 0, checked: ['https://apex.test','https://app.test'].flatMap(host => files.map(p => [host,p])) });
  assert.equal((result.stdout.match(/1 entry chunk\(s\), 3 lazy JS\/CSS file\(s\), 0 failure\(s\)/g) || []).length, 4);
  assert.equal((result.summary.match(/1 entry chunk\(s\), 3 lazy JS\/CSS file\(s\), 0 failure\(s\)/g) || []).length, 4);
});

test('#3590: a missing JS on only the second host, wrong CSS MIME, lost old entry and missing map fail', () => {
  for (const [fault, needle] of [['missing','https://app.test/assets/lazy-current.js'], ['css-mime','/assets/lazy-previous.css'],
    ['previous-entry','/assets/index-previous.js'], ['entry-mime','unexpected Content-Type'], ['map','Missing __vite__mapDeps'], ['timeout','/assets/lazy-current.js']]) {
    const result = smoke(fault);
    assert.deepEqual({ status: result.status, named: result.stderr.includes(needle) }, { status: 1, named: true });
  }
});

test('#3590: a stale live shell cannot hide the just-built entry', () => {
  const result = smoke('missing', true, false, false, false, true);
  assert.deepEqual({ status: result.status, current: result.requests.some(([host,p]) => host==='https://app.test' && p==='/assets/lazy-current.js') }, { status: 1, current: true });
});

test('#3590: a nested dependency map in the built generation is checked too', () => {
  const result = smoke('', false, false, false, true);
  assert.deepEqual({ status: result.status, leaves: result.requests.filter(([,p]) => p==='/assets/nested-leaf.js') },
    { status: 0, leaves: [['https://apex.test','/assets/nested-leaf.js'],['https://app.test','/assets/nested-leaf.js']] });
});

test('#3590: all failed lazy files are fetched but only the first five per build/host are printed', () => {
  const result = smoke('many');
  assert.deepEqual({ status: result.status, requested: result.requests.filter(([,p]) => p.startsWith('/assets/missing-')).length,
    printed: (result.stderr.match(/\[spa-live\] FAIL  current build /g) || []).length }, { status: 1, requested: 60, printed: 10 });
});

test('#3590: widespread missing leaves are attempted in waves before retries', () => {
  const result = smoke('many-retry');
  const requested = result.requests.filter(([,p]) => p.startsWith('/assets/missing-'));
  const wave = Array.from({length:30}, (_,i) => '/assets/missing-'+i+'.js');
  assert.deepEqual({ status: result.status, requested }, { status: 1,
    requested: ['https://apex.test','https://app.test'].flatMap(host => [...wave,...wave,...wave].map(p => [host,p])) });
});

test('#3590: unreadable manifests fail without suppressing existing live probes', () => {
  for (const fault of ['', 'capture-failed', 'current-input', 'missing-current']) {
    const result = smoke(fault, false, fault === '');
    assert.deepEqual({ status: result.status,
      probes: result.requests.filter(([,p]) => ['/hq', '/api/health', '/api/__smoke/rate-limited', '/api/auth/google/config'].includes(p)),
      liveGraph: result.requests.filter(([,p]) => p==='/assets/lazy-current.js').length,
      reported: result.stderr.includes('input is unreadable'),
    }, { status: 1,
      probes: ['https://apex.test','https://app.test'].flatMap(host => ['/api/health', '/api/__smoke/rate-limited', '/api/auth/google/config', '/api/health', '/hq'].map(p => [host,p])),
      liveGraph: 2, reported: true });
  }
});

test('#3590: transient entry and lazy-leaf misses recover within the retry budget', () => {
  const result = smoke('retry');
  assert.deepEqual({ status: result.status,
    attempts: result.requests.filter(([,p]) => ['/assets/index-current.js','/assets/lazy-current.js'].includes(p)).length,
    backoffs: result.requests.filter(([host,p]) => host === 'sleep' && p === '7').length,
  }, { status: 0, attempts: 8, backoffs: 4 });
});

test('#3590: a cache miss reports unavailable coverage instead of a previous-build pass', () => {
  const result = smoke('', false, false, true);
  assert.deepEqual({ status: result.status, warning: result.summary.includes('Previous build not verified'),
    claimed: result.stdout.includes('previous build:'), oldRequested: result.requests.some(([,p]) => p==='/assets/index-previous.js') },
  { status: 0, warning: true, claimed: false, oldRequested: false });
});

test('#3590: deploy verification cannot gate publishing or skip sibling jobs; the schedule stays', () => {
  const source = readFileSync(join(ROOT,'.github/workflows/cloudflare-worker-deploy.yml'),'utf8');
  const deploy = source.split('\n  spa-smoke:')[0];
  const job = source.split('\n  spa-smoke:')[1].split('\n  schema-drift:')[0];
  const schedule = readFileSync(join(ROOT,'.github/workflows/post-deploy-smoke.yml'),'utf8');
  const restore = deploy.indexOf('uses: actions/cache/restore@');
  const capture = deploy.indexOf('run: node scripts/capture-spa-previous.mjs');
  const build = deploy.indexOf('run: npm run build -- --seed-restored-tree');
  const current = deploy.indexOf('run: node scripts/capture-spa-previous.mjs', capture+1);
  const transfer = deploy.indexOf('uses: actions/upload-artifact@');
  const publish = deploy.indexOf('npx --no-install wrangler deploy --config');
  const save = deploy.indexOf('uses: actions/cache/save@');
  const live = job.indexOf('run: node scripts/check-spa-live.mjs');
  const stepAt = (text,at) => text.slice(text.lastIndexOf('      - name:',at),at);
  const step = stepAt(job,live);
  assert.deepEqual({ order: restore>=0 && restore<capture && capture<build && build<current && current<transfer && transfer<publish && publish<save,
    noPrePublishSmoke: !deploy.includes('run: node scripts/check-spa-live.mjs'),
    independent: /needs: deploy/.test(job) && /schema-drift:[\s\S]*?needs: deploy/.test(source) && /branches:[\s\S]*?needs: deploy/.test(source),
    captureSoft: /continue-on-error: true/.test(stepAt(deploy,capture)) && /continue-on-error: true/.test(stepAt(deploy,current)),
    currentInput: /SMOKE_CACHE_RESTORED: 'built'/.test(stepAt(deploy,current)),
    transferSoft: /continue-on-error: true/.test(stepAt(deploy,transfer)) && /spa-smoke-current.json[\s\S]*spa-smoke-previous.json/.test(deploy.slice(transfer,publish)),
    exactRun: /name: spa-smoke-inputs\n/.test(deploy) && /name: spa-smoke-inputs\n/.test(job) && /overwrite: true/.test(deploy.slice(transfer,publish)),
    download: /uses: actions\/download-artifact@[a-f0-9]{40}/.test(job) && /continue-on-error: true/.test(stepAt(job,job.indexOf('uses: actions/download-artifact@'))),
    bothHosts: /SMOKE_HOSTS: 'https:\/\/axal.vc https:\/\/app.axal.vc'/.test(step),
    current: /SMOKE_CURRENT_BUILD: \$\{\{ runner.temp \}\}\/spa-smoke\/spa-smoke-current.json/.test(step),
    previous: /SMOKE_PREVIOUS_BUILD: \$\{\{ runner.temp \}\}\/spa-smoke\/spa-smoke-previous.json/.test(step),
    noSoftFailure: !/continue-on-error/.test(step),
    schedule: /cron: '0 \*\/6 \* \* \*'/.test(schedule), scheduledCache: /restore-keys: \|\s*spa-assets-/.test(schedule),
    generation: /capture-spa-previous.mjs "\$RUNNER_TEMP\/spa-smoke-previous.json" --previous-generation/.test(schedule),
    captureInput: /SMOKE_CACHE_RESTORED: \$\{\{ steps.retention.outputs.cache-matched-key \}\}/.test(deploy),
    scheduledInput: /SMOKE_CACHE_RESTORED: \$\{\{ steps.retention.outputs.cache-matched-key \}\}/.test(schedule),
    scheduledSoftCapture: /Capture the retained previous lazy entry\n        continue-on-error: true/.test(schedule),
    scheduledManifest: /SMOKE_PREVIOUS_BUILD:.*format\('\{0\}\/spa-smoke-previous.json', runner.temp\)/.test(schedule),
    scheduledRun: /run: node scripts\/check-spa-live.mjs/.test(schedule),
    scheduledCurrent: /SMOKE_BUILD_DIR:.*steps.retention.outputs.cache-matched-key != '' && 'docs' \|\| '' \}\}/.test(schedule),
    customHosts: ['SMOKE_BUILD_DIR:', 'SMOKE_PREVIOUS_BUILD:'].every(key => (schedule.split('\n').find(line => line.includes(key)) || '').includes("github.event.inputs.hosts == '' || github.event.inputs.hosts == 'https://axal.vc https://app.axal.vc'")),
  }, { order:true,noPrePublishSmoke:true,independent:true,captureSoft:true,currentInput:true,transferSoft:true,exactRun:true,download:true,
    bothHosts:true,current:true,previous:true,noSoftFailure:true,schedule:true,scheduledCache:true,generation:true,
    captureInput:true,scheduledInput:true,scheduledSoftCapture:true,scheduledManifest:true,scheduledRun:true,scheduledCurrent:true,customHosts:true });
});
