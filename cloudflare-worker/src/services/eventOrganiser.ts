/** D567: registration audience rules are independent of complimentary pricing. */
import type { Env } from '../types';
import { PERSONAS } from '../personas';

// D1031 (#2872): advisors host events, so they can be an audience too.
export const EVENT_ROLES = ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'] as const;
const COMP_KEYS = ['comp_official_partners', 'comp_invested_lps', 'comp_investors', 'comp_host_connections', 'comp_project_founders'];
export function validateRegistrationRules(value: unknown): Record<string, unknown> {
  const rules = typeof value === 'string' ? JSON.parse(value) : value;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('invalid_audience_rules');
  const r = rules as Record<string, unknown>;
  const keys = [...COMP_KEYS, 'mode', 'roles', 'personas'];
  if (Object.keys(r).some(k => !keys.includes(k))) throw new Error('invalid_audience_rules');
  for (const key of COMP_KEYS) if (key in r && typeof r[key] !== 'boolean') throw new Error('invalid_audience_rules');
  const mode = 'mode' in r ? r.mode : 'everyone';
  if (typeof mode !== 'string' || !['everyone', 'selected', 'invite_only'].includes(mode)) throw new Error('invalid_audience_rules');
  for (const [key, allowed] of [['roles', EVENT_ROLES], ['personas', PERSONAS.map(p => p.id)]] as const) {
    if (key in r && (!Array.isArray(r[key]) || (r[key] as unknown[]).some(v => typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) || new Set(r[key] as unknown[]).size !== (r[key] as unknown[]).length)) throw new Error('invalid_audience_rules');
  }
  if (mode === 'selected' && !(Array.isArray(r.roles) && r.roles.length) && !(Array.isArray(r.personas) && r.personas.length)) throw new Error('audience_selection_required');
  return { ...r, mode };
}

export async function registrationEligibility(env: Env, event: any, userId: number | null, email: string | null) {
  const rules = validateRegistrationRules(event.audience_rules_json || '{}');
  if (rules.mode === 'everyone') return { eligible: true, reason: 'Everyone may register.' };
  if (rules.mode === 'invite_only') {
    const invite = await env.DB.prepare(`SELECT id FROM event_invitations WHERE event_id = ? AND status != 'revoked' AND (invited_user_id = ? OR lower(invited_email) = lower(?)) LIMIT 1`).bind(event.id, userId, email).first();
    return { eligible: !!invite, reason: invite ? 'You have an invitation.' : 'An invitation is required.' };
  }
  if (userId === null) return { eligible: false, reason: 'Sign in with an eligible member account.' };
  const user: any = await env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(userId).first();
  if ((rules.roles as string[] | undefined)?.includes(user?.role)) return { eligible: true, reason: 'Your role is eligible.' };
  if ((rules.personas as string[] | undefined)?.length) {
    const rows = await env.DB.prepare(`SELECT persona_id FROM user_personas WHERE user_id = ?`).bind(userId).all<{ persona_id: string }>();
    if ((rows.results || []).some(p => (rules.personas as string[]).includes(p.persona_id))) return { eligible: true, reason: 'Your persona is eligible.' };
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
