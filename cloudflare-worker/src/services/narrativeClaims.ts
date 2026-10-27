/**
 * D912 (#2696) — one narrative version's claims, as the Claims tab (NAR6),
 * the claim lightbox (NAR7, NAR7b) and the Check tab (NAR8) draw them, from
 * D1264's store (`raise_claims`, `surface = 'narrative'`) and nothing else.
 * The states are the claim check's; this file re-derives none of them.
 *
 * Each claim: its section, the figure it states, its state, the best source
 * among the records that decided it, the founder's note when one applies
 * (D900's "Keep mine, with a note", migration 645), and when it was checked.
 *
 * THE RECORD'S FIGURE IS THE FOUNDER'S ONLY. An Admin (D914) and anyone else
 * the narrative admits reads states, sections and sources, never a record's
 * value and never the candidates a Not-backed claim could be linked to: a
 * record's figure is Evidence the founder has not shared (D1265).
 */
import type { Env } from '../types';
import { NARRATIVE_SECTIONS } from './narrative/store';
import { EVIDENCE_RULES } from './raiseEvidenceSources';
import { FIGURE_LABEL, fmtFigure, type FigureKey } from './raiseCycle';
import { SOURCE_RANK } from './raiseClaims';

const BY_DECK_KEY = new Map(NARRATIVE_SECTIONS.filter((s) => s.deckKey).map((s) => [s.deckKey as string, s]));
const BY_KEY = new Map(NARRATIVE_SECTIONS.map((s) => [s.key, s]));

/** The section a claim's field sits in: a deck key, `why_now`, or `section:<key>`; null for any other field. */
export function sectionOf(fieldKey: string): { key: string; label: string } | null {
  const field = String(fieldKey).split('#')[0];
  const spec = field.startsWith('section:') ? BY_KEY.get(field.slice(8)) : field === 'why_now' ? BY_KEY.get('why_now') : BY_DECK_KEY.get(field);
  return spec ? { key: spec.key, label: spec.label } : null;
}

type ClaimRow = {
  id: number; uid: string; field_key: string; claim_kind: string; stated_value: string | null; state: string; checked_at: string | null;
  note: string | null; note_value: string | null; noted_at: string | null;
};
type LinkRow = { claim_id: number; how: string; uid: string; kind: string; source_label: string; provider: string | null; observed_on: string | null; value_num: number | null };
type ItemRow = { uid: string; kind: string; source_label: string; provider: string | null; observed_on: string | null };

const show = (kind: string, v: number | null) => (v == null ? null : kind in FIGURE_LABEL ? fmtFigure(kind as FigureKey, v) : String(v));

/**
 * The claims of narrative version `version` (a number, as `/narrative/:version`
 * takes it). `founder` decides whether record figures and candidates are read.
 */
export async function narrativeClaims(env: Env, projectId: number, version: number, founder: boolean) {
  const surfaceVersion = `v${version}`;
  const rows = (await env.DB.prepare(
    `SELECT id, uid, field_key, claim_kind, stated_value, state, checked_at, note, note_value, noted_at
       FROM raise_claims WHERE project_id = ? AND surface = 'narrative' AND surface_version = ? ORDER BY field_key, id`,
  ).bind(projectId, surfaceVersion).all<ClaimRow>()).results || [];
  const links = rows.length ? (await env.DB.prepare(
    `SELECT l.claim_id, l.how, i.uid, i.kind, i.source_label, i.provider, i.observed_on, i.value_num
       FROM raise_claim_evidence l JOIN raise_evidence_items i ON i.id = l.item_id AND i.project_id = l.project_id
      WHERE l.project_id = ? AND l.claim_id IN (SELECT value FROM json_each(?))`,
  ).bind(projectId, JSON.stringify(rows.map((r) => r.id))).all<LinkRow>()).results || [] : [];
  const notBacked = rows.filter((r) => r.state === 'not_backed');
  // Records that could back a Not-backed claim: pinned items whose kind backs the claim's figure (D1263's `backs`).
  const pinned = founder && notBacked.length ? (await env.DB.prepare(
    `SELECT uid, kind, source_label, provider, observed_on FROM raise_evidence_items WHERE project_id = ? AND state = 'pinned' ORDER BY id`,
  ).bind(projectId).all<ItemRow>()).results || [] : [];

  const claims = rows.map((r) => {
    const own = links.filter((l) => Number(l.claim_id) === Number(r.id));
    const best = [...own].sort((a, b) => (SOURCE_RANK[a.source_label as keyof typeof SOURCE_RANK] ?? 99) - (SOURCE_RANK[b.source_label as keyof typeof SOURCE_RANK] ?? 99)
      || String(b.observed_on ?? '').localeCompare(String(a.observed_on ?? '')))[0] ?? null;
    const stated = r.stated_value == null ? null : Number(r.stated_value);
    const noteApplies = r.note != null && r.note_value === r.stated_value;
    return {
      id: r.uid,
      section: sectionOf(r.field_key),
      figure: r.claim_kind in FIGURE_LABEL ? FIGURE_LABEL[r.claim_kind as FigureKey] : r.claim_kind,
      kind: r.claim_kind,
      stated: show(r.claim_kind, Number.isFinite(stated) ? stated : null),
      state: r.state,
      checked_at: r.checked_at,
      // The best-sourced record that decided the state: its source and date for everyone, its figure for the founder only.
      source: best ? { label: best.source_label, provider: best.provider, observed_on: best.observed_on, record: founder ? show(r.claim_kind, best.value_num) : undefined } : null,
      linked: own.filter((l) => l.how !== 'computed').length,
      note: noteApplies ? { text: founder ? r.note : undefined, at: r.noted_at } : null,
      note_outdated: r.note != null && !noteApplies,
      candidates: founder && r.state === 'not_backed'
        ? pinned.filter((i) => EVIDENCE_RULES.find((rule) => rule.kind === i.kind)?.backs.includes(r.claim_kind))
          .map((i) => ({ id: i.uid, kind: i.kind, source_label: i.source_label, provider: i.provider, observed_on: i.observed_on }))
        : undefined,
    };
  });
  const checked = rows.map((r) => r.checked_at).filter(Boolean).sort().at(-1) ?? null;
  return { version, founder, checked_at: checked, claims };
}
