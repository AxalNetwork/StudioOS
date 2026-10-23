import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/pages/TrustCenterPage.jsx',import.meta.url),'utf8');
const start=source.indexOf('  async function runScreen(e)',source.indexOf('function SanctionsTab'));
const body=source.slice(start,source.indexOf('\n\n  return (',start));
test('2444: an incomplete screening is shown as not completed, without success copy',async()=>{
 const errors=[],messages=[];
 const context=vm.createContext({userId:'7',fullName:'Fixture Subject',dob:'',nationality:'',
  setErr:value=>errors.push(value),setInfo:value=>messages.push(value),setBusy:()=>{},
  api:{trustScreenSanctions:async()=>{throw new Error('Lists unavailable: eu');}},
  reload:async()=>{},setUserId:()=>{},setFullName:()=>{},setDob:()=>{},setNationality:()=>{}});
 await vm.runInContext(`${body}; runScreen({preventDefault(){}})`,context);
 assert.equal(messages.filter(Boolean).length,0);
 assert.match(errors.at(-1),/Screening not completed/);
 assert.match(errors.at(-1),/eu/);
});
