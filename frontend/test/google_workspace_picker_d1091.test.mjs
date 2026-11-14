import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseWorkspaceFiles, PICKER_SCOPE } from '../src/lib/googleWorkspacePicker.js';
function fake(scope = PICKER_SCOPE, action = 'picked') {
 const seen={};
 class Builder {
  addView(){return this;} enableFeature(){return this;} setDeveloperKey(v){seen.key=v;return this;} setAppId(v){seen.app=v;return this;}
  setOAuthToken(v){seen.token=v;return this;} setOrigin(v){seen.origin=v;return this;} setCallback(cb){this.cb=cb;return this;}
  build(){return {setVisible:()=>this.cb({action,docs:[{id:'chosen-id'}]}),dispose(){seen.disposed=true;}};}
 }
 const browser={location:{origin:'https://axal.vc'},google:{accounts:{oauth2:{initTokenClient(options){seen.options=options;return {requestAccessToken(){options.callback({scope,access_token:'browser-only'});}};}}},picker:{PickerBuilder:Builder,DocsView:class {setIncludeFolders(v){seen.folders=v;return this;}setSelectFolderEnabled(v){seen.folderSelection=v;return this;}},Feature:{MULTISELECT_ENABLED:1},Action:{PICKED:'picked',CANCEL:'cancel'}}}};
 return {browser,seen};
}
const config={configured:true,client_id:'public-client',api_key:'public-key',app_id:'123'};
test('Picker requests only drive.file, excludes inherited scopes and returns IDs without a token',async()=>{
 const {browser,seen}=fake();const result=await chooseWorkspaceFiles(config,browser);
 assert.deepEqual(result,['chosen-id']);assert.equal(seen.options.scope,PICKER_SCOPE);assert.equal(seen.options.include_granted_scopes,false);
 assert.equal(seen.app,'123');assert.equal(seen.key,'public-key');assert.equal(seen.folders,false);assert.equal(seen.folderSelection,false);assert.equal(seen.disposed,true);
 assert.doesNotMatch(JSON.stringify(result),/browser-only|access_token/);
});
test('wider or missing grants and an unconfigured Picker refuse; cancellation returns no files',async()=>{
 await assert.rejects(()=>chooseWorkspaceFiles(config,fake(PICKER_SCOPE+' calendar.events').browser),/picker_scope_refused/);
 await assert.rejects(()=>chooseWorkspaceFiles(config,fake('').browser),/picker_scope_refused/);
 await assert.rejects(()=>chooseWorkspaceFiles({...config,configured:false},fake().browser),/picker_not_ready/);
 assert.deepEqual(await chooseWorkspaceFiles(config,fake(PICKER_SCOPE,'cancel').browser),[]);
});
