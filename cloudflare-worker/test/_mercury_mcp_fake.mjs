/**
 * D840 (#2346) — a fake of Mercury's MCP server and its OAuth server, for
 * every D840 test. Nothing here reaches the network.
 *
 * It is a `fetch` that answers the host `mcp.mercury.com` only:
 *
 *   GET  /.well-known/oauth-protected-resource/mcp   RFC 9728 metadata
 *   GET  /.well-known/oauth-authorization-server     RFC 8414 metadata
 *   POST /register                                   RFC 7591 dynamic registration
 *   POST /token                                      authorization_code (PKCE S256) and refresh_token
 *   POST /revoke                                     RFC 7009
 *   POST /mcp                                        JSON-RPC: initialize, notifications/initialized,
 *                                                    tools/list, tools/call
 *   DELETE /mcp                                      ends the session
 *
 * `tools/list` offers the read tools AND Mercury's write tools (by name only:
 * a request for one is recorded and answered with an error), so a test can
 * prove the Worker refuses them before any request. Every request is recorded
 * in `calls`, with the tool name for a `tools/call`; no token is recorded.
 *
 * Ids, names and amounts are invented. An account number is a masked `****`
 * plus a last four.
 *
 *   const fake = mercuryMcpFake();         // state you can change
 *   const off = fake.install();            // globalThis.fetch answers mcp.mercury.com; others pass through
 *   const { code } = fake.authorize({ client_id, redirect_uri, code_challenge, scope });
 *   ...
 *   off();
 */
import { createHash, randomBytes } from 'node:crypto';

export const MCP_HOST = 'mcp.mercury.com';
export const ISSUER = `https://${MCP_HOST}`;

/** The read tools the real server listed on 2026-10-21, and its write tools. */
export const FAKE_READ_TOOLS = ['getOrganization', 'getAccounts', 'getAccount', 'listTransactions', 'getTransactionById',
  'getCashflowSummary', 'getTreasury', 'getAccountStatements', 'listInvoices', 'listCustomers', 'getRecipients',
  'getSafeRequests', 'listCategories', 'getCurrentDate', 'getUsers', 'getAttachment', 'listCards'];
export const FAKE_WRITE_TOOLS = ['requestSendMoney', 'requestTransferMoney', 'createCategory', 'editCategory', 'updateTransaction'];

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const s256 = (v) => b64url(createHash('sha256').update(v).digest());
const token = (p) => `${p}-${b64url(randomBytes(12))}`;

