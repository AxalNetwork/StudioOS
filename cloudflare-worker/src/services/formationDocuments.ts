/**
 * D6706 (#6706, plan key E14 of #6680) — a formation case's documents: the
 * template set of its catalogue form, filled from the case, sent for
 * signature through the in-house e-sign, and the consents to act a filing
 * waits on.
 *
 * TEMPLATE SETS. A form's template set is its catalogue pack items of kind
 * `document` that name a `template_key` (formation_pack_items, in position
 * order). Nothing here writes legal text: a body is the template store's
 * active, non-stub row (counsel's), and this service only fills its tokens.
 *
 *   legacy forms (legacy_gate '1', the six version-1 products) keep the
 *     wizard's rule exactly (routes/legal.ts POST /incorporate/wizard): a
 *     contract type is `pending_esign`; no body is `pending_counsel` for the
 *     templates in COUNSEL_REQUIRED_TEMPLATES and `pending_body` otherwise;
 *     the five flat tokens are filled with the wizard's values, placeholders
 *     included. The parity test holds the two to the same documents.
 *   every other form: a template is used only when an `approved` counsel
 *     review of its current body names the form's country
 *     (`templateApprovedFor`, D6693's gate); otherwise `pending_counsel`. A
 *     body left with an unfilled token is `pending_fields`, never written with
 *     a hole and never filled with a placeholder.
 *
 * THE MERGE SCHEMA (`caseMerge`, FORMATION_MERGE_FIELDS): the five flat
 * tokens, plus the form, its country, the people by role, ownership, capital
 * and the registered office, all read from the case and its order. A pack
 * item whose item_key starts `consent_to_act` is filled once per appointee,
 * with `person.*`.
 *
 * SIGNING. The founder sends a generated case document (or a contract
 * template of the form) to themselves or to a person of the case through
 * `createAndSendEnvelope` (routes/esign.ts), whose rules are unchanged. The
 * same batch that links the envelope to the case (formation_case_envelopes)
 * records the owed `formation_case_signed` effect (services/esignEffects.ts,
 * D8516); when the envelope completes, `onCaseEnvelopeCompleted` puts the
 * signed copy on the case with the SHA-256 of its file and, for a consent to
 * act, sets the person's consent_to_act_at — unless the person was edited
 * after the envelope was sent.
 *
 * CONSENT TO ACT: an appointee (APPOINTEE_ROLES, formationFilings.ts) signs a
 * consent document, or HQ or a partner uploads a signed consent
 * (`recordConsentUpload`). formationFilings.ts refuses to file until every
 * appointee has consented.
 *
 * PACK APPROVAL: `setPackForApproval` sets a filing's pack and opens the
 * founder's approval request bound to the pack's hash (D6695).
 *
 * Every write is a D1 batch; every value is bound. Files are not stored here:
 * a signed copy is the one e-sign already wrote through the classified record
 * store (D6651), and an upload is a documents row stored the same way.
 */
import type { Env } from '../types';
import { newUid } from '../routes/_t13t14t15_helpers';
import type { Actor } from './formationCase';
import { APPOINTEE_ROLES, setPack, type FilingResult, type FilingRow } from './formationFilings';
import { templateApprovedFor } from './formationGates';
import { applyMergeFields, mergeTokensIn } from './mergeFields';
import { getActiveTemplateBody } from './legalTemplateStore';
import { owedEffectStatement } from './esignEffects';

/** A pack item with this key prefix is a consent to act, filled once per appointee. */
export const CONSENT_ITEM_PREFIX = 'consent_to_act';
const CONSENT_ITEM = `${CONSENT_ITEM_PREFIX}*`;
const SHA256 = /^[0-9a-f]{64}$/;
const WRITERS = new Set(['hq', 'partner', 'counsel', 'system']);
const UPLOADERS = new Set(['hq', 'partner', 'counsel']);

