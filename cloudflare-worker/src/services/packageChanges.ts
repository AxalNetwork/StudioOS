/**
 * D5025 part 2 (#5025) — HQ schedules a package change for the next term.
 *
 * The owner's rule (#5025, answers 1-3): an accepted renewal, upgrade,
 * downgrade or change takes effect at the next term only, with no proration
 * and no notice period. So a schedule names the licence's current term and an
 * offered offer that starts the day after that term ends, never inside it.
 * It freezes the kind and both prices so the decision can be read later.
 *
 * The offer is still accepted through D5024's route (grants, legal policy and
 * review hash), which already refuses a package that would start early or
 * overlap a term. On or after `effective_on` the schedule reads `due`; once
 * the offer is accepted it reads `applied`; if the offer is declined, expired
 * or superseded it reads `lapsed`. Those three are read from the offer, not
 * stored, so they cannot disagree with it. HQ can cancel a schedule that has
 * not been applied.
 *
 * Money: no proration, so no credit or debit is written. The owner's answer 2
 * (an adjustment row on the D4694 licence fee invoices) applies only if
 * proration is introduced later.
 */
import type { Env } from '../types';
import { getPackageOffer, offerKey, offerReason, PackageOfferError, type PackageOffer } from './packageOffers';
import { changeKind, currentTerm, FINANCIAL_RULE, licenceOffers, nextDay, programKeys, type ChangeKind } from './packageLifecycle';
import { logAdminAction } from './adminAudit';

export type PackageChangeRow = {
  uid: string; licence_uid: string; from_offer_uid: string; to_offer_uid: string; kind: ChangeKind; effective_on: string;
  old_annual_fee_cents: number; new_annual_fee_cents: number; old_currency: string; new_currency: string; financial_rule: string;
  state: 'scheduled' | 'cancelled'; reason: string; created_at: string; created_by: number; schedule_key: string;
  cancelled_at: string | null; cancelled_by: number | null; cancel_reason: string | null;
};
export const CHANGE_STATUSES = Object.freeze(['scheduled', 'due', 'applied', 'lapsed', 'cancelled'] as const);
export type ChangeStatus = typeof CHANGE_STATUSES[number];

const conflict = (code: string, message: string): never => { throw new PackageOfferError(409, code, message); };
const bad = (code: string, message: string): never => { throw new PackageOfferError(400, code, message); };

/** A schedule's status on `day`, read with its next-term offer's state. */
export function changeStatus(row: Pick<PackageChangeRow, 'state' | 'effective_on'>, toOfferState: string | null, day: string): ChangeStatus {
  if (row.state === 'cancelled') return 'cancelled';
  if (toOfferState === 'accepted') return 'applied';
  if (toOfferState !== 'offered') return 'lapsed';
  return day >= row.effective_on ? 'due' : 'scheduled';
}

/** Why `proposal` cannot be scheduled against `term`, or null when it can. */
export function scheduleRefusal(term: PackageOffer | null, proposal: PackageOffer): { code: string; message: string } | null {
  if (proposal.state !== 'offered') return { code: 'offer_not_offered', message: 'Only an offered package can be scheduled as the next term. Offer it first.' };
  if (!term) return { code: 'no_current_term', message: 'This licence has no accepted package term to change; accept the offer as its first term.' };
  const next = nextDay(term.ends_on);
  if (proposal.starts_on < next) {
    return { code: 'change_not_next_term', message: `A package change takes effect at the next term only. This offer must start on ${next}, the day after the current term ends.` };
  }
  if (proposal.starts_on > next) {
    return { code: 'change_leaves_gap', message: `This offer starts after ${next}, leaving days with no package. Start it on ${next}.` };
  }
  return null;
}

function present(row: PackageChangeRow, offers: Map<string, PackageOffer>, day: string) {
  const to = offers.get(row.to_offer_uid) ?? null;
  return {
    uid: row.uid, kind: row.kind, effective_on: row.effective_on, financial_rule: row.financial_rule, proration_applies: false,
    status: changeStatus(row, to?.state ?? null, day),
    from_offer_uid: row.from_offer_uid, to_offer_uid: row.to_offer_uid,
    old_annual_fee_cents: row.old_annual_fee_cents, old_currency: row.old_currency,
    new_annual_fee_cents: row.new_annual_fee_cents, new_currency: row.new_currency,
    reason: row.reason, created_at: row.created_at, created_by: row.created_by,
    cancelled_at: row.cancelled_at, cancelled_by: row.cancelled_by, cancel_reason: row.cancel_reason,
  };
}

export async function listPackageChanges(env: Env, licenceUid: string, day: string) {
  const [rows, offers] = await Promise.all([
    env.DB.prepare('SELECT * FROM licence_package_changes WHERE licence_uid = ? ORDER BY effective_on, created_at, uid').bind(licenceUid).all<PackageChangeRow>(),
    licenceOffers(env, licenceUid),
  ]);
  const byUid = new Map(offers.map((o) => [o.uid, o]));
  return (rows.results || []).map((r) => present(r, byUid, day));
}

