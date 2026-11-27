/**
 * D1021 (#2858) — Cap table part 6: proposals from a close.
 *
 * A close is a tranche of the active round (`raise_closes`, migration 169), and
 * its investors are the committed raise prospects assigned to it (`close_id`).
 * Each investor becomes one proposed issuance on part 2's record (D1017):
 *
 *   origin 'close', origin_ref 'raise_prospect:<uid>'
 *
 * That key is the proposal's identity. The Closing room (CAPITAL's CP11, #2424)
 * reads and decides the same row by the same key, so a proposal accepted or
 * dismissed on one page is decided on both. A key is written once: running the
 * writer again never re-proposes an investor whose row was decided.
 *
 * Money is the close's own: the amount each investor committed, in the venture's
 * currency, and for a priced close the class and price a person gives. Shares
 * are the amount over that price, rounded down. Nothing is guessed: a missing
 * amount stays empty for the person to enter on Accept (#2431).
 *
 * An investor is recorded only from their signed document (`signatureOf`): a
 * SAFE sent through StudioOS whose envelope is completed is linked as signed;
 * anyone else reads "Not signed yet" until a person attaches it on Accept.
 */
import type { Env } from '../types';
import { RecordError, currencyOf, proposeFromSource, signatureOf, type RecordActor } from './capTableRecord';

export const CLOSE_REF = 'raise_prospect:';

/** The raise pipeline's instrument → the record's kind. An instrument not recorded is not guessed. */
const KIND_OF: Record<string, 'safe' | 'note' | 'priced'> = { safe: 'safe', note: 'note', equity: 'priced' };

interface CloseRow { id: number; uid: string; name: string; state: string; closed_date: string | null; round_name: string | null }

interface InvestorRow {
  id: number; uid: string; name: string | null; firm: string | null; amount: number | null; instrument: string | null;
  commit_status: string | null; safe_uid: string | null; envelope_status: string | null;
}

interface ProposalRow { uid: string; origin_ref: string; status: string; safe_issuance_uid: string | null; document_ref: string | null }

async function closeOrThrow(env: Env, projectId: number, closeUid: string): Promise<CloseRow> {
  const row = await env.DB.prepare(
    `SELECT c.id, c.uid, c.name, c.state, c.closed_date, r.name AS round_name
       FROM raise_closes c LEFT JOIN raise_rounds r ON r.id = c.round_id
      WHERE c.uid = ? AND c.project_id = ?`,
  ).bind(closeUid, projectId).first<CloseRow>();
  if (!row) throw new RecordError(404, 'unknown_close', 'That close is not this venture’s.');
  return row;
}

/**
 * The close's investors: committed and firm (signed or wired; a commitment
 * with no status is read as signed, as migration 169 says). A soft commitment
 * is not in the close's issuances. Each carries the latest SAFE sent through
 * StudioOS for that prospect, if any, and its envelope's state.
 */
async function investorsOf(env: Env, projectId: number, closeId: number): Promise<InvestorRow[]> {
  return (await env.DB.prepare(
    `SELECT p.id, p.uid, p.name, p.firm, p.amount, p.instrument, p.commit_status, s.uid AS safe_uid, e.status AS envelope_status
       FROM raise_prospects p
       LEFT JOIN safe_issuances s ON s.id = (SELECT MAX(x.id) FROM safe_issuances x WHERE x.prospect_id = p.id AND x.project_id = p.project_id)
       LEFT JOIN esign_envelopes e ON e.id = s.envelope_id
      WHERE p.project_id = ? AND p.close_id = ? AND p.stage = 'committed' AND COALESCE(p.commit_status, 'signed') IN ('signed', 'wired')
      ORDER BY p.id`,
  ).bind(projectId, closeId).all<InvestorRow>()).results || [];
}

/** The latest row for each key, whatever its status: a decided key stays decided. */
async function proposalsFor(env: Env, projectId: number, refs: string[]): Promise<Map<string, ProposalRow>> {
  if (!refs.length) return new Map();
  const rows = (await env.DB.prepare(
    `SELECT uid, origin_ref, status, safe_issuance_uid, document_ref FROM cap_table_issuances
      WHERE project_id = ? AND origin = 'close' AND origin_ref IN (SELECT value FROM json_each(?))
      ORDER BY id`,
  ).bind(projectId, JSON.stringify(refs)).all<ProposalRow>()).results || [];
  return new Map(rows.map((r) => [r.origin_ref, r]));
}

/** The currency's minor-unit digits (USD 2, JPY 0), so a whole amount becomes the record's smallest unit. */
export function minorDigits(code: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** A committed amount in the venture currency's smallest unit; a missing or negative one is not recorded. */
export function amountMinor(amount: number | null, code: string): number | null {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) < 0) return null;
  return Math.round(Number(amount) * 10 ** minorDigits(code));
}

/** Shares bought: the amount over the price per share, rounded down (no fractional shares). */
export function sharesFor(amountMinorUnits: number | null, priceMicros: number | null, code: string): number | null {
  if (amountMinorUnits == null || priceMicros == null || priceMicros <= 0) return null;
  const n = (BigInt(amountMinorUnits) * 1_000_000n) / (BigInt(priceMicros) * 10n ** BigInt(minorDigits(code)));
  return n > 0n ? Number(n) : null;
}

