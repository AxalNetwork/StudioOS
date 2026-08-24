/**
 * Task #9 — bidirectional ticket ↔ GitHub Issues sync service.
 *
 * Single home for every GitHub Issues API call the ticket system makes
 * (create / update / comment / labels / assignees), plus the pure mapping
 * logic that keeps both sides consistent:
 *
 *   - label mapping:   type → `bug`/`feature`/`task`,
 *                      priority → `priority:urgent|high|medium|low`,
 *                      category pass-through `audit`/`beta-readiness`/`tracking`,
 *                      constant `support-ticket` marker label.
 *   - status mapping:  local open/in_progress ↔ GH open;
 *                      resolved → closed/completed; closed → closed/not_planned.
 *   - loop prevention: every outbound body/comment carries an HTML source
 *                      marker (`<!-- axal-sync:ticket-<id> -->`) so the inbound
 *                      webhook can drop our own echoes; inbound deliveries are
 *                      deduped by GitHub's `X-GitHub-Delivery` GUID via the
 *                      `ticket_sync_events` D1 sidecar table.
 *
 * Validation is done inline (no zod) — matches the repo convention (see
 * services/advisor/writeRouter.ts: adding zod to the worker bundle is
 * deliberately avoided).
 *
 * All network helpers retry once with backoff on 5xx / secondary-rate-limit
 * responses and NEVER throw — they return `{ ok:false, status, error }` so
 * callers surface an explicit `github_sync_status` instead of failing the
 * underlying DB write silently.
 */
import type { Env } from '../types';

/* ------------------------------------------------------------------ */
/* Enums + pure mapping logic (unit-tested by string-slicing —        */
/* keep these functions self-contained; no closures over module state) */
/* ------------------------------------------------------------------ */

export const TICKET_TYPES = ['bug', 'feature', 'task'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
// Category labels pass through both directions untouched.
export const CATEGORY_LABELS = ['audit', 'beta-readiness', 'tracking'] as const;
export const SUPPORT_LABEL = 'support-ticket';
export const SYNC_MARKER_PREFIX = '<!-- axal-sync:ticket-';

export function syncMarker(ticketId: number | string): string {
  return `<!-- axal-sync:ticket-${ticketId} -->`;
}

export function hasSyncMarker(body: unknown): boolean {
  return typeof body === 'string' && body.includes('<!-- axal-sync:ticket-');
}

export function priorityLabel(priority: string): string {
  return `priority:${priority}`;
}

/** Full outbound label set for a ticket. */
export function labelsForTicket(t: { type?: string | null; priority?: string | null; categories?: string[] }): string[] {
  const labels: string[] = ['support-ticket'];
  const type = (t.type || 'task').toLowerCase();
  if ((TICKET_TYPES as readonly string[]).includes(type)) labels.push(type);
  const priority = (t.priority || 'medium').toLowerCase();
  if ((TICKET_PRIORITIES as readonly string[]).includes(priority)) labels.push(`priority:${priority}`);
  for (const c of t.categories || []) {
    if ((CATEGORY_LABELS as readonly string[]).includes(c) && !labels.includes(c)) labels.push(c);
  }
  return labels;
}

/**
 * Inverse mapping: GitHub label objects (or names) → normalized fields.
 * Accepts both `priority:high` and the legacy `priority: high` spelling.
 */
export function parseLabelsFromGithub(labels: Array<{ name?: string } | string> | null | undefined): {
  priority: string | null; type: string | null; categories: string[]; names: string[];
} {
  const names = (labels || [])
    .map((l) => (typeof l === 'string' ? l : l?.name || ''))
    .filter(Boolean);
  let priority: string | null = null;
  let type: string | null = null;
  const categories: string[] = [];
  for (const raw of names) {
    const name = raw.toLowerCase().trim();
    const pm = name.match(/^priority:\s*(low|medium|high|urgent)$/);
    if (pm) { priority = pm[1]; continue; }
    if ((TICKET_TYPES as readonly string[]).includes(name)) { type = name; continue; }
    if ((CATEGORY_LABELS as readonly string[]).includes(name) && !categories.includes(name)) categories.push(name);
  }
  return { priority, type, categories, names };
}

export function mapGithubStatusToLocal(ghState: string, ghStateReason?: string | null): string {
  if (ghState === 'closed') {
    if (ghStateReason === 'not_planned') return 'closed';
    return 'resolved';
  }
  return 'open';
}

/** Local status → GitHub issue state patch. */
export function mapLocalStatusToGithub(status: string): { state: 'open' | 'closed'; state_reason: 'completed' | 'not_planned' | 'reopened' | null } {
  if (status === 'resolved') return { state: 'closed', state_reason: 'completed' };
  if (status === 'closed') return { state: 'closed', state_reason: 'not_planned' };
  return { state: 'open', state_reason: null };
}

/* ------------------------------------------------------------------ */
/* Inline validation (repo convention: no zod in the worker bundle)   */
/* ------------------------------------------------------------------ */

type Valid<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateTicketCreate(data: any): Valid<{
  title: string; description: string | null; priority: string; type: string; project_id: number | null;
}> {
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_payload' };
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title || title.length > 200) return { ok: false, error: 'title must be 1-200 characters' };
  const description = typeof data.description === 'string' && data.description.trim()
    ? data.description.trim().slice(0, 10000) : null;
  const priority = String(data.priority || 'medium').toLowerCase();
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) return { ok: false, error: 'priority must be one of low|medium|high|urgent' };
  const type = String(data.type || 'task').toLowerCase();
  if (!(TICKET_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'type must be one of bug|feature|task' };
  const project_id = Number.isInteger(data.project_id) ? data.project_id : null;
  return { ok: true, value: { title, description, priority, type, project_id } };
}

