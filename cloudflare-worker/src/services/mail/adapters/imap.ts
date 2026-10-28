/**
 * D1340 (#3548) — a mailbox by IMAP and SMTP with an app password, over
 * `cloudflare:sockets`.
 *
 *   - TLS always: `tls` (implicit, 465 or 993) or `starttls` (587 or 143, then
 *     STARTTLS before anything is said). A server that will not upgrade is refused.
 *   - PORT 25 IS REFUSED: it is server-to-server relay, never a member's submission.
 *   - VERIFY sends nothing: SMTP EHLO and AUTH, then QUIT; an IMAP LOGIN, then LOGOUT.
 *   - SEND is one message: MAIL FROM, RCPT TO, DATA (`mime.ts`, base64 body), QUIT.
 *   - There is no revoke: an app password is revoked in the provider's own settings.
 *
 * `socketDeps.connect` is `cloudflare:sockets`' `connect`, swapped in tests.
 * Nothing a server says is passed on, and no line is logged: a server's text
 * can echo the username.
 */
import type { Env } from '../../../types';
import { buildMime } from './mime';
import { AdapterError, type Creds, type ImapCreds, type MailAdapter, type Tls } from './types';

export type Socket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  startTls(): Socket;
  close(): Promise<void>;
};
export type Connect = (address: { hostname: string; port: number }, options: { secureTransport: 'on' | 'starttls'; allowHalfOpen: boolean }) => Socket;

export const socketDeps: { connect: Connect | null; timeoutMs: number } = { connect: null, timeoutMs: 15000 };

async function connector(): Promise<Connect> {
  if (socketDeps.connect) return socketDeps.connect;
  const mod: any = await import('cloudflare:sockets');
  return mod.connect as Connect;
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const refused = (sentence: string) => new AdapterError('refused', sentence);
const unreachable = () => new AdapterError('unreachable', 'The mail server could not be reached. Check the host and port, then try again.');
const authFailed = () => new AdapterError('auth_failed', 'The mail server refused the username or app password. Check them, then connect again.');

/** The settings, checked before any socket opens. Port 25 is refused in words. */
export function checkSettings(s: Partial<ImapCreds>): ImapCreds {
  const host = (v: unknown, what: string) => {
    const h = String(v ?? '').trim().toLowerCase();
    if (!HOST.test(h) || /^[0-9.]+$/.test(h) || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) throw refused(`Give the ${what} server as a host name, like mail.example.com.`);
    return h;
  };
  const port = (v: unknown, what: string) => {
    const n = Number(v);
    if (n === 25) throw refused('Port 25 is refused: it relays between servers. Use 465 or 587 for sending.');
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw refused(`Give the ${what} port as a number.`);
    return n;
  };
  const tls = (v: unknown, what: string): Tls => {
    if (v === 'tls' || v === 'starttls') return v;
    throw refused(`Choose TLS or STARTTLS for ${what}: a mailbox is never connected without encryption.`);
  };
  const username = String(s.username ?? '').trim();
  const password = String(s.password ?? '');
  if (!username || username.length > 320 || /[\r\n\0]/.test(username)) throw refused('Give the mailbox username.');
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) throw refused('Give the app password.');
  return {
    kind: 'imap', username, password,
    smtp_host: host(s.smtp_host, 'sending'), smtp_port: port(s.smtp_port, 'sending'), smtp_tls: tls(s.smtp_tls, 'sending'),
    imap_host: host(s.imap_host, 'reading'), imap_port: port(s.imap_port, 'reading'), imap_tls: tls(s.imap_tls, 'reading'),
  };
}

/** One line-oriented conversation over a socket, upgraded in place by STARTTLS. */
class Conversation {
  private socket: Socket;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  constructor(socket: Socket) { this.socket = socket; this.attach(); }
  private attach() { this.reader = this.socket.readable.getReader(); this.writer = this.socket.writable.getWriter(); }

  async line(): Promise<string> {
    const deadline = Date.now() + socketDeps.timeoutMs;
    for (;;) {
      const i = this.buffer.indexOf('\n');
      if (i >= 0) { const out = this.buffer.slice(0, i).replace(/\r$/, ''); this.buffer = this.buffer.slice(i + 1); return out; }
      const left = deadline - Date.now();
      if (left <= 0) throw unreachable();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(unreachable()), left); }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) throw unreachable();
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }
  async send(text: string) { await this.writer.write(this.encoder.encode(`${text}\r\n`)); }
  async upgrade() {
    this.reader.releaseLock(); this.writer.releaseLock();
    this.socket = this.socket.startTls();
    this.buffer = '';
    this.attach();
  }
  async close() { try { await this.socket.close(); } catch { /* already closed */ } }
}

