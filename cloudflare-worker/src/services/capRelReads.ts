/**
 * D1190 (#3124) — Capital relationships part 2: the two reads the tool's
 * Commitments (CRL9) and Match (CRL7) tabs draw.
 *
 * ─── THE COMMITMENTS READ ───────────────────────────────────────────────────
 *
 * Commitments live in four places, and each is read as it stands:
 *
 *   source     where                                  status words
 *   Typed      a prospect at Committed                Signed, Wired, Soft, Status not recorded
 *              (`raise_prospects`, contacts.ts)
 *   Recorded   a round call's response (D653)         Indicated through a call
 *   Recorded   a deal commitment (`commitments`)      Pending, Confirmed (withdrawn is gone)
 *   Connector  a Mercury credit matched to the        Received
 *              investor (D752), the founder only
 *   Closings (CAPITAL, #2424) are not recorded anywhere yet; the read says so.
 *
 * WHAT COUNTS. Received, Signed, Wired, Confirmed and Pending count, as the
 * canvas's "Committed against the target" draws them. Indicated and Soft never
 * count, and neither does a commitment with no status: "Status not recorded"
 * (#2457 owner question 4). An amount nobody recorded is listed with `cents:
 * null` and never summed as 0.
 *
 * ONE LINE PER INVESTOR IN THE TOTALS. One investor reaches several stores: a
 * round-call response also writes its prospect as Soft (D653), and a Mercury
 * credit marks its prospect Wired (D752). Summing every line would count that
 * money twice. So each investor's lines are grouped (a prospect, or the same
 * person found by email), and only the strongest line counts toward the
 * totals: Received, then Signed, Wired, Confirmed, Pending, Indicated, Soft,
 * Status not recorded. Every line is still listed under its investor.
 *
 * ONE CURRENCY (#2457 owner question 5). The venture's currency is its active
 * round's (migration 607), USD when no round records one. A line in another
 * currency is listed and never summed with it.
 *
 * NAMES. A prospect is the venture's own record. A round-call respondent is
 * named, as the founder's Calls already name everyone who answered; a deal
 * commitment names the investor, never their email.
 *
 * ─── THE MATCH READ ──────────────────────────────────────────────────────────
 *
 * The fund directory (D535, read only `FROM SERVED_FUNDS`, D597), each fund
 * with its Fit against the venture's sector (`fundFit`, the Research
 * crosswalk, never a substring), the people in the caller's OWN network who
 * work there (`network_connections.company`, the fund's name exactly, case
 * aside), and whether the venture already tracks it. The directory's own
 * filters apply; `fit` and `warm` add two. Stage is not recorded in the
 * directory, so a stage filter is refused, as the directory refuses it.
 *
 * VERIFIED INVESTORS ARE A COUNT, NEVER NAMES (#2457 owner question 10): the
 * investors on Axal whose account is verified (active, KYC approved) and whose
 * published sectors fit the venture's, by the same crosswalk, with the
 * venture's sector not in their anti-thesis. Their names stay private until
 * they answer a Call for Capital.
 *
 * Every statement here is bound. Logs hold counts only.
 */
import type { Env } from '../types';
import { fundFit, FIT_LABEL, receivedCredits, type Fit } from './raiseCycle';
import { DirectoryQueryError, listDirectory, parseDirectoryQuery, servedFocusValues, type DirectoryQuery } from './researchFundDirectory';

// ───────────────────────────────────────────────────────────────── vocabulary

export const COMMIT_STATUSES = ['received', 'signed', 'wired', 'confirmed', 'pending', 'indicated', 'soft', 'not_recorded'] as const;
export type CommitStatus = typeof COMMIT_STATUSES[number];

/** The statuses that count toward "committed". Every other one is listed and not counted. */
export const COUNTED: ReadonlySet<CommitStatus> = new Set(['received', 'signed', 'wired', 'confirmed', 'pending']);

export const STATUS_WORDS: Record<CommitStatus, string> = {
  received: 'Received', signed: 'Signed', wired: 'Wired', confirmed: 'Confirmed', pending: 'Pending',
  indicated: 'Indicated through a call', soft: 'Soft', not_recorded: 'Status not recorded',
};

export type CommitSource = 'typed' | 'recorded' | 'connector';
export const SOURCE_WORDS: Record<CommitSource, string> = { typed: 'Typed', recorded: 'Recorded', connector: 'Connector · Mercury' };

