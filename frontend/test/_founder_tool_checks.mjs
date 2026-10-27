import assert from 'node:assert/strict';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { routeBlock } from './_routes.mjs';
import { codeOnly } from './_codeOnly.mjs';
import * as navigation from '../src/pages/cycles/founderToolNavigation.js';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import FounderModuleBackLink from '../src/pages/founder/FounderModuleBackLink.jsx';
import { SHELLS } from '../src/workspaces/shellConfig.js';

export const paths = {
  navigation: 'frontend/src/pages/cycles/founderToolNavigation.js',
  module: 'frontend/src/pages/cycles/CycleModulePage.jsx',
  back: 'frontend/src/pages/founder/FounderModuleBackLink.jsx',
  app: 'frontend/src/App.jsx',
  shell: 'frontend/src/workspaces/shellConfig.js',
  moved: 'frontend/src/pages/raise/caprel/CapRelMovedRedirect.jsx',
  route: 'frontend/src/pages/cycles/CycleRoute.jsx',
};
export const actual = { navigation, CycleModulePage, FounderModuleBackLink, SHELLS,
  sources: Object.fromEntries(Object.entries(paths).map(([key,path]) => [key,readFileSync(path,'utf8')])),
  oldTabsExist: existsSync('frontend/src/pages/founder/FounderWorkspaceTabs.jsx') };
