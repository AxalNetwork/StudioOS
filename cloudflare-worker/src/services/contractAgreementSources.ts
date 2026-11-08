/**
 * D5050 (#5050, part 3 of #5047) — the licence agreements in the Contracts registry: the master territory
 * licence agreements (`licence_contracts`, D110/D4671) and the package and program agreements
 * (`licence_program_agreements`, D5048/D5049), indexed into `GET /api/admin/contracts`'s union.
 *
 * ONE DOCUMENT, ONE ROW. A version that has an envelope IS that envelope's document, and the union already
 * holds the envelope (source `esign`). So the version is not added as a second row: its context is attached to
 * the envelope's row (`agreement`), and the row keeps `source: 'esign'`, so open, history, download, resend
 * and void dispatch as before. Only a version with no envelope on file (a draft, a version voided before it
 * was sent, a backfilled schedule whose envelope row is missing) is a row of its own, `licence_agreement` or
 * `licence_contract`, under a synthetic uid.
 *
 * THE LEGAL STATE IS THE DOCUMENT'S. `agreement.legal_status` is draft, awaiting_signature, executed,
 * superseded or voided, read from the version and its envelope, never from the program grant's state.
 *
 * A store this database does not have yet reads as no rows (an older D1, or a test database built without
 * the licence tables); any other failure is thrown to the caller, which answers "unreadable".
 */
import { programOf } from './programGrants';
import { packageOf } from './agreementTemplates';

export const AGREEMENT_TYPES = ['territory_licence', 'package', 'program_licence', 'program_schedule_addendum'] as const;
export type AgreementType = typeof AGREEMENT_TYPES[number];
export const LEGAL_STATUSES = ['draft', 'awaiting_signature', 'executed', 'superseded', 'voided'] as const;
export type LegalStatus = typeof LEGAL_STATUSES[number];
export const LEGAL_STATUS_LABELS: Record<LegalStatus, string> = {
  draft: 'Draft', awaiting_signature: 'Awaiting signature', executed: 'Executed', superseded: 'Superseded', voided: 'Voided',
};
export const AGREEMENT_TYPE_LABELS: Record<AgreementType, string> = {
  territory_licence: 'Territory licence', package: 'Package agreement', program_licence: 'Program licence',
  program_schedule_addendum: 'Program schedule / addendum',
};

export type AgreementContext = {
  /** The canonical version's own uid, in its own store. */
  agreement_uid: string;
  store: 'licence_program_agreements' | 'licence_contracts';
  agreement_kind: string;
  agreement_type: AgreementType;
  agreement_type_label: string;
  licence_uid: string;
  licence_ref: string | null;
  territory: string[];
  package_key: string | null;
  package_name: string | null;
  package_version: number | null;
  program_key: string | null;
  program_name: string | null;
  counterparty: string | null;
  template_slug: string;
  template_version: number | null;
  legal_status: LegalStatus;
  legal_status_label: string;
  is_current: boolean;
  created_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  superseded_at: string | null;
  envelope_uuid: string | null;
  provider: 'native' | 'docusign' | null;
  /** Whether a signed PDF is on file for the envelope; a draft's stored text is not a signed document. */
  document_available: boolean;
  document_reason: string | null;
  links: {
    licence: string;
    program_access: string | null;
    package: string | null;
    package_reason: string | null;
  };
};

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

const MISSING_TABLE = /no such table/i;

function typeOf(kind: string): AgreementType {
  if (kind === 'licence_master') return 'territory_licence';
  if (kind === 'package_master' || kind === 'package_addendum') return 'package';
  if (kind === 'program_licence') return 'program_licence';
  return 'program_schedule_addendum';
}

/** A package or program version's legal state, from its own status and its envelope's. */
export function programAgreementLegalStatus(status: string, envelopeStatus: string | null): LegalStatus {
  if (status === 'superseded') return 'superseded';
  if (status === 'voided') return 'voided';
  if (status === 'executed') return 'executed';
  if (status === 'draft' || status === 'ready') return 'draft';
  // In flight (sent / partially signed): the envelope may have moved before the version was told.
  if (envelopeStatus === 'completed') return 'executed';
  if (envelopeStatus === 'void' || envelopeStatus === 'rejected') return 'voided';
  return 'awaiting_signature';
}

