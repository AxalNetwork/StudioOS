import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {h,mountForm,mutationCheck} from './_form_d695.mjs';
const source=readFileSync(new URL('../src/pages/cycles/CycleOverview.jsx',import.meta.url),'utf8');
const start=source.indexOf('export function FigureTile(');
const tile=`import React from 'react';
const SECTION=''; const Spark=()=>null; const Unrecorded=()=>null;
const figureValue=f=>f.value; const figureDelta=()=>null; const sparkDrawable=()=>false;
`+source.slice(start,source.indexOf('\nexport function CardBody',start));
async function verify(module){
 for(const [value,scored,state] of [[100,1,'ok'],[null,0,'empty']]){
  const f=await mountForm(h(module.FigureTile,{fig:{key:'readiness_score',label:'Readiness score',value,state,coverage:{scored,total:7},spark:[]}}));
  try{assert.ok(f.text().includes(`${scored} of 7 items scored`));}finally{await f.unmount();}
 }
}
test('#2445: readiness headline displays actual coverage even when empty',async()=>{
 await mutationCheck(tile,'pages/cycles/CycleOverview.jsx',verify,[
 ['{fig.coverage.scored} of {fig.coverage.total} items scored','7 of 7 items scored'],
 ['{fig?.coverage &&','{false &&'],
 ]);
});
