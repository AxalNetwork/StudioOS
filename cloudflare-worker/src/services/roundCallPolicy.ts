// D653: pure policies shared by the Worker and mutation tests.
export type RoundCallTerms = {
  name: string; amount_cents: number; instrument: string; terms: string;
  minimum_cheque_cents: number; target_close: string;
  deck_id: number | null; deck_version: number | null; deck_content_hash?: string | null;
  data_room_project_uid: string | null; stage: string | null; sector: string | null;
};
export function roundCallsEnabled(env: { ROUND_CALLS_ENABLED?: string }): boolean {
  return env.ROUND_CALLS_ENABLED === 'true';
}
export function verifiedInvestor(user: { role: string; is_active: number | boolean; kyc_status?: string | null }): boolean {
  return user.role === 'investor' && Number(user.is_active) === 1 && user.kyc_status === 'approved';
}
export function positiveCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function validClose(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function writableCall(call: { state: string; target_close: string }, today: string): boolean {
  return call.state === 'sent' && call.target_close >= today;
}
export function counselApproved(call: { terms_hash: string; counsel_approved_hash: string | null; counsel_approved_by?: number | null; counsel_approved_at?: string | null; counsel_approval_reference?: string | null }): boolean {
  return !!call.counsel_approved_by && !!call.counsel_approved_at && !!call.counsel_approval_reference
    && call.counsel_approved_hash === call.terms_hash;
}
export async function termsHash(t: RoundCallTerms): Promise<string> {
  const canonical = JSON.stringify([t.name, t.amount_cents, t.instrument, t.terms,
    t.minimum_cheque_cents, t.target_close, t.deck_id, t.deck_version,
    t.data_room_project_uid, t.stage, t.sector, t.deck_content_hash ?? null]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
/** Hash the stored bytes: deck editors may update slides without changing version. */
export async function deckContentHash(slides: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(slides));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export function readiness(call: RoundCallTerms, project: { use_of_funds?: string | null; traction_summary?: string | null; revenue?: number | null; mrr?: number | null; users_count?: number | null }) {
  return [
    { key: 'round', label: 'Round target', ready: positiveCents(call.amount_cents) },
    { key: 'terms', label: 'Round terms', ready: !!call.terms.trim() },
    { key: 'deck', label: 'Pitch deck version', ready: call.deck_id != null && call.deck_version != null },
    { key: 'data_room', label: 'Data room', ready: call.data_room_project_uid != null },
    { key: 'use_of_funds', label: 'Use of funds', ready: !!project.use_of_funds?.trim() },
    { key: 'traction', label: 'Traction', ready: !!project.traction_summary?.trim() || [project.revenue, project.mrr, project.users_count].some(value => value != null) },
    { key: 'close', label: 'Target close', ready: validClose(call.target_close) },
  ];
}
function list(value: string | null | undefined): string[] {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').map(item => item.trim().toLowerCase()) : []; }
  catch { return []; }
}
export type InvestorThesis = {
  sectors_json: string; stages_json: string; thesis_keywords_json: string;
  ticket_min_usd: number | null; ticket_max_usd: number | null;
  anti_thesis_sectors_json?: string; anti_thesis_stages_json?: string;
};
export function matchReasons(call: RoundCallTerms, profile: InvestorThesis, projectText: string): string[] {
  const sector = call.sector?.trim().toLowerCase();
  const stage = call.stage?.trim().toLowerCase();
  if (!sector || !stage || !list(profile.sectors_json).includes(sector)
    || !list(profile.stages_json).includes(stage)
    || list(profile.anti_thesis_sectors_json).includes(sector)
    || list(profile.anti_thesis_stages_json).includes(stage)) return [];
  const minimum = call.minimum_cheque_cents / 100;
  if (profile.ticket_min_usd == null || profile.ticket_max_usd == null
    || call.amount_cents / 100 < profile.ticket_min_usd || minimum > profile.ticket_max_usd) return [];
  const words = new Set((projectText.toLowerCase().match(/[a-z0-9]{3,}/g) || []));
  if (!list(profile.thesis_keywords_json).some(word => words.has(word))) return [];
  return ['Stage fits ' + call.stage, 'Sector fits ' + call.sector, 'Cheque range fits', 'Recorded thesis fits the venture'];
}
export function founderRecipient(row: { origin: string; responded_at: string | null; name: string; email: string; investor_user_id: number; opened_at: string | null; data_room_requested_at: string | null; commitment_cents: number | null; delivery_state: string; match_reasons_json: string }) {
  const visible = row.origin === 'chosen' || row.responded_at != null;
  return {
    origin: row.origin, ...(visible ? { investor_user_id: row.investor_user_id, name: row.name, email: row.email } : {}),
    opened_at: row.opened_at, data_room_requested_at: row.data_room_requested_at,
    commitment_cents: row.commitment_cents, responded_at: row.responded_at,
    delivery_state: row.delivery_state, reasons: list(row.match_reasons_json),
  };
}