export const FAKE_ACC_A = '11111111-1111-4111-8111-111111111111';
export const FAKE_ACC_B = '22222222-2222-4222-8222-222222222222';
export const fakeTx = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function defaultMcpData() {
  return {
    organization: { id: 'org-mcp-own', legalBusinessName: 'Own Venture Inc', ein: 'ein-fixture-only' },
    accounts: [
      { id: FAKE_ACC_A, kind: 'checking', accountNumber: '****4242', routingNumber: 'routing-fixture-only', nickname: 'Ops', status: 'active', currentBalance: 1200.5, availableBalance: 1100 },
      { id: FAKE_ACC_B, kind: 'savings', accountNumber: '****1357', routingNumber: 'routing-fixture-only', nickname: 'Reserve', status: 'active', currentBalance: 5000, availableBalance: 5000 },
    ],
    transactions: [],
    cashflow: { months: [{ month: '2026-09', incomingCents: 500000, outgoingCents: -200000, cashflowCents: 300000 }], truncated: false },
    treasury: { accounts: [{ id: '33333333-3333-4333-8333-333333333333', status: 'active', currentBalance: 10000, availableBalance: 10000 }] },
    statements: { statements: [{ id: '44444444-4444-4444-8444-444444444444', startDate: '2026-09-01', endDate: '2026-09-30', endingBalance: 1200.5, transactionCount: 3, downloadUrl: 'https://example.invalid/statement.pdf' }] },
    invoices: { invoices: [{ id: '55555555-5555-4555-8555-555555555555', invoiceNumber: 'INV-1', customerId: '66666666-6666-4666-8666-666666666666', amount: 2500, status: 'paid', invoiceDate: '2026-09-02', dueDate: '2026-10-02' }] },
    customers: { customers: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Customer Co', email: 'billing@example.invalid', address: { line1: 'Fixture' } }] },
    recipients: { recipients: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Vendor Co', status: 'active', lastPaidDate: '2026-09-15', electronicRoutingInfo: { accountNumber: 'recipient-account-fixture', routingNumber: 'routing-fixture-only' } }] },
    safeRequests: [{ id: '88888888-8888-4888-8888-888888888888', investorName: 'Angel Fixture', purchaseAmount: 25000, postMoneyValuationCap: 5000000, status: 'signed', createdAt: '2026-08-01T00:00:00Z' }],
    categories: { categories: [{ id: '99999999-9999-4999-8999-999999999999', name: 'Software' }] },
  };
}

/**
 * The fake. `opts.stream` answers JSON-RPC as an event stream; `opts.status`
 * answers every /mcp POST with that HTTP status; `opts.scope` is the scope the
 * token endpoint reports (default `read offline_access`).
 */
export function mercuryMcpFake(opts = {}) {
  const state = {
    data: defaultMcpData(),
    stream: !!opts.stream,
    status: opts.status ?? null,
    scope: opts.scope ?? 'read offline_access',
    clients: new Map(),
    codes: new Map(),
    access: new Set(),
    refresh: new Set(),
    revoked: [],
    sessions: new Set(),
    /** Fail the next N token refreshes with 400 invalid_grant. */
    failRefresh: 0,
    /** Answer `tools/list` with only these names, when set. */
    tools: null,
  };
  const calls = [];

  function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }
  function rpc(id, result, headers = {}) {
    const msg = { jsonrpc: '2.0', id, result };
    if (state.stream) {
      return new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...headers } });
    }
    return json(msg, 200, headers);
  }
  const textResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

  function issueTokens(clientId) {
    const access = token('fake-access');
    const refresh = token('fake-refresh');
    state.access.add(access);
    state.refresh.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: state.scope, _client: clientId };
  }

  function toolCall(name, args) {
    const d = state.data;
    switch (name) {
      case 'getOrganization': return textResult({ organization: d.organization });
      case 'getAccounts': return textResult({ accounts: d.accounts, page: {} });
      case 'getAccount': {
        const a = d.accounts.find((x) => x.id === args.accountId);
        return a ? textResult(a) : { isError: true, content: [{ type: 'text', text: 'Not found' }] };
      }
      case 'listTransactions': {
        let list = d.transactions.slice();
        if (Array.isArray(args.accountId)) list = list.filter((t) => args.accountId.includes(t.accountId));
        if (args.start) list = list.filter((t) => String(t.createdAt ?? t.postedAt).slice(0, 10) >= args.start);
        if (args.postedStart) list = list.filter((t) => t.postedAt && t.postedAt.slice(0, 10) >= args.postedStart);
        if (args.postedEnd) list = list.filter((t) => t.postedAt && t.postedAt.slice(0, 10) <= args.postedEnd);
        let from = 0;
        if (args.start_after) from = list.findIndex((t) => t.id === args.start_after) + 1;
        const limit = Number(args.limit ?? 1000);
        const page = list.slice(from, from + limit);
        const more = from + limit < list.length;
        return { structuredContent: { transactions: page, page: more ? { nextPage: page[page.length - 1].id } : {} }, content: [] };
      }
      case 'getTransactionById': {
        const t = d.transactions.find((x) => x.id === args.transactionId);
        return t ? textResult(t) : { isError: true, content: [{ type: 'text', text: 'Not found' }] };
      }
      case 'getCashflowSummary': return textResult(d.cashflow);
      case 'getTreasury': return textResult(d.treasury);
      case 'getAccountStatements': return textResult(d.statements);
      case 'listInvoices': return textResult(d.invoices);
      case 'listCustomers': return textResult(d.customers);
      case 'getRecipients': return textResult(d.recipients);
      case 'getSafeRequests': return textResult(d.safeRequests);
      case 'listCategories': return textResult(d.categories);
      default: return { isError: true, content: [{ type: 'text', text: 'This fake answers no write.' }] };
    }
  }

  async function handle(url, init) {
    const u = new URL(url);
    const method = String(init.method || 'GET').toUpperCase();
    const auth = new Headers(init.headers || {}).get('Authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const call = { method, path: u.pathname, redirect: init.redirect, authorized: !!bearer };
    calls.push(call);

    if (method === 'GET' && u.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: `${ISSUER}/mcp`, authorization_servers: [ISSUER], scopes_supported: ['read', 'offline_access'], bearer_methods_supported: ['header'] });
    }
    if (method === 'GET' && u.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`,
        registration_endpoint: `${ISSUER}/register`, revocation_endpoint: `${ISSUER}/revoke`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
        scopes_supported: ['read', 'offline_access'],
      });
    }
    const form = () => new URLSearchParams(typeof init.body === 'string' ? init.body : String(init.body ?? ''));
    if (method === 'POST' && u.pathname === '/register') {
      const body = JSON.parse(String(init.body || '{}'));
      call.registration = { client_name: body.client_name, redirect_uris: body.redirect_uris, token_endpoint_auth_method: body.token_endpoint_auth_method, scope: body.scope };
      if (/mercury/i.test(String(body.client_name || ''))) return json({ error: 'invalid_client_metadata' }, 400);
      const client_id = `fake-client-${state.clients.size + 1}`;
      state.clients.set(client_id, { redirect_uris: body.redirect_uris || [] });
      return json({ client_id, client_id_issued_at: 1, redirect_uris: body.redirect_uris, token_endpoint_auth_method: 'none' }, 201);
    }
    if (method === 'POST' && u.pathname === '/token') {
      const f = form();
      call.grant_type = f.get('grant_type');
      const client = state.clients.get(f.get('client_id') || '');
      if (!client) return json({ error: 'invalid_client' }, 401);
      if (f.get('grant_type') === 'authorization_code') {
        const c = state.codes.get(f.get('code') || '');
        state.codes.delete(f.get('code') || '');
        if (!c || c.client_id !== f.get('client_id') || c.redirect_uri !== f.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400);
        if (s256(f.get('code_verifier') || '') !== c.code_challenge) return json({ error: 'invalid_grant', error_description: 'pkce' }, 400);
        const { _client, ...t } = issueTokens(c.client_id);
        return json(t);
      }
      if (f.get('grant_type') === 'refresh_token') {
        if (state.failRefresh > 0) { state.failRefresh -= 1; return json({ error: 'invalid_grant' }, 400); }
        const r = f.get('refresh_token') || '';
        if (!state.refresh.has(r)) return json({ error: 'invalid_grant' }, 400);
        state.refresh.delete(r);
        const { _client, ...t } = issueTokens(f.get('client_id'));
        return json(t);
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (method === 'POST' && u.pathname === '/revoke') {
      const f = form();
      const t = f.get('token') || '';
      state.revoked.push(f.get('token_type_hint') || 'unknown');
      state.access.delete(t); state.refresh.delete(t);
      return new Response(null, { status: 200 });
    }
    if (u.pathname === '/mcp') {
      if (!state.access.has(bearer)) return json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"` });
      if (state.status) return json({ error: 'stub' }, state.status);
      if (method === 'DELETE') { state.sessions.delete(new Headers(init.headers).get('Mcp-Session-Id')); return new Response(null, { status: 200 }); }
      const msg = JSON.parse(String(init.body || '{}'));
      call.rpc = msg.method;
      if (msg.method === 'initialize') {
        const sid = `fake-session-${state.sessions.size + 1}`;
        state.sessions.add(sid);
        return rpc(msg.id, { protocolVersion: msg.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-mercury', version: '0' } }, { 'Mcp-Session-Id': sid });
      }
      const sid = new Headers(init.headers).get('Mcp-Session-Id');
      call.session = sid;
      if (!state.sessions.has(sid)) return json({ error: 'no session' }, 404);
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (msg.method === 'tools/list') {
        const names = state.tools ?? [...FAKE_READ_TOOLS, ...FAKE_WRITE_TOOLS];
        return rpc(msg.id, { tools: names.map((name) => ({ name, inputSchema: { type: 'object' } })) });
      }
      if (msg.method === 'tools/call') {
        call.tool = msg.params?.name;
        call.args = msg.params?.arguments;
        return rpc(msg.id, toolCall(msg.params?.name, msg.params?.arguments || {}));
      }
      return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
    return new Response('not found', { status: 404 });
  }

  const fakeFetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    if (new URL(url).host !== MCP_HOST) return new Response('unexpected host', { status: 599 });
    return handle(url, init);
  };

  return {
    state,
    calls,
    fetch: fakeFetch,
    /** The browser's leg: Mercury's consent screen approves and returns a code for the redirect. */
    authorize({ client_id, redirect_uri, code_challenge, code_challenge_method = 'S256', scope }) {
      const client = state.clients.get(client_id);
      if (!client || !client.redirect_uris.includes(redirect_uri) || code_challenge_method !== 'S256') throw new Error('fake authorize refused');
      const code = token('fake-code');
      state.codes.set(code, { client_id, redirect_uri, code_challenge, scope });
      return { code };
    },
    /** Tokens the fake has issued that are still live, for a test that must make the Worker's token expire. */
    expireAccess() { state.access.clear(); },
    toolCalls: () => calls.filter((c) => c.tool).map((c) => c.tool),
    /** Answer mcp.mercury.com from this fake; every other host goes to the fetch that was there. */
    install() {
      const prev = globalThis.fetch;
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input?.url ?? input);
        return new URL(url).host === MCP_HOST ? handle(url, init) : prev(input, init);
      };
      return () => { globalThis.fetch = prev; };
    },
  };
}

/** A fresh access token the fake accepts, with a registered client, for tests of reads alone. */
export function signedInFake(opts = {}) {
  const fake = mercuryMcpFake(opts);
  const access = token('fake-access');
  fake.state.access.add(access);
  return { fake, accessToken: access };
}
