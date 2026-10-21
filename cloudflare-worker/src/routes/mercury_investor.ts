/**
 * /api/mercury/investor — an investor's own Mercury feeds their sections
 * (D840 part 4, #2349). READ-ONLY: nothing here asks Mercury to move money.
 *
 *   GET    /                         what Mercury feeds in each investor section (`mercuryFeeds.ts`)
 *   GET    /accounts                 their checking and savings accounts: id, name, kind, last four; no balance
 *   GET    /commit                   their capacity fact (Deals · Commit), for their own page
 *   POST   /commit                   { account_ids } reads the picked accounts and writes the fact
 *   DELETE /commit                   deletes it; a sync does not bring it back
 *   POST   /sync                     { section, fund_id?, account_ids?, from?, to? } reads Mercury, refreshes facts, adds proposals
 *   GET    /proposals                ?kind=closing|call|ledger|statement&fund_id= their own proposals
 *   POST   /proposals/:uid/accept    the only write a proposal makes
 *   POST   /proposals/:uid/dismiss   dismissed stays dismissed
 *   GET    /reporting                ?fund_id= month-end cash and attached statements of a fund they are GP of
 *   DELETE /reporting/cash/:id       deletes one month's cash; a sync does not bring it back
 *   GET    /ledger/map               ?fund_id= their confirmed category map
 *
 * WHO. An investor, on HQ only (D752's `personal_hq_only_roles`), never in a
 * support session. Every read and write is the caller's own: no admin
 * bypass, because these are the investor's balances. The Fund sections also
 * need the institutional tier, as the Fund bucket does.
 *
 * Every Mercury read writes one `integration_logs` row with the section and
 * counts, never a figure. A failed read is 502 `mercury_unreadable` with our
 * sentence; Mercury's text never reaches a body or a log line here.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { branchOf, HQ_ONLY } from '../util/branch';
import { refuse } from '../util/refusal';
import { ensureInvestorTier } from '../middleware/requireInvestorTier';
import type { IntegrationRow } from '../integrations/registry';
import { entityAccountRefusal, isSupportSession, readOnlyRefusal } from '../integrations/providers/mercury';
import { INVESTOR_LANDS, MERCURY_FEEDS, PORTFOLIO_NOTE } from '../integrations/mercuryFeeds';
import { MODULE_HREFS, MODULE_LABELS } from '../integrations/moduleLabels';
import { MercuryClientError, type MercuryFetch } from '../services/mercury/client';
import { MERCURY_AUTH_TYPE, mercuryAccessFor } from '../services/mercury/oauth';
import { openMercuryReads, scopePermission, type MercuryReads } from '../services/mercury/reads';
import {
  acceptProposal, adminFunds, callProposalsFor, capacityOf, categoryMap, closingDrafts, deleteCapacity, deleteMonthEndCash,
  dismissProposal, gpFunds, ledgerDrafts, listProposals, monthEndCash, ownCommitments, ownProposal, readCapacity, readLines,
  readMonthEndCash, readStatements, statementDrafts, statementKeyOf, writeCapacity, writeMonthEndCash, writeProposals,
  type InvestorReader, type ProposalKind,
} from '../services/mercury/investorFeeds';

type C = Context<{ Bindings: Env }>;

/** The caller's own Mercury, opened for one request. A Response when it cannot be. */
/** A session lives for one request; the server expires it (part 1's `mcp.ts` sends POST only). */
export interface InvestorConnection { integrationId: number; reader: InvestorReader }
export type OpenInvestorMercury = (c: C, user: User) => Promise<InvestorConnection | Response>;

export interface MercuryInvestorOptions { open?: OpenInvestorMercury; today?: () => string }

const ACCOUNT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: readonly ProposalKind[] = ['closing', 'call', 'ledger', 'statement'];
const SECTIONS = ['commit', 'closing', 'calls', 'ledger', 'reporting'] as const;
type Section = typeof SECTIONS[number];
const DEFAULT_DAYS = 90;
const MAX_DAYS = 366;

const plusDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function refused(c: C, status: number, code: string, message: string): Response {
  return refuse(c, status, { code, message });
}

/** Investor, HQ, no support session. Null when allowed. */
async function policy(c: C, user: User): Promise<Response | null> {
  if (await isSupportSession(c)) return refused(c, 403, 'support_session_refused', 'A support session cannot read or change a member\'s bank account.');
  if (String(user.role || '').toLowerCase() !== 'investor') return refused(c, 403, 'purpose_not_allowed', 'Your Mercury connection cannot be used for this.');
  if (branchOf(c.env)) return refused(c, 403, 'hq_only', HQ_ONLY);
  return null;
}

/** The Fund sections' tier, as the Fund bucket requires it. */
function fundTier(user: User): Response | null {
  try { ensureInvestorTier(user, 'institutional'); return null; } catch (e) { if (e instanceof Response) return e; throw e; }
}

function windowOf(body: Record<string, unknown>, today: string): { from: string; to: string } | null {
  const to = body.to === undefined ? today : body.to;
  const from = body.from === undefined ? (isDay(to) ? plusDays(to, -DEFAULT_DAYS) : null) : body.from;
  if (!isDay(from) || !isDay(to) || from > to) return null;
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_DAYS) return null;
  return { from, to };
}

function accountIdsOf(v: unknown): string[] | null | false {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 20 || !v.every((x) => typeof x === 'string' && ACCOUNT_ID_RE.test(x))) return false;
  return v as string[];
}

const fundIdOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** One log row per read: the section and counts only. */
async function logRead(env: Env, integrationId: number, user: User, section: string, counts: Record<string, number>): Promise<void> {
  const summary = [`use=investor_${section}`, ...Object.entries(counts).map(([k, v]) => `${k}=${v}`)].join(' ');
  await env.DB.prepare(
    'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary) ' +
    "VALUES (?, ?, 'mercury', 'outbound', ?, 'ok', ?)",
  ).bind(integrationId, user.id, `investor_${section}`, summary).run();
}

function unreadable(c: C, e: unknown): Response {
  return refuse(c, 502, { code: 'mercury_unreadable', message: 'Your Mercury account could not be read. Nothing changed; try again.', raw: e, audience: 'owner' });
}

/**
 * The caller's own signed-in Mercury (part 1, #2346), checked as D713's
 * `personalConnection` checks a connection: active, readable, read-only, and
 * not an Axal entity's organization. The sections read through Mercury's MCP
 * server only: a pasted token serves proof of funds, not these.
 */
export function openOwnInvestorMercuryWith(fetcher?: MercuryFetch): OpenInvestorMercury {
  return async (c, user) => {
    const row = await c.env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury' LIMIT 1")
      .bind(user.id).first<IntegrationRow>();
    if (!row) return refused(c, 409, 'mercury_not_connected', 'Sign in with Mercury on your Connectors page first.');
    if (row.auth_type !== MERCURY_AUTH_TYPE) return refused(c, 409, 'mercury_signin_required', 'These sections read through Sign in with Mercury. A Read Only API token serves proof of funds only.');
    if (row.status !== 'active') return refused(c, 409, 'mercury_reconnect_required', 'Your Mercury connection needs attention. Sign in with Mercury again.');
    let reads: MercuryReads;
    try {
      const access = await mercuryAccessFor(c.env, Number(user.id), fetcher);
      if (!access) return refused(c, 503, 'credentials_unreadable', 'Your Mercury connection could not be read. Sign in with Mercury again.');
      const scope = readOnlyRefusal(scopePermission(access.scopes), true);
      if (scope) return refused(c, scope.status, scope.code, scope.sentence);
      reads = await openMercuryReads(access);
      const entity = await entityAccountRefusal(c.env, await reads.organization(), await reads.accounts());
      if (entity) return refused(c, entity.status, entity.code, entity.sentence);
    } catch (e) {
      if (e instanceof MercuryClientError && e.code === 'unauthorized') return refused(c, 409, 'mercury_reconnect_required', 'Mercury no longer accepts your connection. Sign in with Mercury again.');
      return unreadable(c, e);
    }
    return { integrationId: Number(row.id), reader: reads };
  };
}