export function validateTicketUpdate(data: any): Valid<{
  status?: string; priority?: string; type?: string; assigned_to?: string;
}> {
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_payload' };
  const out: any = {};
  if (data.status !== undefined) {
    const status = String(data.status).toLowerCase();
    if (!(TICKET_STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be one of open|in_progress|resolved|closed' };
    out.status = status;
  }
  if (data.priority !== undefined) {
    const priority = String(data.priority).toLowerCase();
    if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) return { ok: false, error: 'priority must be one of low|medium|high|urgent' };
    out.priority = priority;
  }
  if (data.type !== undefined) {
    const type = String(data.type).toLowerCase();
    if (!(TICKET_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'type must be one of bug|feature|task' };
    out.type = type;
  }
  if (data.assigned_to !== undefined) {
    const assigned = String(data.assigned_to).trim();
    if (!assigned || assigned.length > 200) return { ok: false, error: 'assigned_to must be 1-200 characters' };
    out.assigned_to = assigned;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'no valid fields to update' };
  return { ok: true, value: out };
}

export function validateComment(data: any): Valid<{ body: string }> {
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_payload' };
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  if (!body || body.length > 20000) return { ok: false, error: 'body must be 1-20000 characters' };
  return { ok: true, value: { body } };
}

/* ------------------------------------------------------------------ */
/* Assignee mapping                                                   */
/* ------------------------------------------------------------------ */

/**
 * Map a local `assigned_to` string (name or email) to a GitHub login via the
 * optional ADMIN_GITHUB_LOGINS env JSON, e.g.
 *   {"kim@axal.vc":"kim-axal","Alex Doe":"alexdoe"}
 * Keys are matched case-insensitively. Returns null when unmapped — callers
 * skip the GitHub assignee call rather than guessing a login.
 */
export function assigneeLoginFor(env: Env, assignedTo: string | null | undefined): string | null {
  if (!assignedTo) return null;
  const raw = (env as any).ADMIN_GITHUB_LOGINS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object') return null;
    const needle = assignedTo.toLowerCase().trim();
    for (const [key, login] of Object.entries(map)) {
      if (key.toLowerCase().trim() === needle && typeof login === 'string' && login) return login;
    }
  } catch { /* malformed env — treat as unmapped */ }
  return null;
}

/* ------------------------------------------------------------------ */
/* Schema drift guard + sync-event dedup store                        */
/* ------------------------------------------------------------------ */

/** Idempotent runtime migrations for prod D1 drift (mirrors sql/schema.sql). */
export async function ensureTicketSyncSchema(env: Env): Promise<void> {
  const db = env.DB;
  const alters = [
    `ALTER TABLE tickets ADD COLUMN github_issue_number INTEGER`,
    `ALTER TABLE tickets ADD COLUMN github_issue_url TEXT`,
    `ALTER TABLE tickets ADD COLUMN type TEXT NOT NULL DEFAULT 'task'`,
    `ALTER TABLE tickets ADD COLUMN github_labels TEXT`,
    `ALTER TABLE tickets ADD COLUMN github_assignees TEXT`,
    // Stale-event guard: the issue's updated_at as of the last applied
    // inbound event; older deliveries are dropped instead of reverting state.
    `ALTER TABLE tickets ADD COLUMN github_updated_at TEXT`,
  ];
  for (const stmt of alters) {
    try { await db.prepare(stmt).run(); } catch { /* column exists */ }
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS ticket_sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      github_issue_number INTEGER,
      direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
      event_key TEXT UNIQUE NOT NULL,
      payload_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  } catch { /* ignore */ }
}

/**
 * Record a sync event; returns false when the event_key was already seen
 * (idempotency). Uses INSERT OR IGNORE + changes count for atomicity.
 */
export async function recordSyncEvent(env: Env, args: {
  ticketId?: number | null; issueNumber?: number | null;
  direction: 'outbound' | 'inbound'; eventKey: string; payloadHash?: string | null;
}): Promise<boolean> {
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO ticket_sync_events (ticket_id, github_issue_number, direction, event_key, payload_hash) VALUES (?, ?, ?, ?, ?)`
    ).bind(args.ticketId ?? null, args.issueNumber ?? null, args.direction, args.eventKey, args.payloadHash ?? null).run();
    return ((res as any)?.meta?.changes ?? 0) > 0;
  } catch (e) {
    console.warn('[githubSync] recordSyncEvent failed', (e as Error).message);
    // Fail open for OUTBOUND bookkeeping, but callers deduping INBOUND
    // deliveries treat `true` as "not seen before" — that's the safe default
    // here because reprocessing a delivery is idempotent (status/labels are
    // absolute writes, not increments).
    return true;
  }
}

/**
 * Release a previously claimed sync event so a webhook redelivery can be
 * reprocessed after a mid-handler failure (claim-then-release pattern:
 * the delivery GUID is claimed up front for dedup, and released if the
 * ticket mutation fails so GitHub's retry isn't swallowed as a duplicate).
 */
export async function releaseSyncEvent(env: Env, eventKey: string): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM ticket_sync_events WHERE event_key = ?`).bind(eventKey).run();
  } catch (e) {
    console.warn('[githubSync] releaseSyncEvent failed', (e as Error).message);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* GitHub REST helpers (retry + explicit failure)                     */
/* ------------------------------------------------------------------ */

export function githubConfigured(env: Env): boolean {
  return !!(env.GITHUB_ACCESS_TOKEN && env.GITHUB_REPO_OWNER && env.GITHUB_REPO_NAME);
}

export interface GhResult { ok: boolean; status: number; data: any; error?: string }

async function ghFetch(env: Env, path: string, init: RequestInit = {}): Promise<GhResult> {
  if (!githubConfigured(env)) return { ok: false, status: 0, data: null, error: 'github_not_configured' };
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}${path}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_ACCESS_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'StudioOS-Worker',
    ...(init.headers || {}),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { ...init, headers });
      const retryable = resp.status >= 500
        || (resp.status === 403 && (resp.headers.get('retry-after') || resp.headers.get('x-ratelimit-remaining') === '0'))
        || resp.status === 429;
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, 750));
        continue;
      }
      let data: any = null;
      try { data = await resp.json(); } catch { /* empty body */ }
      if (!resp.ok) {
        return { ok: false, status: resp.status, data, error: data?.message || `github_http_${resp.status}` };
      }
      return { ok: true, status: resp.status, data };
    } catch (e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 750)); continue; }
      return { ok: false, status: 0, data: null, error: `network: ${(e as Error).message}` };
    }
  }
  return { ok: false, status: 0, data: null, error: 'unreachable' };
}

