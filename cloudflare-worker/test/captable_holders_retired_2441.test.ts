import test from 'node:test';
import assert from 'node:assert/strict';
import captable from '../src/routes/captable.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const JWT_SECRET='synthetic-holder-retirement-test-'.repeat(2);
for (const role of ['admin','founder','partner','investor','advisor','exploring']) {
  test(`holder replacement is absent for ${role}, without touching the register`, async () => {
    const queries: string[] = [];
    assert.equal(captable.routes.some(r => r.method === 'PUT' && r.path === '/:projectId/holders'), false);
    const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
    try {
      for(const table of ['users','super_admins','cap_table_scenarios']) db.exec(tableFromBaseline(baseline,table));
      db.prepare("INSERT INTO users(id,role,name,email) VALUES(1,?,'Synthetic','synthetic@example.invalid')").run(role);
      const token=await new SignJWT({user_id:1}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const DB=d1Over(db);const prepare=DB.prepare.bind(DB);
      DB.prepare=(sql:string)=>{queries.push(sql);return prepare(sql);};
      const response=await captable.request('/1/holders', { method:'PUT', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({holders:[]}) }, {DB,JWT_SECRET,ENVIRONMENT:'development'} as any);
      assert.equal(response.status,role==='admin'?403:404);assert.equal(queries.some(q=>q.includes('cap_table_holders')),false);
    } finally {db.close();}
  });
}
