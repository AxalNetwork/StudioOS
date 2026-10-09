/**
 * D652 — connectors inside an Eadwyn conversation (#1464, part of D649).
 *
 * Three rules live here, each as a pure function the route calls rather than
 * re-deriving:
 *
 *   1. READ GATE. A run reads a connector only if the conversation switched it
 *      on AND the member's connection to it is active. `readableConnectors`
 *      is the only place that list is made; the route never walks
 *      `conversation.connectors` itself.
 *   2. NO WRITE INSIDE A RUN. A write Eadwyn would make is returned as a
 *      proposal, validated by `validateSend` and stored as a pending action.
 *      Nothing in this file, and nothing in the ask handler, calls a
 *      provider's `push`. Only the member's confirm does.
 *   3. THE PAYLOAD SHOWN IS THE PAYLOAD SENT. `canonicalPayload` fixes the
 *      bytes once, `payloadHash` seals them, and confirm re-hashes the stored
 *      bytes before it sends them. The request body of confirm is never read.
 */
import type { Env, User } from '../types';
import type { IntegrationRow } from '../integrations/registry';
import { getDescriptor } from '../integrations/registry';

/** A connector key exactly as the registry spells it. */
export const CONNECTOR_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** At most this many switches on in one conversation. */
export const MAX_ENABLED = 12;

/** A pending action that old can no longer be sent. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The switches a conversation stores: known registry keys only, each once,
 * sorted so two equal sets compare equal. Anything else is dropped rather
 * than refused, because the rail sends the whole set on every change.
 */
export function normaliseConnectorKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const k of raw) {
    const key = typeof k === 'string' ? k.trim().toLowerCase() : '';
    if (!CONNECTOR_KEY_RE.test(key)) continue;
    if (!getDescriptor(key)) continue;
    out.add(key);
  }
  return [...out].sort().slice(0, MAX_ENABLED);
}

export function parseConnectorKeys(json: string | null | undefined): string[] {
  try {
    return normaliseConnectorKeys(JSON.parse(json || '[]'));
  } catch {
    return [];
  }
}

/** Why a connection cannot be used right now, in the member's words; '' when it can. */
export function attentionReason(row: Pick<IntegrationRow, 'status' | 'last_error'>): string {
  const status = String(row.status || '').toLowerCase();
  if (status === 'active') return '';
  if (status === 'error') {
    const err = String(row.last_error || '').toLowerCase();
    if (/expired|invalid_grant|unauthori[sz]ed|401|revoked/.test(err)) return 'Sign-in expired';
    return 'Needs attention';
  }
  if (status === 'pending') return 'Not finished connecting';
  return 'Disconnected';
}

/**
 * RULE 1. The connections a run may read: switched on in this conversation
 * AND active. A key that is on but not connected, or connected but not on,
 * is not in the answer. Order follows the switches.
 */
export function readableConnectors<R extends Pick<IntegrationRow, 'provider_key' | 'status' | 'last_error'>>(
  enabledKeys: readonly string[],
  connections: readonly R[],
): R[] {
  const byKey = new Map<string, R>();
  for (const row of connections) {
    if (attentionReason(row) !== '') continue;
    if (!byKey.has(row.provider_key)) byKey.set(row.provider_key, row);
  }
  const out: R[] = [];
  for (const key of enabledKeys) {
    const row = byKey.get(key);
    if (row) out.push(row);
  }
  return out;
}

/** What one read gives the run. `as_of` is when the data was last fetched. */
export interface ConnectorRead {
  facts: string[];
  as_of: string | null;
}

export type ConnectorReader = (
  env: Env,
  user: User,
  row: IntegrationRow,
  companyId: number | null,
) => Promise<ConnectorRead>;

/**
 * The read-only functions a run can call, one per provider. Empty until the
 * company scope of #1462 (D650) is on main: a read must only see the active
 * company's data, and a connection does not yet say which company it serves.
 * The gate above, the source line and the receipt work today; a provider
 * joins this map when its read can honour that scope.
 */
export const CONNECTOR_READERS: Record<string, ConnectorReader> = {};

/** A source line under an answer: "From Stripe · [12 min ago]". */
export interface ConnectorSource {
  key: string;
  name: string;
  as_of: string | null;
}

export function sourceFor(key: string, asOf: string | null): ConnectorSource {
  return { key, name: getDescriptor(key)?.display_name || key, as_of: asOf };
}

/**
 * The writes a run may PROPOSE, per provider: the push payload keys the
 * provider's existing `push` accepts and what each one targets. A proposal
 * outside this table is dropped, so the model cannot invent a target.
 */
export const SEND_TARGETS: Record<string, { field: 'project_id' | 'deal_id'; label: string }[]> = {
  hubspot: [
    { field: 'project_id', label: 'Company' },
    { field: 'deal_id', label: 'Deal' },
  ],
  salesforce: [
    { field: 'project_id', label: 'Account' },
    { field: 'deal_id', label: 'Opportunity' },
  ],
};

export interface SendProposal {
  connector: string;
  field: 'project_id' | 'deal_id';
  target_id: number;
  summary: string;
}

/**
 * RULE 2, the shape half. A proposal is kept only if its connector is
 * readable in this run (switched on and active), the provider can push, and
 * its payload names exactly one known target with a positive integer id.
 * Ownership of that target is checked by the route against the database.
 */
export function validateSend(raw: unknown, readableKeys: readonly string[]): SendProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const connector = typeof r.connector === 'string' ? r.connector.trim().toLowerCase() : '';
  if (!readableKeys.includes(connector)) return null;
  const targets = SEND_TARGETS[connector];
  if (!targets) return null;
  const payload = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
  if (!payload) return null;
  const keys = Object.keys(payload);
  if (keys.length !== 1) return null;
  const target = targets.find((t) => t.field === keys[0]);
  if (!target) return null;
  const id = payload[target.field];
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  const summary = typeof r.summary === 'string' ? r.summary.trim().slice(0, 200) : '';
  return { connector, field: target.field, target_id: id, summary };
}

/** RULE 3. The one serialisation of a payload: stored, shown, hashed and sent. */
export function canonicalPayload(p: Pick<SendProposal, 'field' | 'target_id'>): string {
  return JSON.stringify({ [p.field]: p.target_id });
}

export async function payloadHash(payloadJson: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadJson));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isExpired(createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return true;
  // D1 writes CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return now - t > PENDING_TTL_MS;
}

/**
 * The model answers in one JSON object: `{ "answer": "...", "send": null | {...} }`.
 * Anything that is not that object is read as a plain answer with no send,
 * so a model that ignores the format can never produce a write.
 */
export function parseModelReply(output: string): { answer: string; send: unknown } {
  const text = String(output || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      if (obj && typeof obj.answer === 'string') {
        return { answer: obj.answer.trim(), send: obj.send ?? null };
      }
    } catch {
      // fall through: not the format, so no send
    }
  }
  return { answer: text, send: null };
}