export async function createIssue(env: Env, args: { title: string; body: string; labels: string[] }): Promise<GhResult> {
  return ghFetch(env, '/issues', { method: 'POST', body: JSON.stringify(args) });
}

export async function updateIssue(env: Env, issueNumber: number, patch: {
  title?: string; body?: string; state?: 'open' | 'closed'; state_reason?: string | null; labels?: string[];
}): Promise<GhResult> {
  return ghFetch(env, `/issues/${issueNumber}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function addComment(env: Env, issueNumber: number, body: string): Promise<GhResult> {
  return ghFetch(env, `/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

export async function setLabels(env: Env, issueNumber: number, labels: string[]): Promise<GhResult> {
  return ghFetch(env, `/issues/${issueNumber}/labels`, { method: 'PUT', body: JSON.stringify({ labels }) });
}

/** Replace assignees wholesale (DELETE existing not needed — PATCH issue). */
export async function setAssignees(env: Env, issueNumber: number, assignees: string[]): Promise<GhResult> {
  return ghFetch(env, `/issues/${issueNumber}`, { method: 'PATCH', body: JSON.stringify({ assignees }) });
}

export async function fetchIssue(env: Env, issueNumber: number): Promise<GhResult> {
  return ghFetch(env, `/issues/${issueNumber}`, { method: 'GET' });
}

export async function fetchComments(env: Env, issueNumber: number): Promise<GhResult> {
  return ghFetch(env, `/issues/${issueNumber}/comments?per_page=50`, { method: 'GET' });
}
