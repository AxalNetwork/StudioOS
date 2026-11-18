/**
 * D6016 (#6016, V8): one hypothesis with its evidence, from the record read `services/records/validate.ts` already
 * sends. Nothing here fetches and nothing is invented: a value the read does not send is said to be missing.
 *
 * - The computed evidence state and the founder's decision are drawn apart. The state is the read's status pill, in
 *   the methodology's words (`METHOD_BY_CLAIM_WORD`), and labelled as computed from linked evidence, not proof. The
 *   record read sends no decision for a hypothesis, so the page names where decisions are recorded (Verdict) and
 *   offers the record's own Record a decision; it never shows a decision it has not read.
 * - The Evidence section is split into Supporting and Contradictory, each with its count and a glyph beside the word.
 *   The Worker tones a contradicting row `bad` and every other row a supporting tone; that is the split's key.
 * - Everything else (facts, Experiments, Pain themes, What would prove this wrong, activity, every action) is the
 *   record as read, so add evidence, unlink, edit, retire, record a decision and Lovable keep working.
 */
import { METHOD_BY_CLAIM_WORD } from './adapters/validate.js';

const STATUS_WORDS = new Set(Object.keys(METHOD_BY_CLAIM_WORD));
const pillText = (p) => (typeof p === 'string' ? p : p?.text ?? '');

export function hypothesisRecordView(record) {
  if (!record || typeof record !== 'object') return { record, standing: null };
  const pills = Array.isArray(record.pills) ? record.pills : [];
  const statusPill = pills.find((p) => STATUS_WORDS.has(pillText(p)));
  const retired = pills.some((p) => pillText(p) === 'Retired');
  const decision = (Array.isArray(record.actions) ? record.actions : []).find((a) => a?.key === 'record-decision') ?? null;
  const standing = {
    state: retired ? { text: 'Retired', tone: 'grey' }
      : statusPill ? { text: METHOD_BY_CLAIM_WORD[pillText(statusPill)], tone: typeof statusPill === 'object' ? statusPill.tone : undefined } : null,
    decision: decision?.href ? { label: decision.label || 'Record a decision', href: decision.href } : null,
  };
  const main = Array.isArray(record.main) ? record.main : [];
  const out = [];
  for (const section of main) {
    if (section?.key !== 'evidence') { out.push(section); continue; }
    const rows = Array.isArray(section.rows) ? section.rows : [];
    if (!rows.length) { out.push(section); continue; }
    const against = rows.filter((r) => r?.tone === 'bad');
    const forRows = rows.filter((r) => r?.tone !== 'bad');
    out.push({ ...section, key: 'evidence-supporting', title: `↑ Supporting · ${forRows.length}`, rows: forRows, empty: 'No supporting evidence linked yet.' });
    out.push({ ...section, key: 'evidence-contradicting', title: `↓ Contradictory · ${against.length}`, rows: against, action: undefined, empty: 'No contradicting evidence linked yet.' });
  }
  return { record: { ...record, pills: pills.filter((p) => p !== statusPill), main: out }, standing };
}
