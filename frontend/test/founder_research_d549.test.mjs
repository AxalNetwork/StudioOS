import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { founderZoneActions } from '../src/workspaces/founderZoneActions.js';
import { founderZoneFilters } from '../src/workspaces/founderZoneFilters.js';
const { AnswerDisposition } = await import('../src/pages/research/AskZone.jsx');
const { DocumentMetadata, CollectionManager } = await import('../src/pages/research/LibraryZone.jsx');
const html = (component, props) => renderToStaticMarkup(h(component, props));

test('D549: the rendered answer exposes explicit disposition, note and empty state', () => {
  const render = (item) => html(AnswerDisposition, { item, onUpdate() {} });
  const saved = render({ saved:true, discarded:false, use_note:'Used in the pitch' });
  const discarded = render({ saved:false, discarded:true, use_note:null });
  const unset = render({ saved:false, discarded:false, use_note:null });
  assert.deepEqual([saved.includes('Saved'),saved.includes('Used in the pitch'),saved.includes('What you did with it'),discarded.includes('Discarded'),discarded.includes('Undo discard'),discarded.includes('Use note: Not recorded'),unset.includes('Not decided'),unset.includes('Save note')], Array(8).fill(true));
});

test('D549: metadata renders the new kinds and nullable source year only for owned files', () => {
  const owned = html(DocumentMetadata, { document:{ uid:'own',title:'Interview',kind:'primary',source_year:null },onSaved() {} });
  const recorded = html(DocumentMetadata, { document:{ uid:'own',title:'Report',kind:'report',source_year:2025 },onSaved() {} });
  const shared = html(DocumentMetadata, { document:{ uid:'shared',title:'Client',source:'client',read_only:true },onSaved() {} });
  assert.deepEqual([owned.includes('Report'),owned.includes('Primary'),owned.includes('Legal'),owned.includes('Not recorded'),owned.includes('Save metadata'),recorded.includes('2025'),shared], [true,true,true,true,true,true,'']);
});

test('D549: collection controls distinguish empty, selected, unreadable and member states', () => {
  const base={documents:[{uid:'own',title:'Interview'}],selected:'',onSelect(){},showCreate:true,onShowCreate(){},onSaved(){}};
  const empty=html(CollectionManager,{...base,state:{loading:false,error:'',items:[]}});
  const collection={uid:'c',name:'Primary work',document_uids:[]};
  const selected=html(CollectionManager,{...base,selected:'c',state:{loading:false,error:'',items:[collection]}});
  const member=html(CollectionManager,{...base,selected:'c',state:{loading:false,error:'',items:[{...collection,document_uids:['own']}]}});
  const unreadable=html(CollectionManager,{...base,state:{loading:false,error:'synthetic failure',items:[]}});
  assert.deepEqual([empty.includes('No collections yet'),empty.includes('Create collection'),selected.includes('This collection is empty'),selected.includes('Rename'),selected.includes('Delete collection'),selected.includes('Add to collection'),member.includes('Interview'),member.includes('Remove from collection'),unreadable.includes('Unreadable'),unreadable.includes('Retry'),unreadable.includes('No collections yet')], [true,true,true,true,true,true,true,true,true,true,false]);
});

test('D549: real zone builders expose Discarded and the wired New collection action', () => {
  let clicks=0;
  const action=founderZoneActions('research/library',{handlers:{newCollection:()=>{clicks+=1;},addDocument(){}}}).find((item)=>item.label==='New collection');
  action?.onClick?.();
  const filters=founderZoneFilters('research/ask',{value:'all',onChange(){}});
  assert.deepEqual([clicks,filters.some((item)=>item.label==='Discarded' && !item.disabled),filters.some((item)=>item.label==='Cited in deck')], [1,true,false]);
});
