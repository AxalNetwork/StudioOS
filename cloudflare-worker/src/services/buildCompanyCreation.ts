/**
 * D6038 (#6038, Build v2 BD11, BD25, BD26, BD29, BD30) — Company creation's
 * company-first reads: the entity summary, one 83(b) row per founder, and the
 * company's papers, for `routes/cycle_build.ts` `company()` on the module page.
 *
 * Each block is read on its own and fails on its own (BD29): a block that
 * could not be read says `unreadable`, never an empty list, and the filings
 * table beside it keeps working.
 *
 * DATES (D6694, #6694/#7162; the S1 note on #6038, 2026-11-15). "Formed on"
 * is the order's `filed_on`, and what that date is depends on the order's
 * track: on a `v2` formation case it is the registry's registration date (the
 * submission day lives on `formation_filings.submitted_on`, not here); on a
 * `legacy_v1` order, or one no case was opened for, it is the submission day
 * an admin typed (D601). The source line says which. `incorporations.status`
 * keeps its five values, and a filing that is with the registry reads
 * `packet_ready`, so the order line says Packet ready there and draws no
 * Filed with state date until `filed_on` exists.
 *
 * 83(b) ROWS (D6035 part 2, Q1 answered A, 2026-11-16): one row per founder on
 * the cap table, joining that founder's newest `section_83b_trackers` row and
 * their 83(b) Build filing (`formation_steps.kind = '83b'`,
 * `for_holder_id`). Every reader of the board reads every founder's row: the
 * venture's founders by the owner's answer, and an admin or a partner, who
 * already read every tracker through `GET /api/legal/83b/trackers`. No tracker
 * and no filing is Not recorded with its reason, never a deadline.
 *
 * PAPERS: the company's four named document slots (D1592,
 * `routes/company_documents.ts` `readSlots`), read only for a member of the
 * company (`viewerIsMember`, which admits an admin), as that route reads them.
 * A venture with no company is `not_linked`; anyone else is `refused`, and is
 * told nothing about the company, not even counts. The 83(b) proofs are the
 * 83(b) rows' own `proof`, so they are not read twice. No new store.
 */
import type { Env, User } from '../types';
import { readSlots } from '../routes/company_documents';
import { viewerIsMember } from './companyAccess';

type Order = { id: number; status: string; paid_at: string | null; packet_ready_at: string | null; filed_on: string | null;
  jurisdiction_id: string | null } | null;
type Step = { id: number; title: string; due_date: string | null; state: string; proof_file_key: string | null; kind: string | null; for_holder_id: number | null };
type ProjectRef = { id: number; company_id: number | null; entity_id: number | null };

/** A summary value, where it came from, or why there is none. */
export type SummaryFact = { value: string | null; source: string | null; reason: string | null };
const has = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const fact = (value: string | null | undefined, source: string, reason: string): SummaryFact =>
  has(value) ? { value: value.trim(), source, reason: null } : { value: null, source: null, reason };
const first = (...facts: SummaryFact[]): SummaryFact => facts.find(f => f.value != null) ?? facts[facts.length - 1];
const day = (raw: unknown): string | null => (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null);

/** Whole days from today (UTC) to a day, or null. */
function daysUntil(raw: unknown): number | null {
  const d = day(raw);
  if (!d) return null;
  const now = new Date();
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
}

/** The order's five statuses in the page's words (D6694: a filing with the registry reads packet_ready). */
export const ORDER_STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  pending_payment: 'Awaiting payment', paid: 'Order paid', packet_processing: 'Packet being prepared', packet_ready: 'Packet ready', filed: 'Filed with state',
});

/** Where "Formed on" came from, by the order's track (D6694 §7). */
export const FORMED_SOURCE = Object.freeze({
  v2: 'The registry’s registration date, from the incorporation order',
  legacy_v1: 'The filing day recorded on the incorporation order',
  company: 'The company record',
  entity: 'The entity record',
});

/**
 * BD25's summary band. `order` is the read `company()` already made (the
 * newest order past pending_payment); `steps` its formation steps.
 */
