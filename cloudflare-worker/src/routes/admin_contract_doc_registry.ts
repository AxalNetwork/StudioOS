/**
 * D480 — HQ · Contracts doc-type registry (D1 store + code catalog).
 * Mounted at `/api/admin/contracts/registry` before the contracts catch-all.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin, requireHqAuthoring, requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import {
  buildTemplateCatalog,
  loadAllContracts,
  loadTemplateUsage,
  TEMPLATE_LAYERS,
  TEMPLATES,
} from './admin_contracts';
import {
  listRegistryRows,
  publishType,
  upsertDraft,
} from '../services/contractDocTypeRegistryStore';

const CODE_LAYER_ORDER = ['gp', 'fund', 'portfolio', 'compliance'] as const;
const CANVAS_LAYERS = ['PLATFORM', 'VENTURE', 'FUND', 'ENGAGEMENT'] as const;

/** Hub catalog row. A store-only type may be draft or published; both use source `store`. */
type RegistryHubItem = {
  key: string;
  title: string;
  doc_type: string;
  layer: string;
  layer_label: string;
  layer_description: string;
  party_roles: readonly string[];
  usage_count: number;
  last_used_at: string | null;
  required_fields?: string[];
  draft?: {
    title: string;
    layer: string;
    party_roles: string[];
    required_fields: string[];
  };
  /** Set when a published type has a save that publish has not applied. Null otherwise. */
  pending_draft: {
    title: string;
    layer: string;
    party_roles: string[];
    required_fields: string[];
    updated_at: string | null;
    updated_by: number | null;
    updated_by_name: string | null;
  } | null;
  registry_status: 'published' | 'draft' | 'code';
  /** D633 — when, by whom and why a published type went live. Null unless published. */
  published?: PublishedMeta | null;
  source: 'store' | 'code';
};

type PublishedMeta = { at: string | null; by: number | null; by_name: string | null; reason: string | null };

export const REGISTRY_PUBLISH_REASON_MIN = 10;

const registry = new Hono<{ Bindings: Env }>();
// D647 — document-type metadata and authoring belong to HQ's Super Admin.
registry.use('*', async (c, next) => {
  await requireSuperAdmin(c);
  await next();
});

function rolesOverlap(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  return b.some((r) => sa.has(r));
}

function computeOverlapFlags(
  items: Array<{ doc_type: string; layer: string; party_roles: readonly string[] }>,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.layer !== b.layer) continue;
      if (!rolesOverlap(a.party_roles, b.party_roles)) continue;
      out.set(a.doc_type, true);
      out.set(b.doc_type, true);
    }
  }
  return out;
}

/**
 * D633 (#1391, Q1) — the names of the Super Admins who published the stored
 * types, one read for all of them. A failed read leaves the names out and
 * the hub still answers: the page says the name is not recorded.
 */
async function readPublisherNames(env: Env, rows: Array<{ published_by: number | null }>): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map((r) => r.published_by).filter((v): v is number => Number.isInteger(v)))];
  if (!ids.length) return new Map();
  try {
    const res = await env.DB.prepare(
      'SELECT id, name, email FROM users WHERE id IN (SELECT value FROM json_each(?))',
    ).bind(JSON.stringify(ids)).all<{ id: number; name: string | null; email: string | null }>();
    return new Map((res.results || []).map((u) => [Number(u.id), u.name || u.email || '']).filter(([, n]) => n) as Array<[number, string]>);
  } catch (e) {
    console.warn('[contracts.registry] publisher names unreadable', (e as Error).message);
    return new Map();
  }
}

function publishedMeta(
  row: { published_at: string | null; published_by: number | null; publish_reason: string | null },
  names: Map<number, string>,
): PublishedMeta {
  return {
    at: row.published_at ?? null,
    by: row.published_by ?? null,
    by_name: row.published_by != null ? names.get(Number(row.published_by)) ?? null : null,
    reason: row.publish_reason ?? null,
  };
}