async function getChange(env: Env, licenceUid: string, uid: string): Promise<PackageChangeRow> {
  const row = await env.DB.prepare('SELECT * FROM licence_package_changes WHERE uid = ? AND licence_uid = ?').bind(uid, licenceUid).first<PackageChangeRow>();
  if (!row) throw new PackageOfferError(404, 'change_not_found', 'No scheduled package change for this licence has that id.');
  return row;
}

export async function schedulePackageChange(env: Env, licenceUid: string, offerUid: string, body: Record<string, any>,
  actor: { id: number; email?: string | null }, day: string) {
  if (Object.keys(body).some((k) => !['reason', 'idempotency_key'].includes(k))) bad('invalid_fields', 'Send only reason and idempotency_key.');
  const reason = offerReason(body.reason);
  const key = offerKey(body.idempotency_key);
  const replay = await env.DB.prepare('SELECT * FROM licence_package_changes WHERE created_by = ? AND schedule_key = ?').bind(actor.id, key).first<PackageChangeRow>();
  if (replay) {
    if (replay.licence_uid !== licenceUid || replay.to_offer_uid !== offerUid) conflict('idempotency_key_reused', 'This key already scheduled a different change. Mint a new key.');
    const offers = await licenceOffers(env, licenceUid);
    return { change: present(replay, new Map(offers.map((o) => [o.uid, o])), day), replayed: true };
  }
  const proposal = await getPackageOffer(env, licenceUid, offerUid);
  const all = await licenceOffers(env, licenceUid);
  const term = currentTerm(all.filter((o) => o.uid !== proposal.uid), day);
  const refusal = scheduleRefusal(term, proposal);
  if (refusal) conflict(refusal.code, refusal.message);
  const from = term as PackageOffer;
  const kind = changeKind(programKeys(from), programKeys(proposal), from.package_key === proposal.package_key);
  const row: PackageChangeRow = {
    uid: crypto.randomUUID(), licence_uid: licenceUid, from_offer_uid: from.uid, to_offer_uid: proposal.uid, kind,
    effective_on: proposal.starts_on, old_annual_fee_cents: from.accepted_annual_fee_cents as number,
    new_annual_fee_cents: proposal.accepted_annual_fee_cents ?? proposal.recommended_annual_fee_cents,
    old_currency: from.currency, new_currency: proposal.currency, financial_rule: FINANCIAL_RULE, state: 'scheduled', reason,
    created_at: new Date().toISOString(), created_by: actor.id, schedule_key: key, cancelled_at: null, cancelled_by: null, cancel_reason: null,
  };
  try {
    await env.DB.prepare(`INSERT INTO licence_package_changes (uid, licence_uid, from_offer_uid, to_offer_uid, kind, effective_on,
        old_annual_fee_cents, new_annual_fee_cents, old_currency, new_currency, financial_rule, state, reason, created_at, created_by, schedule_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`)
      .bind(row.uid, licenceUid, row.from_offer_uid, row.to_offer_uid, kind, row.effective_on, row.old_annual_fee_cents,
        row.new_annual_fee_cents, row.old_currency, row.new_currency, FINANCIAL_RULE, reason, row.created_at, actor.id, key).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) conflict('change_already_scheduled', 'A change is already scheduled for this term or this offer. Cancel it before scheduling another.');
    throw e;
  }
  await logAdminAction(env, actor.id, actor.email || '', 'licence_package_change_scheduled', {
    licence_uid: licenceUid, change_uid: row.uid, from_offer_uid: row.from_offer_uid, to_offer_uid: row.to_offer_uid,
    kind, effective_on: row.effective_on, reason });
  return { change: present(row, new Map(all.map((o) => [o.uid, o])), day), replayed: false };
}

export async function cancelPackageChange(env: Env, licenceUid: string, uid: string, body: Record<string, any>,
  actor: { id: number; email?: string | null }, day: string) {
  if (Object.keys(body).some((k) => k !== 'reason')) bad('invalid_fields', 'Send only reason.');
  const reason = offerReason(body.reason);
  const row = await getChange(env, licenceUid, uid);
  const all = await licenceOffers(env, licenceUid);
  const offers = new Map(all.map((o) => [o.uid, o]));
  const status = changeStatus(row, offers.get(row.to_offer_uid)?.state ?? null, day);
  if (status === 'cancelled') conflict('change_already_cancelled', 'This change was already cancelled.');
  if (status === 'applied') conflict('change_already_applied', 'This change was applied when its offer was accepted; it can no longer be cancelled.');
  const at = new Date().toISOString();
  const res = await env.DB.prepare(`UPDATE licence_package_changes SET state = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?
      WHERE uid = ? AND licence_uid = ? AND state = 'scheduled'`).bind(at, actor.id, reason, uid, licenceUid).run();
  if (!res.meta?.changes) conflict('change_already_cancelled', 'This change was already cancelled.');
  await logAdminAction(env, actor.id, actor.email || '', 'licence_package_change_cancelled', { licence_uid: licenceUid, change_uid: uid, reason });
  return { change: present({ ...row, state: 'cancelled', cancelled_at: at, cancelled_by: actor.id, cancel_reason: reason }, offers, day) };
}
