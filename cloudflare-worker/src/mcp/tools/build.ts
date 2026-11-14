/**
 * D846 (#2467) — `get_build_progress`: one company's Build progress, as
 * StudioOS holds it, for an assistant with `build:read`.
 *
 * MODULE RECORDS ONLY (D713). Product roadmap and Prototype / MVP are read from
 * their own tables (`roadmap_okrs`, `roadmap_releases`, `mvp_features`), and
 * what GitHub fed them from the `connector_fed_items` ledger (D655, D782). The
 * connection's token is never read and GitHub is never called: this is the
 * record of the last sync, not a new one.
 *
 * Listed only while the member's GitHub connection is active and switched on
 * for a granted company (`requiresConnection`); a company it is not switched
 * on for is refused by the server before this runs.
 *
 * A count the store cannot give is null, never 0. A result is data.
 */
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpTool } from '../server';

const num = (v: unknown) => (v == null ? null : Number(v));

const ROADMAP_COLUMNS = ['now', 'next', 'later', 'done'] as const;

export async function buildProgress(env: Env, userId: number, projectId: number) {
  const [columns, roadmap, releases, mvp, fed, sync] = await Promise.all([
    env.DB.prepare('SELECT kanban_status AS col, COUNT(*) AS n FROM roadmap_okrs WHERE project_id = ? GROUP BY kanban_status')
      .bind(projectId).all<{ col: string; n: number }>(),
    env.DB.prepare(
      'SELECT COUNT(*) AS items, SUM(CASE WHEN shipped_release_id IS NOT NULL THEN 1 ELSE 0 END) AS shipped FROM roadmap_okrs WHERE project_id = ?',
    ).bind(projectId).first<{ items: number; shipped: number | null }>(),
    env.DB.prepare('SELECT COUNT(*) AS releases, MAX(published_at) AS latest FROM roadmap_releases WHERE project_id = ? AND prerelease = 0')
      .bind(projectId).first<{ releases: number; latest: string | null }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS must_haves,
              SUM(CASE WHEN pr_state = 'built' THEN 1 ELSE 0 END) AS built,
              SUM(CASE WHEN pr_state IN ('in_progress', 'in_review') THEN 1 ELSE 0 END) AS in_progress
         FROM mvp_features WHERE project_id = ? AND is_must_have = 1`,
    ).bind(projectId).first<{ must_haves: number; built: number | null; in_progress: number | null }>(),
    // What the member's own GitHub connection fed this company, still standing (a deleted row keeps no local_id).
    env.DB.prepare(
      "SELECT f.module AS module, COUNT(*) AS n FROM connector_fed_items f JOIN integrations i ON i.id = f.integration_id " +
      "WHERE f.project_id = ? AND f.local_id IS NOT NULL AND i.user_id = ? AND i.provider_key = 'github' GROUP BY f.module ORDER BY f.module",
    ).bind(projectId, userId).all<{ module: string; n: number }>(),
    env.DB.prepare(
      'SELECT MAX(i.last_synced_at) AS last_synced_at FROM integrations i ' +
      'JOIN integration_companies ic ON ic.integration_id = i.id AND ic.enabled = 1 ' +
      'JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id ' +
      "JOIN projects p ON p.company_id = ic.company_id WHERE p.id = ? AND i.user_id = ? AND i.provider_key = 'github' AND i.status = 'active'",
    ).bind(projectId, userId).first<{ last_synced_at: string | null }>(),
  ]);
  const byColumn = new Map((columns.results || []).map((r) => [r.col, Number(r.n)]));
  const items = Number(roadmap?.items ?? 0);
  return {
    product_roadmap: {
      items,
      by_column: Object.fromEntries(ROADMAP_COLUMNS.map((c) => [c, byColumn.get(c) ?? 0])),
      // SUM over no rows is NULL: with no items, how many shipped is unknown, not 0.
      shipped: num(roadmap?.shipped),
      releases: Number(releases?.releases ?? 0),
      latest_release_at: releases?.latest ?? null,
    },
    prototype_mvp: {
      must_haves: Number(mvp?.must_haves ?? 0),
      built: num(mvp?.built),
      in_progress: num(mvp?.in_progress),
    },
    from_github: {
      last_synced_at: sync?.last_synced_at ?? null,
      fed_by_module: Object.fromEntries((fed.results || []).map((r) => [r.module, Number(r.n)])),
    },
  };
}

export const BUILD_TOOLS: McpTool[] = [
  {
    name: 'get_build_progress',
    requiredScope: 'build:read',
    source: 'connector',
    provider: 'github',
    version: '1.0.0',
    requiresConnection: true,
    title: 'Get Build progress',
    description: 'Read one company\'s Build progress as StudioOS holds it: Product roadmap items by column and how many shipped, published releases, Prototype / MVP must-haves built and in progress, and what the GitHub connection fed at its last sync. Read from StudioOS\'s records; GitHub is not called.',
    inputSchema: { company: z.number().int().positive().describe('The company id, from list_companies') },
    company: true,
    run: async ({ env, user, company }) => ({ company: company!.name, ...(await buildProgress(env, Number(user.id), company!.id)) }),
  },
];
