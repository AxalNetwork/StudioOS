/**
 * D8524 (#8524) — the local server behind `frontend/tests/e2e/esign_signer_journey.spec.js`.
 *
 * It is the REAL e-sign router (`cloudflare-worker/src/routes/esign.ts`, the
 * signing, completion, document and staged-order code) on real SQLite, behind
 * the built SPA, so a broken completion route or download makes the browser
 * spec fail. Nothing else is real: R2 is a Map, the mailer has no credentials,
 * and `fetch` is a counter that throws, so no email is sent and nothing leaves
 * the machine. All accounts and names are synthetic.
 *
 * Started by the spec as a child process with the Worker tests' TypeScript
 * loader (`cloudflare-worker/test/_ts-loader.mjs`), because the router is
 * `.ts`; it prints one JSON line `{ "port": N }` when it is listening.
 *
 *   /__e2e/single   a one-signer envelope for an external signer (no account)
 *   /__e2e/staged   a staged envelope: the company (an account) signs first,
 *                   the investor (an account) second
 *   /__e2e/token/:position   the signing token of a staged stage, or null
 *   /__e2e/session/:user     a session JWT for a fixture account (cookie)
 *   /__e2e/fetches           how many times anything tried to leave the machine
 *   everything else under /api/legal/esign → the router; /api/auth/me → the
 *   signed-in fixture account; other /api → 404; the rest → docs/ (SPA)
 *
 * Not a test file: the leading underscore keeps it out of the specs.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import esign from '../src/routes/esign.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const WORKER = fileURLToPath(new URL('../', import.meta.url));
const DOCS = resolve(fileURLToPath(new URL('../../docs', import.meta.url)));
const baseline = readFileSync(join(WORKER, 'sql/schema_baseline.sql'), 'utf8');
const migration = (f) => readFileSync(join(WORKER, 'sql/migrations', f), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'legal_templates', 'legal_template_versions',
  'esign_envelopes', 'esign_recipients', 'notifications_inbox', 'projects', 'deals', 'commitments'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + migration('434_contract_template_publications.sql')
  + '\n' + migration('475_legal_document_files.sql')
  + '\n' + migration('479_template_kind_party.sql')
  + '\n' + migration('633_staged_signing.sql')
  // #8516 (#8572): the staged next stage is an owed effect, recorded in esign_effects in the completion batch.
  + '\n' + migration('202611250101_8516_esign_effects.sql');

const SECRET = ['d8524', 'esign', 'journey', 'fixture', 'secret'].join('-');
export const FOUNDER = 2, INVESTOR = 3;
const DEAL = 30, LINE = 40;
const JOINDER = '## SPV Joinder\nThe investor joins the SPV for the closing dated {{closing_date}}.';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

// Nothing leaves the machine: a call is counted, then refused.
let fetches = 0;
globalThis.fetch = async () => { fetches += 1; throw new Error('fetch must not be called'); };
for (const k of ['log', 'warn', 'error', 'info']) console[k] = () => {};

const { DB, db } = makeD1(SCHEMA);
const users = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
users.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 77);
users.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (50, 'Lumen Labs', 77)`);
db.exec(`INSERT INTO deals (id, project_id, status) VALUES (${DEAL}, 50, 'active')`);
db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (${LINE}, ${DEAL}, ${INVESTOR}, 25000, 'confirmed')`);
db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
  VALUES ('spv_joinder', 'SPV Joinder', 'deal', ?, '["closing_date"]', 1, 1, 0)`).run(JOINDER);

const objects = new Map();
const FILES = {
  async put(key, bytes) { objects.set(key, bytes); },
  async get(key) { const b = objects.get(key); return b ? { arrayBuffer: async () => b.slice().buffer } : null; },
};
const env = { DB, FILES, JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'http://127.0.0.1' };
const key = new TextEncoder().encode(SECRET);
const jwt = (id) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(key);

const app = new Hono();
app.route('/api/legal/esign', esign);
app.onError((e, c) => {
  if (String(e?.message ?? '') === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
  throw e;
});

const one = (sql, ...a) => { const r = db.prepare(sql).get(...a); return r ? { ...r } : null; };
const tokenAt = (position) => one(`SELECT r.signing_token FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
  JOIN esign_staged_signers s ON s.envelope_uuid = e.envelope_uuid WHERE s.position = ?`, position)?.signing_token ?? null;
const authed = async (headers) => {
  const m = /(?:^|;\s*)studioos_auth=([^;]+)/.exec(headers.cookie || '');
  if (!m) return null;
  try { return (await jwtVerify(m[1], key)).payload.user_id; } catch { return null; }
};

async function viaRouter(req, body) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host') headers.set(k, v);
  const res = await withThrownResponses(() => app.request(req.url, { method: req.method, headers, ...(body.length ? { body } : {}) }, env));
  return res;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    if (url.pathname === '/__e2e/fetches') return json(200, { fetches });
    if (url.pathname.startsWith('/__e2e/session/')) return json(200, { token: await jwt(Number(url.pathname.split('/').pop())) });
    if (url.pathname.startsWith('/__e2e/token/')) return json(200, { token: tokenAt(Number(url.pathname.split('/').pop())) });
    if (url.pathname === '/__e2e/single') {
      // An external signer: no account, so the link alone is the credential.
      const sent = await viaRouter({ url: '/api/legal/esign/send', method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await jwt(FOUNDER)}` } },
        Buffer.from(JSON.stringify({ document_type: 'founder_nda_v1', recipient_email: 'counsel@example.test', recipient_name: 'Cass Counsel', provider: 'native' })));
      const out = await sent.json();
      if (sent.status >= 300) return json(500, { sent: sent.status, out });
      const r = one('SELECT r.signing_token, e.envelope_uuid FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id ORDER BY r.id DESC LIMIT 1');
      return json(200, { token: r.signing_token, envelope_uuid: r.envelope_uuid });
    }
    if (url.pathname === '/__e2e/staged') {
      const made = await viaRouter({ url: '/api/legal/esign/staged', method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await jwt(FOUNDER)}` } },
        Buffer.from(JSON.stringify({ deal_id: DEAL, commitment_id: LINE, document_type: 'spv_joinder', fields: { closing_date: '2026-11-30' },
          signers: [{ role: 'company', user_id: FOUNDER }, { role: 'investor', user_id: INVESTOR }] })));
      const out = await made.json();
      if (made.status >= 300) return json(500, { made: made.status, out });
      return json(200, { uid: out.uid, first: tokenAt(1) });
    }
    if (url.pathname === '/api/auth/me') {
      const id = await authed(req.headers);
      const u = id ? one('SELECT id, name, email, role FROM users WHERE id = ?', id) : null;
      return u ? json(200, { ...u, roles: [u.role], licences: [], is_super_admin: 0, kyc_status: 'approved' }) : json(401, { detail: 'Unauthorized' });
    }
    if (url.pathname.startsWith('/api/legal/esign/')) {
      const r = await viaRouter({ url: url.pathname + url.search, method: req.method, headers: req.headers }, body);
      const out = Buffer.from(await r.arrayBuffer());
      const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(r.status, headers); return res.end(out);
    }
    if (url.pathname.startsWith('/api/')) return json(404, { detail: 'Not found' });
    let file = join(DOCS, decodeURIComponent(url.pathname));
    if (!(file === DOCS || file.startsWith(DOCS + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(DOCS, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (e) {
    json(500, { error: String(e?.stack || e) });
  }
});
server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port }) + '\n'));
