// Spin-Out Lab — Graduation Certificate view-model (pure module, no JSX).
//
// Design source: spin-out-lab-pipeline/project/Graduation Certificate.dc.html.
//
// WHAT THE DESIGN PROPOSES vs WHAT EXISTS
// The design is largely a product proposal for a credential *system*: its own
// "Data model" tab specifies five tables — certificate_templates,
// issued_certificates, certificate_badges, certificate_events,
// certificate_delivery_logs — none of which exist. Its Admin issuance tab
// (per-graduate issued/emailed/downloaded/revoked states, batch issue, an
// activity log) is entirely driven by those tables, and every value in the
// design is demo content: credential AXL-SOL-C4-0117, "Guillaume Laurent",
// NovaCraft AI, pillars 23/82/DE C-Corp/$610K, six invented graduates.
//
// The CERTIFICATE ITSELF, however, needs no new backend — every field on it
// is already a real, queryable fact:
//   founder      → GET /auth/me
//   company      → the founder's Lab project (pickLabProject)
//   cohort       → GET /spinout-lab/state → `cohort`
//   conferred    → the `incorporation_completed` milestone's completed_at,
//                  which is the same gate /graduates uses to call someone a
//                  graduate (the /exit escape hatch flips is_incorporated
//                  WITHOUT finishing the sprint and deliberately does not count)
//   jurisdiction → state.application.jurisdiction
//   duration     → started_at → conferred, computed the same way the worker
//                  computes it for the public cohort tracker
//   signatory    → legalDocFormat's AXAL_SIGNATORY_* constants (one source of
//                  truth with every other Axal-executed document)
//
// CREDENTIAL REFERENCE — deliberately named, not faked. With no issuance
// registry there is no issued serial number, so certificateRef() DERIVES a
// stable reference from the graduation record itself. It is reproducible, not
// allocated, and the UI says so. Verification follows the same principle: it
// re-checks the live graduation record rather than reading an issuance row,
// which is why there is no "revoked" state here — revocation requires the
// registry the design proposes.
//
// Not reproduced, because nothing stores them: issuance/emailed/downloaded
// state, batch issue, revoke/reissue, the activity log, delivery tracking,
// the profile-badge mint, and template versioning.

import {
  AXAL_SIGNATORY_NAME,
  AXAL_SIGNATORY_TITLE,
} from './legalDocFormat';

/** The milestone that actually defines graduation (see /graduates). */
export const GRADUATION_MILESTONE = 'incorporation_completed';

export const PROGRAM_NAME = 'Spin-Out Lab';
export const ISSUER_NAME = 'Axal VC';

/** Roman numeral for the seal, for cohorts 1..39; falls back to the digits. */
export function romanCohort(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 39) return n == null ? '' : String(n ?? '');
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let rest = v;
  for (const [val, sym] of map) {
    while (rest >= val) { out += sym; rest -= val; }
  }
  return out;
}

