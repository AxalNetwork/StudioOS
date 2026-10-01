/**
 * What S21's strip says for a licence administrator whose branch is not
 * deployed yet (D287) — decided here, in one pure place, so a test can put
 * every payload through it without a renderer.
 *
 * THE FACT IS THE LICENCE'S `deployment` FIELD (routes/licence.ts, HQ arm of
 * /api/licence/mine), and this file re-derives nothing the worker already
 * decided: `requested` is whether a row exists, `live` is the worker's one
 * rule (`linked`), `readable` is whether the read succeeded. What this file
 * adds is the drawing — which of S21's nine chips is lit — and the sentences.
 *
 * NO TIME, AND WHY. S21 captions the chips "last step schema applied at
 * deployment.last_step_at". No such column exists, and nothing writes a step
 * time: provisioning writes `requested` at the INSERT and `failed` on its two
 * refusals, `branch-provision.yml` bumps `updated_at` when it stores the RPC
 * hash, and the intermediate seven statuses are never written at all. So
 * `requested_at` is the request, `updated_at` is whichever write came last,
 * and neither is a step's time. The strip says so rather than dressing one of
 * them up; the step writer is filed in D287.
 */

/** S21's nine chips, in its order and its words. */
export const NOT_DEPLOYED_STEPS = [
  ['not_requested', 'not requested'],
  ['requested', 'requested'],
  ['database_created', 'database created'],
  ['schema_applied', 'schema applied'],
  ['secrets_present', 'secrets present'],
  ['principal_seeded', 'principal seeded'],
  ['worker_live', 'worker live'],
  ['hostname_active', 'hostname active'],
  ['linked', 'linked to HQ'],
];

/** S21's three rules, verbatim. */
export const NOT_DEPLOYED_RULES = [
  'Cannot be dismissed. It is the fact of the account, not a notice.',
  'Stores nothing. It reads the deployment record on the licence.',
  'Disappears the moment the branch is live; the shell then reads the branch database.',
];

export const NOT_DEPLOYED_SUBLINE = 'The eight rows below the strip are the S20 shell. Nothing on this page reads the '
  + 'branch database, because it does not exist yet.';

/** Why the caption carries no time, in place of S21's `deployment.last_step_at`. */
export const NO_STEP_TIME_REASON = 'Recorded on the licence · no step time is recorded: provisioning writes only '
  + '“requested” and “failed” today, and the time on the record is the request or whichever write came last, '
  + 'not a step’s.';

export const UNREADABLE = 'Unreadable';

/** What to call the licence on the strip: its brand, or its entity, or its reference. */
export function brandOf(licence) {
  const brand = String(licence?.brand_name ?? '').trim();
  if (brand) return brand;
  const entity = String(licence?.legal_entity_name ?? '').trim();
  if (entity) return entity;
  const ref = String(licence?.licence_ref ?? '').trim();
  return ref || null;
}

/**
 * The strip's model, or null when there is no strip to draw.
 *
 * @param {object|null|undefined} payload the /api/licence/mine answer:
 *   `{ none: true }` for a 404 (administers none), or `{ licence, deployment }`.
 * @returns {null|{brand: string|null, unreadable: boolean, failed: boolean, note: string|null,
 *   status: string|null, chips: Array<{key: string, label: string, state: 'ok'|'wait'|'unknown'}>}}
 */
export function notDeployedStrip(payload) {
  if (!payload || payload.none || !payload.licence) return null;
  const d = payload.deployment;
  // An older worker that answers no `deployment` at all is a read this file
  // cannot make, and a strip drawn on it would be a claim: no strip.
  if (!d || typeof d !== 'object') return null;
  const brand = brandOf(payload.licence);

  if (d.readable === false) {
    return {
      brand,
      unreadable: true,
      failed: false,
      note: d.reason || null,
      status: null,
      chips: NOT_DEPLOYED_STEPS.map(([key, label]) => ({ key, label, state: 'unknown' })),
    };
  }
  // GONE THE MOMENT THE BRANCH IS LIVE — the worker's word, never re-derived
  // from the status here.
  if (d.live === true) return null;

  // "not requested" is `requested === false` — the absence of a row — and
  // never a stored status. A row whose status happened to read
  // 'not_requested' would still be a request that exists.
  if (d.requested === false) {
    return {
      brand,
      unreadable: false,
      failed: false,
      note: null,
      status: null,
      chips: NOT_DEPLOYED_STEPS.map(([key, label], i) => ({ key, label, state: i === 0 ? 'ok' : 'wait' })),
    };
  }

  const at = NOT_DEPLOYED_STEPS.findIndex(([key]) => key === d.status);
  // `failed`, or a status the timeline does not know: which step it reached is
  // not recorded (lib/deployTimeline.js's rule), so every chip is unknown.
  const failed = at < 1;
  return {
    brand,
    unreadable: false,
    failed,
    note: d.status_note || null,
    status: d.status || null,
    chips: NOT_DEPLOYED_STEPS.map(([key, label], i) => ({
      key,
      label,
      state: failed ? 'unknown' : (i >= 1 && i <= at ? 'ok' : 'wait'),
    })),
  };
}