/** An SMTP reply: its code and every line, continuation lines (`250-`) included. */
async function reply(c: Conversation): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  for (;;) {
    const l = await c.line();
    lines.push(l);
    if (!/^\d{3}-/.test(l)) return { code: Number(l.slice(0, 3)) || 0, lines };
  }
}
async function expect(c: Conversation, ok: number[]) {
  const r = await reply(c);
  if (!ok.includes(r.code)) throw r.code === 535 || r.code === 534 ? authFailed() : unreachable();
  return r;
}

const b64 = (s: string) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

async function smtp<T>(creds: ImapCreds, act: (c: Conversation) => Promise<T>): Promise<T> {
  const connect = await connector();
  let c: Conversation;
  try { c = new Conversation(connect({ hostname: creds.smtp_host, port: creds.smtp_port }, { secureTransport: creds.smtp_tls === 'tls' ? 'on' : 'starttls', allowHalfOpen: false })); }
  catch { throw unreachable(); }
  try {
    await expect(c, [220]);
    await c.send('EHLO axal.vc');
    await expect(c, [250]);
    if (creds.smtp_tls === 'starttls') {
      await c.send('STARTTLS');
      await expect(c, [220]);
      await c.upgrade();
      await c.send('EHLO axal.vc');
      await expect(c, [250]);
    }
    await c.send(`AUTH PLAIN ${b64(`\0${creds.username}\0${creds.password}`)}`);
    await expect(c, [235]);
    const out = await act(c);
    await c.send('QUIT');
    return out;
  } catch (e) {
    throw e instanceof AdapterError ? e : unreachable();
  } finally { await c.close(); }
}

const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function imapLogin(creds: ImapCreds): Promise<void> {
  const connect = await connector();
  let c: Conversation;
  try { c = new Conversation(connect({ hostname: creds.imap_host, port: creds.imap_port }, { secureTransport: creds.imap_tls === 'tls' ? 'on' : 'starttls', allowHalfOpen: false })); }
  catch { throw unreachable(); }
  const tagged = async (tag: string) => { for (;;) { const l = await c.line(); if (l.startsWith(`${tag} `)) return l.slice(tag.length + 1); } };
  try {
    if (!/^\* (OK|PREAUTH)/i.test(await c.line())) throw unreachable();
    if (creds.imap_tls === 'starttls') {
      await c.send('a0 STARTTLS');
      if (!/^OK/i.test(await tagged('a0'))) throw refused('The reading server would not start TLS, so the mailbox was not connected.');
      await c.upgrade();
    }
    await c.send(`a1 LOGIN ${quote(creds.username)} ${quote(creds.password)}`);
    const login = await tagged('a1');
    if (!/^OK/i.test(login)) throw /^NO/i.test(login) ? authFailed() : unreachable();
    await c.send('a2 LOGOUT');
  } catch (e) {
    throw e instanceof AdapterError ? e : unreachable();
  } finally { await c.close(); }
}

const imapOf = (creds: Creds): ImapCreds => {
  if (creds.kind !== 'imap') throw refused('These are not IMAP credentials.');
  return checkSettings(creds);
};

export const imapAdapter: MailAdapter = {
  async verify(_env: Env, creds: Creds) {
    const c = imapOf(creds);
    await smtp(c, async () => undefined);
    await imapLogin(c);
    return {};
  },
  async send(_env: Env, creds: Creds, msg) {
    const c = imapOf(creds);
    const messageId = `${crypto.randomUUID()}@axal.vc`;
    await smtp(c, async (s) => {
      await s.send(`MAIL FROM:<${msg.from}>`);
      await expect(s, [250]);
      await s.send(`RCPT TO:<${msg.to}>`);
      await expect(s, [250, 251]);
      await s.send('DATA');
      await expect(s, [354]);
      // The body is base64, so no line can be a lone "." and end DATA early.
      await s.send(`${buildMime(msg, messageId)}\r\n.`);
      await expect(s, [250]);
    });
    return { messageId };
  },
  async revoke() { /* An app password is revoked in the provider's own settings. */ },
};