/** Digits out of a cohort label ("Cohort 4" → 4). Null when unlabelled. */
export function cohortNumber(cohortLabel) {
  const m = String(cohortLabel || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Stable credential reference derived from the graduation record.
 *
 * Same inputs always produce the same reference. That reproducibility is the
 * point: the worker's `credentialRefFor` (routes/spinout_certificates.ts)
 * applies the identical rule when it allocates a row, so the reference a
 * founder sees BEFORE issuance is the one the registry then issues — it does
 * not change under them the moment the credential is persisted. The two
 * implementations are kept in lockstep deliberately; a test pins them.
 *
 * A derived reference is not by itself proof of issuance. Whether a row
 * exists is answered by GET /spinout-lab/certificates/mine, and only an
 * issued row carries the public_token a third party can verify against.
 *
 * Returns null when the graduation facts needed to make it reproducible are
 * missing.
 */
export function certificateRef({ cohortLabel, conferredAt, userId }) {
  const n = cohortNumber(cohortLabel);
  const day = String(conferredAt || '').slice(0, 10);
  const uid = Number(userId);
  if (!day || !Number.isFinite(uid) || uid <= 0) return null;
  const cohortPart = n == null ? 'X' : `C${n}`;
  // Date digits + user id keep it unique per graduate without exposing a
  // sequence position (which would imply an allocation order we don't have).
  const datePart = day.replace(/-/g, '').slice(2); // YYMMDD
  return `AXL-SOL-${cohortPart}-${datePart}-${String(uid).padStart(4, '0')}`;
}

function fmtLongDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtShortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Days from start to conferral, inclusive — the worker's own rule. */
export function programDays(startedAt, conferredAt) {
  const a = Date.parse(startedAt || '');
  const b = Date.parse(conferredAt || '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(1, Math.floor((b - a) / 86_400_000) + 1);
}

/**
 * Certificate view-model.
 *
 * Returns { eligible, reason, cert, pillars, fields, verify } — `eligible`
 * false means the founder has not graduated, and `reason` says why in the
 * program's own terms. Never throws; every field is null rather than invented
 * when its source is absent.
 *
 * @param state    GET /spinout-lab/state payload
 * @param user     GET /auth/me
 * @param project  the founder's Lab project
 * @param evidence { interviews, composite, raised } — real counts/scores from
 *                 the other tools; each optional and omitted when absent.
 */
export function buildCertificateViewModel({ state, user, project, evidence } = {}) {
  const milestones = Array.isArray(state?.milestones) ? state.milestones : [];
  const gradRow = milestones.find((m) => (m?.key ?? m) === GRADUATION_MILESTONE);
  const conferredAt = gradRow?.completed_at || null;
  const eligible = Boolean(conferredAt);

  const cohortLabel = state?.cohort || null;
  const founder = (user?.name || user?.full_name || user?.email || '').trim() || null;
  const company = (project?.name || state?.application?.company_name || '').trim() || null;
  const jurisdiction = (state?.application?.jurisdiction || '').trim() || null;
  const days = programDays(state?.started_at, conferredAt);
  const ref = certificateRef({ cohortLabel, conferredAt, userId: user?.id });

  // Pillars: only the ones with a real value. The design shows four fixed
  // stats; we render the subset that actually resolved rather than padding
  // with placeholders.
  const pillars = [];
  if (Number.isFinite(Number(evidence?.interviews))) {
    pillars.push({ k: 'Interviews', v: String(Number(evidence.interviews)) });
  }
  if (Number.isFinite(Number(evidence?.composite))) {
    pillars.push({ k: 'Readiness', v: String(Math.round(Number(evidence.composite))) });
  }
  if (jurisdiction) pillars.push({ k: 'Entity', v: jurisdiction });
  if (Number.isFinite(Number(evidence?.raised)) && Number(evidence.raised) > 0) {
    const r = Number(evidence.raised);
    const v = r >= 1_000_000
      ? `$${(r / 1_000_000).toFixed(r % 1_000_000 === 0 ? 0 : 1)}M`
      : `$${Math.round(r / 1000)}K`;
    pillars.push({ k: 'Raised', v });
  }
  if (Number.isFinite(days)) pillars.push({ k: 'Days', v: String(days) });

  const cert = {
    ref,
    founder,
    company,
    cohortLabel,
    cohortNum: romanCohort(cohortNumber(cohortLabel)),
    conferred: fmtLongDate(conferredAt),
    conferredIso: conferredAt,
    jurisdiction,
    days,
    signer: AXAL_SIGNATORY_NAME,
    signerRole: `${AXAL_SIGNATORY_TITLE}, ${ISSUER_NAME}`,
    program: PROGRAM_NAME,
    issuer: ISSUER_NAME,
  };

  // "Auto-filled fields" rail — the real source of every value, so a founder
  // can see the certificate is generated, not typed.
  const fields = [
    { k: 'founder_name', v: founder, src: '/auth/me' },
    { k: 'company_name', v: company, src: 'project record' },
    { k: 'cohort', v: cohortLabel, src: 'lab state' },
    { k: 'conferred_at', v: fmtShortDate(conferredAt), src: `${GRADUATION_MILESTONE} milestone` },
    { k: 'program_days', v: days == null ? null : String(days), src: 'started_at → conferred_at' },
    { k: 'jurisdiction', v: jurisdiction, src: 'cohort application' },
    { k: 'signatory', v: `${AXAL_SIGNATORY_NAME} · ${AXAL_SIGNATORY_TITLE}`, src: 'legalDocFormat' },
    { k: 'credential_ref', v: ref, src: 'derived from the graduation record' },
  ].filter((f) => f.v);

  // Verification rows mirror the live record, not a stored issuance row.
  const verify = eligible
    ? [
        { k: 'Credential', v: ref },
        { k: 'Issued to', v: founder },
        { k: 'Company', v: company },
        { k: 'Program', v: cohortLabel ? `${PROGRAM_NAME} · ${cohortLabel}` : PROGRAM_NAME },
        { k: 'Conferred', v: fmtLongDate(conferredAt) },
      ].filter((r) => r.v)
    : [];

  let reason = null;
  if (!eligible) {
    reason = state?.active
      ? 'Your certificate is conferred when you complete incorporation — the final Week-4 milestone.'
      : 'This credential is issued to Spin-Out Lab graduates.';
  }

  return { eligible, reason, cert, pillars, fields, verify };
}

/** Download filename for the PDF. */
export function certificateFilename(ref, company) {
  const base = ref || `spin-out-lab-certificate-${(company || 'certificate')}`;
  return `${String(base).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
}
