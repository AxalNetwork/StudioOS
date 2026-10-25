import test from 'node:test';
import assert from 'node:assert/strict';
import captable from '../src/routes/captable.ts';
for (const role of ['admin','founder','partner','investor','advisor','exploring']) {
  test(`holder replacement is absent for ${role}, without touching the register`, async () => {
    const queries: string[] = [];
    assert.equal(captable.routes.some(r => r.method === 'PUT' && r.path === '/:projectId/holders'), false);
    const response=await captable.request('/1/holders', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({holders:[]}) }, { DB:{ prepare(sql: string){queries.push(sql);return {all:async()=>({results:[{name:'is_variant'}]}),run:async()=>({success:true}),bind(){return this;}};} } } as any);
    assert.equal(response.status,404);assert.equal(queries.some(q=>q.includes('cap_table_holders')),false);
  });
}
