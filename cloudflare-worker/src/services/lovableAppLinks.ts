/**
 * D1083 (#2948, Lovable part 3 of #2398) — the address Lovable gave the
 * founder, on an experiment or on Prototype / MVP, and its last live check.
 *
 * The rows are migration 585's `lovable_app_links`, written only by
 * `routes/lovable_app_links.ts`. This file reads them into `parts.lovable`
 * for the experiment record (Validate › Hypotheses) and for Prototype / MVP,
 * and holds the rules both the routes and the reads share.
 *
 * A part that cannot be read is `{ state: 'unreadable' }`, never an empty
 * list: an empty list says "No app linked yet", which would be false.
 */
import type { Env } from '../types';
import { isSafePublicUrl } from './webFetch';
import { hostOf, liveLineOwner } from './liveHost';

/** The two places a link lives, fixed: a cycle never names a table itself. */
export const LINK_TARGETS = {
  validate: { module: 'experiments', recordTable: 'hypothesis_experiments' },
  build: { module: 'prototype-mvp', recordTable: 'projects' },
} as const;
export type LinkCycle = keyof typeof LINK_TARGETS;
export const isLinkCycle = (value: unknown): value is LinkCycle => value === 'validate' || value === 'build';

export const APP_URL_MAX = 2048;
export const TITLE_MAX = 120;

/**
 * The address as stored, or why it is refused. https only, a public host, no
 * user name or password in it, and no fragment.
 */
export function checkAppUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, error: 'app_url_required' };
  if (text.length > APP_URL_MAX) return { ok: false, error: 'app_url_too_long' };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, error: 'app_url_invalid' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'app_url_not_https' };
  if (u.username || u.password) return { ok: false, error: 'app_url_invalid' };
  u.hash = '';
  const url = u.toString();
  if (!isSafePublicUrl(url)) return { ok: false, error: 'app_url_not_public' };
  return { ok: true, url };
}

/** A fetched title as plain text: tags and angle brackets gone, whitespace folded, capped. */
export function plainTitle(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, TITLE_MAX) : null;
}

export type LinkRow = {
  uid: string; record_id: number; app_url: string; last_status: string | null;
  last_title: string | null; checked_at: string | null;
};

export type LinkView = {
  uid: string; app_url: string; host: string | null;
  status: 'live' | 'not_reachable' | 'not_checked';
  title: string | null; checked_at: string | null;
  /** 'vercel' when Vercel's production domain is this host: the Live line is Vercel's (liveHost.ts). */
  hosted_on: 'vercel' | null;
};

export function linkView(row: LinkRow, vercelProductionDomains: ReadonlyArray<string> = []): LinkView {
  const host = hostOf(row.app_url);
  const status = row.last_status === 'live' || row.last_status === 'not_reachable' ? row.last_status : 'not_checked';
  return {
    uid: row.uid, app_url: row.app_url, host, status,
    title: row.last_title ?? null, checked_at: row.checked_at ?? null,
    hosted_on: liveLineOwner(host, vercelProductionDomains) === 'vercel' ? 'vercel' : null,
  };
}

export type LovableSlot = { record_id: number; label: string; link: LinkView | null };
export type LovablePart = { state: 'ok'; slots: LovableSlot[] } | { state: 'unreadable' };

/**
 * The Vercel production domains that own a Live line on this project: each
 * chosen Vercel project's (D1098, #2963, `vercel_projects`). A store that
 * cannot be read gives none, and every line stays Lovable's.
 */
export async function vercelProductionDomains(env: Env, projectId: number): Promise<string[]> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT DISTINCT vp.production_domain AS domain FROM vercel_projects vp
         JOIN integrations i ON i.id = vp.integration_id AND i.provider_key = 'vercel'
        WHERE vp.project_id = ? AND vp.production_domain IS NOT NULL`,
    ).bind(projectId).all<{ domain: string }>()).results || [];
    return rows.map((r) => r.domain);
  } catch {
    return [];
  }
}

/** One slot per record, each with its link or none. */
export async function lovablePart(env: Env, projectId: number, cycle: LinkCycle,
  records: ReadonlyArray<{ id: number; label: string }>): Promise<LovablePart> {
  try {
    const target = LINK_TARGETS[cycle];
    const rows = (await env.DB.prepare(
      `SELECT uid, record_id, app_url, last_status, last_title, checked_at
         FROM lovable_app_links WHERE project_id = ? AND module = ? AND record_table = ?`,
    ).bind(projectId, target.module, target.recordTable).all<LinkRow>()).results || [];
    const domains = await vercelProductionDomains(env, projectId);
    const byRecord = new Map(rows.map((r) => [Number(r.record_id), r]));
    return {
      state: 'ok',
      slots: records.map((r) => {
        const row = byRecord.get(Number(r.id));
        return { record_id: Number(r.id), label: r.label, link: row ? linkView(row, domains) : null };
      }),
    };
  } catch (e) {
    console.warn('[lovableAppLinks] part unreadable', (e as Error)?.name ?? 'error');
    return { state: 'unreadable' };
  }
}
