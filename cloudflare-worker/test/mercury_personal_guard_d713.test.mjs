import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root='cloudflare-worker/src';
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const allowed=new Set(['integrations/providers/mercury.ts','services/mercuryPersonal.ts','routes/mercury_personal.ts','routes/revenue.ts','routes/needs.ts','routes/network.ts','routes/partner_settlements.ts','services/onboardingChecklist.ts']);
const callers=new Set(['routes/revenue.ts','routes/mercury_personal.ts','routes/needs.ts','routes/network.ts']);
test('personal match tables and provider queries stay within the personal allowlist',()=>{
  for(const f of walk(root).filter(f=>/\.[cm]?[jt]s$/.test(f))) {
    const s=readFileSync(f,'utf8');
    if(/mercury_personal_matches|provider_key\s*=\s*['"]mercury['"]/i.test(s)) assert.ok(allowed.has(relative(root,f)),f);
  }
});
test('only member-facing routes can import personal Mercury logic',()=>{
  for(const f of walk(root).filter(f=>/\.[cm]?[jt]s$/.test(f))) {
    const s=readFileSync(f,'utf8');
    if(/(?:from\s*|import\s*\(|require\s*\()['"][^'"]*mercuryPersonal(?:\.ts)?['"]/.test(s)) assert.ok(callers.has(relative(root,f)),f);
  }
});
