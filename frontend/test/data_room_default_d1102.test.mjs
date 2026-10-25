/** D1102 — actual upload payloads through the client; both upload doors start NDA-on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, mutationCheck } from './_form_d695.mjs';

const path = 'pages/raise/DataRoomPage.jsx';
// Isolated exports expose the existing component without changing the production module.
const source = readFileSync('frontend/src/' + path, 'utf8') + '\nexport { UploadQueue, FounderRoom };';

test('files tool starts NDA-on, sends NDA, and sends Open only after the person turns it off', async () => {
  await mutationCheck(source, path, async ({ UploadQueue }) => {
    const previousFetch = globalThis.fetch, previousReader = globalThis.FileReader;
    const bodies = [];
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(new URL(url, 'https://fixture.example.test').pathname, '/api/data-room/synthetic-room/files');
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ uid: 'synthetic-upload' }), { headers: { 'Content-Type': 'application/json' } });
    };
    globalThis.FileReader = class { readAsDataURL() { this.result = 'data:text/plain;base64,eA=='; this.onload(); } };
    let view;
    try {
      view = await mountForm(h(UploadQueue, { projectUid: 'synthetic-room', folders: [], onDone() {} }));
      const checkbox = () => view.nodes().find(n => n.tagName === 'INPUT' && view.props(n).type === 'checkbox');
      assert.equal(view.props(checkbox()).checked, true);
      const upload = async () => {
        const picker = view.nodes().find(n => n.tagName === 'INPUT' && view.props(n).type === 'file');
        await act(async () => view.props(picker).onChange({ target: { files: [{ name: 'synthetic.txt', type: 'text/plain', size: 1 }], value: 'synthetic' } }));
        await view.flush();
      };
      await upload(); assert.equal(bodies[0].visibility, 'nda');
      await act(async () => view.props(checkbox()).onChange({ target: { checked: false } }));
      await upload(); assert.equal(bodies[1].visibility, 'open');
      assert.equal(view.props(checkbox()).checked, false);
    } finally { if (view) await view.unmount(); globalThis.fetch = previousFetch; globalThis.FileReader = previousReader; }
  }, [
    ['const [nda, setNda] = useState(true);', 'const [nda, setNda] = useState(false);'],
    ["visibility: nda ? 'nda' : 'open'", "visibility: 'open'"],
    ["visibility: nda ? 'nda' : 'open'", "visibility: 'nda'"],
  ]);
});

test('the module upload uses the same NDA default in its real request body', async () => {
  const forms = readFileSync('frontend/src/pages/cycles/forms.js', 'utf8');
  await mutationCheck(forms, 'pages/cycles/forms.js', async ({ FORMS }) => {
    const form = FORMS.raise['data-room'][0];
    assert.equal(form.toBody({}, 'synthetic.pdf', 'data:application/pdf;base64,eA==').visibility, 'nda');
  }, [["name, data, visibility: 'nda',", "name, data, visibility: 'open',"]]);
});

test('the admin summary renders counts without owner controls, and an unreadable block is never zero', async () => {
  await mutationCheck(source, path, async ({ FounderRoom }) => {
    for (const failed of [false, true]) {
      const previous = globalThis.fetch; const seen = []; let down=failed;
      globalThis.fetch = async (url, init={}) => {
        seen.push(init.method || 'GET');
        return new Response(JSON.stringify({ mode:'summary',read_only:true,project:{uid:'synthetic-room'},
          files:down ? {available:false,reason:'Synthetic failed read'} : {available:true,total:2},
          folders:{available:true,total:1},coverage:{available:true,covered_items:1,total_items:7},grants:{available:true,total:3} }),
          {headers:{'Content-Type':'application/json'}});
      };
      let view;
      try {
        view=await mountForm(h(FounderRoom,{projects:[{uid:'synthetic-room'}]})); await view.flush();
        assert.ok(view.by('data-room-admin-summary')); assert.match(view.text(),/Read-only summary/);
        assert.match(view.text(),failed ? /FilesUnreadable/ : /Files2/);
        assert.match(view.text(),/Checklist coverage1 of 7/); assert.match(view.text(),/Grants3/);
        assert.doesNotMatch(view.text(),/Upload files|Nothing in the room yet|Revoke|Require a signed NDA/);
        if (failed) {
          down=false; await view.click('Try again'); await view.flush();
          assert.match(view.text(),/Files2/); assert.doesNotMatch(view.text(),/Unreadable/); assert.equal(seen.length,2);
        }
        assert.ok(seen.every(m=>m==='GET'));
      } finally {if(view) await view.unmount();globalThis.fetch=previous;}
    }
  }, [
    ["if (room?.mode === 'summary') return <AdminRoomSummary room={room} reload={load} />;", "if (room?.mode === 'summary') return <p>Upload files</p>;"],
    ['onClick={reload} className="mt-2 text-sm underline', 'onClick={() => {}} className="mt-2 text-sm underline'],
    ["typeof block[key] === 'number' ? block[key] : 'Unreadable'", "typeof block[key] === 'number' ? block[key] : 0"],
  ]);
});


test('D1101 Files, Access and Activity tabs render an admin aggregate before any detail derivation',async()=>{
  const path='pages/raise/dataroom/DataRoomTool.jsx';
  const source=readFileSync('frontend/src/'+path,'utf8');
  await mutationCheck(source,path,async({DataRoomTabPage})=>{
    for(const tab of ['files','access','activity'])for(const phone of [false,true]){
      const previous=globalThis.fetch;let failed=true;let view;const seen=[];
      globalThis.fetch=async(url,init={})=>{
        seen.push(init.method||'GET');
        const projects=String(url).includes('/api/projects');
        const body=projects?[{id:3,uid:'synthetic-room'}]:{mode:'summary',read_only:true,project:{uid:'synthetic-room'},
          files:failed?{available:false}:{available:true,total:2},folders:{available:true,total:1},coverage:{available:true,covered_items:1,total_items:7},grants:{available:true,total:3}};
        return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
      };
      try{
        await assert.doesNotReject(async()=>{view=await mountForm(h(DataRoomTabPage,{tab,phone,projectId:3,search:'?project_id=3'}),{phone});await view.flush();});
        assert.ok(view.by('data-room-admin-summary'));assert.match(view.text(),/FilesUnreadable/);
        assert.match(view.text(),/Checklist coverage1 of 7/);assert.match(view.text(),/Grants3/);
        assert.doesNotMatch(view.text(),/Upload files|Share or revoke|Nothing in the log yet|not shared with anyone|Nothing in the room/);
        failed=false;await view.click('Try again');await view.flush();assert.match(view.text(),/Files2/);
        assert.ok(seen.every(method=>method==='GET'));
      }finally{if(view)await view.unmount();globalThis.fetch=previous;}
    }
  },[
    ["else if (read.status === 'ready' && read.room?.mode === 'summary') body = <AdminRoomSummary room={read.room} reload={retry} />;",''],
  ]);
});
