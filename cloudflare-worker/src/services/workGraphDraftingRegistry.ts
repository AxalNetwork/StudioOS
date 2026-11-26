/**
 * D5582 part 4 (#5582): the drafting registry's bootstrap. It finds the domain object a deck, template or offer asset
 * stands for, and that object's current row, through the canonical readers part 3 uses. One asset per domain object
 * and company: its retry key is derived from the object, never supplied by the caller.
 *
 *   pitch_deck      the object is the project; the current row is its `pitch_decks` row with `is_current = 1`
 *   legal_template  the object is the `legal_templates` row; the current row is its active version
 *   offer           the object is the quote; the current row is its latest `quote_versions` row
 *
 * Reads only. Nothing here writes a domain table; registration and adoption go through `workGraphDrafting.ts`.
 */
import type { Env } from '../types';
import type { DraftingAsset } from './workGraphDraftingScope';

export type DraftingKind = DraftingAsset['kind'];
export const DRAFTING_KINDS: readonly DraftingKind[] = ['pitch_deck', 'legal_template', 'offer'];

/** The domain object an asset stands for, and the id of its row that is current now. */
export interface DraftingObject {
  kind: DraftingKind;
  projectId: number | null;
  /** Stable for the object across versions: the asset's derived retry key. */
  objectKey: string;
  /** The current row, in the form the head revision's `source_id` takes. */
  currentSourceId: string;
  locator: 'pitch_decks' | 'legal_template_versions' | 'quote_versions';
}

const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

async function currentDeck(env: Pick<Env, 'DB'>, companyId: number, projectId: number): Promise<DraftingObject | null> {
  const row = await env.DB.prepare(
    `SELECT d.id FROM pitch_decks d JOIN projects p ON p.id = d.project_id
      WHERE d.project_id = ? AND p.company_id = ? AND d.is_current = 1 ORDER BY d.version DESC, d.id DESC LIMIT 1`,
  ).bind(projectId, companyId).first<{ id: number }>();
  return row ? { kind: 'pitch_deck', projectId, objectKey: `project:${projectId}`, currentSourceId: String(row.id), locator: 'pitch_decks' } : null;
}

