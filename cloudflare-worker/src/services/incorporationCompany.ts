/**
 * D1415 Part 3 (#3855) — a filed formation order links or creates the company.
 *
 * `markFiled` (`incorporationFiling.ts`) runs ONE batch: D601's `SET_FILED`
 * first, then the company statements below. Every company statement is
 * guarded by "the order is `filed` and `incorporations.company_id IS NULL`",
 * and the batch ends by setting `company_id`. So a second call (or two admins
 * at once) changes nothing past the first, and a failed batch leaves the
 * order `packet_ready` with no company. Nothing is deleted or overwritten.
 *
 *   · The venture has no company: a company is created from the order (its
 *     name, the mapped jurisdiction and legal form, `incorporation_date =
 *     filed_on`, a free slug, the registered agent's name), the venture's
 *     owner account becomes its primary admin with a `join` event, the
 *     venture moves into it (`projectMoveStatements`), and the order's
 *     registered agent address becomes its open `registered` location.
 *   · The venture is already in a company: only its NULL legal fields are
 *     filled, the registered location is added only when none is open, and
 *     the order is linked. An archived company is linked only.
 *   · The venture has no owner account: the filing stands; no company is
 *     written (`reason: 'no_owner_account'`).
 *
 * The new company is named by a uid chosen here, so every statement after
 * its INSERT reaches it without a row id.
 */
import type { Env } from '../types';
import { newUid } from '../routes/_t13t14t15_helpers';
import { checkSlug, slugHolder } from './slugs';
import { ownerUserId, projectMoveStatements } from './projectMove';
import { catalogueForm } from './formationCatalogue';

/** Each jurisdiction Incorporate sells (`routes/legal.ts` JURISDICTIONS), as the company records it. */
export const JURISDICTION_MAP: Readonly<Record<string, { jurisdiction: string; legal_form: string }>> = Object.freeze({
  us_de_ccorp: { jurisdiction: 'US-DE', legal_form: 'c_corp' },
  us_wy_ccorp: { jurisdiction: 'US-WY', legal_form: 'c_corp' },
  us_de_llc: { jurisdiction: 'US-DE', legal_form: 'llc' },
  uk_ltd: { jurisdiction: 'GB', legal_form: 'ltd' },
  sg_pte: { jurisdiction: 'SG', legal_form: 'ltd' },
  ee_oy: { jurisdiction: 'EE', legal_form: 'ltd' },
});

/** The order's jurisdiction id as the company's ISO code and form; both null for an id the map does not hold. */
export function mappedLegal(jurisdictionId: string | null): { jurisdiction: string | null; legal_form: string | null } {
  const m = jurisdictionId && Object.prototype.hasOwnProperty.call(JURISDICTION_MAP, jurisdictionId) ? JURISDICTION_MAP[jurisdictionId] : null;
  return { jurisdiction: m?.jurisdiction ?? null, legal_form: m?.legal_form ?? null };
}

/**
 * D6694 (#6694): the order's jurisdiction id as the company records it, read
 * from the current formation catalogue (the form's `legal_form_family`, its
 * jurisdiction's country and subdivision), each field falling back to
 * JURISDICTION_MAP when the catalogue has no current version, no such form,
 * or no value. Catalogue version 1 holds exactly the array (D6690), so the
 * answer is the same until a later version changes it.
 */
export async function legalFor(env: Env, jurisdictionId: string | null): Promise<{ jurisdiction: string | null; legal_form: string | null }> {
  const fallback = mappedLegal(jurisdictionId);
  if (!jurisdictionId) return fallback;
  let form: Awaited<ReturnType<typeof catalogueForm>> = null;
  try { form = await catalogueForm(env, jurisdictionId); } catch { form = null; }
  if (!form) return fallback;
  const country = form.jurisdiction?.country || null;
  const sub = form.jurisdiction?.subdivision || null;
  return {
    jurisdiction: country ? (sub ? `${country}-${sub}` : country) : fallback.jurisdiction,
    legal_form: form.form.legal_form_family || fallback.legal_form,
  };
}