/** Why a line is not counted, in words the page shows beside it. */
export const NOT_COUNTED_WHY: Record<'indicated' | 'soft' | 'not_recorded' | 'other_currency', string> = {
  indicated: 'Indicative, not signed.',
  soft: 'Soft: not counted until it is signed.',
  not_recorded: 'Not counted until you set how sure it is.',
  other_currency: 'In another currency than the round: listed, never added to it.',
};

/** The order an investor's strongest line is chosen in: the first is strongest. */
const RANK: Record<CommitStatus, number> = Object.fromEntries(COMMIT_STATUSES.map((s, i) => [s, i])) as Record<CommitStatus, number>;

const MAX_DOLLARS = 10_000_000_000_000;
/** Dollars as cents, by migration 607's rule; out of range or missing is null, never 0. */
export function dollarsToCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DOLLARS) return null;
  return Math.round(n * 100);
}

const CURRENCY = /^[A-Z]{3}$/;
const currencyOf = (v: unknown, fallback: string): string => (typeof v === 'string' && CURRENCY.test(v) ? v : fallback);

// ──────────────────────────────────────────────────────────── commitments read

export interface CommitLine {
  key: string;
  source: CommitSource;
  source_label: string;
  status: CommitStatus;
  status_label: string;
  counted: boolean;
  cents: number | null;
  currency: string;
  on: string | null;
  via: string | null;
  why_not_counted: string | null;
}

export interface CommitInvestor {
  key: string;
  prospect_id: number | null;
  name: string;
  chosen: CommitLine;
  lines: CommitLine[];
}

type Block = { state: 'ok' } | { state: 'unreadable'; reason: string } | { state: 'founder_only'; reason: string } | { state: 'not_recorded'; reason: string };

function line(o: Omit<CommitLine, 'source_label' | 'status_label' | 'counted' | 'why_not_counted'>): CommitLine {
  return {
    ...o,
    source_label: SOURCE_WORDS[o.source],
    status_label: STATUS_WORDS[o.status],
    counted: COUNTED.has(o.status),
    why_not_counted: COUNTED.has(o.status) ? null : NOT_COUNTED_WHY[o.status as 'indicated' | 'soft' | 'not_recorded'],
  };
}

const ROW_CAP = 2000;

async function readBlock<T>(name: string, read: () => Promise<T[]>, sources: Record<string, Block>, reason: string): Promise<T[]> {
  try {
    const rows = await read();
    sources[name] = { state: 'ok' };
    return rows;
  } catch (e) {
    console.warn('[capRelReads] block unreadable:', name, (e as Error)?.name || 'error');
    sources[name] = { state: 'unreadable', reason };
    return [];
  }
}

/**
 * The venture's commitments from every store, grouped by investor, with the
 * totals in the round's currency. `founderUserId` is the caller when they are
 * the venture's own founder (`mercuryFounderOnly`'s rule); only then is
 * Mercury read, and only their own matches.
 */
