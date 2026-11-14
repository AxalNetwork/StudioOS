/**
 * D5582 part 2 (#5582) — the writer for `legal_template_research_drafts`: a proposed revision of an existing legal
 * template, waiting for counsel. Migration 202611071051 declared the table (one draft per template and
 * jurisdiction, `pending_counsel_review`), and nothing wrote it until now.
 *
 * WHAT IT GUARANTEES.
 *   - A draft never replaces another. While one exists for the template and jurisdiction, a second is refused with
 *     `draft_waiting` and the existing row is returned to the caller, untouched (the owner's rule, 2026-11-14).
 *   - Nothing here touches `legal_templates`, `legal_template_versions`, publications or any signed record. A draft
 *     becomes a template version only through counsel's review and the existing publish path.
 *   - `review_notes` carries a fixed sentence and the candidate's digest, never clause text.
 *
 * Every statement is literal SQL with its values bound.
 */

import type { Env } from '../types';

export interface ResearchDraftInput {
  templateId: number;
  /** Carried as written on the template row, so the research queue view can name it. */
  templateSlug: string;
  jurisdiction: string;
  bodyMd: string;
  /** The WorkGraph candidate digest the draft carries (D5579): lowercase hex SHA-256. */
  candidateDigest: string;
}

export interface ResearchDraftRow {
  id: number;
  template_id: number;
  jurisdiction: string;
  draft_body_md: string;
  status: string;
}

export type ResearchDraftResult =
  | { ok: true; id: number }
  | { ok: false; code: 'draft_waiting'; existing: ResearchDraftRow }
  | { ok: false; code: 'not_found' | 'malformed' };

const HEX64 = /^[0-9a-f]{64}$/;
const JURISDICTION = /^[A-Za-z][A-Za-z0-9 _.-]{0,39}$/;
/** A draft longer than this is refused, as an outsized template is (counsel reads every word). */
export const RESEARCH_DRAFT_MAX_CHARS = 200_000;

/** The draft for a template and jurisdiction, whatever its status, or null. */
export async function readResearchDraft(env: Pick<Env, 'DB'>, templateId: number, jurisdiction: string): Promise<ResearchDraftRow | null> {
  return env.DB.prepare(
    'SELECT id, template_id, jurisdiction, draft_body_md, status FROM legal_template_research_drafts WHERE template_id = ? AND jurisdiction = ?',
  ).bind(templateId, jurisdiction).first<ResearchDraftRow>();
}

/** Write one draft for counsel, or refuse: never overwrite a draft that is already there. */
export async function proposeResearchDraft(env: Pick<Env, 'DB'>, input: ResearchDraftInput): Promise<ResearchDraftResult> {
  if (!Number.isSafeInteger(input.templateId) || input.templateId < 1 || !JURISDICTION.test(String(input.jurisdiction))
    || typeof input.bodyMd !== 'string' || !input.bodyMd.trim() || input.bodyMd.length > RESEARCH_DRAFT_MAX_CHARS
    || !HEX64.test(String(input.candidateDigest))) {
    return { ok: false, code: 'malformed' };
  }
  const tpl = await env.DB.prepare('SELECT id, slug FROM legal_templates WHERE id = ?').bind(input.templateId).first<{ id: number; slug: string }>();
  if (!tpl || tpl.slug !== input.templateSlug) return { ok: false, code: 'not_found' };
  const existing = await readResearchDraft(env, input.templateId, input.jurisdiction);
  if (existing) return { ok: false, code: 'draft_waiting', existing };
  const note = `WorkGraph merged candidate ${input.candidateDigest}; pending counsel review. Nothing is published until counsel approves.`;
  try {
    const res = await env.DB.prepare(
      `INSERT INTO legal_template_research_drafts (template_id, template_slug, jurisdiction, draft_body_md, review_notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(input.templateId, tpl.slug, input.jurisdiction, input.bodyMd, note).run();
    return { ok: true, id: Number((res as any)?.meta?.last_row_id ?? 0) };
  } catch (e) {
    // A concurrent writer won the UNIQUE(template_id, jurisdiction) race: theirs stands.
    const raced = await readResearchDraft(env, input.templateId, input.jurisdiction);
    if (raced) return { ok: false, code: 'draft_waiting', existing: raced };
    throw e;
  }
}
