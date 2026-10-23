/**
 * D886 B2 (#2580): the HTTP callback client against a stubbed Worker, and
 * #2577's privacy rule — no meeting link, passcode or participant name in a
 * log line, whatever the adapter throws.
 */
import { test } from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/wav.ts';
import { CALLBACK_PATHS, TransportError, httpTransport, signRequest } from '../src/callback.ts';
import { logLine, safeFields } from '../src/log.ts';
import { runBot } from '../src/lifecycle.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { CHUNK_SAMPLES, FREE_LIMIT_MS } from '../src/constants.ts';
import { AdapterFailure } from '../src/types.ts';
import { FakeClock, StubCallback, tone } from './_harness.ts';

const RUN='00000000-0000-4000-8000-000000000009';
const BASE=`https://axal.vc/api/meeting-bots/${RUN}/`;
const NOW=1_700_000_000_000;
// A fresh key each run: the test checks the signature's shape, not a stored value.
const KEY = randomBytes(16).toString('hex');

type Seen = { url: string; init: RequestInit };
function stubFetch(answer: (url: string, init: RequestInit) => Response) {
  const seen: Seen[] = [];
  const f = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { f, seen };
}

test('1. one signed B1 event stream: exact path, millisecond signature, status/roster/silence and global seq', async()=>{
  const {f,seen}=stubFetch(()=>Response.json({budget_deadline_at:NOW+120_000}));
  const transport=httpTransport({baseUrl:BASE,runId:RUN,key:KEY,fetch:f,now:()=>NOW});
  await transport.status({state:'recording'});
  await transport.events([{n:1,type:'speaker',participant_id:null,at_ms:5}]);
  await transport.heartbeat();
  assert.deepEqual(seen.map(s=>s.url),Array(3).fill(BASE+CALLBACK_PATHS.events));
  assert.deepEqual(seen.map(s=>JSON.parse(String(s.init.body)).seq),[1,2,3]);
  for(const s of seen){
    assert.equal(s.init.method,'POST');assert.equal(s.init.redirect,'error');assert.ok(s.init.signal);
    const h=s.init.headers as Record<string,string>;
    const path=new URL(s.url).pathname;
    assert.equal(h['x-meeting-bot-timestamp'],String(NOW));
    assert.equal(h['x-meeting-bot-signature'],createHmac('sha256',KEY).update(`v1:${NOW}:POST:${path}:${String(s.init.body)}`).digest('hex'));
    assert.deepEqual(await signRequest(KEY,path,String(s.init.body),NOW),{'x-meeting-bot-timestamp':String(NOW),'x-meeting-bot-signature':h['x-meeting-bot-signature']});
  }
  assert.deepEqual(JSON.parse(String(seen[1].init.body)),{seq:2,type:'speaker',participant_id:null,at_ms:5});
});

test('2. canonical chunk manifest gets a same-origin one-use PUT; arbitrary upload hosts are refused',async()=>{
  const path=`/api/meeting-bots/${RUN}/chunks/4?token=synthetic`;
  const {f,seen}=stubFetch(url=>url.endsWith('/events')?Response.json({upload_path:path,expires_at:NOW+60_000}):Response.json({ok:true}));
  const transport=httpTransport({baseUrl:BASE,runId:RUN,key:KEY,fetch:f,now:()=>NOW});
  const wav=encodeWav(new Int16Array(1600));await transport.putChunk(4,wav,30_000);
  assert.deepEqual(seen.map(s=>[s.init.method,s.url]),[['POST',BASE+'events'],['PUT',new URL(path,BASE).href]]);
  assert.deepEqual(JSON.parse(String(seen[0].init.body)),{seq:1,type:'chunk',chunk_seq:4,size_bytes:wav.length,start_ms:30_000});
  assert.equal(seen[1].init.body,wav);
  assert.equal((seen[1].init.headers as Record<string,string>)['content-type'],'audio/wav');
  for(const upload_path of ['http://axal.vc'+path,'https://untrusted.example'+path,`/api/meeting-bots/${RUN}/chunks/5?token=x`]){
    const bad=stubFetch(()=>Response.json({upload_path}));
    await assert.rejects(httpTransport({baseUrl:BASE,runId:RUN,key:KEY,fetch:bad.f}).putChunk(4,wav),TransportError);
    assert.equal(bad.seen.length,1);
  }
});

