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
 * D5060 (#5060, user licences 4/4) — THE USER LICENCE AGREEMENTS AND THE LICENCE ON EVERY ROW.
 *   - A Founder, Investor, Operating Partner or Advisor Licence Agreement is an e-sign envelope of its Contracts
 *     template (`USER_LICENCE_AGREEMENT_TEMPLATES`). The envelope is the canonical document, so its context
 *     rides on the envelope's row like every other licence agreement, and its `agreement_uid` is the envelope
 *     uuid: the uid the licence registry's detail read names too (`services/licenceRegistry.ts`).
 *   - Every context carries the shared licence's family, type and holder (D5057's `licences`), so a row says
 *     whose licence it is and of what type, and the list filters by family, type, holder and territory.
 *
 * A store this database does not have yet reads as no rows (an older D1, or a test database built without
 * the licence tables); any other failure is thrown to the caller, which answers "unreadable".
 */
import { programOf } from './programGrants';
import { packageOf } from './agreementTemplates';

export const AGREEMENT_TYPES = [
  'territory_licence', 'founder_licence', 'investor_licence', 'operating_partner_licence', 'advisor_licence',
  'package', 'program_licence', 'program_schedule_addendum',
] as const;
export type AgreementType = typeof AGREEMENT_TYPES[number];
export const LEGAL_STATUSES = ['draft', 'awaiting_signature', 'executed', 'superseded', 'voided'] as const;
export type LegalStatus = typeof LEGAL_STATUSES[number];
export const LEGAL_STATUS_LABELS: Record<LegalStatus, string> = {
  draft: 'Draft', awaiting_signature: 'Awaiting signature', executed: 'Executed', superseded: 'Superseded', voided: 'Voided',
};
export const AGREEMENT_TYPE_LABELS: Record<AgreementType, string> = {
  territory_licence: 'Territory licence', package: 'Package agreement', program_licence: 'Program licence',
  program_schedule_addendum: 'Program schedule / addendum',
  // D5060: one agreement per user licence type.
  founder_licence: 'Founder Licence Agreement', investor_licence: 'Investor Licence Agreement',
  operating_partner_licence: 'Operating Partner Licence Agreement', advisor_licence: 'Advisor Licence Agreement',
};

/** D5060: the licence families and types of the shared registry (D5057), as the filters accept them. */
export const LICENCE_FAMILIES = ['operator', 'user'] as const;
export const LICENCE_TYPES = ['territory', 'white_label', 'master_franchise', 'founder', 'investor', 'operating_partner', 'advisor'] as const;
export const USER_LICENCE_TYPES = ['founder', 'investor', 'operating_partner', 'advisor'] as const;
export type UserLicenceType = typeof USER_LICENCE_TYPES[number];
export const LICENCE_TYPE_LABELS: Record<string, string> = {
  territory: 'Territory licence', white_label: 'White-label licence', master_franchise: 'Master franchise licence',
  founder: 'Founder licence', investor: 'Investor licence', operating_partner: 'Operating Partner licence', advisor: 'Advisor licence',
};

/**
 * D5060: the Contracts library template each user licence agreement is drafted from, one per type. Contracts owns
 * the text (`legal_templates`); this names the slug and what an envelope of it is. An envelope whose
 * `document_type` is one of these slugs IS that user licence agreement, and its holder is the envelope's account.
 */
export const USER_LICENCE_AGREEMENT_TEMPLATES: ReadonlyArray<{ slug: string; licence_type: UserLicenceType; agreement_type: AgreementType; title: string }> = [
  { slug: 'founder_licence_agreement', licence_type: 'founder', agreement_type: 'founder_licence', title: 'Founder Licence Agreement' },
  { slug: 'investor_licence_agreement', licence_type: 'investor', agreement_type: 'investor_licence', title: 'Investor Licence Agreement' },
  { slug: 'operating_partner_licence_agreement', licence_type: 'operating_partner', agreement_type: 'operating_partner_licence', title: 'Operating Partner Licence Agreement' },
  { slug: 'advisor_licence_agreement', licence_type: 'advisor', agreement_type: 'advisor_licence', title: 'Advisor Licence Agreement' },
];
export const userLicenceTemplateOf = (slug: string | null | undefined) => USER_LICENCE_AGREEMENT_TEMPLATES.find((t) => t.slug === slug) || null;
export const userLicenceTemplateFor = (type: string | null | undefined) => USER_LICENCE_AGREEMENT_TEMPLATES.find((t) => t.licence_type === type) || null;