/** Every token the case fills, with what it holds. Counsel writes templates against these. */
export const FORMATION_MERGE_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  company_name: 'The company name on the order.',
  'company.legal_name': 'The company name on the order (the canonical schema\'s name for it).',
  jurisdiction: 'Legacy forms: the jurisdiction label. Other forms: the catalogue form label.',
  incorporation_date: 'The day the document was generated.',
  registered_agent_name: 'The registered agent on the order.',
  registered_agent_address: 'The registered agent\'s address on the order.',
  'form.key': 'The catalogue form key.',
  'form.label': 'The catalogue form label.',
  'form.family': 'The form\'s legal form family.',
  'country.code': 'The form\'s ISO country code.',
  'country.subdivision': 'The form\'s subdivision, when it has one.',
  'country.registry': 'The registry the form files with.',
  'people.<role>': 'The names of the people holding <role>, in the order they were added, comma separated.',
  'people.all': 'Every person of the case.',
  'ownership.summary': 'Each owner with their share, e.g. "A 60%, B 40%".',
  'capital.amount': 'The share capital, formatted in its currency.',
  'capital.amount_minor': 'The share capital in minor units.',
  'capital.currency': 'The share capital\'s currency.',
  'capital.share_count': 'The number of shares.',
  'registered_office.address': 'The registered office: the registered agent\'s address on the order.',
  'person.name': 'Consent documents: the appointee\'s name.',
  'person.roles': 'Consent documents: the appointee\'s roles, comma separated.',
  recipient_name: 'Contract templates sent for signature: the signer\'s name.',
  recipient_email: 'Contract templates sent for signature: the signer\'s email.',
  effective_date: 'Contract templates sent for signature: the day sent.',
});

type Fail = { ok: false; status: 400 | 403 | 404 | 409 | 502 | 503; error: string };
const fail = (status: Fail['status'], error: string): Fail => ({ ok: false, status, error });
const posInt = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const isoDay = () => new Date().toISOString().slice(0, 10);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface DocCase {
  id: number; uid: string; user_id: number; project_id: number | null; company_id: number | null;
  track: string; stage: string; form_key: string | null; catalogue_version_id: number | null; closed_at: string | null;
}

export async function readDocCase(env: Env, caseId: number): Promise<DocCase | null> {
  return (await env.DB.prepare(`SELECT id, uid, user_id, project_id, company_id, track, stage, form_key, catalogue_version_id, closed_at FROM formation_cases WHERE id = ?`).bind(caseId).first<DocCase>()) || null;
}

/** A v2 case the founder owns, by uid, or null. */
export async function founderDocCase(env: Env, uid: string, userId: number): Promise<DocCase | null> {
  return (await env.DB.prepare(`SELECT id, uid, user_id, project_id, company_id, track, stage, form_key, catalogue_version_id, closed_at FROM formation_cases WHERE uid = ? AND user_id = ? AND track = 'v2'`)
    .bind(uid, userId).first<DocCase>()) || null;
}

interface FormRow { id: number; form_key: string; label: string; legacy_gate: string | null; legal_form_family: string | null;
  country: string; subdivision: string | null; registry_name: string | null }
async function caseForm(env: Env, k: DocCase): Promise<FormRow | null> {
  if (!k.form_key || k.catalogue_version_id == null) return null;
  return (await env.DB.prepare(
    `SELECT f.id, f.form_key, f.label, f.legacy_gate, f.legal_form_family, j.country, j.subdivision, j.registry_name
       FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id
      WHERE f.version_id = ? AND f.form_key = ?`,
  ).bind(k.catalogue_version_id, k.form_key).first<FormRow>()) || null;
}

interface OrderRow { company_name: string | null; registered_agent_name: string | null; registered_agent_address: string | null }
async function caseOrder(env: Env, caseId: number): Promise<OrderRow | null> {
  return (await env.DB.prepare(
    `SELECT i.company_name, i.registered_agent_name, i.registered_agent_address
       FROM formation_case_orders o JOIN incorporations i ON i.id = o.incorporation_id
      WHERE o.case_id = ? ORDER BY o.id DESC LIMIT 1`,
  ).bind(caseId).first<OrderRow>()) || null;
}

interface PackItem { item_key: string; title: string; template_key: string; counsel_required: number }
async function templateSet(env: Env, k: DocCase, form: FormRow): Promise<PackItem[]> {
  return (await env.DB.prepare(
    `SELECT item_key, title, template_key, counsel_required FROM formation_pack_items
      WHERE version_id = ? AND form_id = ? AND kind = 'document' AND template_key IS NOT NULL ORDER BY position, id`,
  ).bind(k.catalogue_version_id, form.id).all<PackItem>()).results || [];
}

export interface CasePerson { id: number; uid: string; name: string; revision: number; ownership_bps: number;
  consent_to_act_at: string | null; email: string | null; roles: string[] }
async function casePeople(env: Env, caseId: number): Promise<CasePerson[]> {
  const rows = (await env.DB.prepare(
    `SELECT p.id, p.uid, p.name, p.revision, p.ownership_bps, p.consent_to_act_at, COALESCE(u.email, p.notice_email) AS email,
            (SELECT json_group_array(role) FROM (SELECT role FROM formation_case_person_roles WHERE person_id = p.id ORDER BY role)) AS roles_json
       FROM formation_case_people p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.case_id = ? AND p.removed_at IS NULL ORDER BY p.id`,
  ).bind(caseId).all<any>()).results || [];
  return rows.map((r) => ({ id: Number(r.id), uid: String(r.uid), name: String(r.name), revision: Number(r.revision),
    ownership_bps: Number(r.ownership_bps), consent_to_act_at: r.consent_to_act_at ?? null, email: r.email ?? null,
    roles: JSON.parse(String(r.roles_json || '[]')) as string[] }));
}

