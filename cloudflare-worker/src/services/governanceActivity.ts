/**
 * D4811 (#4811) part 5 — a governance record's Activity tab (board CT-07):
 * the record's own audit rows (`activity_logs`, written by
 * `routes/admin_governance.ts` through `logAdminAction`) as events with an
 * actor's name and a sentence. Pure: the route reads the rows, this says what
 * they mean. The rows already carry no title, file name or contents (D4563);
 * this adds nothing more than the acting admin's name.
 */

export const GOVERNANCE_ACTIONS = Object.freeze([
  'governance_document_created', 'governance_document_viewed', 'governance_document_updated', 'governance_document_status',
  'governance_version_uploaded', 'governance_file_previewed', 'governance_file_downloaded',
  'governance_relation_added', 'governance_relation_reviewed',
] as const);

const STATUS_WORDS: Record<string, string> = { draft: 'Draft', review: 'In review', approved: 'Approved', executed: 'Executed', archived: 'Archived' };
const word = (s: unknown) => (typeof s === 'string' && STATUS_WORDS[s]) || null;
const parse = (raw: unknown): Record<string, any> => {
  if (typeof raw !== 'string') return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};

/** One audit row as the tab reads it, or null when the row is not one this record wrote. */
export function eventOf(row: { action: string; details: unknown; created_at: string | null; actor_name?: string | null; user_id?: number | null }) {
  const d = parse(row.details);
  const version = Number.isSafeInteger(Number(d.version)) && Number(d.version) > 0 ? Number(d.version) : null;
  let line: string | null = null;
  switch (row.action) {
    case 'governance_document_created': line = 'Created as a draft'; break;
    case 'governance_document_viewed': line = 'Opened (confidential record)'; break;
    case 'governance_document_updated': {
      const fields = Array.isArray(d.fields) ? d.fields.filter((f: unknown) => typeof f === 'string') : [];
      line = fields.length ? `Changed ${fields.map((f: string) => f.replace(/_/g, ' ')).join(', ')}` : 'Details saved';
      break;
    }
    case 'governance_document_status':
      line = word(d.from) && word(d.status) ? `Moved from ${word(d.from)} to ${word(d.status)}` : 'Status changed';
      break;
    case 'governance_version_uploaded': line = version ? `Uploaded v${version}${d.signed ? ' as the signed copy' : ''}` : 'Uploaded a version'; break;
    case 'governance_file_previewed': line = version ? `Previewed v${version}` : 'Previewed a file'; break;
    case 'governance_file_downloaded': line = version ? `Downloaded v${version}` : 'Downloaded a file'; break;
    // D4811 part 8: links to related documents, and a dependant checked against a version.
    case 'governance_relation_added': line = d.kind === 'template' ? 'Linked a template it governs' : 'Linked a record it governs'; break;
    case 'governance_relation_reviewed': line = version != null ? `Marked a related document reviewed against v${version}` : 'Marked a related document reviewed'; break;
    default: return null;
  }
  return { action: row.action, line, at: row.created_at ?? null, actor: row.actor_name || null, version };
}