async function buildHubPayload(env: Env) {
  const sql = getSQL(env);
  try {
    const [{ usage, lastUsed }, storeRows, liveRows] = await Promise.all([
      loadTemplateUsage(sql),
      listRegistryRows(env),
      loadAllContracts(sql),
    ]);

    const publisherNames = await readPublisherNames(env, storeRows);
    const codeItems = buildTemplateCatalog(usage, lastUsed);
    const storeByType = new Map(storeRows.map((r) => [r.doc_type, r]));
    const merged: RegistryHubItem[] = codeItems.map((row) => {
      const stored = storeByType.get(row.doc_type);
      if (stored && stored.status === 'published') {
        return {
          ...row,
          title: stored.title,
          layer: stored.layer,
          party_roles: stored.party_roles.length ? stored.party_roles : row.party_roles,
          required_fields: stored.required_fields,
          pending_draft: stored.pending_draft,
          registry_status: 'published' as const,
          published: publishedMeta(stored, publisherNames),
          source: 'store' as const,
        };
      }
      if (stored && stored.status === 'draft') {
        return {
          ...row,
          draft: {
            title: stored.title,
            layer: stored.layer,
            party_roles: stored.party_roles,
            required_fields: stored.required_fields,
          },
          pending_draft: null,
          registry_status: 'draft' as const,
          source: 'code' as const,
        };
      }
      return { ...row, pending_draft: null, registry_status: 'code' as const, source: 'code' as const };
    });

    for (const s of storeRows) {
      if (TEMPLATES[s.doc_type]) continue;
      merged.push({
        key: s.doc_type,
        title: s.title,
        doc_type: s.doc_type,
        layer: s.layer,
        layer_label: TEMPLATE_LAYERS[s.layer]?.label || s.layer,
        layer_description: TEMPLATE_LAYERS[s.layer]?.description || '',
        party_roles: s.party_roles,
        usage_count: usage.get(s.doc_type) || 0,
        last_used_at: lastUsed.get(s.doc_type) || null,
        required_fields: s.required_fields,
        pending_draft: s.pending_draft,
        registry_status: s.status === 'published' ? 'published' : 'draft',
        published: s.status === 'published' ? publishedMeta(s, publisherNames) : null,
        source: 'store',
      });
    }

    const overlap = computeOverlapFlags(merged);
    const items = merged.map((r) => ({
      ...r,
      overlap: overlap.get(r.doc_type) || false,
    }));

    const inKnownLayer = items.filter((i) => CODE_LAYER_ORDER.includes(i.layer as typeof CODE_LAYER_ORDER[number]));
    const outsideLayers = items.filter((i) => !CODE_LAYER_ORDER.includes(i.layer as typeof CODE_LAYER_ORDER[number]));

    const layers = Object.entries(TEMPLATE_LAYERS).map(([id, meta]) => ({ id, ...meta }));
    const drafts = storeRows.filter((r) => r.status === 'draft').length;
    const publishedStore = storeRows.filter((r) => r.status === 'published').length;
    const overlapCount = [...overlap.values()].filter(Boolean).length;

    const health = [
      { id: 'types', label: 'Registered types', value: items.length, note: `${codeItems.length} in code · ${storeRows.length} in the store` },
      { id: 'live', label: 'Live contracts', value: liveRows.length, note: 'Four-source union (documents, e-sign, pairwise, partner)' },
      { id: 'drafts', label: 'Draft types', value: drafts, note: drafts ? 'Awaiting publish' : 'None awaiting publish' },
      { id: 'published', label: 'Published store rows', value: publishedStore, note: 'Override code titles/layers when published' },
      { id: 'overlap', label: 'Overlap flags', value: overlapCount, note: 'Same layer + shared party role' },
      { id: 'outside', label: 'Outside four layers', value: outsideLayers.length, note: 'Included in totals · not dropped silently' },
    ];

    return {
      layers,
      items,
      in_known_layers: inKnownLayer,
      outside_layers: outsideLayers,
      type_count: items.length,
      type_count_all: items.length,
      outside_layer_count: outsideLayers.length,
      health,
      decisions: {
        canvas_layers: CANVAS_LAYERS,
        code_layers: CODE_LAYER_ORDER,
        layer_mapping: 'pending_owner_decision',
        esign_originators_governance: 'pending_owner_decision',
      },
      coverage: [
        `${items.length} registered types across ${CODE_LAYER_ORDER.length} code layers`,
        `${liveRows.length} live contracts in the union`,
        drafts ? `${drafts} draft ${drafts === 1 ? 'type' : 'types'} in the store` : null,
      ].filter(Boolean),
    };
  } finally {
    await sql.end();
  }
}

