/** D6424: recorded attention counts, unknown stale rule and failure states through the real rendered strip.
 *
 * From frontend/test/README.md (moved by #6472): D6424: recorded stale/new/waiting badges, unset
 * rule, firm setting and failed attention-source rendering.
 */
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter} from 'react-router-dom';
import {AttentionStrip} from '../src/pages/investor/dealflow/DealFlow.jsx';
const read={kind:'ok',data:{items:[{deal_id:1},{deal_id:2}],sources:{}}};
const recorded={kind:'ok',data:{stale:{state:'recorded',count:3},diligence:{state:'recorded',count:1},rule:{days:7,writable:true}}};
const render=r=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(AttentionStrip,{read,recorded:r,newHref:'/deals?scope=new'})));
test('all three counts come from their own reads and the firm rule is configurable',()=>{const html=render(recorded);assert.match(html,/3 stale/);assert.match(html,/2 new/);assert.match(html,/1 waiting on diligence/);assert.match(html,/Firm stale rule/);assert.match(html,/value="7"/);assert.match(html,/Save firm rule/);assert.equal((html.match(/href="\/deals\?scope=new"/g)||[]).length,1);});
test('an unset rule is Not recorded and never zero; a failed source makes the strip Unreadable',()=>{const html=render({...recorded,data:{...recorded.data,stale:{state:'not_recorded',count:null,reason:'No recorded rule'}}});assert.match(html,/Stale · Not recorded/);assert.doesNotMatch(html,/0 stale|3 stale/);assert.match(html,/1 waiting on diligence/);
 for(const data of [{...recorded.data,stale:{state:'unreadable',count:null}},{...recorded.data,diligence:{state:'unreadable',count:null}}]){const fail=render({kind:'ok',data});assert.match(fail,/Unreadable/);assert.doesNotMatch(fail,/0 stale|1 waiting|2 new|3 stale/);assert.match(fail,/Try again/);}});