export async function entitySummary(env: Env, p: ProjectRef, order: Order, steps: Step[]) {
  try {
    // The order's own names, read here so a store without them fails this block only, not the module (BD29).
    const named = order ? await env.DB.prepare('SELECT company_name, registered_agent_name FROM incorporations WHERE id = ?')
      .bind(order.id).first<{ company_name: string | null; registered_agent_name: string | null }>() : null;
    const track = order ? await env.DB.prepare(
      `SELECT c.track FROM formation_case_orders o JOIN formation_cases c ON c.id = o.case_id
        WHERE o.incorporation_id = ? ORDER BY c.id DESC LIMIT 1`,
    ).bind(order.id).first<{ track: string }>().then(r => (r?.track === 'v2' ? 'v2' : 'legacy_v1') as 'v2' | 'legacy_v1') : null;
    const company = p.company_id == null ? null : await env.DB.prepare(
      'SELECT company_name, legal_name, jurisdiction, incorporation_date, registered_agent_name FROM company_profiles WHERE id = ?',
    ).bind(p.company_id).first<any>();
    const entity = p.entity_id == null ? null : await env.DB.prepare(
      'SELECT name, jurisdiction, incorporation_date FROM entities WHERE id = ?',
    ).bind(p.entity_id).first<any>();
    const FROM_ORDER = 'The incorporation order';
    const name = first(fact(named?.company_name, FROM_ORDER, ''), fact(company?.legal_name, FORMED_SOURCE.company, ''),
      fact(company?.company_name, FORMED_SOURCE.company, ''), fact(entity?.name, FORMED_SOURCE.entity, 'No company name is recorded.'));
    const jurisdiction = first(fact(order?.jurisdiction_id, FROM_ORDER, ''), fact(company?.jurisdiction, FORMED_SOURCE.company, ''),
      fact(entity?.jurisdiction, FORMED_SOURCE.entity, 'No jurisdiction is recorded.'));
    const agent = first(fact(named?.registered_agent_name, FROM_ORDER, ''),
      fact(company?.registered_agent_name, FORMED_SOURCE.company, 'No registered agent is recorded.'));
    const filedOn = order && order.status === 'filed' ? day(order.filed_on) : null;
    const notFormed = order ? (order.status === 'packet_ready' ? 'Not filed with the state yet: the packet is ready or with the registry.' : 'Not filed with the state yet.')
      : 'No formation date is recorded.';
    const formed = filedOn ? { value: filedOn, source: FORMED_SOURCE[track ?? 'legacy_v1'], reason: null }
      : first(fact(day(company?.incorporation_date), FORMED_SOURCE.company, ''), fact(day(entity?.incorporation_date), FORMED_SOURCE.entity, notFormed));
    const ein = steps.find(s => s.kind === 'ein') ?? null;
    const einState = ein == null ? 'not_recorded' : ein.state === 'done' ? 'issued' : 'open';
    return {
      state: 'ok' as const,
      /** BD26: nothing to summarise: no order past payment, no entity, no company. */
      has_company: order != null || entity != null || company != null,
      name, jurisdiction, registered_agent: agent, formed_on: formed,
      order: order ? {
        status: order.status, status_label: ORDER_STATUS_LABEL[order.status] ?? null, track,
        steps: [
          { key: 'paid', label: 'Order paid', date: day(order.paid_at) },
          { key: 'packet_ready', label: 'Packet ready', date: day(order.packet_ready_at) },
          { key: 'filed', label: 'Filed with state', date: filedOn },
        ],
      } : null,
      ein: {
        state: einState, label: einState === 'issued' ? 'Issued' : einState === 'open' ? 'Not issued yet' : null,
        filing_id: ein ? `step-${ein.id}` : null, due: ein ? day(ein.due_date) : null,
        reason: einState === 'not_recorded' ? 'No EIN filing is recorded.' : null,
        // No column holds the number (D6035): the letter can be stored, the number is never claimed.
        number: null, number_reason: 'The EIN number is not stored; the letter can be.',
      },
    };
  } catch (error) {
    console.error('[cycle_build] company_creation entity summary read failed', (error as Error)?.message);
    return { state: 'unreadable' as const, reason: 'The company summary could not be read. That is not the same as no company.' };
  }
}

export const ELECTION_LABEL: Readonly<Record<string, string>> = Object.freeze({
  pending: 'Pending', mailed: 'Mailed', confirmed: 'Confirmed', missed: 'Missed', filed: 'Filed · Build filing',
});
const DONE = new Set(['mailed', 'confirmed', 'filed']);

