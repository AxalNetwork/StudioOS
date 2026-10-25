import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_WORKSPACE_FEEDS } from '../src/integrations/googleWorkspaceFeeds.ts';
import { GOOGLE_WORKSPACE_READS } from '../src/services/google/workspace.ts';
import { getDescriptor, CONNECTOR_METADATA } from '../src/integrations/registry.ts';
import { pageDescriptor } from '../src/integrations/connectorPages.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { FED_LEDGER_PROVIDERS } from '../src/integrations/fed.ts';

test('Workspace exposes the read foundation honestly, with no module feed or verified live connection',()=>{
 const row=getDescriptor('google_workspace')!;
 const page=pageDescriptor(row,{role:'founder',hq:true,venture:true})!;
 assert.equal(row.auth_type,'oauth2');assert.equal(row.audience_rule,'venture');assert.equal(row.status,'coming_soon');
 assert.equal(CONNECTOR_METADATA.google_workspace.category,'Docs');
 assert.deepEqual(GOOGLE_WORKSPACE_FEEDS,[]);assert.ok(Object.isFrozen(GOOGLE_WORKSPACE_FEEDS));
 assert.deepEqual(CONNECTOR_METADATA.google_workspace.pulls,GOOGLE_WORKSPACE_FEEDS);
 assert.deepEqual(CONNECTOR_METADATA.google_workspace.feeds,[]);assert.deepEqual(CONNECTOR_METADATA.google_workspace.sends,[]);
 assert.equal(page.sign_in.kind,'first_party');assert.equal(page.sign_in.label,'Allow Google files');
 assert.equal(page.verified_on,null);assert.equal(page.added,null);assert.deepEqual(page.prompts,[]);
 assert.match(page.long_description.join(' '),/await their approved design/);
 assert.match(pageDescriptor(getDescriptor('google_calendar')!,{role:'founder',hq:true,venture:true})!.long_description.join(' '),/file choosing is coming soon.*\/account\/connectors\/google_workspace/);
 assert.equal(page.tools.length,8);
 const fragments=page.tools.flatMap(t=>t.calls);
 for(const call of Object.keys(GOOGLE_WORKSPACE_READS)) assert.ok(fragments.includes("'"+call+"'"),call);
 assert.equal(writesProjectData('google_workspace'),true);assert.equal(FED_LEDGER_PROVIDERS.has('google_workspace'),true);
 assert.equal(pageDescriptor(row,{role:'investor',hq:true,venture:false}),null);
});
