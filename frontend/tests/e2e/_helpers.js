/**
 * Task #10 (AP) — Shared helpers for the post-AO verification smoke.
 *
 * Every spec calls `requirePreview(test)` at the top of its describe
 * block so the entire suite no-ops cleanly when PLAYWRIGHT_BASE_URL is
 * unset (local dev / first-time CI before the preview env is ready).
 *
 * Auth strategy: a seeded admin + founder live in the preview D1 with
 * fixed credentials provided via PLAYWRIGHT_ADMIN_EMAIL / _PASSWORD and
 * PLAYWRIGHT_FOUNDER_EMAIL / _PASSWORD secrets. Each spec calls
 * `loginAs(page, 'admin'|'founder')` which performs a real /api/auth/login
 * and stores the session via cookie + localStorage so subsequent
 * navigations skip the login page.
 */

export function requirePreview(test) {
  const url = process.env.PLAYWRIGHT_BASE_URL;
  if (!url) {
    test.skip(true, 'PLAYWRIGHT_BASE_URL not set — preview env not provisioned (Task #15 follow-up).');
  }
}

// For preview specs that stub their external services. Page routes can still
// fulfill explicit fixtures (such as the Google script) before this fallback.
export async function isolatePreviewTraffic(context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'));
}

export async function loginAs(page, who = 'founder') {
  const email = who === 'admin'
    ? process.env.PLAYWRIGHT_ADMIN_EMAIL
    : process.env.PLAYWRIGHT_FOUNDER_EMAIL;
  const password = who === 'admin'
    ? process.env.PLAYWRIGHT_ADMIN_PASSWORD
    : process.env.PLAYWRIGHT_FOUNDER_PASSWORD;
  if (!email || !password) {
    throw new Error(`Missing PLAYWRIGHT_${who.toUpperCase()}_EMAIL/_PASSWORD secret`);
  }
  // Use the API directly (bypasses the visual login page so spec failures
  // are isolated to the surface under test, not the login UI). The
  // worker sets the auth cookie and returns a Bearer token; mirror the
  // token into localStorage so the SPA's getAuthHeaders() picks it up.
  const res = await page.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${who}: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  await page.addInitScript((token) => {
    localStorage.setItem('token', token);
  }, body.access_token || body.token || '');
}

