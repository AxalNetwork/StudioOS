/**
 * Who may originate which document for signature.
 *
 * WHY THIS EXISTS. `POST /api/legal/esign/send` stopped being admin-only in
 * task #156 — it takes `requireAuth` and nothing more. The UI never followed.
 * The only screen in the SPA that calls it is the "Create envelope" wizard
 * inside AdminPage.jsx, and the template picker it depends on
 * (`GET /admin/contracts/templates/legal`) is behind `requireAdmin`. So a
 * founder has been able to sign documents for two releases and unable to send
 * one, which is the half of the de-admin nobody finished.
 *
 * WHAT LIMITS THIS LIST, and it is not taste. `services/legalTemplates.ts`
 * imports exactly NINE templates as `?raw` and puts them in `TEMPLATES`.
 * Forty-five more .md files sit in templates/legal/ and are not imported at
 * all — `getLegalTemplateBody` throws `unknown_legal_template` on any of them.
 * So a doc type may appear here only if `templateKeyForDocType` resolves it to
 * one of the nine. `esign_originators.test.ts` asserts that for every entry;
 * offering a document the platform cannot actually produce would be the
 * signature-flow version of inventing a fund fact.
 *
 * WHAT THE CANVAS ASKED FOR AND DID NOT GET. The Send for Signature canvas
 * gives founders SAFE, Term Sheet and Co-founder Agreement. Neither SAFE nor
 * Term Sheet has a wired template, so neither is here. Co-founder Agreement
 * has something better than a template — its own drafting flow at
 * POST /legal/cofounder-agreement (task #39) — so the page links to that
 * rather than growing a second, worse path to the same document.
 *
 * `admin` is not a key. An admin keeps the full catalogue through the existing
 * admin wizard; this registry is about what everyone else may originate, and
 * `templatesFor` gives an admin the union so the new page works for them too.
 */
export interface OriginatorTemplate {
  /** The `document_type` posted to /api/legal/esign/send. */
  doc_type: string;
  /** What the sender sees in the picker. */
  name: string;
  /** Grouping chip, from the canvas. */
  tag: string;
  /** When to reach for this document rather than another one. */
  when: string;
  /** Signers and provenance, stated plainly. */
  meta: string;
}

const FOUNDER_NDA: OriginatorTemplate = {
  doc_type: 'founder_nda_v1',
  name: 'Founder Mutual NDA',
  tag: 'Confidentiality',
  when: 'Before sharing metrics, a data room or a cap table with someone outside the company.',
  meta: '2 signers · mutual · no expiry set by default',
};

const NDA_3WAY: OriginatorTemplate = {
  doc_type: 'nda_3way_founder_investor_axal',
  name: '3-Way NDA (Founder ↔ Investor ↔ Axal)',
  tag: 'Confidentiality',
  when: 'When a conversation runs through Axal and all three sides need the same confidentiality terms.',
  meta: '3 signers · mutual',
};

export const ORIGINATOR_TEMPLATES: Record<string, ReadonlyArray<OriginatorTemplate>> = {
  founder: [FOUNDER_NDA, NDA_3WAY],
  investor: [
    {
      doc_type: 'investor_nda_axal',
      name: 'Investor NDA (Axal)',
      tag: 'Confidentiality',
      when: 'Before receiving a company’s confidential materials through Axal.',
      meta: '2 signers · mutual',
    },
    {
      doc_type: 'accreditation_v1',
      name: 'Accreditation Attestation',
      tag: 'Compliance',
      when: 'When a fund or SPV needs your accredited-investor status on record before a close.',
      meta: '1 signer · self-attestation',
    },
    NDA_3WAY,
  ],
  advisor: [
    {
      doc_type: 'mentor_nda_axal',
      name: 'Advisor NDA (Axal)',
      tag: 'Confidentiality',
      when: 'Before an engagement where you will see a company’s confidential material.',
      meta: '2 signers · mutual',
    },
    {
      doc_type: 'mentor_engagement_disclaimer',
      name: 'Advisor Engagement Disclaimer',
      tag: 'Engagement',
      when: 'At the start of an engagement, to set out what the relationship is and is not.',
      meta: '1 signer · acknowledgement',
    },
  ],
  partner: [
    {
      doc_type: 'partner_services',
      name: 'Partner Services / MSA',
      tag: 'Delivery',
      when: 'To put a scope, rate and term around work you are about to start for a company.',
      meta: '2 signers · master agreement',
    },
    FOUNDER_NDA,
  ],
};

/**
 * The templates this role may originate.
 *
 * An admin gets the union rather than an empty list: the new page has to work
 * for them, and every entry here is one the admin wizard already offers.
 * Deduped by doc_type, since the NDAs are deliberately shared across roles.
 */
