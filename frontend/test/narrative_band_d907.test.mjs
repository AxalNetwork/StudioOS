import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {h,mountForm,mutationCheck} from './_form_d695.mjs';
import {api} from '../src/lib/api.js';

// Exercise the actual host's band props and wording without loading unrelated cycle pages.
const source=readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx',import.meta.url),'utf8');
const from=source.indexOf("surface: 'raise/narrative-fix'");
const definition=source.slice(from,source.indexOf('\n      }]]',from));
const tagFrom=source.indexOf('<ZoneDraft key=');
const tag=source.slice(tagFrom,source.indexOf('/>',tagFrom)+2);
const moduleSource=`import React from 'react';
import ZoneDraft from '../../workspaces/ZoneDraft.jsx';
const draft={${definition}};
export const acceptLabel=draft.accept;
export function Band({projectId}) {const cycle='raise',slug='investor-narrative',ai=null;return ${tag};}`;

async function verify(module){
 const saved=api.research.zoneDrafts;const calls=[];let form;
 api.research.zoneDrafts=async(...args)=>{
  calls.push(args);
  return {items:[{uid:'draft-'+args[1],body:args[1]?`Reading for venture ${args[1]}`:'Another venture reading',accepted:false}]};
 };
 try {
  assert.equal(module.acceptLabel,'Save reading to copy');
  form=await mountForm(h(module.Band,{projectId:2}));
  await form.flush();await form.flush();
  assert.deepEqual(calls.at(-1),['raise/narrative-fix','2']);
  assert.ok(form.text().includes('Reading for venture 2'));
  assert.ok(!form.text().includes('Another venture reading'));
  await form.render(h(module.Band,{projectId:3}));await form.flush();
  assert.deepEqual(calls.at(-1),['raise/narrative-fix','3']);
  assert.ok(!form.text().includes('Reading for venture 2'));
 }finally{if(form)await form.unmount();api.research.zoneDrafts=saved;}
}

test('#2691: the narrative band asks for this venture only and describes a saved reading',async()=>{
 await mutationCheck(moduleSource,'pages/cycles/CycleRoute.jsx',verify,[
  ["scoped={cycle === 'raise' && slug === 'investor-narrative'}",''],
  ["accept: 'Save reading to copy'","accept: 'Keep this wording'"],
 ]);
});
