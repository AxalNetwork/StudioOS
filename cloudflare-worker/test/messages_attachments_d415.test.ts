/**
 * D415 — Messages attachments (migration 323).
 *
 * Built from the migrations that ship (185, 201, 238 and 323, read off disk)
 * with an in-memory R2 bucket and KV namespace, through the routes
 * themselves — including routes/files.ts, so a link minted here is followed
 * to the bytes:
 *
 *   * a file is sent as one message, its bytes under `messages/` in R2;
 *   * its type comes from its bytes, not the header the browser sent;
 *   * size, type and a daily count are refused with the Worker's sentence;
 *   * only a member of the thread gets a link, and a link works once;
 *   * a failed write leaves no orphan object in the bucket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import messages, {
  sniffAttachment, safeAttachmentName, ATTACHMENT_MAX_BYTES, ATTACHMENT_DAILY_MAX,
} from '../src/routes/messages.ts';
import files from '../src/routes/files.ts';
import { makeD1 } from './_perks_harness.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (n: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', n), 'utf8');
const A = 1, B = 2, C = 3;
const ROLE: Record<number, string> = { [A]: 'founder', [B]: 'advisor', [C]: 'partner' };

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

function fakeR2() {
  const store = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    store,
    failPut: false,
    async put(key: string, bytes: Uint8Array, opts: any) {
      if ((this as any).failPut) throw new Error('r2 down');
      store.set(key, { bytes: new Uint8Array(bytes), type: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { body: o.bytes, httpMetadata: { contentType: o.type } };
    },
    async delete(key: string) { store.delete(key); },
  };
}
function fakeKV() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

function harness({ withFiles = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, role TEXT NOT NULL, email TEXT, name TEXT NOT NULL,
    display_name TEXT, headline TEXT, privacy_prefs TEXT, headshot_r2_key TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT
  );
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));`);
  for (const m of ['185_messages.sql', '201_advisors_table_in_ledger.sql', '238_advisor_engagements.sql', '323_message_attachments.sql']) db.exec(MIG(m));
  const u = db.prepare('INSERT INTO users (id, role, name, uid, email) VALUES (?,?,?,?,?)');
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `User ${id}`, `u${id}-handle`, `u${id}@example.test`);
  const r2 = fakeR2();
  const hooks: { beforeBatch: ((d: any) => void) | null } = { beforeBatch: null };
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, hooks), TOKENS: fakeKV() };
  if (withFiles) env.FILES = r2;
  const auth = async (who: number) => `Bearer ${await new SignJWT({ user_id: who, role: ROLE[who] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET))}`;
  const call = async (method: string, path: string, who: number, body?: any) => {
    const headers: Record<string, string> = { Authorization: await auth(who) };
    const init: RequestInit = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
    const res = await messages.request(path, init, env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const upload = async (thread: string, who: number, bytes: Uint8Array, name: string, type = 'application/octet-stream', text?: string) => {
    const fd = new FormData();
    fd.append('file', new File([bytes], name, { type }));
    if (text !== undefined) fd.append('body', text);
    const res = await messages.request(`/${thread}/attachments`, { method: 'POST', headers: { Authorization: await auth(who) }, body: fd }, env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const download = async (url: string) => {
    const res = await files.request(url.replace('/api/files', ''), { method: 'GET' }, env);
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  };
  return { db, env, r2, hooks, call, upload, download };
}

async function thread(h: any, from = A, to = 'u2') {
  const r = await h.call('POST', '/', from, { to_email: `${to}@example.test`, body: 'Hello' });
  assert.equal(r.status, 201);
  return r.body.uid as string;
}

test('a file is sent as one message, stored under messages/, and listed on the thread', async () => {
  const h = harness();
  const t = await thread(h);
  const r = await h.upload(t, A, PDF, 'Term sheet (v2).pdf', 'application/pdf', 'Here it is');
  assert.equal(r.status, 201);
  assert.equal(r.body.attachment.filename, 'Term_sheet_v2_.pdf');
  assert.equal(r.body.attachment.content_type, 'application/pdf');
  assert.equal(r.body.attachment.size_bytes, PDF.length);
  const keys = [...h.r2.store.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], new RegExp(`^messages/${t}/${r.body.attachment.uid}/Term_sheet_v2_\\.pdf$`));
  const d = await h.call('GET', `/${t}`, B);
  const last = d.body.messages.at(-1);
  assert.equal(last.body, 'Here it is');
  assert.deepEqual(last.attachments, [{ uid: r.body.attachment.uid, filename: 'Term_sheet_v2_.pdf', content_type: 'application/pdf', size_bytes: PDF.length }]);
  assert.ok(!JSON.stringify(d.body).includes('messages/'), 'the R2 key reached the thread read');
  assert.ok(!('attachments' in d.body.absent), 'with storage connected there is no absence to state');
  const list = await h.call('GET', '/', B);
  assert.equal(list.body.items[0].unread, 2, 'the file is a message the other side has not read');
});

test('a file with no text previews as the file', async () => {
  const h = harness();
  const t = await thread(h);
  await h.upload(t, A, PNG, 'chart.png', 'image/png');
  const list = await h.call('GET', '/', B);
  assert.equal(list.body.items[0].preview, 'Attachment: chart.png');
});

test('the type comes from the bytes: a renamed executable is refused, a mislabelled PDF is a PDF', async () => {
  const h = harness();
  const t = await thread(h);
  const exe = await h.upload(t, A, EXE, 'invoice.pdf', 'application/pdf');
  assert.equal(exe.status, 415);
  assert.equal(exe.body.error, 'file_type_refused');
  assert.match(exe.body.message, /PDF, PNG, JPEG, WebP, Word, Excel or PowerPoint/);
  const pdf = await h.upload(t, A, PDF, 'scan.png', 'image/png');
  assert.equal(pdf.status, 201);
  assert.equal(pdf.body.attachment.content_type, 'application/pdf');
  assert.equal(pdf.body.attachment.filename, 'scan.png.pdf', 'the name ends in what the bytes are');
  assert.equal(h.r2.store.size, 1, 'nothing was stored for the refused file');
});

test('size, emptiness and a missing file are refused with the Worker’s sentence', async () => {
  const h = harness();
  const t = await thread(h);
  const big = new Uint8Array(ATTACHMENT_MAX_BYTES + 1); big.set(PDF);
  const r1 = await h.upload(t, A, big, 'big.pdf');
  assert.equal(r1.status, 413);
  assert.equal(r1.body.error, 'file_too_large');
  const r2 = await h.upload(t, A, new Uint8Array(0), 'empty.pdf');
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error, 'file_empty');
  const r3 = await h.call('POST', `/${t}/attachments`, A, { body: 'no file' });
  assert.equal(r3.status, 400);
  assert.equal(r3.body.error, 'file_required');
  assert.equal(h.r2.store.size, 0);
});

test('an account sends at most the daily number of files', async () => {
  const h = harness();
  const t = await thread(h);
  const now = new Date().toISOString();
  const ins = h.db.prepare(`INSERT INTO message_attachments (uid, thread_id, message_id, uploader_user_id, r2_key, filename, content_type, size_bytes, sha256, created_at)
                            VALUES (?, 1, 1, ?, ?, 'f.pdf', 'application/pdf', 1, 'x', ?)`);
  for (let i = 0; i < ATTACHMENT_DAILY_MAX; i += 1) ins.run(`seed-${i}`, A, `messages/seed/${i}`, now);
  const r = await h.upload(t, A, PDF, 'one-more.pdf');
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'attachment_limit');
  // The cap is A's alone: B still sends while A is at it.
  assert.equal((await h.upload(t, B, PDF, 'b-first.pdf')).status, 201);
  // Yesterday's files do not count against today.
  h.db.prepare("UPDATE message_attachments SET created_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await h.upload(t, A, PDF, 'ok.pdf')).status, 201);
  // Another account has its own count.
  assert.equal((await h.upload(t, B, PDF, 'b.pdf')).status, 201);
});

test('only a member gets a link; the link reaches the bytes once', async () => {
  const h = harness();
  const t = await thread(h);
  const up = await h.upload(t, A, PDF, 'deck.pdf');
  const att = up.body.attachment.uid;
  const outsider = await h.call('POST', `/${t}/attachments/${att}/link`, C);
  assert.equal(outsider.status, 404, 'a non-member cannot tell the thread exists');
  const link = await h.call('POST', `/${t}/attachments/${att}/link`, B);
  assert.equal(link.status, 200);
  assert.match(link.body.url, /^\/api\/files\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(link.body.filename, 'deck.pdf');
  const first = await h.download(link.body.url);
  assert.equal(first.status, 200);
  assert.deepEqual(first.bytes, PDF);
  assert.match(first.headers.get('content-disposition') || '', /attachment; filename="deck\.pdf"/);
  const again = await h.download(link.body.url);
  assert.equal(again.status, 403, 'a link works once');
  const logged = h.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'signed_download'").get() as any;
  assert.equal(Number(logged.n), 1, 'the download is on the record');
});

test('a file in another thread is not reachable through this one', async () => {
  const h = harness();
  const t1 = await thread(h, A, 'u2');
  const t2 = await thread(h, A, 'u3');
  const up = await h.upload(t2, A, PDF, 'other.pdf');
  const r = await h.call('POST', `/${t1}/attachments/${up.body.attachment.uid}/link`, B);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'attachment_not_found');
  const ghost = await h.call('POST', `/${t1}/attachments/does-not-exist/link`, B);
  assert.deepEqual(ghost.body, r.body, 'a made-up id reads the same');
});

test('an archived thread takes no files, and a non-member cannot send one', async () => {
  const h = harness();
  const t = await thread(h);
  assert.equal((await h.upload(t, C, PDF, 'x.pdf')).status, 404);
  await h.call('POST', `/${t}/archive`, A);
  assert.equal((await h.upload(t, A, PDF, 'x.pdf')).status, 409);
  assert.equal(h.r2.store.size, 0);
});

test('a failed write leaves no orphan in the bucket', async () => {
  const h = harness();
  const t = await thread(h);
  // Make the batch fail AFTER the object is stored: break the table the batch
  // writes to at the moment the batch runs, as a concurrent failure would.
  let storedBeforeBatch = 0;
  h.hooks.beforeBatch = (db: any) => { storedBeforeBatch = h.r2.store.size; db.exec('DROP TABLE message_attachments'); };
  const r = await h.upload(t, A, PDF, 'x.pdf');
  assert.ok(r.status >= 500, `expected a server error, got ${r.status}`);
  assert.equal(storedBeforeBatch, 1, 'the object was not stored before the batch, so this proves nothing');
  assert.equal(h.r2.store.size, 0, 'the object outlived the write that failed');
  const msgs = h.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as any;
  assert.equal(Number(msgs.n), 1, 'the batch left a message behind');
});

test('with no storage connected, the Worker says so rather than pretending', async () => {
  const h = harness({ withFiles: false });
  const t = await thread(h);
  const r = await h.upload(t, A, PDF, 'x.pdf');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'storage_unavailable');
  const d = await h.call('GET', `/${t}`, A);
  assert.match(d.body.absent.attachments, /no file storage connected/);
});

test('sniffAttachment and safeAttachmentName', () => {
  assert.deepEqual(sniffAttachment(ZIP, 'plan.docx'), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' });
  assert.equal(sniffAttachment(ZIP, 'archive.zip'), null, 'a ZIP that is not an Office file is refused');
  assert.equal(sniffAttachment(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'p.jpg')?.type, 'image/jpeg');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffAttachment(webp, 'x')?.type, 'image/webp');
  assert.equal(safeAttachmentName('../../etc/passwd.pdf', 'pdf'), 'passwd.pdf');
  assert.equal(safeAttachmentName('C:\\\\Users\\\\me\\\\Q3 plan.pdf', 'pdf'), 'Q3_plan.pdf');
  assert.equal(safeAttachmentName('photo.JPEG', 'jpg'), 'photo.JPEG');
  assert.equal(safeAttachmentName('', 'png'), 'file.png');
  assert.ok(safeAttachmentName('a'.repeat(300) + '.pdf', 'pdf').length <= 100);
});