/** D5060: who holds the licence an agreement belongs to, from the shared registry. */
export type LicenceHolder = { type: 'entity' | 'user'; id: string; name: string | null };

export type AgreementContext = {
  /** The canonical version's own uid, in its own store (for a user licence agreement, its envelope's uuid). */
  agreement_uid: string;
  store: 'licence_program_agreements' | 'licence_contracts' | 'esign_envelopes';
  agreement_kind: string;
  agreement_type: AgreementType;
  agreement_type_label: string;
  /** The shared licence (`licences.uid`, D5057); null only for a user licence agreement whose licence is not recorded. */
  licence_uid: string | null;
  licence_ref: string | null;
  /** D5060: the shared licence's family, type and holder; null where the registry holds no row for it. */
  licence_family: 'operator' | 'user' | null;
  licence_type: string | null;
  licence_type_label: string | null;
  holder: LicenceHolder | null;
  /** D5060: why the licence, its family or its holder is not recorded, when it is not. */
  licence_reason: string | null;
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
    licence: string | null;
    program_access: string | null;
    package: string | null;
    package_reason: string | null;
  };
};

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

const MISSING_TABLE = /no such table/i;

function typeOf(kind: string, slug: string): AgreementType {
  if (kind === 'user_licence_agreement') return userLicenceTemplateOf(slug)!.agreement_type;
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

/**
 * D5060 — a user licence agreement's legal state, from its envelope. An executed envelope that a later executed
 * one of the same agreement (same template, same account) replaced is superseded: it was signed, and it is history.
 */
export function userAgreementLegalStatus(envelopeStatus: string | null, supersededByLater: boolean): LegalStatus {
  if (envelopeStatus === 'completed') return supersededByLater ? 'superseded' : 'executed';
  if (envelopeStatus === 'void' || envelopeStatus === 'rejected') return 'voided';
  return 'awaiting_signature';
}

function context(r: any, store: AgreementContext['store'], legal: LegalStatus): AgreementContext {
  const type = typeOf(String(r.agreement_kind), String(r.template_slug));
  const program = r.program_key ? programOf(String(r.program_key)) : null;
  const pkg = r.package_key ? packageOf(String(r.package_key)) : null;
  const signed = !!r.signed_r2_key;
  const licenceUid = r.licence_uid == null ? null : String(r.licence_uid);
  return {
    agreement_uid: String(r.uid),
    store,
    agreement_kind: String(r.agreement_kind),
    agreement_type: type,
    agreement_type_label: AGREEMENT_TYPE_LABELS[type],
    licence_uid: licenceUid,
    licence_ref: r.licence_ref ?? null,
    licence_family: null,
    licence_type: null,
    licence_type_label: null,
    holder: null,
    licence_reason: null,
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
      licence: licenceUid ? `/admin/licences/${encodeURIComponent(licenceUid)}` : null,
      program_access: licenceUid && (program || r.program_key) ? `/admin/licences/programs/studio/${encodeURIComponent(licenceUid)}` : null,
      package: null,
      package_reason: type === 'package' ? 'There is no package page yet (#5021 builds the package store).' : null,
    },
  };
}

/**
 * D5060 — the shared licence's family, type and holder on each package, program and master licence context. A
 * database without the registry (before D5057) leaves them null, and `licence_reason` says why.
 */
async function withRegistryIdentity(sql: Sql, contexts: AgreementContext[]): Promise<void> {
  const uids = [...new Set(contexts.map((c) => c.licence_uid).filter((u): u is string => !!u))];
  if (!uids.length) return;
  let rows: any[];
  try {
    rows = await sql`
      SELECT l.uid, l.licence_ref, l.licence_family, l.licence_type, l.holder_type, l.holder_id,
             COALESCE(t.legal_entity_name, t.brand_name, en.name, u.name, u.email) AS holder_name
        FROM licences l
        LEFT JOIN territory_licences t ON t.id = l.territory_licence_id
        LEFT JOIN entities en ON l.holder_type = 'entity' AND en.id = CAST(l.holder_id AS INTEGER)
        LEFT JOIN users u ON l.holder_type = 'user' AND u.id = CAST(l.holder_id AS INTEGER)
       WHERE l.uid IN (SELECT value FROM json_each(${JSON.stringify(uids)}))`;
  } catch (e) {
    if (!MISSING_TABLE.test(String((e as Error)?.message))) throw e;
    for (const c of contexts) c.licence_reason = 'The licence registry is not on this database, so the licence family and holder are not recorded.';
    return;
  }
  const byUid = new Map(rows.map((r) => [String(r.uid), r]));
  for (const c of contexts) {
    const l = c.licence_uid ? byUid.get(c.licence_uid) : undefined;
    if (!l) { c.licence_reason = 'The licence registry holds no row for this licence.'; continue; }
    c.licence_family = l.licence_family;
    c.licence_type = l.licence_type;
    c.licence_type_label = LICENCE_TYPE_LABELS[l.licence_type] ?? l.licence_type;
    c.licence_ref = c.licence_ref ?? l.licence_ref ?? null;
    c.holder = { type: l.holder_type, id: String(l.holder_id), name: l.holder_name ?? null };
    if (!c.counterparty) c.counterparty = l.holder_name ?? null;
  }
}

