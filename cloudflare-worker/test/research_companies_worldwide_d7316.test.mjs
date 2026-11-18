import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptance, coverage, countryQuery, dedupe, migration, normalizeDomain, normalizeName, COUNTRIES } from '../../scripts/import-wikidata-worldwide.mjs';

test('D7316 country plan covers >=50 countries and all required regions',()=>{
 assert.ok(COUNTRIES.length>=50); for(const r of ['north_america','europe','asia','middle_east','africa','latin_america','oceania'])assert.ok(COUNTRIES.some(c=>c.region===r));
 assert.equal(new Set(COUNTRIES.map(c=>c.code)).size,COUNTRIES.length);
});
test('country query is ISO-scoped and rejects unsafe input',()=>{
 assert.match(countryQuery('CH',100),/wdt:P297 "CH"/); assert.throws(()=>countryQuery('CH" }',100)); assert.throws(()=>countryQuery('CH',5001));
});
test('normalizers support deterministic domain and name-country dedupe',()=>{
 assert.equal(normalizeDomain('https://www.Example.com/a'),'example.com'); assert.equal(normalizeName('  Acmé, Inc. '),'acme inc');
 const rows=[
  {uid:'q1',domain:'a.com',name:'A',country_code:'US'},
  {uid:'q1',domain:'b.com',name:'B',country_code:'US'},
  {uid:'q2',domain:'a.com',name:'C',country_code:'US'},
  {uid:'q3',domain:'c.com',name:'A',country_code:'US'},
  {uid:'q4',domain:'d.com',name:'A',country_code:'CA'},
 ];
 const d=dedupe(rows); assert.deepEqual(d.accepted.map(x=>x.uid),['q1','q4']); assert.deepEqual(d.report,{duplicate_by_id:1,duplicate_by_domain:1,duplicate_by_name_country:1});
});
test('coverage gate enforces worldwide minima and 35% concentration',()=>{
 const rows=[];const plan={north_america:1000,europe:1000,asia:1000,latin_america:250,africa:250,middle_east:250,oceania:250};
 let q=1;for(const [region,n] of Object.entries(plan))for(let i=0;i<n;i++)rows.push({uid:`q${q++}`,country_code:`${region.slice(0,1)}${i%10}`,region,sector:'software',source_name:'Wikidata',source_license:'CC0',website:'https://x.test',founded_year:null});
 while(rows.length<25000)rows.push({uid:`q${q++}`,country_code:`X${q%60}`,region:'europe',sector:'software',source_name:'Wikidata',source_license:'CC0',website:'https://x.test',founded_year:null});
 const c=coverage(rows);assert.ok(c.country_count>=50);assert.equal(acceptance(c).pass,true);
});
test('migration is deterministic, provenance-bearing and idempotent SQL',()=>{
 const r={uid:'q42',name:"O'Reilly",website:'https://example.com',country:'Switzerland',country_code:'CH',founded_year:null,sector:'software',source_name:'Wikidata',source_url:'https://www.wikidata.org/wiki/Q42',source_license:'CC0',as_of:'2026-11-18'};
 const a=migration([r],'2026-11-18');assert.equal(a,migration([r],'2026-11-18'));assert.match(a,/INSERT OR IGNORE/);assert.match(a,/O''Reilly/);assert.match(a,/Wikidata/);assert.match(a,/NULL/);
});