export function templatesFor(role: string | null | undefined): OriginatorTemplate[] {
  if (role === 'admin') {
    const seen = new Set<string>();
    const out: OriginatorTemplate[] = [];
    for (const list of Object.values(ORIGINATOR_TEMPLATES)) {
      for (const t of list) {
        if (seen.has(t.doc_type)) continue;
        seen.add(t.doc_type);
        out.push(t);
      }
    }
    return out;
  }
  return [...(ORIGINATOR_TEMPLATES[String(role || '')] ?? [])];
}

/** True when `role` may originate `docType`. The send route enforces this. */
export function mayOriginate(role: string | null | undefined, docType: string): boolean {
  return templatesFor(role).some((t) => t.doc_type === docType);
}

/**
 * The name a person reads for a doc type this registry offers, or null.
 * createAndSendEnvelope titled template-backed envelopes with the raw doc type,
 * so the signing email, the PDF and the status view all said
 * `founder_nda_v1` (D411). A doc type outside the registry keeps its own
 * string, which is what the operator flows have always sent.
 */
export function originatorName(docType: string): string | null {
  for (const list of Object.values(ORIGINATOR_TEMPLATES)) {
    const t = list.find((x) => x.doc_type === docType);
    if (t) return t.name;
  }
  return null;
}

/**
 * Every doc type this registry names, for the test that checks each one
 * actually resolves to a wired template.
 *
 * This module deliberately imports NOTHING. legalTemplates.ts pulls its bodies
 * in as `*.md?raw`, which only resolves under the wrangler bundler, so
 * importing it here would make this registry unloadable by any plain test
 * runner. The guard reads both files as text instead.
 */
export function allOriginatorDocTypes(): string[] {
  return [...new Set(Object.values(ORIGINATOR_TEMPLATES).flat().map((t) => t.doc_type))];
}

/**
 * WHAT THE CANVAS DRAWS THAT THIS PAGE CANNOT SEND, per role, each with the
 * reason the page prints (D411). The canvas offers these by name; leaving them
 * out silently would read as "the platform has never heard of a SAFE". Each
 * one is absent for the same underlying reason — no body is registered for it
 * in `services/legalTemplates.ts`, so an envelope for it could not be rendered
 * — and the Co-founder Agreement is the exception with a better answer: its
 * own drafting flow, which the page links to instead.
 *
 * The reason is served, not written into the page, so the page prints exactly
 * what the Worker knows and the two cannot drift.
 */
export interface NotOfferedTemplate {
  name: string;
  tag: string;
  reason: string;
  /** Where the job is done instead, when somewhere does it. */
  instead?: { path: string; label: string };
}

const NO_BODY = 'Not wired to the signing engine: no template body is registered for it, so an envelope could not be rendered.';

export const NOT_OFFERED: Record<string, ReadonlyArray<NotOfferedTemplate>> = {
  founder: [
    { name: 'SAFE', tag: 'Financing', reason: NO_BODY },
    { name: 'Term Sheet', tag: 'Financing', reason: NO_BODY },
    {
      name: 'Co-founder Agreement', tag: 'Formation',
      reason: 'Drafted in its own flow, which collects the split, vesting and IP terms before it drafts anything.',
      instead: { path: '/incorporate/cofounder-agreement', label: 'Open the Co-founder Agreement' },
    },
  ],
  partner: [
    { name: 'White-Label Service Agreement', tag: 'Delivery', reason: NO_BODY },
  ],
  advisor: [
    { name: 'Advisory Agreement', tag: 'Equity', reason: NO_BODY },
    { name: 'Advisory Retainer', tag: 'Cash terms', reason: NO_BODY },
  ],
  investor: [],
};

/** Same shape as `templatesFor`: an admin sees the union, deduped by name. */
export function notOfferedFor(role: string | null | undefined): NotOfferedTemplate[] {
  if (role === 'admin') {
    const seen = new Set<string>();
    return Object.values(NOT_OFFERED).flat().filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
  }
  return [...(NOT_OFFERED[String(role || '')] ?? [])];
}

/**
 * What the canvas draws around a send that no store holds, with the sentence
 * the page prints for each (D411). Served with the template and the envelope
 * so the page never writes its own reason for an absence.
 */
export const SEND_ABSENCES = {
  prefill: 'Nothing is pre-filled from a deal record, quote or match: this page does not read those stores yet, so every field starts empty.',
  pre_send_checks: 'No pre-send checks are recorded for this template: there is no store of rules to check a document against.',
  ordered_signers: 'One signer per envelope, and you do not sign it yourself: envelopes have no signing order or sender signature yet.',
} as const;

export const ENVELOPE_ABSENCES = {
  signer_ip: 'Signer IP addresses are held in the audit record but not shown here: whether the other party may see them is an open decision for the platform owner.',
  data_room: 'Not filed to a data room: nothing writes an executed agreement into one yet. Download the PDF below.',
} as const;
