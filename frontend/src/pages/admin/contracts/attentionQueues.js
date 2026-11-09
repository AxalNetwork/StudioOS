/**
 * D4811 (#4811) part 11 — the short work queues under the metric strip (board
 * CT-01: "Stalled and awaiting signature", "Data repair required", "Legal
 * review required") and the repair each agreement row offers (CT-02). Pure:
 * `AttentionQueues.jsx` reads and draws, this file says what a row means.
 * A send that was never recorded has no age, never 0 days.
 */
import { agreementRowSemantics, canLinkCompany, governanceLifecycle, hasExecutionEvidence, templateLifecycle, templateOverlays } from '../../../lib/contractLifecycle';

export const STALLED_DAYS = 30; // the Worker's `STALLED_DAYS` (services/contractAttention.ts)
export const QUEUE_ROWS = 3;
const DAY = 86_400_000;

const time = (v) => {
  if (v == null || v === '') return null;
  const raw = String(v);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
  return Number.isNaN(t) ? null : t;
};

/** Whole days since the recorded send, or null when the send was never recorded. */
export function sentAge(row, now = Date.now()) {
  const t = time(row?.sent_at);
  return t == null ? null : Math.max(0, Math.floor((now - t) / DAY));
}

/** Who an agreement is with, as one line: the company (or why there is none), then the recipient. */
export function partyLine(row) {
  const m = agreementRowSemantics(row);
  const company = m.company.name || m.company.label;
  const who = row?.recipient_name || row?.recipient_email || null;
  return [company, who].filter(Boolean).join(' · ');
}

/** One row of the stalled queue: its state line, its age and whether it is stalled. */
export function stalledItem(row, now = Date.now()) {
  const age = sentAge(row, now);
  const line = agreementRowSemantics(row).line;
  return { uid: row.uid, title: row.title, party: partyLine(row), line, age, stalled: age != null && age > STALLED_DAYS };
}

/**
 * The repair a row needs, or null. A contradiction (marked signed with no
 * execution evidence) comes first; then an unlinked recipient in a store that
 * can be linked. `action.kind` is 'link' (the Link dialog) or 'open' (the
 * record's panel: no route attaches evidence to an agreement yet).
 */
export function repairOf(row) {
  if (row?.status === 'signed' && !hasExecutionEvidence(row)) {
    return { kind: 'evidence', problem: 'Marked signed · no execution evidence', action: { kind: 'open', label: 'Open the record' } };
  }
  if (canLinkCompany(row) && row?.status !== 'void' && row?.status !== 'draft' && !row?.project_name) {
    return { kind: 'unlinked', problem: 'Recipient not linked to a company', action: { kind: 'link', label: '⚭ Link recipient' } };
  }
  return null;
}

/**
 * The legal-review queue: templates under review, restricted or incomplete, and
 * governance records in review (HQ only; `governance` null when not read).
 * Each item: `{ key, type, title, context, badge, overlays, to }`.
 */
export function reviewItems(templates, governance) {
  const out = [];
  for (const t of templates || []) {
    const o = templateOverlays(t);
    const badge = templateLifecycle(t);
    if (!(o.restricted || o.incomplete || badge?.key === 'under_review')) continue;
    out.push({ key: `template:${t.slug}`, type: 'template', title: t.title || t.slug,
      context: [t.layer_label, Number.isInteger(t.version) ? `v${t.version}` : null].filter(Boolean).join(' · ') || null,
      badge, overlays: [o.restricted && 'restricted', o.incomplete && 'incomplete'].filter(Boolean),
      to: `/admin/contracts?tab=templates&open=${encodeURIComponent(t.slug)}` });
  }
  for (const e of governance?.entities || []) {
    for (const d of e.documents || []) {
      if (d.status !== 'review') continue;
      out.push({ key: `governance:${d.uid}`, type: 'governance', title: d.title,
        context: [e.name, d.latest?.version != null ? `v${d.latest.version}` : null].filter(Boolean).join(' · ') || null,
        badge: governanceLifecycle(d.status), overlays: [], to: `/admin/contracts/governance/doc/${encodeURIComponent(d.uid)}` });
    }
  }
  return out;
}
