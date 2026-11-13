/** D592: proposed activity-evidence blend. Activation belongs to the owner. */
import type { Env } from '../types';
import { ENGINE_VERSION, PROFILE_EVIDENCE_BLEND_WEIGHT } from './archetypeScoring';

export const PROFILE_EVIDENCE_BLEND_KEY = 'profile_evidence_blend_enabled';
export const EVIDENCE_LEVEL_FULL_WEIGHT = 3;

/** An activity-coverage index, not an independently assessed proficiency. */
export function evidenceLevel(weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.min(5, 5 * weight / EVIDENCE_LEVEL_FULL_WEIGHT);
}

/** No rating stays null; no usable evidence never lowers a rating. */
export function blendedSkillLevel(self: number | null, weight: number, enabled = false): number | null {
  if (!enabled || self === null || !Number.isFinite(weight) || weight <= 0) return self;
  const delta = Math.max(-1, Math.min(1, evidenceLevel(weight) - self));
  return Math.max(0, Math.min(5, self + delta * PROFILE_EVIDENCE_BLEND_WEIGHT));
}

/** Off preserves the existing snapshot version byte for byte. */
export function profileEngineVersion(enabled: boolean): string {
  return enabled ? `${ENGINE_VERSION}+evidence-blend-v1:w=${PROFILE_EVIDENCE_BLEND_WEIGHT}` : ENGINE_VERSION;
}

export async function evidenceBlendEnabled(env: Env): Promise<boolean> {
  let row: { value: string } | null;
  try {
    row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?')
      .bind(PROFILE_EVIDENCE_BLEND_KEY).first<{ value: string }>();
  } catch (error) {
    // Compatibility with pre-241 databases: no setting can have been enabled.
    // A timeout or any other failure remains unreadable, never silently off.
    if (/no such table: (?:main\.)?platform_settings\b/i.test((error as Error).message)) return false;
    throw error;
  }
  if (!row) return false;
  if (row.value !== '0' && row.value !== '1') throw new Error('Invalid profile evidence blend setting');
  return row.value === '1';
}