const isAppointee = (p: Pick<CasePerson, 'roles'>) => p.roles.some((r) => (APPOINTEE_ROLES as readonly string[]).includes(r));

/** A share in basis points as a percentage, without trailing zeros: 6000 → "60%", 3333 → "33.33%". */
export function percent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

function money(amountMinor: number, currency: string): string | null {
  try {
    const f = new Intl.NumberFormat('en', { style: 'currency', currency });
    const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
    return f.format(amountMinor / 10 ** digits);
  } catch { return null; }
}

/**
 * The merge values of a case for a non-legacy form. A value the case does not
 * hold is absent, so its token stays unfilled and the document is
 * `pending_fields`: no placeholder is ever written into a document.
 */
export async function caseMerge(env: Env, k: DocCase, form: FormRow, order: OrderRow | null, today: string,
  person?: CasePerson | null): Promise<Record<string, unknown>> {
  const people = await casePeople(env, k.id);
  const capital = await env.DB.prepare('SELECT amount_minor, currency, share_count FROM formation_case_capital WHERE case_id = ?')
    .bind(k.id).first<{ amount_minor: number; currency: string; share_count: number }>();
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const byRole: Record<string, string> = {};
  for (const p of people) for (const role of p.roles) byRole[role] = byRole[role] ? `${byRole[role]}, ${p.name}` : p.name;
  const owners = people.filter((p) => p.ownership_bps > 0);
  const companyName = text(order?.company_name);
  return {
    company_name: companyName,
    company: { legal_name: companyName },
    jurisdiction: text(form.label),
    incorporation_date: today,
    registered_agent_name: text(order?.registered_agent_name),
    registered_agent_address: text(order?.registered_agent_address),
    form: { key: form.form_key, label: text(form.label), family: text(form.legal_form_family) },
    country: { code: form.country, subdivision: text(form.subdivision), registry: text(form.registry_name) },
    people: { ...byRole, all: people.length ? people.map((p) => p.name).join(', ') : undefined },
    ownership: { summary: owners.length ? owners.map((p) => `${p.name} ${percent(p.ownership_bps)}`).join(', ') : undefined },
    capital: capital ? {
      amount: money(Number(capital.amount_minor), String(capital.currency)) ?? undefined,
      amount_minor: Number(capital.amount_minor), currency: capital.currency, share_count: Number(capital.share_count),
    } : {},
    registered_office: { address: text(order?.registered_agent_address) },
    ...(person ? { person: { name: person.name, roles: person.roles.join(', ') } } : {}),
  };
}

/** The legacy wizard's five values, its placeholders included (routes/legal.ts). */
function legacyFill(order: OrderRow, jurisdictionLabel: string, today: string) {
  return {
    company_name: String(order.company_name ?? '').trim(),
    jurisdiction: jurisdictionLabel,
    incorporation_date: today,
    registered_agent_name: order.registered_agent_name || '[Registered Agent]',
    registered_agent_address: order.registered_agent_address || '[Registered Agent Address]',
  };
}

// ── Generation ──────────────────────────────────────────────────────────────

export interface GeneratedDoc { uid: string; template_key: string; title: string; document_id: number; sha256: string | null;
  person_uid: string | null; reused: boolean }
export interface DocumentSet {
  documents: GeneratedDoc[];
  pending_esign: { template_key: string; title: string; doc_type: string; reason: 'use_esign_envelope' }[];
  pending_counsel: { template_key: string; title: string; reason: 'counsel_approval_pending' | 'not_reviewed_for_country'; country?: string }[];
  pending_body: { template_key: string; title: string; reason: 'template_has_no_body' }[];
  pending_fields: { template_key: string; title: string; person_uid: string | null; fields: string[] }[];
  pending_people: { template_key: string; title: string; reason: 'no_appointees' }[];
}
export type GenerateResult = ({ ok: true; dry_run: boolean } & DocumentSet) | Fail;

const GENERATED_FOR = `SELECT cd.uid, cd.document_id, cd.sha256 FROM formation_case_documents cd
  WHERE cd.case_id = ? AND cd.origin = 'generated' AND cd.template_key = ? AND COALESCE(cd.person_id, 0) = ?`;

/**
 * The case's document set, generated into formation_case_documents. A
 * template already generated for the case (and person) is reused, never
 * rewritten. `dryRun` reads and writes nothing: the same answer, as a plan.
 */
