import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const postcss=require('postcss');
const css=readFileSync(new URL('../src/index.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function verify(source){
 const ast=postcss.parse(source);
 const guard=ast.nodes.find(n=>n.type==='atrule' && n.name==='media' && n.nodes?.some(r=>r.type==='rule' && r.selector==='html.app-type' && r.nodes.some(d=>d.prop==='touch-action')));
 assert.ok(guard,'a shared mobile tap policy exists');
 assert.equal(guard.params,'(max-width: 1023px)','do not alter desktop controls');
 const tap=guard.nodes.find(n=>n.selector==='html.app-type');
 assert.equal(tap.nodes.find(d=>d.prop==='touch-action').value,'manipulation','retain pan and pinch gestures');
 const inputs=guard.nodes.find(n=>n.type==='rule' && n.selector.includes('textarea'));
 for(const target of ['input:not(', 'textarea','select','[contenteditable="true"]']) assert.ok(inputs.selector.includes(target),target);
 for(const type of ['checkbox','radio','range','color','file','button','submit','reset','hidden']) assert.ok(inputs.selector.includes(`:not([type="${type}"])`),type);
 const size=inputs.nodes.find(d=>d.prop==='font-size');
 assert.equal(size.value,'max(16px, 1rem)');assert.equal(size.important,true,'compact component styles cannot restore focus zoom');
 assert.equal(inputs.selector.includes(':focus'),false,'size is stable before and after tapping');
}
test('#2656: mobile tap/focus protection covers editors and portals without changing desktop or pinch zoom',()=>{
 verify(css);
 for(const [a,b] of [['(max-width: 1023px)','(min-width: 1023px)'],['touch-action: manipulation','touch-action: none'],['max(16px, 1rem)','14px'],['1rem) !important','1rem)'],['    select,',''],[':not([type="range"])','']]){
  assert.ok(css.includes(a));assert.throws(()=>verify(css.replace(a,b)),{name:'AssertionError'});
 }
 verify(css);
 const viewport=html.match(/<meta name="viewport" content="([^"]+)"/)[1];
 assert.match(viewport,/width=device-width/);assert.match(viewport,/initial-scale=1/);
 assert.doesNotMatch(viewport,/maximum-scale|user-scalable|minim(?:um)?-scale/);
});
