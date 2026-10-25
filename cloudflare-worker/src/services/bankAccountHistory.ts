/** D1182: masked history from the reveal ledger and the existing audit store. */
import type { Env } from '../types';

export class BankHistoryError extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status=status; this.code=code; }
}
const invalid = (): never => { throw new BankHistoryError(400, 'history_filter_invalid'); };
export function bankHistoryText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  // Reasons and labels are free text. Never echo an account/routing number
  // accidentally pasted into them, including space/hyphen-separated digits.
  return value.trim().replace(/[0-9](?:[^\p{L}\p{N}]*[0-9]){3,}/gu, '[redacted]');
}
function historyTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const iso=value.replace(' ','T');
  const ms=Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)?iso:iso+'Z');
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
const integer = (value: string | undefined, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  if (!/^\d{1,10}$/.test(value)) return invalid();
  const n = Number(value); return n > 0 && n <= max ? n : invalid();
};
function date(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const ms = Date.parse(value+'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== value) return invalid();
  return value;
}
export function historyFilters(query: Record<string, string>) {
  const kind = query.kind || null, entity = query.entity || null;
  if (kind && !['reveal','bank_account','mercury'].includes(kind)) return invalid();
  if (entity && !['holdings','management','gp','fund'].includes(entity)) return invalid();
  const rawActor = query.actor?.replace(/^actor:/,'');
  const actor = rawActor === undefined ? null : integer(rawActor, 0, Number.MAX_SAFE_INTEGER);
  const q = query.q?.trim() || null; if (q && q.length > 120) return invalid();
  const range = query.range || 'all'; if (!['all','7d','30d','90d'].includes(range)) return invalid();
  let from = date(query.from); const to = date(query.to);
  if (range !== 'all' && (from || to)) return invalid();
  if (from && to && from > to) return invalid();
  const until = to ? new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString() : null;
  if (until && !/^\d{4}-/.test(until)) return invalid();
  const page = integer(query.page,1,1_000_000), per = integer(query.per,25,100);
  let snapshot: [number,number,number] | null = null;
  if (query.snapshot !== undefined) {
    if (!/^\d{1,16}\.\d{1,16}\.\d{1,16}$/.test(query.snapshot)) return invalid();
    const parts = query.snapshot.split('.').map(Number);
    if (parts.some(n=>!Number.isSafeInteger(n)) || !Number.isFinite(new Date(parts[2]).getTime())) return invalid();
    snapshot = parts as [number,number,number];
  }
  const asOf = snapshot?.[2] ?? Date.now();
  if (range !== 'all') from = new Date(asOf-Number(range.slice(0,-1))*86400000).toISOString();
  return {kind,entity,actor,q,from,until,page,per,snapshot,asOf};
}

export async function bankAccountHistory(env: Env, f: ReturnType<typeof historyFilters>) {
  try {
    const caps = f.snapshot || await env.DB.prepare(
      `SELECT (SELECT COALESCE(MAX(id),0) FROM entity_bank_account_reveals) AS reveals,
              (SELECT COALESCE(MAX(id),0) FROM admin_audit_log) AS audits`,
    ).bind().first<{reveals:number;audits:number}>().then(row=>{
      if (!row) throw new Error('history_unreadable');
      return [row.reveals,row.audits,f.asOf] as [number,number,number];
    });
    if (!caps) throw new Error('history_unreadable');
    const malformed = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit_log
        WHERE id <= ? AND (substr(action,1,13) = 'bank_account_' OR action IN ('mercury_connected','mercury_token_replaced','mercury_disconnected'))
          AND filters_json IS NOT NULL
          AND CASE WHEN json_valid(filters_json) THEN json_type(filters_json) <> 'object' ELSE 1 END`,
    ).bind(caps[1]).first<{n:number}>();
    if (!malformed || malformed.n) throw new Error('history_unreadable');
    const result = await env.DB.prepare(
      `WITH history AS (
         SELECT 'reveal' AS kind, 'bank_account_revealed' AS action, 'reveal' AS source, r.id AS source_id,
                r.created_at AS at, r.actor_user_id AS actor_id, u.name AS actor_name,
                b.entity_key, b.uid AS account_uid, b.label AS account_label, b.account_last4,
                r.context, r.context_ref
           FROM entity_bank_account_reveals r LEFT JOIN entity_bank_accounts b ON b.id = r.account_id
           LEFT JOIN users u ON u.id = r.actor_user_id WHERE r.id <= ?
         UNION ALL
         SELECT CASE WHEN substr(a.action,1,13) = 'bank_account_' THEN 'bank_account' ELSE 'mercury' END,
                a.action, 'audit', a.id, a.exported_at, a.admin_user_id, u.name,
                COALESCE(b.entity_key, CASE WHEN json_extract(CASE WHEN json_valid(a.filters_json) THEN a.filters_json ELSE '{}' END,'$.entity_key') IN ('holdings','management','gp','fund') THEN json_extract(CASE WHEN json_valid(a.filters_json) THEN a.filters_json ELSE '{}' END,'$.entity_key') END),
                b.uid, b.label, b.account_last4, NULL, NULL
           FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
           LEFT JOIN entity_bank_accounts b ON b.uid = json_extract(CASE WHEN json_valid(a.filters_json) THEN a.filters_json ELSE '{}' END,'$.account_uid')
          WHERE a.id <= ? AND (substr(a.action,1,13) = 'bank_account_' OR a.action IN ('mercury_connected','mercury_token_replaced','mercury_disconnected'))
       ), filtered AS (
         SELECT * FROM history
          WHERE (? IS NULL OR kind = ?) AND (? IS NULL OR entity_key = ?) AND (? IS NULL OR actor_id = ?)
            AND (? IS NULL OR datetime(at) >= datetime(?)) AND (? IS NULL OR datetime(at) < datetime(?))
            AND (? IS NULL OR instr(lower(COALESCE(actor_name,'') || ' ' || COALESCE(account_label,'') || ' ' || COALESCE(account_last4,'') || ' ' || COALESCE(entity_key,'') || ' ' || action || ' ' || COALESCE(context,'')), lower(?)) > 0)
       ), page AS (
         SELECT * FROM filtered ORDER BY julianday(at) DESC, source DESC, source_id DESC LIMIT ? OFFSET ?
       ) SELECT (SELECT COUNT(*) FROM filtered) AS total,
         (SELECT json_group_array(json_object('source',source,'source_id',source_id,'kind',kind,'action',action,'time',at,'actor_id',actor_id,'actor_name',actor_name,
           'entity_key',entity_key,'account_uid',account_uid,'account_label',account_label,'account_last4',account_last4,'context',context,'context_ref',context_ref)) FROM page) AS rows`,
    ).bind(caps[0],caps[1],f.kind,f.kind,f.entity,f.entity,f.actor,f.actor,f.from,f.from,f.until,f.until,f.q,f.q,f.per,(f.page-1)*f.per).first<{total:number;rows:string}>();
    if (!result || !Number.isSafeInteger(result.total)) throw new Error('history_unreadable');
    const rows = JSON.parse(result.rows);
    if (!Array.isArray(rows)) throw new Error('history_unreadable');
    return {rows: rows.map(row=>({
      id: `${row.source}:${row.source_id}`, source: row.source === 'reveal' ? 'reveal_ledger' : 'admin_audit', kind: row.kind, action: row.action,
      time: historyTime(row.time), actor_ref: row.actor_id ? `actor:${row.actor_id}` : null,
      actor_name: bankHistoryText(row.actor_name), entity_key: row.entity_key,
      account_uid: row.account_uid, account_label: bankHistoryText(row.account_label),
      account_masked: /^\d{4}$/.test(row.account_last4 || '') ? '••••'+row.account_last4 : null,
      context: row.context, context_ref: row.context === 'capital_call_line' && /^[1-9]\d{0,15}$/.test(row.context_ref || '') && Number.isSafeInteger(Number(row.context_ref)) ? row.context_ref : bankHistoryText(row.context_ref),
    })), total: result.total, page:f.page, per:f.per, snapshot: caps.join('.')};
  } catch { throw new BankHistoryError(503, 'history_unreadable'); }
}