/** A master licence contract's legal state: superseded on its row, otherwise its envelope's (D451). */
export function licenceContractLegalStatus(supersededAt: string | null, envelopeStatus: string | null, rowStatus: string): LegalStatus {
  if (supersededAt) return 'superseded';
  if (envelopeStatus === 'completed') return 'executed';
  if (envelopeStatus === 'void' || envelopeStatus === 'rejected') return 'voided';
  if (envelopeStatus === 'sent' || envelopeStatus === 'partially_signed' || envelopeStatus === 'viewed') return 'awaiting_signature';
  if (rowStatus === 'signed') return 'executed';
  if (rowStatus === 'void') return 'voided';
  return rowStatus === 'sent' ? 'awaiting_signature' : 'draft';
}

function context(r: any, store: AgreementContext['store'], legal: LegalStatus): AgreementContext {
  const type = typeOf(String(r.agreement_kind));
  const program = r.program_key ? programOf(String(r.program_key)) : null;
  const pkg = r.package_key ? packageOf(String(r.package_key)) : null;
  const signed = !!r.signed_r2_key;
  const licenceUid = String(r.licence_uid);
  return {
    agreement_uid: String(r.uid),
    store,
    agreement_kind: String(r.agreement_kind),
    agreement_type: type,
    agreement_type_label: AGREEMENT_TYPE_LABELS[type],
    licence_uid: licenceUid,
    licence_ref: r.licence_ref ?? null,
    territory: r.territory ? String(r.territory).split(',').filter(Boolean) : [],
    package_key: r.package_key ?? null,
    package_name: pkg?.name ?? (r.package_key ? String(r.package_key) : null),
    package_version: r.package_version ?? null,
    program_key: r.program_key ?? null,
    program_name: program?.name ?? (r.program_key ? String(r.program_key) : null),
    counterparty: r.legal_entity_name || r.brand_name || null,
    template_slug: String(r.template_slug),
    template_version: r.template_version ?? null,
    legal_status: legal,
    legal_status_label: LEGAL_STATUS_LABELS[legal],
    is_current: legal !== 'superseded' && legal !== 'voided',
    created_at: r.created_at ?? null,
    sent_at: r.sent_at ?? null,
    signed_at: r.signed_at ?? r.completed_at ?? null,
    effective_from: r.effective_from ?? null,
    effective_to: r.effective_to ?? null,
    superseded_at: r.superseded_at ?? null,
    envelope_uuid: r.envelope_uuid ?? null,
    provider: r.envelope_uuid ? (r.provider === 'docusign' ? 'docusign' : 'native') : null,
    document_available: signed,
    document_reason: signed ? null : r.envelope_uuid ? 'No signed PDF is on file for this envelope yet.' : 'Not sent: there is no envelope or signed document yet.',
    links: {
      licence: `/admin/licences/${encodeURIComponent(licenceUid)}`,
      program_access: program || r.program_key ? `/admin/licences/programs/studio/${encodeURIComponent(licenceUid)}` : null,
      package: null,
      package_reason: type === 'package' ? 'There is no package page yet (#5021 builds the package store).' : null,
    },
  };
}

/** Every licence agreement version on file, with its context; [] for a store this database does not have. */
export async function loadLicenceAgreementContexts(sql: Sql): Promise<AgreementContext[]> {
  const out: AgreementContext[] = [];
  try {
    const rows = await sql`
      SELECT a.uid, a.licence_uid, a.agreement_kind, a.program_key, a.package_key, a.package_version, a.template_slug,
             a.template_version, a.status, a.envelope_uuid, a.created_at, a.sent_at, a.signed_at, a.effective_from,
             a.effective_to, a.superseded_at,
             l.licence_ref, l.legal_entity_name, l.brand_name,
             (SELECT group_concat(t.country_code, ',') FROM (SELECT country_code FROM licence_territories
                WHERE licence_id = l.id ORDER BY country_code) t) AS territory,
             e.status AS envelope_status, e.provider, e.signed_r2_key, e.completed_at
        FROM licence_program_agreements a
        LEFT JOIN territory_licences l ON l.uid = a.licence_uid
        LEFT JOIN esign_envelopes e ON e.envelope_uuid = a.envelope_uuid
       ORDER BY a.id`;
    for (const r of rows) out.push(context(r, 'licence_program_agreements', programAgreementLegalStatus(String(r.status), r.envelope_status ?? null)));
  } catch (e) {
    if (!MISSING_TABLE.test(String((e as Error)?.message))) throw e;
  }
  try {
    const rows = await sql`
      SELECT c.uid, c.licence_uid, 'licence_master' AS agreement_kind, NULL AS program_key, NULL AS package_key,
             NULL AS package_version, c.template_slug, c.template_version, c.status, c.envelope_uid AS envelope_uuid,
             c.created_at, c.sent_at, c.signed_at, NULL AS effective_from, NULL AS effective_to, c.superseded_at,
             l.licence_ref, l.legal_entity_name, l.brand_name,
             (SELECT group_concat(t.country_code, ',') FROM (SELECT country_code FROM licence_territories
                WHERE licence_id = l.id ORDER BY country_code) t) AS territory,
             e.status AS envelope_status, e.provider, e.signed_r2_key, e.completed_at
        FROM licence_contracts c
        LEFT JOIN territory_licences l ON l.uid = c.licence_uid
        LEFT JOIN esign_envelopes e ON e.envelope_uuid = c.envelope_uid
       ORDER BY c.id`;
    for (const r of rows) out.push(context(r, 'licence_contracts', licenceContractLegalStatus(r.superseded_at ?? null, r.envelope_status ?? null, String(r.status))));
  } catch (e) {
    if (!MISSING_TABLE.test(String((e as Error)?.message))) throw e;
  }
  return out;
}