export const openOwnInvestorMercury: OpenInvestorMercury = openOwnInvestorMercuryWith();

export function createMercuryInvestor(opts: MercuryInvestorOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const open = opts.open ?? openOwnInvestorMercury;
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10));

  /** Run `fn` on the caller's own open connection. */
  async function withMercury(c: C, user: User, fn: (conn: InvestorConnection) => Promise<Response>): Promise<Response> {
    const conn = await open(c, user);
    if (conn instanceof Response) return conn;
    try {
      return await fn(conn);
    } catch (e) {
      if (e instanceof Response) throw e;
      return unreadable(c, e);
    }
  }

  app.get('/', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const sections = MERCURY_FEEDS.filter((f) => f.role === 'investor').map((f) => ({
      key: f.key,
      section: f.module ? MODULE_LABELS[f.module] : 'Trust',
      module: f.module,
      href: f.module ? MODULE_HREFS[f.module] : '/trust',
      what: f.what,
      lands: INVESTOR_LANDS[f.key],
    }));
    return c.json({ sections, portfolio: PORTFOLIO_NOTE });
  });

  app.get('/accounts', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    return withMercury(c, user, async (conn) => {
      const accounts = await conn.reader.accounts();
      await logRead(c.env, conn.integrationId, user, 'accounts', { accounts: accounts.length });
      return c.json({ accounts: accounts.map((a) => ({ id: a.mercury_account_id, name: a.nickname, kind: a.kind, last_four: a.last_four })) });
    });
  });

  app.get('/commit', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    return c.json({ capacity: await readCapacity(c.env, user) });
  });

  app.post('/commit', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = accountIdsOf(body?.account_ids);
    if (!ids || !ids.length) return refused(c, 400, 'invalid_accounts', 'Pick at least one of your accounts, at most twenty.');
    return withMercury(c, user, async (conn) => {
      const accounts = await conn.reader.accounts();
      const cap = capacityOf(accounts, ids);
      await logRead(c.env, conn.integrationId, user, 'commit', { accounts: ids.length });
      if (!cap.ok) {
        return cap.code === 'balance_unreadable'
          ? refused(c, 502, 'balance_unreadable', 'Mercury did not give an available balance for every account you picked, so nothing was written.')
          : refused(c, cap.code === 'account_not_found' ? 404 : 400, cap.code, 'Pick accounts from your own Mercury.');
      }
      await writeCapacity(c.env, user, conn.integrationId, cap, today());
      return c.json({ capacity: await readCapacity(c.env, user) });
    });
  });

  app.delete('/commit', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    return c.json({ deleted: await deleteCapacity(c.env, user) });
  });

  app.post('/sync', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const section = body?.section as Section;
    if (!SECTIONS.includes(section)) return refused(c, 400, 'invalid_section', 'Name a section: commit, closing, calls, ledger or reporting.');
    const window = windowOf(body, today());
    if (!window) return refused(c, 400, 'invalid_window', 'Give from and to as calendar dates, in order, at most 366 days apart.');
    const accountIds = accountIdsOf(body.account_ids);
    if (accountIds === false) return refused(c, 400, 'invalid_accounts', 'Pick at most twenty of your accounts.');
    let fundId: number | null = null;
    if (section === 'calls' || section === 'ledger' || section === 'reporting') {
      const tier = fundTier(user);
      if (tier) return tier;
      fundId = fundIdOf(body.fund_id);
      const funds = fundId == null ? [] : section === 'ledger' ? await adminFunds(c.env, user, fundId) : await gpFunds(c.env, user, fundId);
      if (!funds.length) return refused(c, 404, 'fund_not_found', section === 'ledger' ? 'Pick a fund you administer.' : 'Pick a fund you are GP of.');
    }
    // A capacity the investor deleted stays deleted: the sync refreshes only a live one, and reads nothing otherwise.
    const held = section === 'commit' ? await readCapacity(c.env, user) : null;
    if (section === 'commit' && !held) return c.json({ section, written: 0 });
    return withMercury(c, user, async (conn) => {
      if (section === 'commit' && held) {
        const accounts = await conn.reader.accounts();
        const ids = accounts.filter((a) => held.account_last_fours.includes(a.last_four)).map((a) => a.mercury_account_id);
        const cap = capacityOf(accounts, ids);
        await logRead(c.env, conn.integrationId, user, 'commit', { accounts: ids.length });
        if (!cap.ok) return refused(c, 502, 'balance_unreadable', 'Mercury did not give an available balance for every account you picked, so nothing changed.');
        await writeCapacity(c.env, user, conn.integrationId, cap, today());
        return c.json({ section, written: 1 });
      }
      if (section === 'reporting') {
        const statements = await readStatements(conn.reader, window, accountIds);
        const cash = await writeMonthEndCash(c.env, user, conn.integrationId, fundId!, monthEndCash(statements));
        const props = await writeProposals(c.env, user, conn.integrationId, await statementDrafts(c.env, fundId!, statements));
        await logRead(c.env, conn.integrationId, user, 'reporting', { statements: statements.length, months: cash.written, proposed: props.proposed });
        return c.json({ section, written: cash.written, proposed: props.proposed });
      }
      const read = await readLines(conn.reader, window, accountIds);
      const drafts = section === 'closing' ? closingDrafts(await ownCommitments(c.env, user), read.lines)
        : section === 'calls' ? await callProposalsFor(c.env, fundId!, read.lines)
        : ledgerDrafts(fundId!, read.lines);
      const out = await writeProposals(c.env, user, conn.integrationId, drafts);
      await logRead(c.env, conn.integrationId, user, section, { lines: read.lines.length, proposed: out.proposed, skipped: out.skipped });
      return c.json({ section, proposed: out.proposed, capped: read.capped });
    });
  });

  app.get('/proposals', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const kind = c.req.query('kind') as ProposalKind;
    if (!KINDS.includes(kind)) return refused(c, 400, 'invalid_kind', 'Name a kind: closing, call, ledger or statement.');
    if (kind !== 'closing') {
      const tier = fundTier(user);
      if (tier) return tier;
    }
    const fundId = c.req.query('fund_id') === undefined ? null : fundIdOf(c.req.query('fund_id'));
    const rows = await listProposals(c.env, user, kind, fundId);
    return c.json({ proposals: rows.map(({ id: _i, user_id: _u, integration_id: _g, external_id: _e, ...r }) => r) });
  });

  /** Accept or dismiss one of the caller's own proposals. */
  async function decide(c: C, act: 'accept' | 'dismiss'): Promise<Response> {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const uid = c.req.param('uid') ?? '';
    const prop = /^[0-9a-f]{32}$/i.test(uid) ? await ownProposal(c.env, user, uid.toLowerCase()) : null;
    if (!prop) return refused(c, 404, 'proposal_not_found', 'No such proposal.');
    if (prop.kind !== 'closing') {
      const tier = fundTier(user);
      if (tier) return tier;
    }
    if (act === 'dismiss') {
      return await dismissProposal(c.env, user, prop) ? c.json({ ok: true }) : refused(c, 409, 'already_decided', 'This proposal was already accepted or dismissed.');
    }
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const finish = async (extras = {}) => {
      const out = await acceptProposal(c.env, user, prop, body, extras);
      return out.ok ? c.json({ ok: true, result_ref: out.result_ref }) : refused(c, out.status, out.code, out.message);
    };
    if (prop.kind !== 'statement' || prop.state !== 'proposed') return finish();
    // A statement is attached as its PDF, read now from the investor's own Mercury.
    return withMercury(c, user, async (conn) => {
      const accounts = (await conn.reader.accounts()).filter((a) => a.last_four === prop.account_last_four);
      let pdf = null;
      for (const a of accounts) {
        pdf = await conn.reader.statementPdf(a.mercury_account_id, prop.mercury_id);
        if (pdf) break;
      }
      await logRead(c.env, conn.integrationId, user, 'statement', { pdfs: pdf ? 1 : 0 });
      return finish({ statementPdf: pdf });
    });
  }

  app.post('/proposals/:uid/accept', (c) => decide(c, 'accept'));
  app.post('/proposals/:uid/dismiss', (c) => decide(c, 'dismiss'));

  /** An attached statement's PDF: its owner only (`result_ref` is the key only once accepted), from the private bucket. */
  app.get('/proposals/:uid/statement.pdf', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const uid = c.req.param('uid') ?? '';
    const prop = /^[0-9a-f]{32}$/i.test(uid) ? await ownProposal(c.env, user, uid.toLowerCase()) : null;
    if (!prop || prop.kind !== 'statement' || prop.result_ref !== statementKeyOf(user, prop)) {
      return refused(c, 404, 'statement_not_found', 'No attached statement here.');
    }
    const obj = c.env.FILES ? await c.env.FILES.get(prop.result_ref) : null;
    if (!obj) return refused(c, 404, 'statement_not_found', 'No attached statement here.');
    return new Response(obj.body, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="statement-${prop.posted_on ?? 'mercury'}.pdf"`,
      'Cache-Control': 'private, no-store',
    } });
  });

  app.get('/reporting', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const tier = fundTier(user);
    if (tier) return tier;
    const fundId = fundIdOf(c.req.query('fund_id'));
    if (fundId == null || !(await gpFunds(c.env, user, fundId)).length) return refused(c, 404, 'fund_not_found', 'Pick a fund you are GP of.');
    const statements = (await listProposals(c.env, user, 'statement', fundId)).map(({ uid, target_id, account_last_four, posted_on, state }) => ({ uid, period_id: target_id, account_last_four, period_end: posted_on, state }));
    return c.json({ month_end_cash: await readMonthEndCash(c.env, user, fundId), statements });
  });

  app.delete('/reporting/cash/:id', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const id = fundIdOf(c.req.param('id'));
    if (id == null || !await deleteMonthEndCash(c.env, user, id)) return refused(c, 404, 'not_found', 'No such month.');
    return c.json({ deleted: true });
  });

  app.get('/ledger/map', async (c) => {
    const user = await requireAuth(c);
    const p = await policy(c, user);
    if (p) return p;
    const tier = fundTier(user);
    if (tier) return tier;
    const fundId = fundIdOf(c.req.query('fund_id'));
    if (fundId == null || !(await adminFunds(c.env, user, fundId)).length) return refused(c, 404, 'fund_not_found', 'Pick a fund you administer.');
    // The fund's own accounts and open periods, for the one-time mapping on Accept.
    const accounts = (await c.env.DB.prepare('SELECT id, code, name, category FROM fund_ledger_accounts WHERE fund_id = ? ORDER BY code, id')
      .bind(fundId).all<{ id: number; code: string; name: string; category: string }>()).results || [];
    const periods = (await c.env.DB.prepare('SELECT id, label, start_date, end_date FROM fund_accounting_periods WHERE fund_id = ? AND closed = 0 ORDER BY start_date DESC, id DESC')
      .bind(fundId).all<{ id: number; label: string; start_date: string; end_date: string }>()).results || [];
    return c.json({ map: await categoryMap(c.env, user, fundId), accounts, periods });
  });

  return app;
}

const mercuryInvestor = createMercuryInvestor();
export default mercuryInvestor;