/** D6694: the registered address as the registry gives it. `country` is ISO 3166-1 alpha-2. */
export type RegisteredAddress = {
  line1: string; line2?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country: string;
};
/** D6694: what an accepted incorporation filing adds to the company write. */
export type Registration = { number: string; certificateDocumentId: number; address?: RegisteredAddress | null };

export type CompanyOutcome =
  | { uid: string; created: boolean; filled: string[]; reason?: 'archived' }
  | { created: false; reason: 'no_owner_account' };

type OrderFacts = {
  id: number; project_id: number | null; company_name: string | null; jurisdiction_id: string | null;
  /** D6687: the company the order is for, when its subject is a company. */
  subject_company_id?: number | null;
  registered_agent_name: string | null; registered_agent_address: string | null;
};
type ProjectFacts = { id: number; founder_id: number | null; company_id: number | null; slug: string | null };
type CompanyFacts = {
  id: number; uid: string; archived_at: string | null; legal_name: string | null; legal_form: string | null;
  jurisdiction: string | null; incorporation_date: string | null; registered_agent_name: string | null;
  registration_number?: string | null;
};

/** The guard every company statement carries: the order is filed and not yet linked. */
const LINKED_LAST = "UPDATE incorporations SET company_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'filed' AND company_id IS NULL";
const LINK_NEW = "UPDATE incorporations SET company_id = (SELECT id FROM company_profiles WHERE uid = ?), updated_at = datetime('now') WHERE id = ? AND status = 'filed' AND company_id IS NULL";

const MAX_SLUG_TRIES = 20;

/** A slug from the company's name, or null: the name itself, then `-2`, `-3` … up to 20 tries. */
export async function freeCompanySlug(env: Env, name: string): Promise<string | null> {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44).replace(/-+$/g, '');
  for (let n = 1; n <= MAX_SLUG_TRIES; n++) {
    const c = checkSlug(n === 1 ? base : `${base}-${n}`);
    if (!c.ok) continue;
    if ((await slugHolder(env, 'company', c.slug)) == null) return c.slug;
  }
  return null;
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The company statements for one filing, to run after `SET_FILED` in the same
 * batch, and what they will do. Reads happen here, before the batch; every
 * write is in the returned list.
 */
