/** D5582 part 3 (#5582): read drafting sources through their canonical domain readers, bounded to an existing asset. */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';
// Not `getDeckRow` from routes/decks: that module reaches the Mercury spend feeds, and no admin route may
// (mercury_member_privacy_d752). The units need only the row's slides and title.
import { hydrateSlides } from './decks/cardBlobs';
import { publishedContractTemplates } from './contractPublication';
import { deckUnits, legalTemplateUnits, quoteUnits, unitsDigest, type UnitDocument } from './workGraphUnits';

export interface DraftingAsset {
  asset_uid: string; kind: 'pitch_deck' | 'legal_template' | 'offer';
  tenant_id: number; company_id: number; project_id: number | null;
  head_revision_uid: string; digest: string;
  source_locator: string; source_id: string; source_revision: string;
}

export const scopeOfDraft = (asset: DraftingAsset): Scope => ({
  tenantId: asset.tenant_id, companyId: asset.company_id, projectId: asset.project_id,
});

/** Company is already verified by activeCompanyFor. A tenant supplied in JSON never enters this read. */
export async function draftingAsset(env: Env, companyId: number, uid: string): Promise<DraftingAsset | null> {
  return env.DB.prepare(
    `SELECT a.asset_uid, a.kind, a.tenant_id, a.company_id, a.project_id, a.head_revision_uid,
            r.digest, r.source_locator, r.source_id, r.source_revision
       FROM work_graph_assets a JOIN work_graph_revisions r
         ON r.revision_uid = a.head_revision_uid AND r.asset_uid = a.asset_uid
        AND r.tenant_id = a.tenant_id AND r.company_id = a.company_id
      WHERE a.asset_uid = ? AND a.company_id = ? AND a.approval_policy = 'human_publication'
        AND a.kind IN ('pitch_deck', 'legal_template', 'offer') AND r.tombstoned_at IS NULL
        AND r.source_store = 'd1_record'`,
  ).bind(uid, companyId).first<DraftingAsset>();
}

export type DomainRead = { doc: UnitDocument; target:
  | { kind: 'pitch_deck'; projectId: number; baseDeckId: number; title: string; createdByUserId: number }
  | { kind: 'legal_template'; templateId: number; templateSlug: string; jurisdiction: string }
  | { kind: 'offer' } };

const positiveId = (value: string) => /^[1-9][0-9]{0,14}$/.test(value) ? Number(value) : null;

/** Read the head's exact source. For publication, allow only a current row of that same domain object. */
export async function readDraftingDomain(
  env: Env, asset: DraftingAsset, userId: number, publishedId?: string,
): Promise<DomainRead | null> {
  const id = positiveId(publishedId ?? asset.source_id);
  if (asset.kind === 'pitch_deck') {
    if (asset.source_locator !== 'pitch_decks' || !id || !asset.project_id) return null;
    const original = await env.DB.prepare('SELECT project_id FROM pitch_decks WHERE id = ?').bind(positiveId(asset.source_id)).first<{ project_id: number }>();
    if (original?.project_id !== asset.project_id) return null;
    const owned = await env.DB.prepare(
      `SELECT d.id FROM pitch_decks d JOIN projects p ON p.id = d.project_id
        WHERE d.id = ? AND d.project_id = ? AND p.company_id = ? AND d.is_current = 1`,
    ).bind(id, asset.project_id, asset.company_id).first();
    if (!owned) return null;
    const row = await env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
    if (!row) return null;
    const deck = await hydrateSlides(env, row);
    const slides = typeof deck.slides === 'string' ? JSON.parse(deck.slides) : deck.slides;
    if (!Array.isArray(slides)) return null;
    return { doc: deckUnits({ ...deck, slides }), target: { kind: 'pitch_deck', projectId: asset.project_id,
      baseDeckId: id, title: deck.title, createdByUserId: userId } };
  }
  if (asset.kind === 'offer') {
    if (asset.source_locator !== 'quote_versions' || !id || asset.project_id !== null) return null;
    const row = await env.DB.prepare(
      `SELECT v.id, v.quote_id, v.version, v.change_summary, v.note, v.price_cents
         FROM quote_versions v JOIN quotes q ON q.id = v.quote_id
         JOIN quote_versions base ON base.quote_id = q.id
        WHERE v.id = ? AND base.id = ? AND q.company_id = ?
          AND NOT EXISTS (SELECT 1 FROM quote_versions later WHERE later.quote_id = q.id AND later.version > v.version)`,
    ).bind(id, positiveId(asset.source_id), asset.company_id).first<Parameters<typeof quoteUnits>[0]>();
    return row ? { doc: quoteUnits(row), target: { kind: 'offer' } } : null;
  }
  if (asset.source_locator !== 'legal_template_versions' || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(asset.source_id)) return null;
  const [templateId, baseVersion] = asset.source_id.split(':').map(Number);
  const version = publishedId === undefined ? baseVersion : positiveId(publishedId);
  if (!version || asset.project_id !== null) return null;
  const row = await env.DB.prepare(
    `SELECT v.template_id, v.version, v.body_md, v.slug
       FROM legal_template_versions v JOIN legal_templates t ON t.id = v.template_id
      WHERE v.template_id = ? AND v.version = ? AND t.version = v.version AND t.is_active = 1`,
  ).bind(templateId, version).first<{ template_id: number; version: number; body_md: string; slug: string }>();
  if (!row) return null;
  if (publishedId !== undefined) {
    const published = (await publishedContractTemplates(env)).find(p => p.template_id === templateId);
    if (published?.version !== version || published.body_md !== row.body_md) return null;
  }
  return { doc: legalTemplateUnits(row), target: { kind: 'legal_template', templateId,
    templateSlug: row.slug, jurisdiction: '' } };
}

/** A newer domain save also invalidates the old WorkGraph base, before any candidate is written. */
export async function currentDraftingDomain(env: Env, asset: DraftingAsset, userId: number): Promise<DomainRead | null> {
  const current = await readDraftingDomain(env, asset, userId);
  return current && current.doc.source.revision === asset.source_revision
    && await unitsDigest(current.doc.units) === asset.digest ? current : null;
}
