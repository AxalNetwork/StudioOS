import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAccessView, recordHolder } from '../src/services/capTableAccessRecord.ts';
const holder = (id:number,name:string) => ({holder_id:id,name});
function fixture(): any {
  return {
    by_holder:{available:true,rows:[
      {...holder(1,'Founder'),kind:'founder',shares:700,options:0},
      {...holder(2,'Fund'),kind:'investor',shares:200,options:0},
      {...holder(3,'Private employee'),kind:'employee',shares:20,options:30},
      {...holder(4,'Private advisor'),kind:'advisor',shares:10,options:0},
    ]}, fully_diluted:{available:true,shares:1000,unallocated_pool:40},
    issuances:{rows:[...[holder(1,'Founder'),holder(2,'Fund'),holder(3,'Private employee'),holder(4,'Private advisor')].map(h => ({holder:h,status:'recorded',document_ref:'private-proof'})), {holder:holder(5,'Pending person'),status:'proposed'}]},
    instruments:{rows:[{holder:holder(2,'Fund'),kind:'safe',amount_cents:10000,currency:'EUR',issued_on:'2026-01-01',terms:{cap_cents:null,discount_bps:null,basis:null},note:'Private note',recorded_by:999}]},
  };
}
test('Summary contains only group percentages, with round count unknown', () => {
  const v:any=recordAccessView(fixture(),'summary',null);
  assert.deepEqual(v.summary,[{group:'Founders',pct:70},{group:'Investors',pct:20},{group:'Other',pct:3},{group:'Option pool',pct:7}]);
  assert.equal(v.rounds_completed,null);
  for(const forbidden of ['Founder"','Private employee','Private advisor','Pending person','shares','private-proof','10000','Private note']) assert.ok(!JSON.stringify(v).includes(forbidden),forbidden);
});
test('Investor aggregates employee shares and options; Full keeps their recorded positions', () => {
  const inv:any=recordAccessView(fixture(),'investor',null), full:any=recordAccessView(fixture(),'full',null);
  assert.deepEqual(inv.founding.map((h:any)=>[h.holder,h.shares]),[['Founder',700],['Fund',200],['Option pool',70],['Other',30]]);
  assert.ok(!JSON.stringify(inv).includes('Private employee') && !JSON.stringify(inv).includes('Private advisor'));
  assert.deepEqual(full.founding.filter((h:any)=>h.holder==='Private employee').map((h:any)=>h.shares),[20,30]);
  assert.ok(!JSON.stringify(full).includes('private-proof')&&!JSON.stringify(full).includes('Private note')&&!JSON.stringify(full).includes('recorded_by'));
});
test('Own position uses an identity, never another holder with the same name, and keeps currency', () => {
  const r=fixture();r.issuances.rows.push({holder:holder(8,'Fund'),status:'recorded'});r.by_holder.rows.push({...holder(8,'Fund'),kind:'investor',shares:50,options:0});
  assert.equal(recordHolder(r,'Fund'),null);
  const v:any=recordAccessView(r,'own_position','holder:2');
  assert.deepEqual(v.position.map((h:any)=>h.shares),[200]);
  assert.equal(v.instruments[0].currency,'EUR');assert.equal(v.instruments[0].amount,100);
  assert.deepEqual(v.documents,[{title:'Recorded document',status:'recorded'}]);
  assert.ok(!JSON.stringify(v).includes('Private employee')&&!JSON.stringify(v).includes('private-proof'));
  const ambiguous:any=recordAccessView(r,'own_position','Fund');assert.deepEqual(ambiguous.position,[]);assert.deepEqual(ambiguous.instruments,[]);assert.deepEqual(ambiguous.documents,[]);
});
test('Missing fully diluted denominator does not invent percentages or hide known positions', () => {
  const r=fixture();r.fully_diluted={available:false,sentence:'Pool size is not recorded.'};
  const full:any=recordAccessView(r,'full',null), sum:any=recordAccessView(r,'summary',null);
  assert.equal(full.founding[0].shares,700);assert.equal(full.founding[0].pct,null);
  assert.deepEqual(sum.summary,[]);assert.equal(sum.split_reason,'Pool size is not recorded.');
});
test('SAFE-only own position remains readable without a share issuance', () => {
  const r=fixture();r.by_holder={available:false};r.fully_diluted={available:false};
  const v:any=recordAccessView(r,'own_position','holder:2');assert.equal(v.instruments.length,1);assert.deepEqual(v.position,[]);
  assert.equal(recordHolder(r,'holder:5'),null,'pending issuances cannot supply a grant identity');
});