/** The query filters this file adds to `GET /api/admin/contracts`, validated; null fields filter nothing. */
export type AgreementFilters = {
  agreement_type: AgreementType | null;
  agreement_status: LegalStatus | null;
  licence: string | null;
  program: string | null;
  package: string | null;
  signed_from: string | null;
  signed_to: string | null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const LICENCE = /^[A-Za-z0-9_-]{1,64}$/;

/** The filters from a query, or the name of the first one that is not a value the registry knows. */
export function agreementFilters(q: Record<string, string | undefined>): { ok: true; filters: AgreementFilters } | { ok: false; field: string } {
  const pick = (k: string) => (q[k] ?? '').trim() || null;
  const f: AgreementFilters = {
    agreement_type: pick('agreement_type') as AgreementType | null,
    agreement_status: pick('agreement_status') as LegalStatus | null,
    licence: pick('licence'), program: pick('program'), package: pick('package'),
    signed_from: pick('signed_from'), signed_to: pick('signed_to'),
  };
  if (f.agreement_type && !(AGREEMENT_TYPES as readonly string[]).includes(f.agreement_type)) return { ok: false, field: 'agreement_type' };
  if (f.agreement_status && !(LEGAL_STATUSES as readonly string[]).includes(f.agreement_status)) return { ok: false, field: 'agreement_status' };
  if (f.licence && !LICENCE.test(f.licence)) return { ok: false, field: 'licence' };
  if (f.program && !KEY.test(f.program)) return { ok: false, field: 'program' };
  if (f.package && !KEY.test(f.package)) return { ok: false, field: 'package' };
  if (f.signed_from && !DATE.test(f.signed_from)) return { ok: false, field: 'signed_from' };
  if (f.signed_to && !DATE.test(f.signed_to)) return { ok: false, field: 'signed_to' };
  return { ok: true, filters: f };
}

/** Whether any agreement filter is set: then only rows carrying an agreement context can match. */
export const anyAgreementFilter = (f: AgreementFilters) => Object.values(f).some((v) => v !== null);

/** Whether a row with this context (or none) passes the filters. */
export function matchesAgreementFilters(a: AgreementContext | null | undefined, f: AgreementFilters, signedAt: string | null): boolean {
  if (!anyAgreementFilter(f)) return true;
  if (f.signed_from || f.signed_to) {
    const day = signedAt ? String(signedAt).slice(0, 10) : null;
    if (!day) return false;
    if (f.signed_from && day < f.signed_from) return false;
    if (f.signed_to && day > f.signed_to) return false;
  }
  const onlyDates = !f.agreement_type && !f.agreement_status && !f.licence && !f.program && !f.package;
  if (onlyDates) return true;
  if (!a) return false;
  if (f.agreement_type && a.agreement_type !== f.agreement_type) return false;
  if (f.agreement_status && a.legal_status !== f.agreement_status) return false;
  if (f.licence && a.licence_uid !== f.licence && (a.licence_ref ?? '').toLowerCase() !== f.licence.toLowerCase()) return false;
  if (f.program && a.program_key !== f.program) return false;
  if (f.package && a.package_key !== f.package) return false;
  return true;
}
