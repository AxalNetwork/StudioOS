/**
 * D1126 (#3006) — two reads D981's parts left out: HQ's History tab, across
 * every licence, and the Download CSV behind HQ's header and the one-studio
 * header.
 *
 * HISTORY IS THE LICENCE LEDGER'S OWN RECORD. Every grant write, every answer
 * to a program request and every partner deal type change appends one
 * `program_changed` row to `licence_events` (D982 §5, D983, D986), with its
 * reason. This reads those rows for every licence at once, newest first, a
 * page at a time by id. It writes nothing and stores nothing new.
 *
 * THE CSV IS THE GRID, ONE ROW PER STUDIO AND PROGRAM. A program with no grant
 * row says "Not recorded", never "Not granted" (D981 §3); HQ only and not
 * ready to grant say so. Every term has its own column, and a term nobody set
 * is a blank cell, which is how a CSV says "not recorded" (`services/csv.ts`).
 */
import type { Env } from '../types';
import { PROGRAMS, TERM_KEYS, presentGrant, type LicenceLite } from './programGrants';
import { toCsv } from './csv';

/** Each history action, in HQ's words. An action this list does not know is shown by its key. */
export const ACTION_LABELS: Record<string, string> = {
  granted: 'Granted',
  regranted: 'Granted again',
  terms_changed: 'Terms changed',
  paused: 'Paused',
  resumed: 'Resumed',
  ended: 'Ended',
  request_approved: 'Request approved',
  request_declined: 'Request declined',
  deal_types_changed: 'Partner deal types changed',
};

export const HISTORY_PAGE_MAX = 200;
export const HISTORY_PAGE_DEFAULT = 100;

const programName = (key: string | null) => (key ? PROGRAMS.find((p) => p.key === key)?.name ?? key : null);

export type HistoryQuery = { program?: string | null; licence?: string | null; before?: number | null; limit?: number | null };

/**
 * Every licence's `program_changed` events, newest first. `before` is the id
 * the last page ended on; `next_before` is set when there is more.
 */
export async function readAllHistory(env: Env, q: HistoryQuery = {}) {
  const limit = Math.max(1, Math.min(HISTORY_PAGE_MAX, Math.floor(Number(q.limit) || HISTORY_PAGE_DEFAULT)));
  const rows = ((await env.DB.prepare(
    `SELECT e.id, e.detail_json, e.note, e.created_at, u.name AS actor_name,
            l.uid AS licence_uid, l.licence_ref, l.brand_name
       FROM licence_events e
       LEFT JOIN territory_licences l ON l.id = e.licence_id
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.event = 'program_changed'
        AND (? IS NULL OR e.id < ?)
        AND (? IS NULL OR l.uid = ?)
        AND (? IS NULL OR json_extract(e.detail_json, '$.program_key') = ?)
      ORDER BY e.id DESC LIMIT ?`,
  ).bind(q.before ?? null, q.before ?? null, q.licence ?? null, q.licence ?? null, q.program ?? null, q.program ?? null, limit + 1)
    .all<Record<string, any>>()).results || []);
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => {
      let d: Record<string, any> = {};
      try { d = r.detail_json ? JSON.parse(r.detail_json) : {}; } catch { d = {}; }
      const action = typeof d.action === 'string' ? d.action : null;
      return {
        id: r.id,
        at: r.created_at,
        action,
        action_label: action ? ACTION_LABELS[action] ?? action : 'Not recorded',
        program_key: d.program_key ?? null,
        program_name: programName(d.program_key ?? null),
        // A row whose licence is gone keeps its record and says so; it is never given another licence.
        licence: r.licence_uid ? { uid: r.licence_uid, licence_ref: r.licence_ref ?? null, brand_name: r.brand_name ?? null } : null,
        changed: Array.isArray(d.changed) ? d.changed : [],
        deal_types: action === 'deal_types_changed' ? { before: d.before ?? null, after: d.after ?? null } : null,
        request: d.request_uid ? { uid: d.request_uid, kind: d.request_kind ?? null } : null,
        reason: r.note ?? null,
        by: r.actor_name ?? null,
      };
    }),
    next_before: rows.length > limit ? page[page.length - 1].id : null,
  };
}

const STATE_WORD: Record<string, string> = { granted: 'Granted', paused: 'Paused', ended: 'Ended' };

export const EXPORT_HEADER = [
  'licence_ref', 'studio', 'licence_status', 'program', 'program_key', 'grant', 'in_force', 'waiting_on',
  'effective_end', 'schedule_signed_at', ...TERM_KEYS, 'note', 'set_at',
] as const;

/**
 * The grid as CSV rows: every licence that is not a draft or terminated (or
 * the one named), by every program in catalogue order.
 */
export async function exportRows(env: Env, today: string, licenceId?: number | null) {
  const licences = ((await env.DB.prepare(
    `SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences
      WHERE (? IS NULL AND status NOT IN ('draft', 'terminated')) OR id = ?
      ORDER BY licence_ref, id`,
  ).bind(licenceId ?? null, licenceId ?? null).all<LicenceLite>()).results || []);
  const grants = ((await env.DB.prepare(
    `SELECT * FROM program_grants WHERE (? IS NULL OR licence_id = ?) ORDER BY id`,
  ).bind(licenceId ?? null, licenceId ?? null).all<Record<string, any>>()).results || []);
  const out: unknown[][] = [];
  for (const l of licences) {
    for (const p of PROGRAMS) {
      const row = grants.find((g) => Number(g.licence_id) === l.id && g.program_key === p.key);
      const lead = [l.licence_ref, l.brand_name, l.status, p.name, p.key];
      if (!row) {
        const word = p.readiness === 'hq' ? 'HQ only' : p.readiness === 'notready' ? 'Not ready to grant' : 'Not recorded';
        out.push([...lead, word, '', '', '', '', ...TERM_KEYS.map(() => ''), '', '']);
        continue;
      }
      const g = presentGrant(row, l, today);
      out.push([
        ...lead, STATE_WORD[g.state] ?? g.state, g.in_force ? 'yes' : 'no', g.waiting_on.join(' '),
        g.effective_end, g.schedule.signed_at, ...TERM_KEYS.map((k) => g.terms[k] ?? ''), g.note, g.set_at,
      ]);
    }
  }
  return out;
}

export async function exportCsv(env: Env, today: string, licenceId?: number | null): Promise<{ body: string; rows: number }> {
  const rows = await exportRows(env, today, licenceId);
  return { body: toCsv(EXPORT_HEADER, rows), rows: rows.length };
}