export async function generateCaseDocuments(env: Env, caseId: number, actor: Actor,
  opts: { today?: string; dryRun?: boolean } = {}): Promise<GenerateResult> {
  if (!opts.dryRun && !WRITERS.has(actor.party)) return fail(403, 'party_cannot_generate');
  const k = await readDocCase(env, caseId);
  if (!k) return fail(404, 'case_not_found');
  if (k.track !== 'v2') return fail(409, 'case_not_v2');
  if (k.closed_at && !opts.dryRun) return fail(409, 'case_closed');
  const form = await caseForm(env, k);
  if (!form) return fail(409, 'case_has_no_form');
  const order = await caseOrder(env, k.id);
  if (!order) return fail(409, 'case_has_no_order');
  const today = opts.today ?? isoDay();
  const legacy = String(form.legacy_gate ?? '') === '1';
  const { CONTRACT_DOC_TYPES } = await import('../routes/admin_contracts');
  const out: DocumentSet = { documents: [], pending_esign: [], pending_counsel: [], pending_body: [], pending_fields: [], pending_people: [] };

  let legacyTitles: Record<string, { title: string }> = {};
  let counselRequired = new Set<string>();
  let fill: Record<string, string> | null = null;
  if (legacy) {
    const legal = await import('../routes/legal');
    legacyTitles = legal.JURISDICTION_TEMPLATES;
    counselRequired = legal.COUNSEL_REQUIRED_TEMPLATES;
    const j = legal.JURISDICTIONS.find((x) => x.id === form.form_key);
    if (!j) return fail(409, 'legacy_form_unknown');
    fill = legacyFill(order, j.label, today);
  }
  const people = await casePeople(env, k.id);
  const write = async (item: { template_key: string; title: string }, content: string, person: CasePerson | null) => {
    const sha = await sha256Hex(content);
    if (opts.dryRun) {
      out.documents.push({ uid: '', template_key: item.template_key, title: item.title, document_id: 0, sha256: sha, person_uid: person?.uid ?? null, reused: false });
      return;
    }
    await writeGenerated(env, k, item, content, sha, person, actor);
    const row = await env.DB.prepare(GENERATED_FOR).bind(k.id, item.template_key, person?.id ?? 0).first<any>();
    if (row) out.documents.push({ uid: row.uid, template_key: item.template_key, title: item.title, document_id: Number(row.document_id),
      sha256: row.sha256 ?? null, person_uid: person?.uid ?? null, reused: false });
  };

  for (const item of await templateSet(env, k, form)) {
    const key = item.template_key;
    const title = legacy ? legacyTitles[key]?.title : item.title;
    if (!title) continue;
    if (CONTRACT_DOC_TYPES.has(key.toLowerCase())) {
      out.pending_esign.push({ template_key: key, title, doc_type: key, reason: 'use_esign_envelope' });
      continue;
    }
    const consent = !legacy && item.item_key.startsWith(CONSENT_ITEM_PREFIX);
    const targets: (CasePerson | null)[] = consent ? people.filter(isAppointee) : [null];
    if (consent && !targets.length) { out.pending_people.push({ template_key: key, title, reason: 'no_appointees' }); continue; }
    // The wizard reuses before it reads a body; so does this.
    const todo: (CasePerson | null)[] = [];
    for (const person of targets) {
      const existing = await env.DB.prepare(GENERATED_FOR).bind(k.id, key, person?.id ?? 0).first<any>();
      if (existing) {
        out.documents.push({ uid: existing.uid, template_key: key, title, document_id: Number(existing.document_id), sha256: existing.sha256 ?? null, person_uid: person?.uid ?? null, reused: true });
      } else todo.push(person);
    }
    if (!todo.length) continue;
    if (legacy && k.project_id != null && !opts.dryRun) {
      // The wizard's reuse: a document of the venture already made from this template.
      const prior = await env.DB.prepare('SELECT id, content FROM documents WHERE project_id = ? AND template_name = ? LIMIT 1')
        .bind(k.project_id, key).first<{ id: number; content: string | null }>();
      if (prior) {
        await attachExisting(env, k, key, prior.id, prior.content == null ? null : await sha256Hex(prior.content), actor);
        const row = await env.DB.prepare(GENERATED_FOR).bind(k.id, key, 0).first<any>();
        out.documents.push({ uid: row?.uid ?? '', template_key: key, title, document_id: prior.id, sha256: row?.sha256 ?? null, person_uid: null, reused: true });
        continue;
      }
    }
    const body = await getActiveTemplateBody(env, key);
    if (legacy) {
      if (!body && counselRequired.has(key)) { out.pending_counsel.push({ template_key: key, title, reason: 'counsel_approval_pending' }); continue; }
      if (!body) { out.pending_body.push({ template_key: key, title, reason: 'template_has_no_body' }); continue; }
      await write({ template_key: key, title }, applyMergeFields(body, fill!), null);
      continue;
    }
    if (!body) {
      if (Number(item.counsel_required) === 1) out.pending_counsel.push({ template_key: key, title, reason: 'counsel_approval_pending' });
      else out.pending_body.push({ template_key: key, title, reason: 'template_has_no_body' });
      continue;
    }
    // D6693's rule, for every template of a non-legacy form: counsel approved this body for this country.
    if (!(await templateApprovedFor(env, key, form.country))) {
      out.pending_counsel.push({ template_key: key, title, reason: 'not_reviewed_for_country', country: form.country });
      continue;
    }
    for (const person of todo) {
      const content = applyMergeFields(body, await caseMerge(env, k, form, order, today, person));
      const holes = [...mergeTokensIn(content)].sort();
      if (holes.length) { out.pending_fields.push({ template_key: key, title, person_uid: person?.uid ?? null, fields: holes }); continue; }
      await write({ template_key: key, title }, content, person);
    }
  }
  if (!opts.dryRun && out.documents.some((d) => !d.reused)) {
    await env.DB.prepare(
      `INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json) VALUES (?, ?, ?, 'documents_generated', 'all', ?)`,
    ).bind(k.id, actor.userId ?? null, actor.party, JSON.stringify({
      generated: out.documents.filter((d) => !d.reused).map((d) => ({ uid: d.uid, template_key: d.template_key })),
    })).run();
  }
  return { ok: true, dry_run: !!opts.dryRun, ...out };
}