// ── #8537 (D8537): the local Worker, its controlled sign-in and its outbox ──────────────────────────────────────────
//
// For specs that run on the BUILT SPA with no preview and no account (like licences_console_5933 and
// expertise_axe_7517, which serve docs/ themselves). `startLocalWorker()` serves `docs/` with the Workers assets
// binding's single-page-application fallback and answers `/api/auth/*` the way `cloudflare-worker/src/routes/auth.ts`
// does for the email link, over synthetic accounts kept in memory:
//
//   · POST /api/auth/register       creates an `exploring` account (its lane kept as `suggested_role`, #8680), or 409;
//   · POST /api/auth/magic/start    writes the link to `outbox` (no email leaves) and answers 202, or 400 on a bad address;
//   · GET  /api/auth/magic/verify   spends the link once, sets the httpOnly `studioos_auth` and readable
//                                   `studioos_csrf` cookies and 302s to MAGIC_LANDING (as auth.ts does), or to
//                                   `/login?magic_error=expired` for a spent or unknown link;
//   · GET  /api/auth/me             the cookie's account, else 401; POST /api/auth/logout ends it;
//   · GET  /api/onboarding/progress finished for a seeded account, the licence step for a new one.
//
// Every other `/api/*` call goes to the spec's `handle(req)` first (return `{ status, json }` or nothing), then gets
// `{}` when signed in or under `/api/public/`, else 401. It proves what the SPA does with these answers, never that the
// Worker gives them: the Worker's own tests do (auth_signup_link_4578, magic_link_enqueue). `requests` records every
// API call; `endSessions(email)` ends that account's sessions server-side, as an expiry or a revocation does.
//
// `controlledBrowser(context)` is the browser half: cookie consent already decided, and a stand-in Turnstile that
// answers a token at once, so the sign-in forms can send. Share both with #8529 and #8527 (two accounts: call
// `addAccount` twice and open two contexts on the same `origin`).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = resolve(fileURLToPath(new URL('../../../docs', import.meta.url)));
const DOC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
/** Where `/api/auth/magic/verify` sends a browser (auth.ts: `newSignup ? '/onboarding/chat' : '/dashboard'`, then `?magic=ok`). */
export const MAGIC_LANDING = Object.freeze({ signup: '/onboarding/chat?magic=ok', signin: '/dashboard?magic=ok' });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function startLocalWorker({ handle = null } = {}) {
  if (!existsSync(join(DOCS, 'index.html'))) throw new Error('docs/index.html is missing: run `npm run build` at the repo root first.');
  const accounts = new Map();
  const sessions = new Map();
  const links = new Map();
  const outbox = [];
  const requests = [];
  let seq = 8537000;
  const harness = {
    origin: '', outbox, requests,
    /** A synthetic account; `onboarded` accounts have finished setup. */
    addAccount({ email, name = 'Synthetic Member', role = 'founder', onboarded = true, suggested_role = null }) {
      // `suggested_role`: the lane an `exploring` account chose at signup, as /me returns it (#8680).
      const user = { id: ++seq, email: email.toLowerCase(), name, role, roles: [role], kyc_status: 'approved', email_verified: true, is_super_admin: 0, suggested_role };
      accounts.set(user.email, { user, onboarded });
      return user;
    },
    account: (email) => accounts.get(String(email).toLowerCase())?.user ?? null,
    /** The newest email-link URL sent to `email`, as the inbox would show it. */
    linkFor(email) {
      const mail = [...outbox].reverse().find((m) => m.to === String(email).toLowerCase());
      if (!mail) throw new Error(`no sign-in link in the outbox for ${email}`);
      return mail.link;
    },
    /** End every session of `email` on the server (an expiry or a revocation); the tab learns it on its next read. */
    endSessions(email) {
      for (const [sid, e] of sessions) if (e === String(email).toLowerCase()) sessions.delete(sid);
    },
    // `server.close` waits for every open connection; a browser keep-alive or a request still in flight when the
    // test ends held it past the 90 s afterEach budget (#9073). Drop them so the hook ends at once.
    close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }),
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
      res.end(json === undefined ? '' : JSON.stringify(json));
    };
    if (!path.startsWith('/api/')) {
      let file = join(DOCS, decodeURIComponent(path));
      if (!(file === DOCS || file.startsWith(DOCS + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(DOCS, 'index.html');
      res.writeHead(200, { 'content-type': DOC_TYPES[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const sid = /(?:^|;\s*)studioos_auth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const email = sid ? sessions.get(sid) : null;
    const me = email ? accounts.get(email) : null;
    requests.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body, signedIn: !!me });

    if (path === '/api/auth/register' && req.method === 'POST') {
      const address = String(body?.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(address)) return send(400, { error: 'Please enter a valid email address' });
      if (accounts.has(address)) return send(409, { code: 'email_already_registered', detail: 'An account already exists for this email.' });
      const lane = ['founder', 'partner', 'investor'].includes(body?.role) ? body.role : null;
      const user = harness.addAccount({ email: address, name: String(body?.name || address.split('@')[0]), role: 'exploring', onboarded: false, suggested_role: lane });
      return send(201, { ok: true, user_id: user.id });
    }
    if (path === '/api/auth/magic/start' && req.method === 'POST') {
      const address = String(body?.email || '').toLowerCase().trim();
      if (!EMAIL_RE.test(address)) return send(400, { error: 'Please enter a valid email address' });
      const token = `synthetic-link-${++seq}`;
      links.set(token, address);
      outbox.push({ to: address, purpose: body?.purpose === 'signup' ? 'signup' : 'signin', link: `${harness.origin}/api/auth/magic/verify?token=${token}` });
      return send(202, { ok: true, message: 'If that email is valid, a sign-in link is on its way. It expires in 15 minutes.' });
    }
    if (path === '/api/auth/magic/verify') {
      const token = url.searchParams.get('token') || '';
      const address = links.get(token);
      links.delete(token);
      if (!address) return send(302, undefined, { location: '/login?magic_error=expired' });
      const newSignup = !accounts.has(address);
      if (newSignup) harness.addAccount({ email: address, name: address.split('@')[0], role: 'exploring', onboarded: false });
      const session = `synthetic-session-${++seq}`;
      sessions.set(session, address);
      // A pre-created (`/register`) account is `exploring` and not onboarded; auth.ts treats it as existing, so /dashboard.
      return send(302, undefined, {
        location: newSignup ? MAGIC_LANDING.signup : MAGIC_LANDING.signin,
        'set-cookie': [`studioos_auth=${session}; Path=/; HttpOnly; SameSite=Lax`, `studioos_csrf=csrf-${seq}; Path=/; SameSite=Lax`],
      });
    }
    if (path === '/api/auth/me' || path === '/api/me') return me ? send(200, me.user) : send(401, { detail: 'Not authenticated' });
    if (path === '/api/auth/logout') {
      if (sid) sessions.delete(sid);
      return send(200, { ok: true }, { 'set-cookie': ['studioos_auth=; Path=/; Max-Age=0', 'studioos_csrf=; Path=/; Max-Age=0'] });
    }
    if (path === '/api/onboarding/progress' && me) {
      return send(200, me.onboarded ? { flow: me.user.role, step: 3, total_steps: 3, completed_at: '2026-11-01 09:00:00' } : { flow: 'licence', step: 0, total_steps: 0, completed_at: null });
    }
    const own = handle ? await handle({ method: req.method, path, query: url.searchParams, body, user: me?.user ?? null }) : null;
    if (own) return send(own.status ?? 200, own.json ?? {});
    if (me || path.startsWith('/api/public/')) return send(200, {});
    return send(401, { detail: 'Not authenticated' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  harness.origin = `http://127.0.0.1:${server.address().port}`;
  return harness;
}

/** Cookie consent decided and a stand-in Turnstile, before any page script runs. Off-origin requests are aborted. */
export async function controlledBrowser(context, origin, consentVersion) {
  await context.addInitScript((version) => {
    try {
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version, decided: true, updatedAt: '2026-11-25T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the first check fails loudly */ }
    window.turnstile = { render(el, cfg) { setTimeout(() => cfg.callback('synthetic-turnstile-token'), 10); return 'synthetic'; }, remove() {}, reset() {} };
  }, consentVersion);
  await context.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'));
}