// GET /api/admin/contracts/registry — hub (X1) + merged catalog
registry.get('/', async (c) => {
  await requireAdmin(c);
  return c.json(await buildHubPayload(c.env));
});

// GET /api/admin/contracts/registry/doc-types — backward-compatible read shape
registry.get('/doc-types', async (c) => {
  await requireAdmin(c);
  const hub = await buildHubPayload(c.env);
  return c.json({
    layers: hub.layers,
    items: hub.items,
    type_count: hub.type_count,
    outside_layer_count: hub.outside_layer_count,
    decisions: hub.decisions,
  });
});

// POST /api/admin/contracts/registry/draft — X2 save draft
registry.post('/draft', async (c) => {
  const admin = await requireHqAuthoring(c);
  const body = await c.req.json<{
    doc_type?: string;
    title?: string;
    layer?: string;
    party_roles?: string[];
    required_fields?: string[];
  }>();
  try {
    await upsertDraft(
      c.env,
      {
        doc_type: String(body.doc_type || ''),
        title: String(body.title || ''),
        layer: String(body.layer || 'gp'),
        party_roles: Array.isArray(body.party_roles) ? body.party_roles.map(String) : [],
        required_fields: Array.isArray(body.required_fields) ? body.required_fields.map(String) : [],
      },
      admin.id,
    );
    return c.json({ ok: true }, 201);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code === 'invalid_doc_type' ? 'invalid_doc_type' : 'draft_save_failed';
    const message = code === 'invalid_doc_type'
      ? 'A doc type slug is lowercase letters, digits and underscores, starting with a letter.'
      : 'The draft could not be saved.';
    console.warn('[contract-doc-registry] draft save failed', code);
    return c.json({ error: message, code }, 400);
  }
});

// POST /api/admin/contracts/registry/:doc_type/publish — step-up + audit
registry.post('/:doc_type/publish', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const docType = String(c.req.param('doc_type') || '').toLowerCase();
  const body = await c.req.json<{ reason?: string; reviewed_draft_at?: string | null }>();
  const reason = String(body.reason || '').trim();
  if (reason.length < REGISTRY_PUBLISH_REASON_MIN) {
    return c.json({
      error: `Publish requires a typed reason of at least ${REGISTRY_PUBLISH_REASON_MIN} characters.`,
      code: 'reason_required',
    }, 400);
  }
  // D622 — the revision the Super Admin reviewed. A publish applies that one
  // or refuses: a newer save is a 409 and nothing changes.
  const reviewed = body.reviewed_draft_at == null ? null : String(body.reviewed_draft_at);
  const result = await publishType(c.env, docType, reason, admin.id, reviewed);
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'draft_changed' ? 409 : 400;
    return c.json({ error: result.message, code: result.code }, status);
  }
  // The audit records what went live: the applied values, not a code title.
  await logAdminAction(c.env, admin.id, admin.email || '', 'registry.type.publish', {
    doc_type: docType,
    reason,
    reviewed_draft_at: reviewed,
    applied: result.applied,
  });
  return c.json({ ok: true, applied: result.applied });
});

export default registry;
