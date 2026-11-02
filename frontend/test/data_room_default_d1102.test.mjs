/**
 * D1102 — actual upload payloads through the client; every upload door starts NDA-on.
 * D1109 (#2989): the old files tool (`DataRoomPage.jsx`) is retired, so the doors are
 * the tool's Upload sheet (its real request body is mounted in data_room_files_d1106)
 * and the module's form; the admin summary moved to `dataroom/DataRoomSummary.jsx`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

test('the tool\'s Upload starts NDA-on and sends Open only when the owner turns it off', () => {
  const upload = readFileSync('frontend/src/pages/raise/dataroom/DataRoomUpload.jsx', 'utf8');
  assert.ok(upload.includes('const [nda, setNda] = useState(true);'), 'Upload starts with the NDA off');
  assert.ok(upload.includes("visibility: nda ? 'nda' : 'open'"), 'Upload sends a fixed gate');
  assert.match(upload, /New files need an NDA unless you switch it off\./);
});

test('the module upload uses the same NDA default in its real request body', async () => {
  const forms = readFileSync('frontend/src/pages/cycles/forms.js', 'utf8');
  await mutationCheck(forms, 'pages/cycles/forms.js', async ({ FORMS }) => {
    const form = FORMS.raise['data-room'][0];
    assert.equal(form.toBody({}, 'synthetic.pdf', 'data:application/pdf;base64,eA==').visibility, 'nda');
  }, [["name, data, visibility: 'nda',", "name, data, visibility: 'open',"]]);
});

test('the admin summary renders counts without owner controls, and an unreadable block is never zero', async () => {
  const path = 'pages/raise/dataroom/DataRoomSummary.jsx';
  const source = readFileSync('frontend/src/' + path, 'utf8');
  await mutationCheck(source, path, async ({ AdminRoomSummary }) => {
    for (const failed of [false, true]) {
      let retried = 0;
      const room = { mode: 'summary', read_only: true, project: { uid: 'synthetic-room' },
        files: failed ? { available: false, reason: 'Synthetic failed read' } : { available: true, total: 2 },
        folders: { available: true, total: 1 }, coverage: { available: true, covered_items: 1, total_items: 7 }, grants: { available: true, total: 3 } };
      let view;
      try {
        view = await mountForm(h(AdminRoomSummary, { room, reload: () => { retried += 1; } })); await view.flush();
        assert.ok(view.by('data-room-admin-summary')); assert.match(view.text(), /Read-only summary/);
        assert.match(view.text(), failed ? /FilesUnreadable/ : /Files2/);
        assert.match(view.text(), /Checklist coverage1 of 7/); assert.match(view.text(), /Grants3/);
        assert.doesNotMatch(view.text(), /Upload files|Nothing in the room yet|Revoke|Require a signed NDA/);
        if (failed) { await view.click('Try again'); assert.equal(retried, 1); }
        else assert.doesNotMatch(view.text(), /Try again/);
      } finally { if (view) await view.unmount(); }
    }
  }, [
    ['onClick={reload} className="mt-2 text-sm underline', 'onClick={() => {}} className="mt-2 text-sm underline'],
    ["typeof block[key] === 'number' ? block[key] : 'Unreadable'", "typeof block[key] === 'number' ? block[key] : 0"],
  ]);
});

// D1464 (#4021) supersedes D1101's admin aggregate on the tabs: an admin's summary answer
// now draws the per-open reason gate (`DataRoomSupport.jsx`), still before any detail derivation
// and still with nothing but GETs until a reason is given. reason_gate_per_open_d1464 mounts the rest.
test('D1101, D1464: Files, Access and Activity draw the reason gate for an admin before any detail derivation',async()=>{
  const path='pages/raise/dataroom/DataRoomTool.jsx';
  const source=readFileSync('frontend/src/'+path,'utf8');
  await mutationCheck(source,path,async({DataRoomTabPage})=>{
    for(const tab of ['files','access','activity'])for(const phone of [false,true]){
      const previous=globalThis.fetch;let view;const seen=[];
      globalThis.fetch=async(url,init={})=>{
        seen.push(init.method||'GET');
        const projects=String(url).includes('/api/projects');
        const body=projects?[{id:3,uid:'synthetic-room'}]:{mode:'summary',read_only:true,project:{uid:'synthetic-room'},
          files:{available:true,total:2},folders:{available:true,total:1},coverage:{available:true,covered_items:1,total_items:7},grants:{available:true,total:3}};
        return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
      };
      try{
        await assert.doesNotReject(async()=>{view=await mountForm(h(DataRoomTabPage,{tab,phone,projectId:3,search:'?project_id=3'}),{phone});await view.flush();});
        assert.ok(view.by('dataroom-support-page'));assert.match(view.text(),/Why are you opening this data room\?/);
        assert.doesNotMatch(view.text(),/Upload files|Share or revoke|Nothing in the log yet|not shared with anyone|Nothing in the room/);
        assert.ok(seen.every(method=>method==='GET'));
      }finally{if(view)await view.unmount();globalThis.fetch=previous;}
    }
  },[
    ["else if (read.status === 'ready' && read.room?.mode === 'summary') body = <DataRoomSupport key={read.uid} projectUid={read.uid} venture={venture} viewer={viewer} onOpen={onSupportRead} />;",''],
  ]);
});