/** One 83(b) row per founder (Q1 A). `viewer` marks the viewer's own row. */
export async function electionRows(env: Env, p: ProjectRef, viewer: User, steps: Step[]) {
  try {
    const founders = (await env.DB.prepare(
      'SELECT id, name, user_id FROM cap_table_holders WHERE project_id = ? AND founder_role IS NOT NULL ORDER BY id',
    ).bind(p.id).all<{ id: number; name: string; user_id: number | null }>()).results ?? [];
    const trackers = founders.length ? (await env.DB.prepare(
      `SELECT user_id, grant_date, deadline_date, mailed_at, receipt_doc_id, status FROM section_83b_trackers
        WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(p.id).all<any>()).results ?? [] : [];
    const rows = founders.map(f => {
      const t = f.user_id == null ? null : trackers.find(x => Number(x.user_id) === Number(f.user_id)) ?? null;
      const filing = steps.find(s => s.kind === '83b' && s.for_holder_id != null && Number(s.for_holder_id) === Number(f.id)) ?? null;
      const deadline = day(t?.deadline_date) ?? day(filing?.due_date);
      const daysLeft = daysUntil(deadline);
      const stored = typeof t?.status === 'string' && Object.hasOwn(ELECTION_LABEL, t.status) ? t.status : null;
      let status = stored ?? (filing ? (filing.state === 'done' ? 'filed' : 'pending') : 'not_recorded');
      // A deadline passed with nothing mailed is Missed (BD29), whatever the stored word.
      if ((status === 'pending') && daysLeft != null && daysLeft < 0 && !t?.mailed_at) status = 'missed';
      const proofKey = filing?.proof_file_key;
      const proof = t?.receipt_doc_id != null ? 'Stored'
        : has(proofKey) ? (proofKey.startsWith('build-proof/') ? 'Stored' : 'Unreadable')
        : status === 'not_recorded' ? null
        : DONE.has(status) || status === 'missed' || (daysLeft != null && daysLeft <= 30) ? 'Missing' : 'Not expected yet';
      return {
        holder_id: f.id, name: f.name ?? null, you: f.user_id != null && Number(f.user_id) === Number(viewer.id),
        grant_date: day(t?.grant_date), deadline, days_left: daysLeft, mailed_on: day(t?.mailed_at),
        status, status_label: status === 'not_recorded' ? null : ELECTION_LABEL[status],
        proof, filing_id: filing ? `step-${filing.id}` : null, tracker: t != null,
        reason: status === 'not_recorded' ? (f.user_id == null ? 'This founder has no account, so no 83(b) tracker can be joined.' : 'No 83(b) tracker or 83(b) filing is recorded for this founder.')
          : t == null ? 'No 83(b) tracker: the grant date and mailing are not recorded.' : null,
      };
    });
    return { state: 'ok' as const, rows, done: rows.filter(r => DONE.has(r.status)).length, total: rows.length };
  } catch (error) {
    console.error('[cycle_build] company_creation 83(b) read failed', (error as Error)?.message);
    return { state: 'unreadable' as const, rows: [], done: null, total: null, reason: '83(b) trackers could not be read. Filings still read.' };
  }
}

/** The company's four named papers, for a member of the company only. */
export async function companyPapers(env: Env, p: ProjectRef, viewer: User) {
  if (p.company_id == null) return { state: 'not_linked' as const, rows: [], company_uid: null, reason: 'Link this venture to its company to keep its papers here.' };
  try {
    if (!(await viewerIsMember(env, p.company_id, viewer))) {
      return { state: 'refused' as const, rows: [], company_uid: null, reason: 'Only the company’s members can see its papers.' };
    }
    const company = await env.DB.prepare('SELECT uid FROM company_profiles WHERE id = ?').bind(p.company_id).first<{ uid: string }>();
    if (!company) return { state: 'not_linked' as const, rows: [], company_uid: null, reason: 'The linked company record was not found.' };
    const slots = await readSlots(env, p.company_id);
    const rows = slots.map(s => ({
      kind: s.kind, label: s.label,
      state: s.document == null ? 'Missing' : s.document.has_file ? 'Stored' : 'Unreadable',
      at: s.document ? day(s.document.created_at) : null,
      by: s.document?.uploaded_by?.name ?? null,
    }));
    return { state: 'ok' as const, rows, company_uid: company.uid, stored: rows.filter(r => r.state === 'Stored').length, total: rows.length };
  } catch (error) {
    console.error('[cycle_build] company_creation papers read failed', (error as Error)?.message);
    return { state: 'unreadable' as const, rows: [], company_uid: null, reason: 'Documents could not be read. Nothing here means a paper is missing.' };
  }
}
