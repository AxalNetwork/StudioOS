import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountContracts } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import MeetingBotPanel, { MeetingBotStatus } from '../src/pages/founder/MeetingBotPanel.jsx';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import { SchedulePanel, ScheduledBotChoice } from '../src/pages/founder/InterviewChannels.jsx';
import { TranscriptReview } from '../src/pages/founder/InterviewSessionPage.jsx';
const h=React.createElement;
const now=Date.now();
const link=['https:/','meet.google.com','abc-defg-hij'].join('/');
const by=(m,id)=>m.nodes().find(n=>m.props(n)?.['data-testid']===id);
async function press(m,id){await act(async()=>{await m.props(by(m,id)).onClick?.({preventDefault(){}});});}
async function change(m,id,value,checked){await act(async()=>{await m.props(by(m,id)).onChange({target:{value,checked}});});}
const bot=(status)=>({bot:{uid:'synthetic',status,started_at:now-65000,participant_count:2}});
const models={live:[],final:[],defaults:{live:null,final:null}};
function setup(){
  const sent=[],device=[],started=[],opened=[];
  const props={projectId:10,interview:{id:1,interviewee_name:'Fixture person'},initialMode:'video',initialModels:models,initialBoard:{hypotheses:[]},channels:{providers:[{provider:'zoom',available:false},{provider:'google_meet',available:true}],connections:{}},initialConsent:'written',onClose(){},onStarted:(...a)=>started.push(a),sessions:{async create(id,body){opened.push(body);return{session:{id:15,channel:'video'}};},async sendBot(id,body){sent.push({id,body});return bot('joining');}},recorder:{prepare(){device.push('prepare');},release(){device.push('release');},begin(){device.push('begin');},getSnapshot(){return{};},isCapturing(){return false;}}};
  return {props,sent,device,started,opened};
}

test('B7 every live/terminal state renders with dark pairs, timer, failure and Stop semantics',()=>{
  for(const state of ['queued','joining','waiting_room','recording','processing','done','failed','stopped']){
    const out=renderToStaticMarkup(h(MeetingBotStatus,{snapshot:{read:bot(state)},now,participants:null}));
    assert.match(out,new RegExp(`data-state="${state}"`));
    assert.equal(out.includes('data-testid="bot-stop"'),['queued','joining','waiting_room','recording'].includes(state));
    assert.equal(out.includes('01:05'),state==='recording');assert.match(out,/dark:bg-gray-950/);assert.match(out,/dark:text-gray-100/);
    assert.equal(out.includes('role="alert"'),state==='failed');assert.match(renderedText(out),/Not recorded: the bot has not sent a roster/);
  }
  const unread=renderToStaticMarkup(h(MeetingBotStatus,{snapshot:{read:bot('recording'),unreadable:true},participants:'unreadable'}));assert.match(unread,/data-state="unreadable"/);assert.doesNotMatch(unread,/data-testid="bot-stop"/);assert.match(renderedText(unread),/does not mean the bot has stopped/);
});

test('B7 renders only saved display names and join/leave times; named transcript labels remain visible',()=>{
  const out=renderToStaticMarkup(h(MeetingBotStatus,{snapshot:{read:bot('done')},participants:[{display_name:'Fixture <participant>',joined_ms:1000,left_ms:61000},{display_name:'Fixture B',joined_ms:2000,left_ms:null}]}));
  assert.match(out,/Fixture &lt;participant&gt;/);assert.match(renderedText(out),/Joined 0:01 · Left 1:01/);assert.match(renderedText(out),/Still present in the latest roster/);
  const transcript=renderToStaticMarkup(h(TranscriptReview,{segments:[{id:1,source:'final',speaker_label:'Fixture speaker',text:'Synthetic words.'}]}));assert.match(renderedText(transcript),/Fixture speaker/);
});

test('B7 StrictMode status loads; rendered Stop uses its route exactly once and moves to processing',async()=>{
  const stopped=[];
  const api={getBot:async()=>bot('recording'),stopBot:async(id)=>{stopped.push(id);return bot('processing');},botParticipants:async()=>({participants:null})};
  const m=await mountContracts(h(StrictMode,null,h(MeetingBotPanel,{sessionId:15,api})));
  try{await m.flush();assert.ok(by(m,'bot-stop'));await press(m,'bot-stop');assert.deepEqual(stopped,[15]);assert.equal(by(m,'bot-stop'),undefined);assert.match(m.text(),/Processing the recording/);}finally{await m.unmount();}
});

test('B7 supported link sends the bot after saved consent without preparing a device or storing a plain link',async()=>{
  const s=setup(),m=await mountContracts(h(RecordLightbox,s.props));
  try{await press(m,'record-provider-google_meet');await change(m,'record-link',link);assert.match(m.text(),/Send Eadwyn AI/);assert.ok(by(m,'meeting-bot-consent-notice'));assert.ok(by(m,'record-device'));assert.match(m.text(),/Device recording options/);assert.match(m.text(),/bot time and transcription/);await press(m,'record-start');assert.equal(s.sent.length,1,m.text());assert.equal(s.sent[0].id,15);assert.equal(s.sent[0].body.meeting_url,link);assert.equal(s.opened[0].meeting_url,undefined);assert.equal(s.opened[0].consent.status,'given');assert.equal(s.opened[0].final_model,'@cf/deepgram/nova-3');assert.equal(s.opened[0].live_model,null);assert.deepEqual(s.device,[]);assert.equal(s.started[0][0].submitted_via,'meeting_bot');}finally{await m.unmount();}
});