function holderOf(p: InvestorRow): string | null {
  const v = String(p.firm ?? '').trim() || String(p.name ?? '').trim();
  return v ? v.slice(0, 200) : null;
}

/** Why an investor has no proposal: a person fills these in the raise pipeline first. */
function skipOf(p: InvestorRow): string | null {
  if (!holderOf(p)) return 'holder_not_recorded';
  if (!p.instrument || !KIND_OF[p.instrument]) return 'instrument_not_recorded';
  return null;
}

/** GET /record/:projectId/closes/:closeUid — CT11b: the close's investors, each with its proposal and whether it is signed. */
export async function readClose(env: Env, projectId: number, closeUid: string) {
  const close = await closeOrThrow(env, projectId, closeUid);
  const [investors, currency] = await Promise.all([investorsOf(env, projectId, close.id), currencyOf(env, projectId)]);
  const proposals = await proposalsFor(env, projectId, investors.map((p) => CLOSE_REF + p.uid));
  const rows = [];
  for (const p of investors) {
    const proposal = proposals.get(CLOSE_REF + p.uid) ?? null;
    const sig = proposal
      ? await signatureOf(env, projectId, proposal)
      : { signed: p.envelope_status === 'completed', via: p.envelope_status === 'completed' ? 'safe_envelope' as const : null };
    rows.push({
      prospect_uid: p.uid,
      holder_name: holderOf(p),
      instrument: p.instrument && KIND_OF[p.instrument] ? KIND_OF[p.instrument] : null,
      amount_cents: amountMinor(p.amount, currency.code),
      currency: currency.code,
      signature: { signed: sig.signed, via: sig.via, label: sig.signed ? 'Signed' : 'Not signed yet' },
      proposal: proposal ? { uid: proposal.uid, status: proposal.status } : null,
      skipped: proposal ? null : skipOf(p),
    });
  }
  return {
    close: { uid: close.uid, name: close.name, round_name: close.round_name, state: close.state, closed_date: close.closed_date },
    rows,
  };
}

/**
 * POST /record/:projectId/closes/:closeUid/proposals — a closed close proposes
 * one issuance per investor. Body: `class_uid` and `price_per_share_micros`
 * for a priced close (both the person's), and an admin's `reason`. Answers
 * what it proposed, what was already there, and what it could not.
 */
export async function proposeFromClose(env: Env, projectId: number, actor: RecordActor, closeUid: string, body: Record<string, unknown>) {
  const close = await closeOrThrow(env, projectId, closeUid);
  if (close.state !== 'closed') throw new RecordError(409, 'close_not_closed', 'Mark the close as closed before proposing its issuances.');
  const [investors, currency] = await Promise.all([investorsOf(env, projectId, close.id), currencyOf(env, projectId)]);
  const existing = await proposalsFor(env, projectId, investors.map((p) => CLOSE_REF + p.uid));
  const price = body.price_per_share_micros == null ? null : Number(body.price_per_share_micros);
  if (price != null && !(Number.isSafeInteger(price) && price > 0)) {
    throw new RecordError(400, 'bad_price_per_share_micros', 'price_per_share_micros must be a whole number above 0.', { field: 'price_per_share_micros' });
  }
  // Checked before anything is written, so a bad class never leaves the close half proposed.
  if (body.class_uid != null) {
    const cls = await env.DB.prepare('SELECT kind FROM cap_table_share_classes WHERE uid = ? AND project_id = ?')
      .bind(String(body.class_uid), projectId).first<{ kind: string }>();
    if (!cls) throw new RecordError(400, 'unknown_class', 'That share class is not this venture’s.', { field: 'class_uid' });
    if (cls.kind === 'option_pool') throw new RecordError(400, 'bad_class_uid', 'Shares are issued in a common or preferred class, not in an option pool.');
  }
  const proposed: string[] = [];
  const already: string[] = [];
  const skipped: Array<{ prospect_uid: string; reason: string }> = [];
  for (const p of investors) {
    const ref = CLOSE_REF + p.uid;
    if (existing.has(ref)) { already.push(p.uid); continue; }
    const why = skipOf(p);
    if (why) { skipped.push({ prospect_uid: p.uid, reason: why }); continue; }
    const kind = KIND_OF[p.instrument!];
    const amount = amountMinor(p.amount, currency.code);
    const signedSafe = kind === 'safe' && p.safe_uid != null && p.envelope_status === 'completed';
    const row: Record<string, unknown> = {
      kind, holder_name: holderOf(p), issued_on: close.closed_date, source: signedSafe ? 'signed' : 'document',
      reason: body.reason ?? null,
    };
    // A SAFE sent through StudioOS keeps its terms there (D1017 §5): linked, never copied.
    if (signedSafe) row.safe_issuance_uid = p.safe_uid;
    else row.amount_cents = amount;
    if (kind === 'priced') {
      if (body.class_uid != null) row.class_uid = body.class_uid;
      if (price != null) {
        row.price_per_share_micros = price;
        row.shares = sharesFor(amount, price, currency.code);
      }
    }
    try {
      await proposeFromSource(env, { projectId, actor, origin: 'close', originRef: ref, body: row });
      proposed.push(p.uid);
    } catch (e) {
      // The Closing room, or a person, put it on the record first.
      if (e instanceof RecordError && e.code === 'already_on_record') { already.push(p.uid); continue; }
      throw e;
    }
  }
  return { ...(await readClose(env, projectId, closeUid)), proposed, already, skipped };
}
