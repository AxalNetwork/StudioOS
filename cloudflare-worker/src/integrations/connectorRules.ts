import type { ProviderDescriptor } from './registry';
import { CONNECTOR_METADATA } from './registry';

/** The granted scopes the descriptor never asked for. Scope names are public, never secrets. */
export function extraScopes(desc: ProviderDescriptor, granted: readonly string[]): string[] {
  const requested = new Set((desc.oauth_scopes || []).map((scope) => desc.key === 'carta' ? scope : scope.toLowerCase()));
  return granted.filter((scope) => !requested.has(desc.key === 'carta' ? scope : scope.toLowerCase()));
}

/** Empty granted scopes mean the provider gave no verifiable scope list. */
export function hasScopeOverreach(desc: ProviderDescriptor, granted: readonly string[]): boolean {
  const requested = new Set((desc.oauth_scopes || []).map((scope) => desc.key === 'carta' ? scope : scope.toLowerCase()));
  return granted.some((scope) => !requested.has(desc.key === 'carta' ? scope : scope.toLowerCase()));
}

export function validateConnectorSettings(
  providerKey: string,
  patch: Record<string, unknown>,
): { ok: true; settings: Record<string, unknown>; providerPatch: Record<string, unknown> } | { ok: false; error: string } {
  const providerPatch = { ...patch };
  const settings: Record<string, unknown> = {};
  if ('sync_frequency' in providerPatch) {
    if (!['live', 'hourly', 'daily', 'manual'].includes(String(providerPatch.sync_frequency))) {
      return { ok: false, error: 'invalid_sync_frequency' };
    }
    settings.sync_frequency = providerPatch.sync_frequency;
    delete providerPatch.sync_frequency;
  }
  if ('send_modes' in providerPatch) {
    const raw = providerPatch.send_modes;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_send_modes' };
    const allowed = new Set((CONNECTOR_METADATA[providerKey]?.sends || []).map((send) => send.target));
    for (const [target, mode] of Object.entries(raw)) {
      if (!allowed.has(target) || (mode !== 'auto' && mode !== 'ask')) return { ok: false, error: 'invalid_send_modes' };
    }
    settings.send_modes = raw;
    delete providerPatch.send_modes;
  }
  return { ok: true, settings, providerPatch };
}

export function scheduledSyncDue(configJson: string | null, lastSyncedAt: string | null, now = Date.now()): boolean {
  let config: Record<string, unknown> = {};
  try { config = configJson ? JSON.parse(configJson) : {}; } catch { return false; }
  const frequency = config.sync_frequency;
  if (frequency === 'manual') return false;
  if (frequency === 'live' || frequency == null) return true;
  if (frequency !== 'hourly' && frequency !== 'daily') return false;
  if (!lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt.includes('T') ? lastSyncedAt : lastSyncedAt.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(last)) return false;
  return now - last >= (frequency === 'hourly' ? 3_600_000 : 86_400_000);
}

export function automaticSendAllowed(providerKey: string, eventType: string, configJson: string | null): boolean {
  const target = providerKey === 'hubspot'
    ? (eventType === 'auto_push:project_created' ? 'HubSpot company' : 'HubSpot deal')
    : providerKey === 'salesforce'
      ? (eventType === 'auto_push:project_created' ? 'Salesforce account' : 'Salesforce deal')
      : null;
  if (!target) return false;
  const send = CONNECTOR_METADATA[providerKey]?.sends.find((item) => item.target === target);
  if (!send) return false;
  let config: Record<string, unknown> = {};
  try { config = configJson ? JSON.parse(configJson) : {}; } catch { return false; }
  const modes = config.send_modes && typeof config.send_modes === 'object' && !Array.isArray(config.send_modes)
    ? config.send_modes as Record<string, unknown> : {};
  return (modes[target] ?? send.default_mode) === 'auto';
}