/** One generated document and its case row, in one batch; a second writer for the same template and person writes nothing. */
async function writeGenerated(env: Env, k: DocCase, item: { template_key: string; title: string }, content: string, sha: string,
  person: CasePerson | null, actor: Actor) {
  const docUid = newUid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documents (uid, project_id, company_id, title, doc_type, status, content, template_name)
       SELECT ?, ?, ?, ?, 'other', 'generated', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM formation_case_documents WHERE case_id = ? AND origin = 'generated' AND template_key = ? AND COALESCE(person_id, 0) = ?)`,
    ).bind(docUid, k.project_id, k.project_id == null ? k.company_id : null, item.title, content, item.template_key, k.id, item.template_key, person?.id ?? 0),
    env.DB.prepare(
      `INSERT OR IGNORE INTO formation_case_documents (uid, case_id, document_id, class, visible_to, added_by, origin, template_key, person_id, sha256)
       SELECT ?, ?, d.id, 'other', 'all', ?, 'generated', ?, ?, ? FROM documents d WHERE d.uid = ?`,
    ).bind(newUid(), k.id, actor.userId ?? null, item.template_key, person?.id ?? null, sha, docUid),
  ]);
}

async function attachExisting(env: Env, k: DocCase, key: string, documentId: number, sha: string | null, actor: Actor) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO formation_case_documents (uid, case_id, document_id, class, visible_to, added_by, origin, template_key, person_id, sha256)
     VALUES (?, ?, ?, 'other', 'all', ?, 'generated', ?, NULL, ?)`,
  ).bind(newUid(), k.id, documentId, actor.userId ?? null, key, sha).run();
}

// ── The founder's reads ─────────────────────────────────────────────────────

export interface CaseDocumentView {
  uid: string; class: string; origin: string | null; template_key: string | null; title: string; sha256: string | null;
  person: { uid: string; name: string } | null; created_at: string;
  signing: { envelope_uuid: string; status: string; purpose: string } | null;
}

/** The documents of a case the founder may see (visible_to `all`), newest first, with the last envelope each was sent in. */
export async function listFounderDocuments(env: Env, caseId: number): Promise<CaseDocumentView[]> {
  const rows = (await env.DB.prepare(
    `SELECT cd.uid, cd.class, cd.origin, cd.template_key, cd.sha256, cd.created_at, d.title, p.uid AS person_uid, p.name AS person_name,
            (SELECT json_object('envelope_uuid', e.envelope_uuid, 'status', e.status, 'purpose', l.purpose)
               FROM formation_case_envelopes l JOIN esign_envelopes e ON e.id = l.envelope_id
              WHERE l.source_case_document_id = cd.id ORDER BY l.id DESC LIMIT 1) AS signing_json
       FROM formation_case_documents cd JOIN documents d ON d.id = cd.document_id
       LEFT JOIN formation_case_people p ON p.id = cd.person_id
      WHERE cd.case_id = ? AND cd.visible_to = 'all' ORDER BY cd.id DESC`,
  ).bind(caseId).all<any>()).results || [];
  return rows.map((r) => ({
    uid: r.uid, class: r.class, origin: r.origin ?? null, template_key: r.template_key ?? null, title: r.title, sha256: r.sha256 ?? null,
    person: r.person_uid ? { uid: r.person_uid, name: r.person_name } : null, created_at: r.created_at,
    signing: r.signing_json ? JSON.parse(r.signing_json) : null,
  }));
}

