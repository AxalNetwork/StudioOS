// Task #8 (IH) — Affinity importer helpers. Minimal surface: list pipelines
// (Affinity "lists") + import a list as deals. Uses the API-key path
// (Affinity's v1 REST API authenticates via HTTP Basic with the API key as
// the password and an empty username — see https://api-docs.affinity.co/).
// Credentials are pulled from the user's existing `integrations` row for
// provider='affinity'.

import { type IntegrationRow } from '../registry';
import { decryptCredentials, type CredentialBlob } from '../secrets';
import type { Env, User } from '../../types';

const AFF_API = 'https://api.affinity.co';

interface AffinityList {
  id: number;
  name: string;
  type?: number;
}
interface AffinityStatusField {
  id: number;
  name: string;
  dropdown_options?: Array<{ id: number; text: string }>;
}
interface AffinityListEntry {
  id: number;
  list_id: number;
  entity?: { id?: number; name?: string };
  entity_type?: number;
}

async function affKey(env: Env, row: IntegrationRow): Promise<string> {
  const creds = (await decryptCredentials(env, row.uid, row.credentials_enc)) as CredentialBlob | null;
  const k = (creds?.api_key as string | undefined) || (creds?.access_token as string | undefined) || '';
  if (!k) throw new Error('affinity_no_api_key');
  return k;
}

function affAuth(key: string): string {
  return `Basic ${btoa(`:${key}`)}`;
}

// KV-style cache (in-isolate Map) of list_id → status field id so the commit
// path can look up per-entry status without re-walking /lists/{id}/fields.
const STATUS_FIELD_CACHE = new Map<string, number>();

export async function listAffinityLists(env: Env, integrationId: number): Promise<Array<{ id: string; label: string; stages: Array<{ id: string; label: string; order: number }> }>> {
  const row = await env.DB.prepare('SELECT * FROM integrations WHERE id = ? LIMIT 1').bind(integrationId).first<IntegrationRow>();
  if (!row) throw new Error('integration_not_found');
  const key = await affKey(env, row);
  const res = await fetch(`${AFF_API}/lists`, { headers: { Authorization: affAuth(key) } });
  if (!res.ok) throw new Error(`affinity_lists_failed: ${res.status}`);
  const lists = (await res.json()) as AffinityList[];
  const out: Array<{ id: string; label: string; stages: Array<{ id: string; label: string; order: number }> }> = [];
  for (const l of lists) {
    let stages: Array<{ id: string; label: string; order: number }> = [];
    try {
      const fRes = await fetch(`${AFF_API}/lists/${l.id}/fields`, { headers: { Authorization: affAuth(key) } });
      if (fRes.ok) {
        const fields = (await fRes.json()) as AffinityStatusField[];
        const status = fields.find(f => /status|stage/i.test(f.name || ''));
        if (status) {
          STATUS_FIELD_CACHE.set(String(l.id), status.id);
          if (status.dropdown_options) {
            // Stage id is the dropdown_option id — the wizard sends back
            // stageMap keyed by THIS id, and the commit path looks up the
            // same id from each entry's field-value below.
            stages = status.dropdown_options.map((o, i) => ({ id: String(o.id), label: o.text, order: i }));
          }
        }
      }
    } catch { /* non-fatal */ }
    out.push({ id: String(l.id), label: l.name, stages });
  }
  return out;
}

async function resolveStatusFieldId(key: string, listId: string): Promise<number | null> {
  const cached = STATUS_FIELD_CACHE.get(listId);
  if (cached) return cached;
  try {
    const fRes = await fetch(`${AFF_API}/lists/${listId}/fields`, { headers: { Authorization: affAuth(key) } });
    if (!fRes.ok) return null;
    const fields = (await fRes.json()) as AffinityStatusField[];
    const status = fields.find(f => /status|stage/i.test(f.name || ''));
    if (status) {
      STATUS_FIELD_CACHE.set(listId, status.id);
      return status.id;
    }
  } catch { /* non-fatal */ }
  return null;
}

export async function importAffinityList(
  env: Env,
  _user: User,
  integrationId: number,
  listId: string,
  stageMap: Record<string, string>,
): Promise<{ counts: { imported: number; errors: number } }> {
  const row = await env.DB.prepare('SELECT * FROM integrations WHERE id = ? LIMIT 1').bind(integrationId).first<IntegrationRow>();
  if (!row) throw new Error('integration_not_found');
  const key = await affKey(env, row);
  const statusFieldId = await resolveStatusFieldId(key, listId);
  let imported = 0;
  let errors = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = `${AFF_API}/lists/${encodeURIComponent(listId)}/list-entries${pageToken ? `?page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: affAuth(key) } });
    if (!res.ok) { errors++; break; }
    const out = (await res.json()) as { list_entries?: AffinityListEntry[]; next_page_token?: string } | AffinityListEntry[];
    const entries: AffinityListEntry[] = Array.isArray(out) ? out : (out.list_entries || []);
    for (const e of entries) {
      try {
        const externalId = `affinity:${e.id}`;
        // Resolve this entry's status-option id (best-effort) and map via
        // the wizard's stageMap. Falls back to 'applied' when the list has
        // no status field, the field is unset on this entry, or the user
        // did not map that option in the wizard.
        let mapped = 'applied';
        if (statusFieldId) {
          try {
            const fvRes = await fetch(
              `${AFF_API}/field-values?list_entry_id=${encodeURIComponent(String(e.id))}`,
              { headers: { Authorization: affAuth(key) } },
            );
            if (fvRes.ok) {
              const fvs = (await fvRes.json()) as Array<{ field_id: number; value: unknown }>;
              const hit = fvs.find(v => v.field_id === statusFieldId);
              const optId = hit && typeof hit.value === 'object' && hit.value !== null
                ? (hit.value as { id?: number | string }).id
                : (hit?.value as number | string | undefined);
              if (optId !== undefined && optId !== null) {
                const m = stageMap[String(optId)];
                if (m) mapped = m;
              }
            }
          } catch { /* non-fatal — keep default */ }
        }
        const existing = await env.DB.prepare(
          'SELECT id FROM deals WHERE hubspot_deal_id = ? LIMIT 1',
        ).bind(externalId).first<{ id: number }>();
        if (existing) {
          await env.DB.prepare(
            'UPDATE deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ).bind(mapped, existing.id).run();
        } else {
          // deals.project_id is NOT NULL — find-or-create a placeholder
          // project per Affinity entry (keyed by entity name).
          const { ensureProjectForImport } = await import('../../routes/imports');
          const projectId = await ensureProjectForImport(env, _user, e.entity?.name || `Affinity entry ${e.id}`, 'affinity');
          if (!projectId) { errors++; continue; }
          await env.DB.prepare(
            `INSERT INTO deals (project_id, hubspot_deal_id, status, created_at, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          ).bind(projectId, externalId, mapped).run();
        }
        imported++;
      } catch { errors++; }
    }
    pageToken = (!Array.isArray(out) && out.next_page_token) ? out.next_page_token : undefined;
    if (!pageToken) break;
  }
  return { counts: { imported, errors } };
}
