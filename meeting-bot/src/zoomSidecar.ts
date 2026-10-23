/** A private Linux SDK subprocess: credentials use stdin, protocol fd 3, native logs discarded. */
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { AdapterFailure } from './types.ts';
import { ZoomJoinFailure } from './zoomAdapter.ts';
import type { ZoomSdkBridge } from './zoomAdapter.ts';
import type { RosterChange, SpeakerChange, Unsubscribe } from './types.ts';
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; done: () => void };
type Start = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export class ZoomSidecar implements ZoomSdkBridge {
  private readonly child: ChildProcess;
  private readonly input: Writable;
  private readonly pending = new Map<number, Pending>();
  private readonly topics = new Map<string, Set<(v: any) => void>>();
  private readonly people = new Map<string, RosterChange>();
  private serial = 0;
  private closed = false;
  private buffer = '';
  private readonly initialized: Promise<unknown>;
  private readonly timeout: number;
  constructor(jwt: string, options: { python?: string; start?: Start; timeoutMs?: number } = {}) {
    this.timeout = options.timeoutMs ?? 30_000;
    this.child = (options.start ?? spawn)(options.python ?? 'python3', [fileURLToPath(new URL('../zoom/sidecar.py', import.meta.url))], { stdio: ['pipe', 'ignore', 'ignore', 'pipe'], shell: false });
    this.input = this.child.stdin!;
    const output = this.child.stdio[3] as Readable;
    output.setEncoding('utf8');
    output.on('data', (part: string) => this.read(part));
    output.on('error', () => this.fail()); this.input.on('error', () => this.fail());
    this.child.on('error', () => this.fail()); this.child.on('exit', () => this.fail());
    this.initialized = this.rpc('initialize', { jwt }).then(ok => { if (ok !== true) throw new AdapterFailure('platform_blocked'); });
    this.initialized.catch(() => this.fail());
  }
  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { p.done(); p.reject(new AdapterFailure('platform_blocked')); }
    this.pending.clear(); this.people.clear();
    for (const on of this.topics.get('ended') ?? []) on(undefined);
    this.topics.clear(); this.child.kill('SIGKILL');
  }
  private read(part: string): void {
    if (this.closed) return;
    this.buffer += part;
    for (;;) {
      const at = this.buffer.indexOf('\n');
      if (at < 0) { if (this.buffer.length > 128 * 1024) this.fail(); return; }
      if (at > 128 * 1024) { this.fail(); return; }
      const line = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1);
      try {
        const m = JSON.parse(line);
        if (m.event) {
          let value = m.value;
          if (m.event === 'audio') {
            if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw 0;
            const b = Buffer.from(value, 'base64');
            if (b.length % 2 || b.length > 64000) throw 0;
            const pcm = new Int16Array(b.length / 2);
            for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(i * 2);
            value = pcm;
          } else if (m.event === 'roster') {
            if (!value || !['join', 'leave'].includes(value.kind) || typeof value.key !== 'string' || value.key.length > 128 || typeof value.name !== 'string' || value.name.length > 160) throw 0;
            if (value.kind === 'join') this.people.set(value.key, value); else this.people.delete(value.key);
            if (this.people.size > 500) throw 0;
          } else if (m.event === 'speakers') {
            if (!value || !(value.key === null || typeof value.key === 'string' && value.key.length <= 128)) throw 0;
          } else if (m.event !== 'ended') throw 0;
          for (const on of this.topics.get(m.event) ?? []) on(value);
        } else {
          const p = this.pending.get(m.id); if (!p) continue;
          this.pending.delete(m.id); p.done();
          if (m.error) p.reject(['authorized_user_absent', 'ended', 'refused'].includes(m.error) ? new ZoomJoinFailure(m.error) : new AdapterFailure('platform_blocked'));
          else p.resolve(m.value);
        }
      } catch { this.fail(); return; }
    }
  }
  private rpc(method: string, args: unknown = {}, signal?: AbortSignal): Promise<any> {
    if (this.closed || signal?.aborted || this.pending.size >= 32) return Promise.reject(new AdapterFailure('platform_blocked'));
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const abort = () => this.fail();
      const limit = method === 'admitted' ? 600_000 : method === 'requestRecordingPrivilege' ? 120_000 : this.timeout;
      const timer = setTimeout(abort, limit);
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { resolve, reject, done });
      const line = JSON.stringify({ id, method, args }) + '\n';
      if (line.length > 128 * 1024) { this.fail(); return; }
      this.input.write(line);
    });
  }
  private subscribe(topic: string, on: (v: any) => void): Unsubscribe {
    if (this.closed) throw new AdapterFailure('platform_blocked');
    let set = this.topics.get(topic);
    if (!set) { set = new Set(); this.topics.set(topic, set); }
    const first = set.size === 0; set.add(on);
    if (topic === 'roster') for (const p of this.people.values()) on(p);
    if (first) void this.rpc('subscribe', { topic }).catch(() => this.fail());
    return () => { set!.delete(on); if (!set!.size && !this.closed) void this.rpc('unsubscribe', { topic }).catch(() => this.fail()); };
  }
  async join(i: Parameters<ZoomSdkBridge['join']>[0]): Promise<void> {
    const { signal, ...args } = i;
    const abort = () => this.fail();
    if (signal.aborted) abort();
    signal.addEventListener('abort', abort, { once: true });
    try { await this.initialized; await this.rpc('join', args, signal); }
    finally { signal.removeEventListener('abort', abort); }
  }
  async admitted(signal: AbortSignal): Promise<{ selfKey: string }> {
    const v = await this.rpc('admitted', {}, signal);
    if (!v || typeof v.selfKey !== 'string') throw new AdapterFailure('platform_blocked'); return v;
  }
  async sendChat(text: string): Promise<void> { await this.rpc('sendChat', { text }); }
  async joinAudio(signal: AbortSignal): Promise<void> { await this.rpc('joinAudio', {}, signal); }
  async recordingAllowed(signal: AbortSignal): Promise<boolean> { return await this.rpc('recordingAllowed', {}, signal) === true; }
  async requestRecordingPrivilege(signal: AbortSignal): Promise<boolean> { return await this.rpc('requestRecordingPrivilege', {}, signal) === true; }
  async startRawRecording(signal: AbortSignal): Promise<void> { await this.rpc('startRawRecording', {}, signal); }
  mixedAudio(on: (s: Int16Array) => void): Unsubscribe { return this.subscribe('audio', on); }
  roster(on: (c: RosterChange) => void): Unsubscribe { return this.subscribe('roster', on); }
  speakers(on: (c: SpeakerChange) => void): Unsubscribe { return this.subscribe('speakers', on); }
  ended(on: () => void): Unsubscribe { return this.subscribe('ended', on); }
  async leave(): Promise<void> { if (!this.closed) { try { await this.rpc('leave'); } finally { this.fail(); } } }
}
