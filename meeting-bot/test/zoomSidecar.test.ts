import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { ZoomSidecar } from '../src/zoomSidecar.ts';
import { settle } from './_harness.ts';

function fixture(mode = '', Sidecar = ZoomSidecar) {
  const child = new EventEmitter() as ChildProcess;
  const output = new PassThrough();
  const commands: any[] = []; let kills = 0;
  const input = new Writable({ write(chunk, _encoding, done) {
    const m = JSON.parse(chunk.toString()); commands.push(m);
    if (mode !== 'stall') queueMicrotask(() => output.write(JSON.stringify({ id: m.id, value: m.method === 'admitted' ? { selfKey: 'self' } : true }) + '\n'));
    done();
  } });
  Object.assign(child, { stdin: input, stdio: [input, null, null, output], kill() { kills++; return true; } });
  let launch: unknown;
  const sidecar = new Sidecar('synthetic-jwt', { timeoutMs: 30, start: (file, args, options) => { launch = { file, args, options }; return child; } });
  const event = (name: string, value: unknown) => output.write(JSON.stringify({ event: name, value }) + '\n');
  return { sidecar, output, commands, event, kills: () => kills, launch: () => launch, child };
}
const join = (s: ZoomSidecar, signal = new AbortController().signal) => s.join({ meetingId: '12345678901', passcode: 'synthetic', botName: 'Eadwyn AI', obfToken: 'synthetic-obf', signal });

async function protocol(Sidecar = ZoomSidecar) {
  const f = fixture('', Sidecar); await join(f.sidecar);
  assert.equal(JSON.stringify(f.launch()).includes('synthetic'), false);
  assert.deepEqual((f.launch() as any).options.stdio, ['pipe', 'ignore', 'ignore', 'pipe']);
  assert.equal((f.launch() as any).options.shell, false);
  assert.equal(f.commands[0].args.jwt, 'synthetic-jwt'); assert.equal(f.commands[1].args.obfToken, 'synthetic-obf');
  assert.equal('signal' in f.commands[1].args, false);
  const signal = new AbortController().signal;
  assert.deepEqual(await f.sidecar.admitted(signal), { selfKey: 'self' });
  await f.sidecar.sendChat('Synthetic notice'); await f.sidecar.joinAudio(signal);
  assert.equal(await f.sidecar.recordingAllowed(signal), true);
  assert.equal(await f.sidecar.requestRecordingPrivilege(signal), true); await f.sidecar.startRawRecording(signal);
  const frames: Int16Array[] = [], people: unknown[] = [], speakers: unknown[] = [];
  const off = f.sidecar.mixedAudio(s => frames.push(s));
  f.sidecar.roster(c => people.push(c)); f.sidecar.speakers(c => speakers.push(c));
  f.event('audio', Buffer.from([1, 0, 255, 255]).toString('base64'));
  f.event('roster', { kind: 'join', key: 'p', name: 'Synthetic participant' });
  f.event('speakers', { key: null }); await settle();
  assert.deepEqual([...frames[0]], [1, -1]); assert.equal(people.length, 1); assert.deepEqual(speakers, [{ key: null }]);
  const replay: unknown[] = []; f.sidecar.roster(c => replay.push(c)); assert.equal(replay.length, 1);
  off(); f.event('audio', 'AQD//w=='); await settle(); assert.equal(frames.length, 1);
  await f.sidecar.leave(); await f.sidecar.leave(); assert.equal(f.kills(), 1);
}
test('private pipe, method dispatch, PCM, cached roster and cleanup', () => protocol());
test('crash, malformed protocol, too-large line and bad PCM end the run with sanitized failures', async () => {
  for (const failure of ['exit', 'json', 'large', 'pcm']) {
    const f = fixture(); await join(f.sidecar); let ended = 0; f.sidecar.ended(() => ended++);
    if (failure === 'exit') f.child.emit('exit', 1);
    if (failure === 'json') f.output.write('synthetic-secret-is-not-json\n');
    if (failure === 'large') f.output.write('x'.repeat(128 * 1024 + 1));
    if (failure === 'pcm') f.event('audio', 'AQ==');
    await settle(); assert.equal(ended, 1); assert.equal(f.kills(), 1);
    await assert.rejects(join(f.sidecar), { message: 'platform_blocked' });
  }
});
test('stalled child has a deadline and abort kills outstanding work', async () => {
  const f = fixture('stall'); await assert.rejects(join(f.sidecar), { message: 'platform_blocked' }); assert.equal(f.kills(), 1);
  const g = fixture(); await join(g.sidecar);
  const stop = new AbortController(); stop.abort();
  await assert.rejects(join(g.sidecar, stop.signal), { message: 'platform_blocked' });
  await g.sidecar.leave();
});

test('Python native contract and mutations (no SDK import or network)', () => {
  execFileSync('python3', ['-B', '-m', 'unittest', 'test_native'], { cwd: new URL('../zoom/', import.meta.url), stdio: 'pipe' });
  execFileSync('python3', ['-B', 'mutation_native.py'], { cwd: new URL('../zoom/', import.meta.url), stdio: 'pipe' });
});
const mutants = [
  ['shell enabled', 'shell: false', 'shell: true'],
  ['native logs exposed', "['pipe', 'ignore', 'ignore', 'pipe']", "['pipe', 'inherit', 'inherit', 'pipe']"],
  ['PCM endian', 'b.readInt16LE(i * 2)', 'b.readInt16BE(i * 2)'],
  ['roster replay removed', "if (topic === 'roster') for", "if (false) for"],
  ['no process cleanup', "this.child.kill('SIGKILL');", ''],
] as const;
for (const [name, before, after] of mutants) test('pipe mutation: ' + name, async () => {
  await protocol();
  const url = new URL('../src/zoomSidecar.ts', import.meta.url);
  const src = readFileSync(url, 'utf8'); assert.ok(src.includes(before));
  const source = stripTypeScriptTypes(src.replace(before, after), { mode: 'strip' })
    .replaceAll("'./types.ts'", JSON.stringify(new URL('../src/types.ts', import.meta.url).href))
    .replaceAll("'./zoomAdapter.ts'", JSON.stringify(new URL('../src/zoomAdapter.ts', import.meta.url).href))
    .replace("new URL('../zoom/sidecar.py', import.meta.url)", JSON.stringify(new URL('../zoom/sidecar.py', import.meta.url).href));
  const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await assert.rejects(() => protocol(mod.ZoomSidecar), { name: 'AssertionError' });
  await protocol();
});

test('real Python child uses fd 3 and closes on leave (synthetic protocol peer)', async () => {
  const script = `import sys,os,json
p=os.fdopen(3,'w',buffering=1)
for line in sys.stdin:
 m=json.loads(line)
 value={'selfKey':'self'} if m['method']=='admitted' else True
 p.write(json.dumps({'id':m['id'],'value':value})+'\\n')
 if m['method']=='leave': break
`;
  const s = new ZoomSidecar('synthetic-jwt', { start: (_file, _args, options) => spawn('python3', ['-u', '-c', script], options) });
  try { await join(s); assert.deepEqual(await s.admitted(new AbortController().signal), { selfKey: 'self' }); }
  finally { await s.leave(); }
});
