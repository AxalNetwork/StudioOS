/**
 * D754 way B (#1937, #1938) — the world both "Send to Axal" tests share: the
 * channels routes on the SQLite D1 harness, Axal's number set up with fixture
 * ids, and Graph mocked so that only a send from Axal's number answers. Any
 * other URL — a media download included — fails the test.
 */
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import channels from '../src/routes/channels.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
export const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
export const refCode = (code: string) => createHash('sha256').update(code).digest('hex');

export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
export const ME = 2, OTHER = 3, GONE = 4;
/** ME's founder record and venture: where a forwarded recording's draft opens (#1938). */
export const FOUNDER = 70, PROJECT = 500;
export const AXAL_PNID = '3000001';
export const MEMBER_PNID = '1000001';
export const SENDER = '447700900456';
export const SENDER_2 = '447700900789';
export const AXAL_TOKEN = 'EAAG-axal-system-user-SECRET';

export const SECRETS = {
  WHATSAPP_APP_ID: '424242',
  WHATSAPP_APP_SECRET: 'wa-app-SECRET-value',
  WHATSAPP_VERIFY_TOKEN: 'wa-verify-SECRET',
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '777888',
};
export const AXAL = {
  WHATSAPP_AXAL_ACCESS_TOKEN: AXAL_TOKEN,
  WHATSAPP_AXAL_PHONE_NUMBER_ID: AXAL_PNID,
  WHATSAPP_AXAL_WABA_ID: '3000002',
  WHATSAPP_AXAL_DISPLAY_NUMBER: '+1 555 000 9999',
};

const CHANNEL_MIGRATIONS = ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
  '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
  '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
  '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
  '452_record_session_setup.sql', '454_channel_voice_failures.sql', '457_integrations_last_error_at.sql',
  '458_channel_link_consent.sql', '488_channel_consents.sql'];

export function world(opts: { axal?: Partial<typeof AXAL>; upTo492?: boolean } = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET is_active = 0 WHERE id = ${GONE};
    -- D757 §2.11: OTHER is a second member who may hold a channel (an investor may not).
    UPDATE users SET role = 'founder' WHERE id = ${OTHER};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO founders (id, user_id) VALUES (${FOUNDER}, ${ME});
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER});
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL,
      display_name TEXT, status TEXT NOT NULL DEFAULT 'active', auth_type TEXT NOT NULL, credentials_enc TEXT,
      webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, provider_key)
    );
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of CHANNEL_MIGRATIONS) db.exec(mig(m));
  if (opts.upTo492 !== false) {
    db.exec(mig('492_whatsapp_sender_links.sql'));
    db.exec(mig('497_whatsapp_capture_import.sql'));
  }
  // #1938: the import opens a recorder session, which reaches the pipeline and the engine.
  applyEngineSchema(db);
  /** What the routes queued (JOB_QUEUE.send), and the R2 objects stored (FILES). */
  const queued: any[] = [];
  const files = new Map<string, { bytes: Uint8Array; opts: any }>();
  const env: any = {
    DB, WHATSAPP_CHANNEL: 'on', ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48), ...SECRETS, ...AXAL, ...(opts.axal ?? {}),
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    USE_CF_QUEUE: 'true',
    JOB_QUEUE: { async send(body: any, o?: any) { queued.push({ ...body, opts: o ?? null }); } },
    FILES: {
      async put(key: string, value: ArrayBuffer, o: any) { files.set(key, { bytes: new Uint8Array(value), opts: o }); },
      async get(key: string) { const f = files.get(key); return f ? { arrayBuffer: async () => f.bytes.buffer.slice(0), httpMetadata: f.opts?.httpMetadata } : null; },
      async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) files.delete(k); },
    },
  };
  return { env, db, queued, files };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const app = (() => {
  const a = new Hono();
  a.route('/api/channels', channels as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

export const seen: string[] = [];

async function send(env: any, path: string, init: RequestInit) {
  const res = await app.fetch(new Request(`https://axal.vc${path}`, init), env);
  const text = await res.text();
  seen.push(text);
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

export async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return send(env, `/api/channels${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const sign = (raw: string) => `sha256=${createHmac('sha256', SECRETS.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;

export function waHook(env: any, payload: unknown) {
  const raw = JSON.stringify(payload);
  return send(env, '/api/channels/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': sign(raw) }, body: raw,
  });
}

let wamid = 0;
export const now = () => Math.floor(Date.now() / 1000);
/** A text to a number: Axal's by default. Each call is a new message unless `id` repeats one. */
export const waText = (text: string, from = SENDER, o: { id?: string; pnid?: string } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '3000002', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: o.pnid ?? AXAL_PNID },
    contacts: [{ profile: { name: 'Dana Ruiz' }, wa_id: from }],
    messages: [{ from, id: o.id ?? `wamid.IN${++wamid}`, timestamp: String(now()), type: 'text', text: { body: text } }],
  } }] }],
});