/** One document the founder may see. A generated document carries its text; a stored file carries only its hash. */
export async function openFounderDocument(env: Env, caseId: number, docUid: string) {
  const r = await env.DB.prepare(
    `SELECT cd.uid, cd.class, cd.origin, cd.template_key, cd.sha256, cd.created_at, d.title, d.content
       FROM formation_case_documents cd JOIN documents d ON d.id = cd.document_id
      WHERE cd.case_id = ? AND cd.uid = ? AND cd.visible_to = 'all'`,
  ).bind(caseId, docUid).first<any>();
  if (!r) return null;
  return {
    uid: r.uid, class: r.class, origin: r.origin ?? null, template_key: r.template_key ?? null, title: r.title,
    sha256: r.sha256 ?? null, created_at: r.created_at,
    body: r.origin === 'generated' ? (r.content ?? null) : null,
  };
}

// ── Signing ─────────────────────────────────────────────────────────────────

/** The e-sign send, injectable for a test. The default is routes/esign.ts createAndSendEnvelope. */
export type SendEnvelope = (env: Env, opts: {
  adminUserId: number; adminName: string; recipientUserId: number | null; recipientEmail: string; recipientName: string;
  documentType: string; appUrl: string; renderedBody: { title: string; body: string };
}) => Promise<{ envelope_id: number; envelope_uuid: string; signing_url: string; email_sent: boolean; already_pending?: boolean } | null>;

export interface SignInput { documentUid?: unknown; templateKey?: unknown; personUid?: unknown; purpose?: unknown }
export type SignResult =
  | { ok: true; envelope_uuid: string; email_sent: boolean; already_pending: boolean; signing_url: string | null; purpose: 'document' | 'consent_to_act' }
  | Fail | { ok: false; status: 409; error: 'fields_unfilled'; fields: string[] };

/**
 * The founder sends a document of the case for signature: a generated case
 * document (`documentUid`) or a contract template of the form (`templateKey`,
 * filled from the case). The signer is the founder, or a person of the case
 * (`personUid`). A consent to act (`purpose: 'consent_to_act'`) is a consent
 * document generated for that appointee.
 */
