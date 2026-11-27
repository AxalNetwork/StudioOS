/**
 * D9197 (#9197) — small account-owned reads piggybacked on /api/auth/me.
 * Each field can fail independently so a partial store never blocks sign-in.
 */
import type { Env } from '../types';
import { getUserSettings } from './userSettings';

async function preferences(env: Env, userId: number) {
  const row = await getUserSettings(env, userId);
  let dismissed: unknown;
  try { dismissed = JSON.parse(row.dismissed_explainers || '[]'); } catch { dismissed = []; }
  return {
    theme: row.theme,
    dismissed: Array.isArray(dismissed) ? dismissed.filter((item): item is string => typeof item === 'string') : [],
  };
}

async function onboarding(env: Env, userId: number, role: string) {
  const row = await env.DB.prepare('SELECT flow, completed_at FROM onboarding_progress WHERE user_id = ?')
    .bind(userId).first<{ flow: string; completed_at: string | null }>();
  if (!row || (role === 'admin' && row.flow === 'chat' && !row.completed_at)) {
    return { flow: null, completed_at: null };
  }
  return { flow: row.flow, completed_at: row.completed_at };
}

async function persona(env: Env, userId: number) {
  const row = await env.DB.prepare(
    'SELECT persona_id FROM user_personas WHERE user_id = ? ORDER BY is_primary DESC, updated_at DESC LIMIT 1',
  ).bind(userId).first<{ persona_id: string }>();
  return { primary: row?.persona_id ?? null };
}

export async function memberShell(env: Env, userId: number, role: string) {
  const [settings, progress, personaChoice] = await Promise.all([
    preferences(env, userId).catch(() => null),
    onboarding(env, userId, role).catch(() => null),
    persona(env, userId).catch(() => null),
  ]);
  return { settings, progress, persona: personaChoice };
}