export type Sent = { url: string; to: string; text: string; auth: string | null; body: any };

/** A file Graph serves for a media id (#1938): its bytes, and what the lookup declares. */
export type MediaFixture = { bytes: Uint8Array; size?: number; status?: number; lookupStatus?: number };
export type Fetched = { url: string; auth: string | null };

/**
 * Graph, as far as way B uses it: a send from Axal's number, and, for the ids
 * a test hands it in `media`, the media lookup and its download from Meta's
 * host. Anything else — a media id not handed in included — fails the test.
 * `fetched` lists every lookup and download, in order.
 */
export function mockGraph(media: Record<string, MediaFixture> = {}) {
  const sent: Sent[] = [];
  const fetched: Fetched[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const auth = (init.headers as any)?.authorization ?? null;
    const id = url.pathname.split('/').pop() ?? '';
    if (url.hostname === 'graph.facebook.com' && (init.method ?? 'GET') === 'GET' && Object.hasOwn(media, id)) {
      fetched.push({ url: url.toString(), auth });
      const m = media[id];
      if (m.lookupStatus && m.lookupStatus >= 400) return new Response(JSON.stringify({ error: { code: 100 } }), { status: m.lookupStatus });
      return new Response(JSON.stringify({ url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${id}`, file_size: m.size ?? m.bytes.byteLength, mime_type: 'audio/ogg' }), { status: 200 });
    }
    if (url.hostname === 'lookaside.fbsbx.com') {
      fetched.push({ url: url.toString(), auth });
      const m = media[url.searchParams.get('mid') ?? ''];
      if (!m) throw new Error(`unexpected download ${url.toString()}`);
      return new Response(m.bytes, { status: m.status ?? 200 });
    }
    if (url.hostname !== 'graph.facebook.com' || !url.pathname.endsWith(`/${AXAL_PNID}/messages`)) {
      throw new Error(`unexpected fetch ${url.origin}${url.pathname}`);
    }
    const body = JSON.parse(String(init.body));
    sent.push({ url: url.toString(), to: body.to, text: body.text?.body ?? body.interactive?.body?.text, auth: (init.headers as any)?.authorization ?? null, body });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${sent.length}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetched, restore: () => { globalThis.fetch = original; } };
}

export const count = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);
export const lastEvent = (db: any) => db.prepare('SELECT status, error, user_id FROM channel_events ORDER BY id DESC LIMIT 1').get();

/** Every text value in every table, to look for a clear number. */
export function everyValue(db: any): string {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all().map((r: any) => r.name);
  const out: string[] = [];
  for (const t of tables) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) out.push(...Object.values(row).map((v) => String(v)));
  return out.join('\n');
}

/** The member's code, sent from `from`, then confirmed in Axal. */
export async function link(env: any, user = ME, from = SENDER) {
  const { body } = await call(env, user, 'POST', '/whatsapp/link');
  await waHook(env, waText(`LINK ${body.code}`, from));
  const view = (await call(env, user, 'GET', '/whatsapp/link')).body;
  return { code: body.code, confirm: await call(env, user, 'POST', `/whatsapp/link/${view.claim.uid}/confirm`) };
}