export async function sendForSignature(env: Env, k: DocCase, input: SignInput,
  deps: { send?: SendEnvelope; appUrl?: string; today?: string } = {}): Promise<SignResult> {
  if (k.closed_at) return fail(409, 'case_closed');
  const purpose = input.purpose == null ? 'document' : String(input.purpose);
  if (purpose !== 'document' && purpose !== 'consent_to_act') return fail(400, 'purpose_invalid');
  const founder = await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(k.user_id)
    .first<{ id: number; name: string | null; email: string }>();
  if (!founder) return fail(404, 'case_not_found');

  let person: CasePerson | null = null;
  if (input.personUid != null) {
    person = (await casePeople(env, k.id)).find((p) => p.uid === String(input.personUid)) ?? null;
    if (!person) return fail(404, 'person_not_found');
    if (!person.email) return fail(409, 'recipient_has_no_address');
  }
  if (purpose === 'consent_to_act') {
    if (!person) return fail(400, 'person_required');
    if (!isAppointee(person)) return fail(409, 'not_an_appointee');
    if (person.consent_to_act_at) return fail(409, 'consent_already_recorded');
  }

  let source: { caseDocumentId: number | null; templateKey: string; title: string; body: string };
  const form = await caseForm(env, k);
  if (input.documentUid != null) {
    const d = await env.DB.prepare(
      `SELECT cd.id, cd.template_key, cd.person_id, d.title, d.content FROM formation_case_documents cd JOIN documents d ON d.id = cd.document_id
        WHERE cd.case_id = ? AND cd.uid = ? AND cd.origin = 'generated' AND cd.visible_to = 'all'`,
    ).bind(k.id, String(input.documentUid)).first<any>();
    if (!d || !d.content) return fail(404, 'document_not_found');
    if (d.person_id != null && (!person || Number(d.person_id) !== person.id)) return fail(409, 'document_is_for_another_person');
    if (purpose === 'consent_to_act') {
      const item = form && await env.DB.prepare(
        `SELECT 1 FROM formation_pack_items WHERE version_id = ? AND form_id = ? AND template_key = ? AND item_key GLOB ?`,
      ).bind(k.catalogue_version_id, form.id, d.template_key, CONSENT_ITEM).first();
      if (!item || d.person_id == null) return fail(409, 'not_a_consent_document');
    }
    source = { caseDocumentId: Number(d.id), templateKey: String(d.template_key), title: String(d.title), body: String(d.content) };
  } else if (input.templateKey != null) {
    if (purpose === 'consent_to_act') return fail(400, 'consent_is_a_case_document');
    const key = String(input.templateKey);
    if (!form) return fail(409, 'case_has_no_form');
    const item = await env.DB.prepare(
      `SELECT title FROM formation_pack_items WHERE version_id = ? AND form_id = ? AND kind = 'document' AND template_key = ?`,
    ).bind(k.catalogue_version_id, form.id, key).first<{ title: string }>();
    const { CONTRACT_DOC_TYPES } = await import('../routes/admin_contracts');
    if (!item || !CONTRACT_DOC_TYPES.has(key.toLowerCase())) return fail(404, 'template_not_in_set');
    const legacy = String(form.legacy_gate ?? '') === '1';
    if (!legacy && !(await templateApprovedFor(env, key, form.country))) return fail(409, 'not_reviewed_for_country');
    const body = await getActiveTemplateBody(env, key);
    if (!body) return fail(409, 'template_has_no_body');
    const today = deps.today ?? isoDay();
    const merge = { ...(await caseMerge(env, k, form, await caseOrder(env, k.id), today)),
      recipient_name: person?.name ?? founder.name ?? undefined, recipient_email: person?.email ?? founder.email, effective_date: today };
    const content = applyMergeFields(body, merge);
    const holes = [...mergeTokensIn(content)].sort();
    if (holes.length) return { ok: false, status: 409, error: 'fields_unfilled', fields: holes };
    source = { caseDocumentId: null, templateKey: key, title: item.title, body: content };
  } else {
    return fail(400, 'document_required');
  }

  const send: SendEnvelope = deps.send ?? (async (e, o) => (await import('../routes/esign')).createAndSendEnvelope(e, o));
  let sent: Awaited<ReturnType<SendEnvelope>>;
  try {
    sent = await send(env, {
      adminUserId: founder.id, adminName: founder.name || founder.email,
      recipientUserId: person ? await personUserId(env, person.id) : founder.id,
      recipientEmail: person ? person.email! : founder.email, recipientName: person ? person.name : (founder.name || founder.email),
      documentType: source.templateKey, appUrl: deps.appUrl ?? 'https://axal.vc',
      renderedBody: { title: source.title, body: source.body },
    });
  } catch (e) {
    const { templateBodyRefusal } = await import('../routes/esign');
    const refusal = templateBodyRefusal(e, 'member');
    if (refusal) return fail(refusal.status, refusal.code);
    if ((e as Error)?.message === 'unfilled_fields') return { ok: false, status: 409, error: 'fields_unfilled', fields: (e as any).fields ?? [] };
    throw e;
  }
  if (!sent) return fail(502, 'send_failed');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO formation_case_envelopes (case_id, envelope_id, purpose, source_case_document_id, template_key, person_id, person_revision, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(k.id, sent.envelope_id, purpose, source.caseDocumentId, source.templateKey, person?.id ?? null,
      purpose === 'consent_to_act' ? person!.revision : null, founder.id),
    owedEffectStatement(env, sent.envelope_id, 'formation_case_signed'),
    env.DB.prepare(
      `INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json) VALUES (?, ?, 'founder', 'document_sent', 'all', ?)`,
    ).bind(k.id, founder.id, JSON.stringify({ envelope_uuid: sent.envelope_uuid, template_key: source.templateKey, purpose, person_uid: person?.uid ?? null })),
  ]);
  return { ok: true, envelope_uuid: sent.envelope_uuid, email_sent: !!sent.email_sent, already_pending: !!sent.already_pending,
    signing_url: person ? null : sent.signing_url, purpose };
}

async function personUserId(env: Env, personId: number): Promise<number | null> {
  const r = await env.DB.prepare('SELECT user_id FROM formation_case_people WHERE id = ?').bind(personId).first<{ user_id: number | null }>();
  return r?.user_id ?? null;
}

/**
 * The owed effect of a case envelope (esignEffects.ts `formation_case_signed`):
 * the signed copy lands on the case as an `evidence` document with the
 * SHA-256 of its file, and a consent to act sets the person's
 * consent_to_act_at to the completion time — only while the person is at the
 * revision the envelope was sent at. Idempotent: the copy's documents uid is
 * derived from the envelope.
 */
export { onCaseEnvelopeCompleted } from './formationCaseSigned';

// ── Consent uploaded by HQ or a partner ─────────────────────────────────────