const founder = {role:'founder',subscription_tier:'studio'};
const render = (Component, props, path='/') => renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Component,props)));
// A link's text: tags stripped until none is left, so one split by another
// (`<a<b>>`) cannot come back together as a tag after a single pass.
const stripTags = (s) => {
  let out = s;
  for (let prev = null; prev !== out;) { prev = out; out = out.replace(/<[^>]*>/g,''); }
  return out;
};
const links = (html, testid) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
  .filter((m)=>m[1].includes('data-testid="'+testid+'"'))
  .map((m)=>({href:m[1].match(/href="([^"]*)"/)?.[1],label:stripTags(m[2]),
    quiet: !/\b(?:rounded|border|bg)-/.test(m[1].match(/class="([^"]*)"/)?.[1]||'')}));
export const RETURNS = [
  ['/build/marketplace','/validate/customer-research','← Validate › Customer research'],
  ['/execution','/build/product-roadmap','← Build › Product roadmap'],
  ['/build/team','/grow/team-expansion','← Grow › Team expansion'],
  ['/comarketing','/grow/distribution','← Grow › Distribution'],
  ['/raise/pitch','/raise/pitch-deck','← Raise › Pitch deck'],
  ['/raise/pitch/review','/raise/pitch-deck','← Raise › Pitch deck'],
  ['/raise/pitch/edit','/raise/pitch-deck','← Raise › Pitch deck'],
  ['/raise/pitch/analytics','/raise/pitch-deck','← Raise › Pitch deck'],
  // D1180 (#3107) and D1194 (#3128): /raise/capital, /raise/capital/model and
  // /raise/capital/pipeline only forward, so none has a module return.
  ['/raise/legal-engine','/build/company-creation','← Build › Company creation'],
  ['/raise/legal-engine/incorporation','/build/company-creation','← Build › Company creation'],
  ['/raise/legal-engine/founders','/build/company-creation','← Build › Company creation'],
  ['/raise/legal-engine/compliance','/build/company-creation','← Build › Company creation'],
  ['/raise/legal-engine/equity','/build/company-creation','← Build › Company creation'],
  ['/build/brand','/grow/distribution','← Grow › Distribution'],
  ['/grow/launch','/grow/distribution','← Grow › Distribution'],
  ['/legal','/build/company-creation','← Build › Company creation'],
  ['/legal/send','/build/company-creation','← Build › Company creation'],
];
export const checks = {
  doors(m=actual) {
    const groups = [['grow','distribution'],['raise','cap-table'],['build','company-creation'],['raise','capital-relationships'],['raise','data-room']];
    const out = groups.map(([cycle,slug])=>{
      const tools=m.navigation.moduleToolLinks(cycle,slug,founder,'?project_id=41');
      return links(render(m.CycleModulePage,{cycle,slug,tools,data:{module:{name:slug},records:{cols:[],rows:[],total:0}}}), 'cycle-module-tool');
    });
    assert.deepEqual(out,[
      [{href:'/build/brand?project_id=41',label:'Open landing-page builder',quiet:true},{href:'/grow/launch?project_id=41',label:'Open launch calendar',quiet:true}],
      // Cap table's one door, Open liquidity, left with Liquidity & Exits (owner, 2026-10-20).
      [],
      [{href:'/legal?project_id=41',label:'Open legal documents',quiet:true},{href:'/legal/send?project_id=41',label:'Open e-signature',quiet:true}],
      // D1194: Investor match is Capital relationships › Match.
      [{href:'/raise/capital-relationships/match?project_id=41',label:'Open investor match',quiet:true}],
      // D1109: the files tool's door (D696) left with the tool; the module page is the Data room tool.
      [],
    ]);
  },
  gates(m=actual) {
    const users=[{role:'founder',subscription_tier:'free'},{role:'founder',subscription_tier:'growth'},
      {...founder},{role:'founder',spinout_lab_active:1},{role:'admin'},{role:'partner'},{role:'investor'},null];
    const groups=[['grow','distribution'],['raise','cap-table'],['build','company-creation'],['raise','capital-relationships']];
    assert.deepEqual(users.map(user=>groups.flatMap(([c,s])=>m.navigation.moduleToolLinks(c,s,user)).map(l=>l.href)),
      [
        ['/build/brand','/grow/launch','/legal','/legal/send','/raise/capital-relationships/match'],
        ['/build/brand','/grow/launch','/legal','/legal/send','/raise/capital-relationships/match'],
        ['/build/brand','/grow/launch','/legal','/legal/send','/raise/capital-relationships/match'],
        ['/build/brand','/grow/launch','/legal','/legal/send','/raise/capital-relationships/match'],
        ['/build/brand','/grow/launch','/legal','/legal/send','/raise/capital-relationships/match'],[],[],[],
      ]);
  },
  returns(m=actual) {
    assert.deepEqual(RETURNS.map(([path])=>{
      const html=render(m.FounderModuleBackLink,{user:founder},path+'?project_id=41&mode=workspace&tab=old');
      return [path,links(html,'founder-module-back'), /<nav\b/.test(html)];
    }),RETURNS.map(([path,href,label])=>[path,[{href:href+'?project_id=41',label,quiet:true}],false]));
  },
  project(m=actual) {
    assert.deepEqual(['?project_id=41&mode=workspace&tab=x','?project=9&filter=hidden','?project_id=0','?project_id=evil%23hash',''].map(s=>m.navigation.projectSearch(s)),
      ['?project_id=41','?project_id=9','','','']);
  },
  otherRoles(m=actual) {
    assert.deepEqual(['partner','investor','advisor','exploring'].map(role=>render(m.FounderModuleBackLink,{user:{role}},'/raise/pitch')),['','','','']);
  },
  cleanup(m=actual) {
    assert.deepEqual([m.oldTabsExist, /<FounderWorkspaceTabs\b|import\([^)]*FounderWorkspaceTabs/.test(codeOnly(m.sources.app))],[false,false]);
  },
  bindings(m=actual) {
    const app=codeOnly(m.sources.app);
    // D1178: /raise/capital/model is a redirect to Use of funds › Forecast now, so no editor mounts there.
    // D1194: the capital-match addresses forward to the tool, so they mount no editor either.
    const routes=RETURNS.map(r=>r[0]).filter(p=>!['/raise/capital-match','/grow/capital-match','/build/brand','/grow/launch','/legal','/legal/send','/raise/capital/model'].includes(p));
    assert.deepEqual([routes.map(p=>[p,routeBlock(app,p)?.includes('founderEditor(')??false]),
      /const founderEditor = \(component\) => <><FounderModuleBackLink user=\{user\} \/>\{component\}<\/>/.test(app),
      /tools=\{moduleToolLinks\(cycle, slug, user, q\)\}/.test(m.sources.route)],
      [routes.map(p=>[p,true]),true,true]);
  },
  // D1194 (#3128): the three old addresses forward to the Capital relationships
  // tool's tab with the moved notice; the forward keeps the venture and the hash.
  redirect(m=actual) {
    const app=codeOnly(m.sources.app);
    const moved=codeOnly(m.sources.moved);
    assert.deepEqual([
      ['/raise/capital/pipeline','pipeline'],['/raise/capital-match','match'],['/grow/capital-match','match'],
    ].map(([p,tab])=>[p,routeBlock(app,p)?.includes(`<CapRelMovedRedirect tab="${tab}" moved="${tab}" />`)??false]),
    [['/raise/capital/pipeline',true],['/raise/capital-match',true],['/grow/capital-match',true]]);
    assert.deepEqual([moved.includes('capRelMovedTo(tab, loc.search, moved)'),moved.includes('hash: loc.hash'),
      moved.includes('<Navigate replace')],[true,true,true]);
  },
  shell(m=actual) {
    const rows=m.SHELLS.founder.rows;
    assert.deepEqual(rows.filter(r=>r.zones?.some(z=>z.slug==='capital-match')).map(r=>[r.label,r.prefix]),[['Raise','/raise']]);
  },
  guards(m=actual) {
    const app=codeOnly(m.sources.app);
    // A module tab (D1194's /raise/capital-relationships/match) has no route of
    // its own: /<cycle>/:slug/:id answers it, so its guard is that route's.
    const route=(path)=>routeBlock(app,path)||(path.split('/').length===4?routeBlock(app,'/'+path.split('/')[1]+'/:slug/:id'):null);
    assert.deepEqual(m.navigation.FOUNDER_TOOLS.filter(t=>t.door).map(t=>{
      const block=route(t.path)||'';
      const roles=block.match(/guard\((?:labRoles\()?\[([^\]]*)\]/)?.[1]||'';
      return [t.path,t.roles.every(r=>roles.includes("'"+r+"'"))];
    }),[['/build/brand',true],['/grow/launch',true],['/legal',true],['/legal/send',true],['/raise/capital-relationships/match',true]]);
  },
};