/** One user licence agreement envelope as `loadUserLicenceAgreements` reads it. */
type UserAgreementRow = {
  uid: string; envelope_uuid: string; user_id: number | null; template_slug: string; template_version: number | null;
  envelope_status: string | null; provider: string | null; signed_r2_key: string | null; completed_at: string | null;
  created_at: string | null; user_name: string | null; user_email: string | null;
};

/**
 * D5060 — the user licence agreements: every envelope of the four templates, each with its account and the
 * licence it belongs to. `accountIds` narrows the read to those accounts (the licence registry's page and detail).
 */
export async function loadUserLicenceAgreements(sql: Sql, accountIds: number[] | null = null): Promise<AgreementContext[]> {
  const [f, i, o, a] = USER_LICENCE_AGREEMENT_TEMPLATES.map((t) => t.slug);
  const accounts = accountIds === null ? null : JSON.stringify(accountIds);
  const rows = await sql`
    SELECT e.envelope_uuid AS uid, e.envelope_uuid, e.user_id, e.document_type AS template_slug, NULL AS template_version,
           e.status AS envelope_status, e.provider, e.signed_r2_key, e.completed_at, e.created_at,
           u.name AS user_name, u.email AS user_email
      FROM esign_envelopes e
      LEFT JOIN users u ON u.id = e.user_id
     WHERE e.document_type IN (${f}, ${i}, ${o}, ${a})
       AND (${accounts} IS NULL OR e.user_id IN (SELECT value FROM json_each(${accounts})))
     ORDER BY e.id` as UserAgreementRow[];
  if (!rows.length) return [];
  // The latest executed envelope of each agreement (template × account) is the one in force.
  const latest = new Map<string, UserAgreementRow>();
  for (const r of rows) {
    if (r.envelope_status !== 'completed' || r.user_id == null) continue;
    const key = `${r.template_slug}|${r.user_id}`;
    const prev = latest.get(key);
    if (!prev || String(r.completed_at ?? '') >= String(prev.completed_at ?? '')) latest.set(key, r);
  }
  // The licence each belongs to: the account's user licence of the template's type (D5057's registry).
  const holders = [...new Set(rows.filter((r) => r.user_id != null).map((r) => String(r.user_id)))];
  const licences = new Map<string, any[]>();
  let registry = true;
  try {
    const found = await sql`
      SELECT uid, licence_ref, licence_type, holder_id FROM licences
       WHERE licence_family = 'user' AND holder_type = 'user'
         AND holder_id IN (SELECT value FROM json_each(${JSON.stringify(holders)}))`;
    for (const l of found) {
      const key = `${l.holder_id}|${l.licence_type}`;
      licences.set(key, [...(licences.get(key) || []), l]);
    }
  } catch (e) {
    if (!MISSING_TABLE.test(String((e as Error)?.message))) throw e;
    registry = false;
  }
  return rows.map((r) => {
    const tpl = userLicenceTemplateOf(r.template_slug)!;
    const superseded = r.envelope_status === 'completed' && r.user_id != null && latest.get(`${r.template_slug}|${r.user_id}`) !== r;
    const matches = r.user_id == null ? [] : licences.get(`${r.user_id}|${tpl.licence_type}`) || [];
    const licence = matches.length === 1 ? matches[0] : null;
    const holderName = r.user_name || r.user_email || null;
    const ctx = context({
      ...r, agreement_kind: 'user_licence_agreement', program_key: null, package_key: null, package_version: null,
      licence_uid: licence?.uid ?? null, licence_ref: licence?.licence_ref ?? null, legal_entity_name: null,
      brand_name: holderName, sent_at: r.created_at, signed_at: r.completed_at,
      effective_from: null, effective_to: null, superseded_at: null, territory: null,
    }, 'esign_envelopes', userAgreementLegalStatus(r.envelope_status ?? null, superseded));
    ctx.licence_family = 'user';
    ctx.licence_type = tpl.licence_type;
    ctx.licence_type_label = LICENCE_TYPE_LABELS[tpl.licence_type];
    ctx.holder = r.user_id == null ? null : { type: 'user', id: String(r.user_id), name: holderName };
    ctx.licence_reason = r.user_id == null ? 'The envelope names no account, so no holder or licence is recorded.'
      : !registry ? 'The licence registry is not on this database, so the licence is not recorded.'
      : matches.length === 0 ? `The account holds no ${LICENCE_TYPE_LABELS[tpl.licence_type]} in the licence registry.`
      : matches.length > 1 ? 'The account holds more than one licence of this type, so which one this agreement belongs to is not recorded.'
      : null;
    return ctx;
  });
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
  await withRegistryIdentity(sql, out);
  // D5060: the user licence agreements, after the identity pass (they carry their own).
  try {
    out.push(...await loadUserLicenceAgreements(sql));
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
  /** D5060: the shared licence's family and type, its holder (`user:<id>` or `entity:<id>`) and a territory country. */
  licence_family: string | null;
  licence_type: string | null;
  holder: string | null;
  territory: string | null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const LICENCE = /^[A-Za-z0-9_-]{1,64}$/;
const HOLDER = /^(user|entity):[A-Za-z0-9_:-]{1,120}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** The filters from a query, or the name of the first one that is not a value the registry knows. */
export function agreementFilters(q: Record<string, string | undefined>): { ok: true; filters: AgreementFilters } | { ok: false; field: string } {
  const pick = (k: string) => (q[k] ?? '').trim() || null;
  const f: AgreementFilters = {
    agreement_type: pick('agreement_type') as AgreementType | null,
    agreement_status: pick('agreement_status') as LegalStatus | null,
    licence: pick('licence'), program: pick('program'), package: pick('package'),
    signed_from: pick('signed_from'), signed_to: pick('signed_to'),
    licence_family: pick('licence_family'), licence_type: pick('licence_type'), holder: pick('holder'),
    territory: pick('territory')?.toUpperCase() ?? null,
  };
  if (f.agreement_type && !(AGREEMENT_TYPES as readonly string[]).includes(f.agreement_type)) return { ok: false, field: 'agreement_type' };
  if (f.agreement_status && !(LEGAL_STATUSES as readonly string[]).includes(f.agreement_status)) return { ok: false, field: 'agreement_status' };
  if (f.licence && !LICENCE.test(f.licence)) return { ok: false, field: 'licence' };
  if (f.program && !KEY.test(f.program)) return { ok: false, field: 'program' };
  if (f.package && !KEY.test(f.package)) return { ok: false, field: 'package' };
  if (f.signed_from && !DATE.test(f.signed_from)) return { ok: false, field: 'signed_from' };
  if (f.signed_to && !DATE.test(f.signed_to)) return { ok: false, field: 'signed_to' };
  if (f.licence_family && !(LICENCE_FAMILIES as readonly string[]).includes(f.licence_family)) return { ok: false, field: 'licence_family' };
  if (f.licence_type && !(LICENCE_TYPES as readonly string[]).includes(f.licence_type)) return { ok: false, field: 'licence_type' };
  if (f.holder && !HOLDER.test(f.holder)) return { ok: false, field: 'holder' };
  if (f.territory && !COUNTRY.test(f.territory)) return { ok: false, field: 'territory' };
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
  const onlyDates = !f.agreement_type && !f.agreement_status && !f.licence && !f.program && !f.package
    && !f.licence_family && !f.licence_type && !f.holder && !f.territory;
  if (onlyDates) return true;
  if (!a) return false;
  if (f.agreement_type && a.agreement_type !== f.agreement_type) return false;
  if (f.agreement_status && a.legal_status !== f.agreement_status) return false;
  if (f.licence && a.licence_uid !== f.licence && (a.licence_ref ?? '').toLowerCase() !== f.licence.toLowerCase()) return false;
  if (f.program && a.program_key !== f.program) return false;
  if (f.package && a.package_key !== f.package) return false;
  if (f.licence_family && a.licence_family !== f.licence_family) return false;
  if (f.licence_type && a.licence_type !== f.licence_type) return false;
  if (f.holder && (!a.holder || `${a.holder.type}:${a.holder.id}` !== f.holder)) return false;
  if (f.territory && !a.territory.includes(f.territory)) return false;
  return true;
}
