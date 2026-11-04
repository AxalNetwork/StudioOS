/** D4488 (#4488): Distribution proposal labels, honest receipts and the exact safe-bulk rule. */
export const DISTRIBUTION_OPTION = 'draft:distribution';
export const SAFE_KINDS = Object.freeze(['post', 'subject_line', 'newsletter']);
export const SOURCE_CHOICES = Object.freeze([{ key: 'validate', label: 'Validate · ICP' }, { key: 'research', label: 'Customer research · quotes with consent' }, { key: 'distribution', label: 'Distribution' }]);
export const OUT_OF_TOKENS = 'The included AI allowance and top-up balance cannot cover this run.';
export const WAITING_OUT = 'You are out of AI tokens. New proposals pause; the ones below stay. Add tokens to draft more.';
export const ACCEPT_LINE = 'Accept places text in the form. Nothing is saved until you create or save the campaign.';
const LABELS = { post: 'Post', subject_line: 'Subject line', newsletter: 'Newsletter section', outreach_email: 'Email', reply: 'Reply', ad_creative: 'Ad creative', campaign_fields: 'Campaign fields' };
const money = (n) => (n / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
export function holdLine(estimate) { return Number.isSafeInteger(estimate?.hold_microusd) && estimate.hold_microusd >= 0 ? `Holds up to $${money(estimate.hold_microusd)} · you pay what it uses` : 'Hold not recorded'; }
export function receiptLine(receipt) { return Number.isSafeInteger(receipt?.charged_microusd) && Number.isSafeInteger(receipt?.held_microusd) ? `Charged $${money(receipt.charged_microusd)} of $${money(receipt.held_microusd)} held` : 'Charge not recorded'; }
export function proposalLabel(p) { const v = p.decided_payload ?? p.payload ?? {}; return `${LABELS[v.kind] ?? 'Text proposal'}${v.placement ? ` · ${v.placement.replaceAll('_', ' ')}` : ''}${v.creative_field ? ` · ${v.creative_field}` : ''}`; }
export function listedRows(rows) { return Array.isArray(rows) ? rows.filter(p => p?.status === 'proposed' && p.rail_option === DISTRIBUTION_OPTION) : []; }
export function safeProposal(p) {
  const v = p?.payload;
  return p?.status === 'proposed' && p.rail_option === DISTRIBUTION_OPTION && v?.version === 1 && SAFE_KINDS.includes(v.kind) && typeof v.text === 'string' && v.text.trim().length > 0 && [...v.text].length <= 2000 && Object.keys(v).every(k => ['version','project','campaign_uid','target','kind','channel_uid','text','sources'].includes(k));
}
export function waitingModel(rows) { const listed = listedRows(rows); return { rows: listed, count: listed.length, safe: listed.filter(safeProposal) }; }
export function notifyDistribution(project) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('distribution-proposals-changed', { detail: { project } })); }