export async function filingCompanyStatements(
  env: Env, order: OrderFacts, filedOn: string, adminId: number, registration: Registration | null = null,
): Promise<{ statements: D1PreparedStatement[]; outcome: CompanyOutcome }> {
  const project = order.project_id == null ? null
    : await env.DB.prepare('SELECT id, founder_id, company_id, slug FROM projects WHERE id = ?').bind(order.project_id).first<ProjectFacts>();
  // D6687: an order for a company fills that company; an order for a venture, the venture's company (or a new one).
  const subjectCompany = order.subject_company_id ?? null;
  const target = subjectCompany ?? project?.company_id ?? null;
  const legal = await legalFor(env, order.jurisdiction_id);
  const name = clean(order.company_name);
  const agent = clean(order.registered_agent_name);
  const number = registration ? clean(registration.number) : null;
  // D6694: the registry's structured address when the filing gives one, else the agent's address line.
  const structured = registration?.address && clean(registration.address.line1) && /^[A-Z]{2}$/.test(String(registration.address.country || ''))
    ? registration.address : null;
  const address = structured ? clean(structured.line1) : clean(order.registered_agent_address);
  const country = structured ? structured.country : (legal.jurisdiction ? legal.jurisdiction.slice(0, 2) : null);
  const guard = [order.id] as const;

  // ── The subject company, or the venture's company: fill only what is empty. No venture is moved. ──
  if (target != null) {
    const co = await env.DB.prepare(
      `SELECT id, uid, archived_at, legal_name, legal_form, jurisdiction, incorporation_date, registered_agent_name, registration_number
         FROM company_profiles WHERE id = ?`,
    ).bind(target).first<CompanyFacts>();
    if (co) {
      const link = env.DB.prepare(LINKED_LAST).bind(co.id, ...guard);
      if (co.archived_at) return { statements: [link], outcome: { uid: co.uid, created: false, filled: [], reason: 'archived' } };
      const fill: Record<string, string | null> = {
        legal_name: name, legal_form: legal.legal_form, jurisdiction: legal.jurisdiction, incorporation_date: filedOn, registered_agent_name: agent,
        registration_number: number,
      };
      const filled = Object.entries(fill).filter(([k, v]) => v != null && (co as any)[k] == null).map(([k]) => k);
      const statements: D1PreparedStatement[] = [];
      if (filled.length) {
        // COALESCE keeps every value already there: a field is written only while it is NULL.
        statements.push(env.DB.prepare(
          `UPDATE company_profiles SET legal_name = COALESCE(legal_name, ?), legal_form = COALESCE(legal_form, ?),
             jurisdiction = COALESCE(jurisdiction, ?), incorporation_date = COALESCE(incorporation_date, ?),
             registered_agent_name = COALESCE(registered_agent_name, ?), registration_number = COALESCE(registration_number, ?),
             updated_at = datetime('now')
           WHERE id = ? AND archived_at IS NULL
             AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
        ).bind(name, legal.legal_form, legal.jurisdiction, filedOn, agent, number, co.id, ...guard));
      }
      if (address && country) {
        const open = await env.DB.prepare("SELECT 1 AS ok FROM company_locations WHERE company_id = ? AND kind = 'registered' AND closed_on IS NULL").bind(co.id).first();
        if (!open) {
          statements.push(registeredLocation(env, { companyId: co.id }, address, country, adminId, order.id, structured));
          filled.push('registered_address');
        }
      }
      if (registration) {
        const has = await env.DB.prepare(CERT_HELD).bind(co.id).first();
        if (!has) {
          statements.push(certificateCopy(env, { companyId: co.id }, registration.certificateDocumentId, adminId, order.id));
          filled.push('certificate_of_incorporation');
        }
      }
      statements.push(link);
      return { statements, outcome: { uid: co.uid, created: false, filled } };
    }
    // D6687: a subject company that is gone creates nothing in its place.
    if (subjectCompany != null) return { statements: [], outcome: { created: false, reason: 'no_owner_account' } };
  }

  // ── The venture has no company: create one for its owner. ──
  const owner = project ? await ownerUserId(env, project.founder_id) : null;
  if (!project || owner == null || !name) return { statements: [], outcome: { created: false, reason: 'no_owner_account' } };
  const uid = newUid();
  const slug = await freeCompanySlug(env, name);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO company_profiles (uid, company_name, legal_name, legal_form, jurisdiction, incorporation_date, registered_agent_name, registration_number, slug, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
    ).bind(uid, name, name, legal.legal_form, legal.jurisdiction, filedOn, agent, number, slug, now, now, ...guard),
    // The owner is the primary admin, written as `POST /company/create` writes it, with its `join` event.
    env.DB.prepare(
      `INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at)
       SELECT ?, cp.id, ?, 'Admin', 1, ? FROM company_profiles cp
        WHERE cp.uid = ? AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
    ).bind(newUid(), owner, now, uid, ...guard),
    env.DB.prepare(
      `INSERT INTO company_membership_events (company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json)
       SELECT cp.id, NULL, ?, ?, 'join', NULL, '{"role_in_company":"Admin","is_primary_admin":true}' FROM company_profiles cp
        WHERE cp.uid = ? AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
    ).bind(adminId, owner, uid, ...guard),
    ...projectMoveStatements(env, { projectId: project.id, from: null, toNewCompanyUid: uid, orderId: order.id, actorUserId: adminId, slug: project.slug }),
  ];
  const filled = ['legal_name', ...(legal.legal_form ? ['legal_form', 'jurisdiction'] : []), 'incorporation_date', ...(agent ? ['registered_agent_name'] : []),
    ...(number ? ['registration_number'] : [])];
  if (address && country) {
    statements.push(registeredLocation(env, { companyUid: uid }, address, country, adminId, order.id, structured));
    filled.push('registered_address');
  }
  if (registration) {
    statements.push(certificateCopy(env, { companyUid: uid }, registration.certificateDocumentId, adminId, order.id));
    filled.push('certificate_of_incorporation');
  }
  statements.push(env.DB.prepare(LINK_NEW).bind(uid, ...guard));
  return { statements, outcome: { uid, created: true, filled } };
}

/**
 * The registered address as the company's open `registered` location, only when none is open: the registry's
 * structured address when the filing gives one (D6694), else the order's agent address as line 1.
 */
function registeredLocation(
  env: Env, company: { companyId: number } | { companyUid: string }, line1: string, country: string, adminId: number, orderId: number,
  structured: RegisteredAddress | null = null,
) {
  const part = (v: unknown) => (clean(v) ? String(clean(v)).slice(0, 200) : null);
  const rest = [part(structured?.line2), part(structured?.city), part(structured?.region), part(structured?.postal_code)];
  if ('companyId' in company) {
    return env.DB.prepare(
      `INSERT INTO company_locations (uid, company_id, kind, line1, line2, city, region, postal_code, country, created_by)
       SELECT ?, ?, 'registered', ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM company_locations WHERE company_id = ? AND kind = 'registered' AND closed_on IS NULL)
          AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
    ).bind(newUid(), company.companyId, line1.slice(0, 200), ...rest, country, adminId, company.companyId, orderId);
  }
  return env.DB.prepare(
    `INSERT INTO company_locations (uid, company_id, kind, line1, line2, city, region, postal_code, country, created_by)
     SELECT ?, cp.id, 'registered', ?, ?, ?, ?, ?, ?, ? FROM company_profiles cp
      WHERE cp.uid = ?
        AND NOT EXISTS (SELECT 1 FROM company_locations WHERE company_id = cp.id AND kind = 'registered' AND closed_on IS NULL)
        AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
  ).bind(newUid(), line1.slice(0, 200), ...rest, country, adminId, company.companyUid, orderId);
}

/** D6694: the company already holds a certificate of incorporation in its slot (D1592). */
const CERT_HELD = "SELECT 1 AS ok FROM documents WHERE company_id = ? AND project_id IS NULL AND doc_type = 'certificate_of_incorporation' LIMIT 1";

/**
 * D6694: the registry's certificate as the company's `certificate_of_incorporation` document (D1592's slot): a
 * copy of the filing's certificate row, so the case keeps its own. Written only while the slot is empty.
 */
const CERT_COPY_TO_ID =
  `INSERT INTO documents (project_id, company_id, title, doc_type, status, content, template_name, uploaded_by)
   SELECT NULL, ?, src.title, 'certificate_of_incorporation', src.status, src.content, src.template_name, ?
     FROM documents src WHERE src.id = ?
      AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.company_id = ? AND d.project_id IS NULL AND d.doc_type = 'certificate_of_incorporation')
      AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`;
const CERT_COPY_TO_UID =
  `INSERT INTO documents (project_id, company_id, title, doc_type, status, content, template_name, uploaded_by)
   SELECT NULL, cp.id, src.title, 'certificate_of_incorporation', src.status, src.content, src.template_name, ?
     FROM documents src JOIN company_profiles cp ON cp.uid = ? WHERE src.id = ?
      AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.company_id = cp.id AND d.project_id IS NULL AND d.doc_type = 'certificate_of_incorporation')
      AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`;

function certificateCopy(env: Env, company: { companyId: number } | { companyUid: string }, documentId: number, adminId: number, orderId: number) {
  if ('companyId' in company) {
    return env.DB.prepare(CERT_COPY_TO_ID).bind(company.companyId, adminId, documentId, company.companyId, orderId);
  }
  return env.DB.prepare(CERT_COPY_TO_UID).bind(adminId, company.companyUid, documentId, orderId);
}