test('3. fixed transport errors disclose status only; unsafe base or credentials are refused',async()=>{
  const bad=stubFetch(()=>new Response('SYNTHETIC_PRIVATE_MARKER',{status:503}));
  const transport=httpTransport({baseUrl:BASE,runId:RUN,key:KEY,fetch:bad.f});
  const error=await transport.status({state:'joining'}).catch(e=>e);
  assert.ok(error instanceof TransportError);assert.equal(error.message,'callback_503');assert.equal(error.status,503);
  for(const baseUrl of ['http://axal.vc/'+RUN+'/',BASE+'wrong/',BASE+'?secret=x',BASE.replace('https://','https://user:pass@')])
    assert.throws(()=>httpTransport({baseUrl,runId:RUN,key:KEY}),TransportError);
});

test('4. safeFields keeps numbers, booleans and the bot\'s own codes, and drops every other string', () => {
  assert.deepEqual(safeFields({ state: 'recording', code: 'not_admitted', seq: 3, ok: true, url: 'https://zoom.us/j/1', name: 'Ada', reason: 'alone', nan: NaN, 'Bad-Key': 1 }),
    { state: 'recording', code: 'not_admitted', seq: 3, ok: true, reason: 'alone' });
  const lines: string[] = [];
  logLine((e) => lines.push(e), 'https://zoom.us/j/1');
  assert.deepEqual(lines, [], 'an event name that is not code-like is not written');
});

test('5. a whole run, with a passcode in the link and names in the roster, writes none of them to a log line', async () => {
  const LINK = 'https://us02web.zoom.us/j/81234567890?pwd=Zq9SECRETpass';
  const NAMES = ['Zelda Quixote', 'Bartholomew Yung'];
  const lines: string[] = [];
  const console0 = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    for (const variant of ['ok', 'adapter_throws'] as const) {
      const clock = new FakeClock();
      const cb = new StubCallback();
      cb.failChunk.set(0, 2);
      const a = new FakeAdapter({ platform: 'zoom', openDoor: true });
      if (variant === 'adapter_throws') a.join = async () => { throw new Error(`could not open ${LINK} for ${NAMES[0]}`); };
      a.arrive('u1', NAMES[0]); a.arrive('u2', NAMES[1]);
      const run = runBot({ runId: 'r', platform: 'zoom', meetingUrl: LINK, notice: 'n', limitMs: FREE_LIMIT_MS, deadlineAt: clock.now()+FREE_LIMIT_MS, budgetDeadlineAt: clock.now()+120_000 },
        { adapter: a, transport: cb, clock, log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
      await clock.advance(100);
      a.speak('u1'); a.say(tone(CHUNK_SAMPLES + 10)); a.depart('u2');
      await clock.advance(10_000);
      a.end();
      const r = await clock.until(run);
      if (variant === 'adapter_throws') assert.equal(r.code, 'platform_blocked');
      else assert.equal(r.reason, 'call_ended');
    }
    // A refusal raised with a message is reported by its code alone.
    assert.equal(new AdapterFailure('obf_unavailable').message, 'obf_unavailable');
  } finally {
    console.log = console0;
  }
  assert.ok(lines.length > 5, 'the run did log');
  const all = lines.join('\n');
  for (const needle of [LINK, 'Zq9SECRETpass', '81234567890', 'zoom.us/j', ...NAMES, 'Zelda', 'u1', 'u2']) {
    assert.ok(!all.includes(needle), `a log line carries ${needle}`);
  }
});
