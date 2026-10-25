import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceModule} from './_form_d695.mjs';
test('D1168: the admin client posts a bounded batch request without file keys or a cursor',async()=>{
 globalThis.__storageBackfillCalls=[];
 const code=readFileSync(new URL('../src/lib/api/adminStorage.js',import.meta.url),'utf8').replace(/import \{ request \}[^;]+;/,'const request=(...args)=>{globalThis.__storageBackfillCalls.push(args);return Promise.resolve({complete:false});};');
 try{const {adminStorageApi}=await sourceModule(code,'lib/api/adminStorage.js');await adminStorageApi.backfillSizes(17);await adminStorageApi.backfillSizes();const calls=globalThis.__storageBackfillCalls;assert.equal(calls.length,2);for(const [path,opts]of calls){assert.equal(path,'/admin/platform/storage/backfill-sizes');assert.equal(opts.method,'POST');}assert.deepEqual(JSON.parse(calls[0][1].body),{limit:17});assert.deepEqual(JSON.parse(calls[1][1].body),{});}finally{delete globalThis.__storageBackfillCalls;}
});
