import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceModule} from './_form_d695.mjs';
test('D1182: history client sends only supported encoded filters to the mounted GET route',async()=>{
 globalThis.__bankHistoryCalls=[];
 const code=readFileSync(new URL('../src/lib/api/bankAccounts.js',import.meta.url),'utf8').replace(/import \{ request \}[^;]+;/,'const request=(...args)=>{globalThis.__bankHistoryCalls.push(args);return Promise.resolve({rows:[]});};');
 try{const {bankAccountsApi}=await sourceModule(code,'lib/api/bankAccounts.js');await bankAccountsApi.history({q:'Operating & ready',kind:'reveal',entity:'gp',actor:'actor:3',from:'2026-01-01',to:'2026-01-03',page:2,per:25,snapshot:'2.7.1767225600000',secret:'never-send'});const [path,options]=globalThis.__bankHistoryCalls[0];const url=new URL(path,'https://example.test');assert.equal(url.pathname,'/admin/bank-accounts/history');assert.equal(url.searchParams.get('q'),'Operating & ready');for(const [key,value]of Object.entries({kind:'reveal',entity:'gp',actor:'actor:3',page:'2',per:'25',snapshot:'2.7.1767225600000',from:'2026-01-01',to:'2026-01-03'}))assert.equal(url.searchParams.get(key),value);assert.equal(url.searchParams.has('secret'),false);assert.equal(options,undefined);await bankAccountsApi.history();assert.equal(new URL(globalThis.__bankHistoryCalls[1][0],'https://example.test').search,'');}finally{delete globalThis.__bankHistoryCalls;}
});