test('B7 secondary device choice stays explicit; refusal never falls back to microphone or echoes provider text',async()=>{
  const s=setup(),m=await mountContracts(h(RecordLightbox,s.props));
  try{await press(m,'record-provider-google_meet');await change(m,'record-link',link);await press(m,'record-device');assert.equal(s.sent.length,0);assert.deepEqual(s.device,['begin']);}finally{await m.unmount();}
  const f=setup();f.props.sessions.sendBot=async()=>{throw Object.assign(new Error('PRIVATE-PROVIDER-DETAIL'),{status:402});};
  const n=await mountContracts(h(RecordLightbox,f.props));
  try{await press(n,'record-provider-google_meet');await change(n,'record-link',link);await press(n,'record-start');assert.deepEqual(f.device,[]);assert.match(n.text(),/not enough AI tokens/);assert.doesNotMatch(n.text(),/PRIVATE-PROVIDER-DETAIL/);assert.equal(f.started.length,0);assert.match(n.text(),/Open the session to check/);}finally{await n.unmount();}
});

test('B7 scheduled-call auto-send defaults on and explicit opt-out reaches the scheduling request',async()=>{
  const sent=[];
  const api={meetings:async()=>({meetings:[],providers:[{provider:'zoom',available:true,connected:true}]}),scheduleMeeting:async(id,body)=>{sent.push(body);return{meeting:{},bot_error:{code:'bot_unavailable'}};}};
  const date=new Date(now+3600000);const form={provider:'zoom',date:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,time:`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`,duration:30,topic:'',consent:'written',record:false};
  const m=await mountContracts(h(SchedulePanel,{interview:{id:1},api,initialForm:form}));
  try{assert.equal(m.props(by(m,'meeting-auto-send')).checked,true);assert.match(m.text(),/does not need a paid recording or transcription plan/);await press(m,'button-schedule-meeting');assert.equal(sent[0].auto_send_bot,true);assert.match(m.text(),/not available on this deployment/);await change(m,'meeting-auto-send','',false);await press(m,'button-schedule-meeting');assert.equal(sent[1].auto_send_bot,false);}finally{await m.unmount();}
});

test('B7 per-call opt-out cancels the persisted queued run; re-enable uses its original start time',async()=>{
  const calls=[];const meeting={session_id:15,status:'scheduled',join_url:link,starts_at:new Date(now+3600000).toISOString(),bot:{status:'queued'}};
  const api={async stopBot(id){calls.push(['stop',id]);},async sendBot(id,body){calls.push(['send',id,body]);}};
  const m=await mountContracts(h(ScheduledBotChoice,{meeting,api,now}));
  try{assert.equal(m.props(by(m,'scheduled-bot-choice')).checked,true);await change(m,'scheduled-bot-choice','',false);assert.deepEqual(calls,[['stop',15]]);}finally{await m.unmount();}
  const n=await mountContracts(h(ScheduledBotChoice,{meeting:{...meeting,bot:null},api,now}));
  try{await change(n,'scheduled-bot-choice','',true);assert.equal(calls[1][0],'send');assert.equal(calls[1][2].scheduled_at,meeting.starts_at);}finally{await n.unmount();}
});

test('B7 unsaved consent sends nothing, duplicate Send presses share one setup, and explicit fallback has its own key',async()=>{
  const no=setup();no.props.initialConsent='';const n=await mountContracts(h(RecordLightbox,no.props));
  try{await press(n,'record-provider-google_meet');await change(n,'record-link',link);await press(n,'record-start');assert.equal(no.sent.length,0);assert.equal(no.opened.length,0);}finally{await n.unmount();}
  const s=setup(),m=await mountContracts(h(RecordLightbox,s.props));
  try{await press(m,'record-provider-google_meet');await change(m,'record-link',link);const send=m.props(by(m,'record-start')).onClick;await act(async()=>{await Promise.all([send(),send()]);});assert.equal(s.sent.length,1);assert.equal(s.opened.length,1);}finally{await m.unmount();}
  const f=setup();f.props.sessions.sendBot=async()=>{throw{status:402};};const k=await mountContracts(h(RecordLightbox,f.props));
  try{await press(k,'record-provider-google_meet');await change(k,'record-link',link);await press(k,'record-start');assert.deepEqual(f.device,[]);await press(k,'record-device');assert.notEqual(f.opened[0].client_key,f.opened[1].client_key);assert.deepEqual(f.device,['begin']);}finally{await k.unmount();}
});

test('B7 a failed status read is Unreadable, offers no Stop, and does not leave participants loading forever',async()=>{
  const m=await mountContracts(h(MeetingBotPanel,{sessionId:15,api:{getBot:async()=>{throw new Error('SYNTHETIC-PRIVATE');}}}));
  try{await m.flush();assert.match(m.text(),/Unreadable/);assert.doesNotMatch(m.text(),/Reading participants|SYNTHETIC-PRIVATE/);assert.equal(by(m,'bot-stop'),undefined);}finally{await m.unmount();}
  const out=renderToStaticMarkup(h(MeetingBotStatus,{snapshot:{read:{bot:{status:'stopped',failure_code:'tokens'}}},participants:null}));assert.match(renderedText(out),/not enough AI tokens to continue/);
});
