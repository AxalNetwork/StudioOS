/** D567: registration audience rules are independent of complimentary pricing. */
import type { Env } from '../types';
import { PERSONAS, isAllowedPersonaOverlap, type PersonaId } from '../personas';

// D1031 (#2872): advisors host events, so they can be an audience too.
export const EVENT_ROLES = ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'] as const;
const COMP_KEYS = ['comp_official_partners', 'comp_invested_lps', 'comp_investors', 'comp_host_connections', 'comp_project_founders'];
export function validateRegistrationRules(value: unknown, segmentKeys: readonly string[] = PERSONAS.map(p => p.id)): Record<string, unknown> {
  const rules = typeof value === 'string' ? JSON.parse(value) : value;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('invalid_audience_rules');
  const r = rules as Record<string, unknown>;
  const keys = [...COMP_KEYS, 'mode', 'roles', 'personas'];
  if (Object.keys(r).some(k => !keys.includes(k))) throw new Error('invalid_audience_rules');
  for (const key of COMP_KEYS) if (key in r && typeof r[key] !== 'boolean') throw new Error('invalid_audience_rules');
  const mode = 'mode' in r ? r.mode : 'everyone';
  if (typeof mode !== 'string' || !['everyone', 'selected', 'invite_only'].includes(mode)) throw new Error('invalid_audience_rules');
  for (const [key, allowed] of [['roles', EVENT_ROLES], ['personas', segmentKeys]] as const) {
    if (key in r && (!Array.isArray(r[key]) || (r[key] as unknown[]).some(v => typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) || new Set(r[key] as unknown[]).size !== (r[key] as unknown[]).length)) throw new Error('invalid_audience_rules');
  }
  if (mode === 'selected' && !(Array.isArray(r.roles) && r.roles.length) && !(Array.isArray(r.personas) && r.personas.length)) throw new Error('audience_selection_required');
  return { ...r, mode };
}

export class AudienceSegmentsUnreadable extends Error {
  constructor() { super('Segment choices could not be read. Try again.'); }
}

/** D1128: Events accepts stored segments, including HQ-authored names/keys.
 * No segment read is needed for everyone, invite-only or a roles-only rule. */
export async function registrationRulesFromStore(env: Env, value: unknown) {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  const keys = raw && typeof raw === 'object' && Array.isArray(raw.personas) ? raw.personas : [];
  // Check shape, allowed roles, duplicate IDs and mode before reading a store.
  const shaped = validateRegistrationRules(raw, keys);
  if (!keys.length) return shaped;
  let rows;
  try {
    rows = await env.DB.prepare(`SELECT key FROM segment_profiles WHERE key IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(keys)).all<{ key: string }>();
    if (!Array.isArray(rows?.results)) throw new Error('segment choices unreadable');
  } catch { throw new AudienceSegmentsUnreadable(); }
  return validateRegistrationRules(shaped, rows.results.map(row => row.key));
}

export async function registrationEligibility(env: Env, event: any, userId: number | null, email: string | null) {
  const rules = await registrationRulesFromStore(env, event.audience_rules_json || '{}');
  if (rules.mode === 'everyone') return { eligible: true, reason: 'Everyone may register.' };
  if (rules.mode === 'invite_only') {
    const invite = await env.DB.prepare(`SELECT id FROM event_invitations WHERE event_id = ? AND status != 'revoked' AND (invited_user_id = ? OR lower(invited_email) = lower(?)) LIMIT 1`).bind(event.id, userId, email).first();
    return { eligible: !!invite, reason: invite ? 'You have an invitation.' : 'An invitation is required.' };
  }
  if (userId === null) return { eligible: false, reason: 'Sign in with an eligible member account.' };
  const user: any = await env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(userId).first();
  if ((rules.roles as string[] | undefined)?.includes(user?.role)) return { eligible: true, reason: 'Your role is eligible.' };
  if ((rules.personas as string[] | undefined)?.length) {
    const rows = await env.DB.prepare(`SELECT persona_id, is_primary FROM user_personas WHERE user_id = ?`).bind(userId).all<{ persona_id: string; is_primary: number }>();
    const held = rows.results || [];
    const primary = held.find(p => p.is_primary === 1);
    const current = held.filter(p => p.is_primary === 1 || (primary && isAllowedPersonaOverlap(primary.persona_id as PersonaId, p.persona_id as PersonaId)));
    if (current.some(p => (rules.personas as string[]).includes(p.persona_id))) return { eligible: true, reason: 'Your persona is eligible.' };
  }
  return { eligible: false, reason: 'Your role or persona is outside this event’s audience.' };
}

export function agendaLocation(body: any) {
  const out: Record<string, string | null> = {};
  for (const key of ['location_text', 'location_url']) {
    if (!(key in body)) continue;
    if (body[key] !== null && typeof body[key] !== 'string') throw new Error('invalid_location');
    const value = body[key]?.trim() || null;
    if (value && value.length > (key === 'location_url' ? 2048 : 300)) throw new Error('invalid_location');
    if (value && key === 'location_url') {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_location_url');
    }
    out[key] = value;
  }
  return out;
}