export async function commitmentsRead(env: Env, projectId: number, founderUserId: number | null) {
  const sources: Record<string, Block> = {};
  const round = await env.DB.prepare(
    `SELECT id, name, target_cents, target_amount, currency, close_date FROM raise_rounds
      WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
  ).bind(projectId).first<{ id: number; name: string | null; target_cents: number | null; target_amount: number | null; currency: string | null; close_date: string | null }>()
    .catch(() => null);
  const currency = currencyOf(round?.currency, 'USD');

  // Every prospect's email, to find the same person in the other stores.
  const people = await readBlock('prospects', async () => ((await env.DB.prepare(
    `SELECT id, name, firm, LOWER(TRIM(email)) AS email, stage, commit_status, amount_cents, amount, currency, updated_at
       FROM raise_prospects WHERE project_id = ? ORDER BY id LIMIT ?`,
  ).bind(projectId, ROW_CAP).all<{ id: number; name: string | null; firm: string | null; email: string | null; stage: string; commit_status: string | null;
    amount_cents: number | null; amount: number | null; currency: string | null; updated_at: string | null }>()).results || []),
  sources, 'The investors typed into the pipeline could not be read');
  const byEmail = new Map<string, number>();
  const prospectName = new Map<number, string>();
  for (const p of people) {
    if (p.email) byEmail.set(p.email, Number(p.id));
    prospectName.set(Number(p.id), String(p.firm || p.name || '').trim() || 'Investor');
  }

  const investors = new Map<string, { key: string; prospect_id: number | null; name: string; lines: CommitLine[] }>();
  const add = (key: string, prospectId: number | null, name: string, l: CommitLine) => {
    const inv = investors.get(key) ?? { key, prospect_id: prospectId, name, lines: [] };
    inv.lines.push(l);
    investors.set(key, inv);
  };
  const keyFor = (email: string | null, userId: number): { key: string; prospectId: number | null } => {
    const pid = email ? byEmail.get(email) : undefined;
    return pid != null ? { key: `prospect:${pid}`, prospectId: pid } : { key: `investor:${userId}`, prospectId: null };
  };

  // Typed: every prospect at Committed, with its own status.
  for (const p of people) {
    if (p.stage !== 'committed') continue;
    const status: CommitStatus = p.commit_status === 'signed' || p.commit_status === 'wired' || p.commit_status === 'soft' ? p.commit_status : 'not_recorded';
    add(`prospect:${p.id}`, Number(p.id), prospectName.get(Number(p.id))!, line({
      key: `typed:${p.id}`, source: 'typed', status,
      cents: p.amount_cents != null ? Number(p.amount_cents) : dollarsToCents(p.amount),
      currency: currencyOf(p.currency, 'USD'), on: p.updated_at ? String(p.updated_at).slice(0, 10) : null, via: null,
    }));
  }

  // Recorded, indicative: each answered round call that named an amount (D653).
  const calls = await readBlock('round_calls', async () => ((await env.DB.prepare(
    `SELECT rr.investor_user_id, rr.commitment_cents, rr.responded_at, rc.uid AS call_uid, rc.name AS call_name,
            u.name AS investor_name, LOWER(TRIM(u.email)) AS email, r.currency AS round_currency
       FROM round_call_recipients rr
       JOIN round_calls rc ON rc.id = rr.call_id
       JOIN users u ON u.id = rr.investor_user_id
       LEFT JOIN raise_rounds r ON r.id = rc.round_id
      WHERE rc.project_id = ? AND rr.responded_at IS NOT NULL AND rr.commitment_cents IS NOT NULL
      ORDER BY rr.responded_at DESC LIMIT ?`,
  ).bind(projectId, ROW_CAP).all<{ investor_user_id: number; commitment_cents: number; responded_at: string; call_uid: string; call_name: string;
    investor_name: string | null; email: string | null; round_currency: string | null }>()).results || []),
  sources, 'The answers to your Calls for Capital could not be read');
  for (const r of calls) {
    const k = keyFor(r.email, Number(r.investor_user_id));
    add(k.key, k.prospectId, k.prospectId != null ? prospectName.get(k.prospectId)! : (String(r.investor_name || '').trim() || 'Investor'), line({
      key: `call:${r.call_uid}:${r.investor_user_id}`, source: 'recorded', status: 'indicated',
      cents: Number(r.commitment_cents), currency: currencyOf(r.round_currency, 'USD'),
      on: String(r.responded_at).slice(0, 10), via: String(r.call_name),
    }));
  }

  // Recorded: commitments in the venture's deal rooms, pending or confirmed.
  const deals = await readBlock('deals', async () => ((await env.DB.prepare(
    `SELECT c.uid, c.amount, c.status, c.created_at, c.investor_user_id, u.name AS investor_name, LOWER(TRIM(u.email)) AS email, d.currency
       FROM commitments c
       JOIN deals d ON d.id = c.deal_id
       JOIN users u ON u.id = c.investor_user_id
      WHERE d.project_id = ? AND c.status IN ('pending', 'confirmed')
      ORDER BY c.id DESC LIMIT ?`,
  ).bind(projectId, ROW_CAP).all<{ uid: string; amount: number; status: 'pending' | 'confirmed'; created_at: string | null; investor_user_id: number;
    investor_name: string | null; email: string | null; currency: string | null }>()).results || []),
  sources, 'The commitments in your deal rooms could not be read');
  for (const d of deals) {
    const k = keyFor(d.email, Number(d.investor_user_id));
    add(k.key, k.prospectId, k.prospectId != null ? prospectName.get(k.prospectId)! : (String(d.investor_name || '').trim() || 'Investor'), line({
      key: `deal:${d.uid}`, source: 'recorded', status: d.status,
      cents: dollarsToCents(d.amount), currency: currencyOf(d.currency, 'USD'),
      on: d.created_at ? String(d.created_at).slice(0, 10) : null, via: 'Deal room',
    }));
  }

  // Connector: Mercury credits the founder matched to an investor (D752). The founder alone.
  if (founderUserId == null) {
    sources.mercury = { state: 'founder_only', reason: 'Only the startup’s founder reads its Mercury, from their own connection.' };
  } else {
    // The query is `raiseCycle.receivedCredits`, inside the personal-Mercury allowlist (D713's guard).
    const received = await readBlock('mercury', () => receivedCredits(env, projectId, founderUserId, ROW_CAP),
      sources, 'Mercury’s matched credits could not be read');
    for (const m of received) {
      const pid = Number(m.target_id);
      add(`prospect:${pid}`, pid, prospectName.get(pid) ?? 'Investor', line({
        key: `mercury:${m.uid}`, source: 'connector', status: 'received',
        cents: m.amount_cents != null ? Number(m.amount_cents) : null, currency: 'USD',
        on: m.posted_on ? String(m.posted_on).slice(0, 10) : null, via: 'Mercury',
      }));
    }
  }

  sources.closings = { state: 'not_recorded', reason: 'Closings are read here once the closing room records them (CAPITAL, #2424).' };

  // One line per investor in the totals: the strongest in the round's currency.
  const out: CommitInvestor[] = [];
  const totals = {
    counted_cents: 0,
    counted_amount_not_recorded: 0,
    not_counted_cents: 0,
    by_status: Object.fromEntries(COMMIT_STATUSES.map((s) => [s, { cents: 0, investors: 0, amount_not_recorded: 0 }])) as Record<CommitStatus, { cents: number; investors: number; amount_not_recorded: number }>,
    other_currency: 0,
  };
  for (const inv of investors.values()) {
    inv.lines.sort((a, b) => RANK[a.status] - RANK[b.status] || (b.cents ?? -1) - (a.cents ?? -1));
    const inCurrency = inv.lines.filter((l) => l.currency === currency);
    const chosen = inCurrency[0] ?? { ...inv.lines[0], counted: false, why_not_counted: NOT_COUNTED_WHY.other_currency };
    out.push({ key: inv.key, prospect_id: inv.prospect_id, name: inv.name, chosen, lines: inv.lines });
    if (!inCurrency.length) { totals.other_currency += 1; continue; }
    const t = totals.by_status[chosen.status];
    t.investors += 1;
    if (chosen.cents == null) {
      t.amount_not_recorded += 1;
      if (chosen.counted) totals.counted_amount_not_recorded += 1;
      continue;
    }
    t.cents += chosen.cents;
    if (chosen.counted) totals.counted_cents += chosen.cents;
    else totals.not_counted_cents += chosen.cents;
  }
  out.sort((a, b) => RANK[a.chosen.status] - RANK[b.chosen.status] || (b.chosen.cents ?? -1) - (a.chosen.cents ?? -1) || a.name.localeCompare(b.name));

  const targetCents = round ? (round.target_cents != null ? Number(round.target_cents) : dollarsToCents(round.target_amount)) : null;
  const partial = Object.values(sources).some((s) => s.state === 'unreadable');
  return {
    currency,
    currency_basis: round?.currency ? 'The active round’s currency.' : 'No round records a currency; amounts entered as dollars are USD.',
    round: round ? { name: round.name, close_date: round.close_date, target_cents: targetCents, currency } : null,
    round_reason: round ? null : 'No active round is recorded, so there is no target to count against.',
    totals: {
      ...totals,
      percent_of_target: targetCents ? Math.round((totals.counted_cents / targetCents) * 1000) / 10 : null,
      partial,
    },
    investors: out,
    sources,
    words: { status: STATUS_WORDS, source: SOURCE_WORDS },
    basis: 'Received, Signed, Wired, Confirmed and Pending count. Indicated, Soft and Status not recorded are listed and not counted. Each investor counts once, by their strongest line.',
  };
}

// ────────────────────────────────────────────────────────────────── match read

/** A query the match read refuses: `sentence` is ours, shown as is. */
export class MatchQueryError extends Error {
  field: string;
  sentence: string;
  constructor(field: string, sentence: string) { super(sentence); this.field = field; this.sentence = sentence; }
}

const FITS: readonly Fit[] = ['fits', 'outside', 'unclear'];

/** Lower-cased and trimmed, the only way a network company is compared to a fund's name. */
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The fund directory for this venture: each fund's Fit, the caller's own
 * connections who work there, and whether the venture tracks it; plus the
 * count of verified investors whose published focus fits.
 */
export async function matchRead(env: Env, a: { projectId: number; callerUserId: number; get: (k: string) => string | undefined }) {
  let q: DirectoryQuery;
  try {
    q = parseDirectoryQuery(a.get);
  } catch (e) {
    if (e instanceof DirectoryQueryError) throw new MatchQueryError(e.field, e.reason);
    throw e;
  }
  const fitQ = (a.get('fit') ?? '').trim();
  if (fitQ && !(FITS as readonly string[]).includes(fitQ)) throw new MatchQueryError('fit', `fit must be one of ${FITS.join(', ')}`);
  const warmQ = (a.get('warm') ?? '').trim();
  if (warmQ && warmQ !== '1') throw new MatchQueryError('warm', 'warm is 1 for the funds someone in your network works at');

  const project = await env.DB.prepare('SELECT name, sector FROM projects WHERE id = ?').bind(a.projectId)
    .first<{ name: string | null; sector: string | null }>();
  const sector = String(project?.sector ?? '').trim() || null;

  // The caller's own network: who works where, by the company's exact name.
  const network = ((await env.DB.prepare(
    `SELECT name, title, company FROM network_connections
      WHERE user_id = ? AND TRIM(COALESCE(company, '')) <> '' ORDER BY id LIMIT 5000`,
  ).bind(a.callerUserId).all<{ name: string; title: string | null; company: string }>()).results || []);
  const atCompany = new Map<string, Array<{ name: string; title: string | null }>>();
  for (const n of network) {
    const k = norm(n.company);
    atCompany.set(k, [...(atCompany.get(k) ?? []), { name: String(n.name), title: n.title ? String(n.title) : null }]);
  }

  if (fitQ) {
    // SQL cannot run the crosswalk, so the fit filter is the raw focus strings whose Fit is the one asked for.
    const focuses = await servedFocusValues(env);
    q.focus_in = focuses.filter((v) => fundFit(v, sector) === fitQ);
    q.focus_in_blank = fitQ === 'unclear';
  }
  if (warmQ === '1') q.name_in = [...atCompany.keys()];

  const dir = await listDirectory(env, q);
  const uids = dir.items.map((f) => String(f.uid));
  const tracked = new Map(uids.length ? (((await env.DB.prepare(
    `SELECT id, research_fund_uid FROM raise_prospects WHERE project_id = ? AND research_fund_uid IN (SELECT value FROM json_each(?))`,
  ).bind(a.projectId, JSON.stringify(uids)).all<{ id: number; research_fund_uid: string }>()).results || [])
    .map((r) => [String(r.research_fund_uid), Number(r.id)])) : []);

  const items = dir.items.map((f) => {
    const fit = fundFit(f.sector_focus, sector);
    const warm = atCompany.get(norm(f.name)) ?? [];
    return {
      ...f,
      stage: null,
      stage_reason: 'Not recorded: the fund directory records no stage',
      fit: { code: fit, label: FIT_LABEL[fit], their_focus: f.sector_focus ?? null, your_sector: sector },
      warm_paths: warm.map((w) => ({ name: w.name, title: w.title, sentence: `${w.name} works there` })),
      in_pipeline: tracked.has(String(f.uid)) ? { prospect_id: tracked.get(String(f.uid)) } : null,
    };
  });

  return {
    ...dir,
    items,
    sector,
    sector_reason: sector ? null : 'Your venture’s sector is not recorded, so every Fit reads Unclear. Set it on the venture.',
    fit_basis: 'Fit reads each fund’s stated focus against your venture’s sector through the Research crosswalk. It never shows another venture’s data.',
    warm_basis: 'A warm path is someone in your own network whose company is the fund’s name.',
    verified_investors: await verifiedInvestorsWhoFit(env, sector),
  };
}

/** A count of verified investors whose published sectors fit, never their names. */
async function verifiedInvestorsWhoFit(env: Env, sector: string | null) {
  if (!sector) return { count: null, reason: 'Your venture’s sector is not recorded, so no investor’s focus can be read against it.' };
  try {
    const rows = ((await env.DB.prepare(
      `SELECT p.sectors_json, p.anti_thesis_sectors_json FROM investor_profiles p JOIN users u ON u.id = p.user_id
        WHERE u.role = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved'`,
    ).all<{ sectors_json: string | null; anti_thesis_sectors_json: string | null }>()).results || []);
    const list = (raw: string | null): string[] => {
      try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []; } catch { return []; }
    };
    const mine = norm(sector);
    const count = rows.filter((r) => {
      const sectors = list(r.sectors_json);
      if (!sectors.length) return false;
      if (list(r.anti_thesis_sectors_json).some((s) => norm(s) === mine)) return false;
      return fundFit(sectors.join(', '), sector) === 'fits';
    }).length;
    return { count, reason: null, basis: 'Verified investors on Axal whose published focus fits your venture. Their names stay private until they answer a Call for Capital.' };
  } catch (e) {
    console.warn('[capRelReads] verified investors unreadable:', (e as Error)?.name || 'error');
    return { count: null, reason: 'The investors on Axal could not be read. Try again.' };
  }
}