async function currentTemplate(env: Pick<Env, 'DB'>, templateId: number): Promise<DraftingObject | null> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.version FROM legal_templates t JOIN legal_template_versions v ON v.template_id = t.id AND v.version = t.version
      WHERE t.id = ? AND t.is_active = 1`,
  ).bind(templateId).first<{ id: number; version: number }>();
  return row ? { kind: 'legal_template', projectId: null, objectKey: `template:${row.id}`,
    currentSourceId: `${row.id}:${row.version}`, locator: 'legal_template_versions' } : null;
}

async function currentQuote(env: Pick<Env, 'DB'>, companyId: number, quoteId: number): Promise<DraftingObject | null> {
  const row = await env.DB.prepare(
    `SELECT v.id FROM quote_versions v JOIN quotes q ON q.id = v.quote_id
      WHERE q.id = ? AND q.company_id = ? ORDER BY v.version DESC, v.id DESC LIMIT 1`,
  ).bind(quoteId, companyId).first<{ id: number }>();
  return row ? { kind: 'offer', projectId: null, objectKey: `quote:${quoteId}`, currentSourceId: String(row.id), locator: 'quote_versions' } : null;
}

/**
 * The object a domain screen names: a deck id (any current deck of a project of this company), a template id, or a
 * quote id of this company. A row of another company reads as absent.
 */
export async function objectByDomainId(
  env: Pick<Env, 'DB'>, companyId: number, kind: DraftingKind, id: number,
): Promise<DraftingObject | null> {
  if (!positive(companyId) || !positive(id)) return null;
  if (kind === 'pitch_deck') {
    const deck = await env.DB.prepare(
      `SELECT d.project_id FROM pitch_decks d JOIN projects p ON p.id = d.project_id
        WHERE d.id = ? AND p.company_id = ? AND d.is_current = 1`,
    ).bind(id, companyId).first<{ project_id: number }>();
    return deck ? currentDeck(env, companyId, Number(deck.project_id)) : null;
  }
  if (kind === 'legal_template') return currentTemplate(env, id);
  if (kind === 'offer') return currentQuote(env, companyId, id);
  return null;
}

/** The object an existing asset stands for, read from the asset's own scope and head source, and its current row. */
export async function objectOfAsset(
  env: Pick<Env, 'DB'>, asset: Pick<DraftingAsset, 'kind' | 'company_id' | 'project_id' | 'source_locator' | 'source_id'>,
): Promise<DraftingObject | null> {
  if (asset.kind === 'pitch_deck') {
    return asset.source_locator === 'pitch_decks' && positive(asset.project_id)
      ? currentDeck(env, asset.company_id, Number(asset.project_id)) : null;
  }
  if (asset.kind === 'legal_template') {
    if (asset.source_locator !== 'legal_template_versions' || !/^[1-9][0-9]{0,14}:[1-9][0-9]{0,14}$/.test(asset.source_id)) return null;
    return currentTemplate(env, Number(asset.source_id.split(':')[0]));
  }
  if (asset.kind === 'offer' && asset.source_locator === 'quote_versions' && /^[1-9][0-9]{0,14}$/.test(asset.source_id)) {
    const base = await env.DB.prepare(
      'SELECT v.quote_id FROM quote_versions v JOIN quotes q ON q.id = v.quote_id WHERE v.id = ? AND q.company_id = ?',
    ).bind(Number(asset.source_id), asset.company_id).first<{ quote_id: number }>();
    return base ? currentQuote(env, asset.company_id, Number(base.quote_id)) : null;
  }
  return null;
}

/**
 * The shape part 3's `readDraftingDomain` reads: an asset whose head source is the object's current row. The head
 * fields are blank; only the scope, kind and source are read.
 */
export function readableAt(
  object: DraftingObject, scope: { tenantId: number; companyId: number },
): DraftingAsset {
  return {
    asset_uid: '', kind: object.kind, tenant_id: scope.tenantId, company_id: scope.companyId, project_id: object.projectId,
    head_revision_uid: '', digest: '', source_locator: object.locator, source_id: object.currentSourceId, source_revision: '',
  };
}

/** The derived retry key of the object's asset. */
export const bootstrapKey = (object: DraftingObject) => `drafting-bootstrap:${object.kind}:${object.objectKey}`;

/** The asset already registered for the object, if any. */
export async function assetForObject(
  env: Pick<Env, 'DB'>, scope: { tenantId: number; companyId: number }, object: DraftingObject,
): Promise<{ asset_uid: string; head_revision_uid: string | null } | null> {
  return env.DB.prepare(
    'SELECT asset_uid, head_revision_uid FROM work_graph_assets WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?',
  ).bind(scope.tenantId, scope.companyId, bootstrapKey(object)).first();
}

/** WorkGraph already holds this company under another tenant (its assets or release tables). */
export async function companyHeldElsewhere(env: Pick<Env, 'DB'>, scope: { tenantId: number; companyId: number }): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS one FROM work_graph_assets WHERE company_id = ? AND tenant_id <> ?
     UNION ALL SELECT 1 FROM work_graph_release_lines WHERE company_id = ? AND tenant_id <> ? LIMIT 1`,
  ).bind(scope.companyId, scope.tenantId, scope.companyId, scope.tenantId).first();
  return !!row;
}

export interface DraftingAssetRow {
  asset_uid: string; kind: DraftingKind; tenant_id: number; project_id: number | null; access_class: string;
  head_revision_uid: string | null; head_seq: number; digest: string | null; source_locator: string | null; source_id: string | null;
}

/** The company's drafting assets, newest first: ids, digests and sources only, never content. */
export async function listDraftingAssets(
  env: Pick<Env, 'DB'>, companyId: number, kind: DraftingKind | null, limit: number,
): Promise<DraftingAssetRow[]> {
  const rows = await env.DB.prepare(
    `SELECT a.asset_uid, a.kind, a.tenant_id, a.project_id, a.access_class, a.head_revision_uid, a.head_seq,
            r.digest, r.source_locator, r.source_id
       FROM work_graph_assets a LEFT JOIN work_graph_revisions r ON r.revision_uid = a.head_revision_uid AND r.asset_uid = a.asset_uid
      WHERE a.company_id = ? AND a.approval_policy = 'human_publication'
        AND a.kind IN ('pitch_deck', 'legal_template', 'offer') AND (? IS NULL OR a.kind = ?)
      ORDER BY a.created_at DESC, a.asset_uid LIMIT ?`,
  ).bind(companyId, kind, kind, limit).all<DraftingAssetRow>();
  return (rows.results ?? []) as DraftingAssetRow[];
}