/**
 * HQ, a partner or counsel records an appointee's signed consent to act from
 * a document already stored through the classified upload (no bytes here).
 * The document goes on the case and consent_to_act_at is set, in one batch,
 * only while the person is as read.
 */
export async function recordConsentUpload(env: Env, caseId: number, personId: number, input: { documentId: unknown }, actor: Actor):
  Promise<{ ok: true } | Fail> {
  if (!UPLOADERS.has(actor.party) || !posInt(actor.userId)) return fail(403, 'party_cannot_record_consent');
  const k = await readDocCase(env, caseId);
  if (!k) return fail(404, 'case_not_found');
  if (k.closed_at) return fail(409, 'case_closed');
  const person = (await casePeople(env, k.id)).find((p) => p.id === Number(personId));
  if (!person) return fail(404, 'person_not_found');
  if (!isAppointee(person)) return fail(409, 'not_an_appointee');
  if (person.consent_to_act_at) return fail(409, 'consent_already_recorded');
  const doc = posInt(input.documentId);
  const stored = doc && await env.DB.prepare('SELECT id, content FROM documents WHERE id = ?').bind(doc).first<{ id: number; content: string | null }>();
  if (!stored) return fail(400, 'document_not_found');
  let sha: string | null = null;
  try { const p = JSON.parse(String(stored.content ?? '')); if (SHA256.test(String(p?.sha256))) sha = p.sha256; } catch { /* not a stored-file pointer */ }
  const changed = env.DB.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END');
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE formation_case_people SET consent_to_act_at = datetime('now')
          WHERE id = ? AND case_id = ? AND revision = ? AND removed_at IS NULL AND consent_to_act_at IS NULL`,
      ).bind(person.id, k.id, person.revision),
      changed,
      env.DB.prepare(
        `INSERT OR IGNORE INTO formation_case_documents (uid, case_id, document_id, class, visible_to, added_by, origin, person_id, sha256)
         VALUES (?, ?, ?, 'evidence', 'all', ?, 'consent_upload', ?, ?)`,
      ).bind(newUid(), k.id, stored.id, actor.userId, person.id, sha),
      env.DB.prepare(
        `INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json) VALUES (?, ?, ?, 'consent_to_act_recorded', 'all', ?)`,
      ).bind(k.id, actor.userId, actor.party, JSON.stringify({ person_uid: person.uid, document_id: stored.id })),
    ]);
  } catch (e) {
    if (/overflow/i.test(String((e as Error)?.message))) return fail(409, 'person_moved');
    throw e;
  }
  return { ok: true };
}

// ── Filing-pack approval ────────────────────────────────────────────────────

/**
 * A filing's pack is set (formationFilings.setPack, which clears any earlier
 * approval) and the founder is asked to approve it: an approval request bound
 * to the pack's SHA-256 and the filing (D6695). Active approval requests of
 * this filing bound to another hash are cancelled; one bound to this hash is
 * kept rather than duplicated.
 */
export async function setPackForApproval(env: Env, filingId: number, input: { packDocumentId: unknown; packSha256: unknown }, actor: Actor):
  Promise<(FilingResult & { ok: true; request_uid: string }) | Fail> {
  const set = await setPack(env, filingId, input, actor);
  if (!set.ok) return set;
  const asked = await openPackApproval(env, set.filing, actor);
  if (!asked.ok) return asked;
  return { ...set, request_uid: asked.request_uid };
}

export async function openPackApproval(env: Env, filing: Pick<FilingRow, 'id' | 'case_id' | 'pack_sha256'>, actor: Actor):
  Promise<{ ok: true; request_uid: string } | Fail> {
  if (!filing.pack_sha256) return fail(409, 'pack_missing');
  const { openRequest, cancelRequest } = await import('./formationRequests');
  const active = (await env.DB.prepare(
    `SELECT id, uid, bound_sha256 FROM formation_case_requests
      WHERE filing_id = ? AND kind = 'approval' AND state IN ('open', 'answered', 'returned') ORDER BY id`,
  ).bind(filing.id).all<{ id: number; uid: string; bound_sha256: string }>()).results || [];
  for (const r of active) if (r.bound_sha256 !== filing.pack_sha256) await cancelRequest(env, r.id, actor);
  const same = active.find((r) => r.bound_sha256 === filing.pack_sha256);
  if (same) return { ok: true, request_uid: same.uid };
  const opened = await openRequest(env, filing.case_id, {
    askedOf: 'founder', kind: 'approval', title: 'Approve the filing pack', boundSha256: filing.pack_sha256, filingId: filing.id,
  }, actor);
  if (!opened.ok) return fail(opened.status, opened.error);
  return { ok: true, request_uid: opened.request.uid };
}
