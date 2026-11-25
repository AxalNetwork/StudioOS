/**
 * D5585 part 12 (#5585, WorkGraph P1 under the #5577 epic): render approvals tied to #5586's budgets. A release that
 * pins a render (a video render, a brand image) cannot be approved or published unless that render went through
 * #5586's swarm admission and settled, at a measured cost, within what admission reserved for it. Pure: it reads the
 * swarm state the caller passes and the revision rows the release services already read, and writes nothing.
 * Decision: `documentation/architecture/decisions/D5585-p12.md`.
 *
 * NO SECOND LEDGER. The admission record is #5586's own: the ticket in `SwarmState.tickets`, keyed by the agent run's
 * uid (a ticket's uid is the run that writes the revision), and its refusal in `SwarmState.audit`. The cost basis is
 * the read model's own (`costEntriesFromTickets`): a reserve charged because metrics were missing is not a measured
 * cost, so it never satisfies this requirement.
 *
 * WHICH PIECES ARE RENDERS. A revision an agent run wrote, of kind `video` (modality `video_render`), or of kind
 * `image` or `brand` with an image media profile (modality `brand_image`). A person's upload spent no swarm budget and
 * is not a render; a brand-token revision of a `brand` asset is a record, not an image. Every other piece is untouched.
 */
import { ventureKey, type Modality, type SwarmState, type SwarmTicket } from './agents/swarmAdmission';
import { costEntriesFromTickets } from './agents/swarmCapacity';

/** The requirement this part adds to a release's evaluation. It is read, never attested (D5585-p12 §2). */
export const RENDER_REQUIREMENT = 'render_admitted' as const;

/**
 * Why a pinned render does not meet `render_admitted`, the first that applies:
 *   admission_unverified  the caller passed no swarm state, so nothing was read (never assumed admitted)
 *   not_admitted          this venture's swarm holds no ticket and no refusal for the run that wrote it
 *   refused               admission refused the run's request; `admissionCode` is its code (no_capacity, budget_exhausted…)
 *   other_modality        the run's ticket was admitted for another modality
 *   other_revision        the run's ticket was for another asset, or for another base than the revision was built on
 *   waiting               still queued; `admissionCode` is why (venture_capacity, modality_capacity, budget_exhausted…)
 *   withdrawn             ended without running; `admissionCode` is its end code (withdrawn, agent_revoked)
 *   not_settled           admitted and not settled yet, so its cost is not known
 *   cost_unknown          settled without metrics: charged its reserve, an upper bound, never a measured cost
 *   over_budget           settled above the reserve admission held against the venture's render budget
 */
export const RENDER_GAPS = [
  'admission_unverified', 'not_admitted', 'refused', 'other_modality', 'other_revision', 'waiting', 'withdrawn',
  'not_settled', 'cost_unknown', 'over_budget',
] as const;
export type RenderGapReason = (typeof RENDER_GAPS)[number];

/** The revision columns this reads, all from `work_graph_revisions` joined to its asset (`readComponents`). */
export interface RenderRevisionRow {
  revision_uid: string; asset_uid: string; tenant_id: number; company_id: number; kind: string;
  actor_kind: string; agent_run_id: string | null; parent_uids_json: string; media_profile: string;
}

export interface RenderAdmission {
  modality: Extract<Modality, 'video_render' | 'brand_image'>;
  /** The run that wrote the revision, which is the swarm ticket's uid. */
  ticketUid: string;
  /** Null when `render_admitted` holds. */
  gap: RenderGapReason | null;
  /** #5586's own code behind a `refused`, `waiting` or `withdrawn` gap; null otherwise. */
  admissionCode: string | null;
  /** The settled charge and the reserve admission held for it, when the ticket settled; null otherwise. */
  chargedMicrousd: number | null;
  reserveMicrousd: number | null;
}

/** The modality a pinned revision was rendered under, or null when it is not a render. */
export function renderModality(row: Pick<RenderRevisionRow, 'kind' | 'actor_kind' | 'agent_run_id' | 'media_profile'>): RenderAdmission['modality'] | null {
  if (row.actor_kind !== 'agent' || !row.agent_run_id) return null;
  if (row.kind === 'video') return 'video_render';
  if ((row.kind === 'image' || row.kind === 'brand') && /^image\//i.test(String(row.media_profile))) return 'brand_image';
  return null;
}

const parentsOf = (json: string): string[] => {
  try { const p = JSON.parse(json); return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};

/**
 * Whether one pinned revision meets `render_admitted`, from #5586's swarm state. Null when the revision is not a
 * render. Only a ticket and a refusal of the revision's own tenant and company count: another venture's record under
 * the same run uid is treated as absent, so it never satisfies, and never shows, another tenant's render.
 */
export function renderAdmissionOf(row: RenderRevisionRow, swarm: SwarmState | null | undefined): RenderAdmission | null {
  const modality = renderModality(row);
  if (!modality) return null;
  const ticketUid = row.agent_run_id as string;
  const gap = (g: RenderGapReason, admissionCode: string | null = null, t?: SwarmTicket): RenderAdmission => ({
    modality, ticketUid, gap: g, admissionCode,
    chargedMicrousd: t?.state === 'settled' && Number.isSafeInteger(t.charged_microusd) ? t.charged_microusd : null,
    reserveMicrousd: t?.state === 'settled' ? t.reserve_held_microusd : null,
  });
  if (!swarm || typeof swarm !== 'object' || !swarm.tickets || !Array.isArray(swarm.audit)) return gap('admission_unverified');
  const venture = ventureKey(row);
  const found = Object.prototype.hasOwnProperty.call(swarm.tickets, ticketUid) ? swarm.tickets[ticketUid] : undefined;
  const t = found && ventureKey(found) === venture ? found : undefined;
  if (!t) {
    const refusal = swarm.audit.filter((a) => a.ticket_uid === ticketUid && ventureKey(a) === venture && a.action === 'request' && a.outcome === 'refused').at(-1);
    return refusal ? gap('refused', refusal.code) : gap('not_admitted');
  }
  if (t.modality !== modality) return gap('other_modality', null, t);
  const parents = parentsOf(row.parent_uids_json);
  if (t.asset_uid !== row.asset_uid || (t.base_revision_uid === null ? parents.length !== 0 : !parents.includes(t.base_revision_uid))) {
    return gap('other_revision', null, t);
  }
  if (t.state === 'waiting') return gap('waiting', t.wait_reason, t);
  if (t.state === 'withdrawn') return gap('withdrawn', t.end_code, t);
  if (t.state !== 'settled') return gap('not_settled', null, t);
  const bill = costEntriesFromTickets([t])[0];
  if (!bill || bill.basis !== 'measured') return gap('cost_unknown', null, t);
  if ((t.charged_microusd as number) > t.reserve_held_microusd) return gap('over_budget', null, t);
  return { ...gap('not_settled', null, t), gap: null };
}
