// D4421: one copy source on canonical agent proposals/queue DTOs and the actual run instruction.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { world, AGENT, SPONSOR, STRANGER } from './_agent_engine_fixture.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT_DISCLAIMERS, GENERAL_COUNSEL_DISCLAIMER_KEY as KEY, agentDisclaimerText, disclaimerKeyForRole } from '../src/services/agents/disclaimers.ts';
import { systemPrompt } from '../src/services/agents/agentRun.ts';
import { roleOf } from '../src/services/agents/catalogue.ts';
import { proposeRail, getRail, listRail, railByRunKey } from '../src/services/railProposals.ts';
import { queueList, queueItem } from '../src/services/agents/queue.ts';
import { loadScope } from '../src/services/agents/teams.ts';
after(removeMigratedDatabases);
const TEXT='Not legal advice. Always escalates.';

test('copy lookup uses exact role identity and a closed disclaimer key',()=>{
  assert.equal(agentDisclaimerText(KEY),TEXT); assert.equal(Object.isFrozen(AGENT_DISCLAIMERS),true);
  assert.equal(roleOf('general_counsel')?.disclaimer_key,KEY);
  assert.equal(disclaimerKeyForRole('general_counsel'),KEY);
  assert.equal(disclaimerKeyForRole('General counsel'),undefined);
  assert.equal(disclaimerKeyForRole('external_counsel'),undefined);
  assert.equal(agentDisclaimerText('__proto__'),null); assert.equal(agentDisclaimerText('unknown'),null);
});

test('run and quote share a mandatory instruction independent of editable rule-book wording',()=>{
  const rules={...roleOf('general_counsel')!.default_rules,mission:'Synthetic edited mission',tone:'Brief'};
  const agent={role_key:'general_counsel',persona_key:null,first_name:'Synthetic',last_name:'Agent'};
  const prompt=systemPrompt(agent,rules,{kind:'project',name:'Synthetic project'},'Legal');
  assert.ok(prompt.includes(`Include this exact limit in every output: ${TEXT}`));
  assert.equal(prompt.split(TEXT).length-1,1);
  assert.ok(prompt.includes('Synthetic edited mission'));
  const other=systemPrompt({...agent,role_key:'cfo',first_name:'General counsel'},rules,{kind:'project',name:'Synthetic project'},'Finance');
  assert.equal(other.includes(TEXT),false,'a display name cannot impersonate a role');
});

test('proposal reads and queue items carry trusted role metadata, including old payloads and history',async()=>{
  const w=world();try{
    w.agent(AGENT,'general_counsel'); w.agent(AGENT+1,'cfo');
    const own=await proposeRail(w.env,{userId:SPONSOR,page:'Founder · Raise',option:'draft:raise/legal',kind:'draft',payload:{text:'Synthetic draft'},agentId:AGENT,runKey:'agent:run-4421-aaaa'});
    const spoof=await proposeRail(w.env,{userId:SPONSOR,page:'Founder · Raise',option:'draft:raise/legal',kind:'draft',payload:{text:'Synthetic finance draft',disclaimer_key:KEY},agentId:AGENT+1});
    assert.equal(own.disclaimer_key,KEY); assert.equal(spoof.disclaimer_key,undefined);
    assert.equal((await getRail(w.env,SPONSOR,own.uid))?.disclaimer_key,KEY);
    assert.equal(await getRail(w.env,STRANGER,own.uid),null);
    assert.equal((await railByRunKey(w.env,SPONSOR,'agent:run-4421-aaaa'))?.disclaimer_key,KEY);
    const rows=await listRail(w.env,SPONSOR,{option:'draft:raise/legal'});
    assert.equal(rows.find(r=>r.uid===own.uid)?.disclaimer_key,KEY);
    assert.equal(rows.find(r=>r.uid===spoof.uid)?.disclaimer_key,undefined);
    const scope=(await loadScope(w.env,'project','7'))!;
    const user=w.db.prepare('SELECT * FROM users WHERE id=?').get(SPONSOR) as any;
    const queue=await queueList(w.env,scope,{},user);
    assert.equal(queue.items.find(r=>r.uid===own.uid)?.disclaimer_key,KEY);
    assert.equal(queue.items.find(r=>r.uid===spoof.uid)?.disclaimer_key,undefined);
    const item=await queueItem(w.env,user,own.uid); assert.equal(item.ok,true);
    if(!item.ok)throw new Error('missing synthetic queue item');
    assert.equal(item.item.disclaimer_key,KEY);
    w.db.prepare("UPDATE ai_rail_proposals SET status='accepted' WHERE uid=?").run(own.uid);
    const history=await queueList(w.env,scope,{status:'accepted'},user);
    assert.equal(history.items[0].disclaimer_key,KEY);
    assert.doesNotMatch(JSON.stringify(own),/sponsor@example|agent_id|user_id/);
  }finally{w.close();}
});
