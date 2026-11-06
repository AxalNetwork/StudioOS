import React from 'react';
import ReactMarkdown from 'react-markdown';
import LegalDocument from './site/LegalDocument';

/** Proposed v2 legal copy from D1 draft; review required before merge/deployment.
 * Source: privacy_v2_review_draft (#135).
 * The LegalDocument layout is intentionally preserved.
 */
export const PRIVACY_UPDATED = 'Pending legal approval';
export const PRIVACY_EMAIL = 'privacy@axal.vc';
const INTRO_MARKDOWN = "# AXAL VC — PRIVACY POLICY\nProposed Version 2.0. Effective date: [COUNSEL-APPROVED DATE]. Draft for legal review; not effective or published.\n";
const CONTENT = [
  {
    "n": "01",
    "h": "Introduction",
    "body": "This Policy describes processing by Axal VC in connection with its website, StudioOS, venture-building activities, investment administration, partnerships and communications. It applies to visitors, users, founders, investors, contractors, interview participants and business contacts. Additional notices may govern particular activities or jurisdictions."
  },
  {
    "n": "02",
    "h": "Responsible entities",
    "body": "Axal VC Management LLC operates the website and StudioOS and is generally responsible for their personal-data processing. Axal VC Holdings LLC is the parent of Management LLC and Axal VC GP LLC. Depending on actual processing, an affiliate, fund or service provider may be an independent controller, joint controller or processor. Specific roles must be verified; group ownership does not mean unrestricted access."
  },
  {
    "n": "03",
    "h": "Categories of information",
    "body": "Depending on the service, we may collect identity and contact details, professional details, investor eligibility and financial data, KYC/AML information, account credentials and logs, uploaded documents, communications, interview recordings and transcripts, device/IP information, cookie preferences and authorized connector data. Sensitive identifiers and banking data should be collected only where necessary."
  },
  {
    "n": "04",
    "h": "Sources",
    "body": "Information may come from individuals, authorized representatives, Platform interactions, lawful public sources, compliance vendors, partners and user-authorized integrations."
  },
  {
    "n": "05",
    "h": "Purposes",
    "body": "Purposes include account operation, security, venture and investor administration, identity and eligibility checks where required, transactions, support, communications, lawful analytics, fraud prevention, contract performance and legal compliance. We do not sell personal information for money; jurisdiction-specific sale/sharing claims require review of actual analytics and advertising practices."
  },
  {
    "n": "06",
    "h": "Lawful bases",
    "body": "Where GDPR/UK GDPR or analogous law applies, grounds may include contract, legal obligation, legitimate interests subject to balancing, consent or another applicable ground. Record purpose-specific lawful bases and consent withdrawal methods."
  },
  {
    "n": "07",
    "h": "Investor information and financial privacy",
    "body": "Subscription, capital-call, tax, suitability and compliance data may be processed for particular vehicles. GLBA, Regulation S-P and other rules apply only where relevant to an entity and activity. Separate investor notices and fund documents may control."
  },
  {
    "n": "08",
    "h": "Disclosures",
    "body": "Personal information may be shared on a need-to-know basis with affiliates, fund administrators, verification and technology vendors, legal/accounting advisers, transaction participants, competent authorities and parties to lawful corporate transactions. Apply contracts and confidentiality safeguards as required."
  },
  {
    "n": "09",
    "h": "International transfers",
    "body": "Cross-border transfers shall use lawful mechanisms where required, potentially adequacy decisions, standard contractual clauses or equivalent safeguards. Actual processing locations and mechanisms must be verified."
  },
  {
    "n": "10",
    "h": "Security and incidents",
    "body": "Apply proportionate administrative, technical and organizational safeguards, including appropriate authentication, access controls, encryption, logging and incident response. No system is perfectly secure. Notify affected people and authorities where and when applicable law requires; do not promise a universal 30-day deadline."
  },
  {
    "n": "11",
    "h": "Retention",
    "body": "Retention varies by account, investor, tax, compliance, security, marketing, interview and connector data categories. Maintain an approved category-specific schedule, legal holds and deletion procedures. Do not assert all records require seven years."
  },
  {
    "n": "12",
    "h": "Individual rights",
    "body": "Where applicable, individuals may request access, correction, deletion, portability, restriction, objection, withdrawal of consent and applicable sale/sharing or profiling opt-outs, and complain to competent authorities. Rights may be limited by law. Requests: privacy@axal.vc; verify identity and meet applicable deadlines."
  },
  {
    "n": "13",
    "h": "Cookies",
    "body": "Essential cookies support authentication and security. Functional, analytics and advertising technologies require accurate disclosure and consent where applicable. Honor preference controls and applicable privacy signals. Verify deployed providers and cookie behavior."
  },
  {
    "n": "14",
    "h": "AI processing",
    "body": "AI-assisted analysis, matching, summaries and document workflows may involve personal data. Apply appropriate confidentiality, vendor, data-minimization, security and legal-basis safeguards. Do not assume AI data is anonymized or that all vendors share retention policies. Explain significant automated decision-making rights where applicable."
  },
  {
    "n": "15",
    "h": "Interview recordings",
    "body": "Interview and meeting recording/transcription require notice and consent where legally necessary, including for non-account holders. State purpose, access, retention and deletion rights; see https://axal.vc/privacy/interviews."
  },
  {
    "n": "16",
    "h": "Google integrations",
    "body": "Authorized Google Calendar, Meet, Drive, Sheets, Gmail and profile data are accessed only for enabled features and granted scopes. Comply with Google API Services User Data Policy and Limited Use requirements. Do not use Google API data for advertising or generalized AI model training. Provide connector revocation and deletion controls. Verify exact scopes, Gmail behavior, transcripts, tokens and retention against implementation."
  },
  {
    "n": "17",
    "h": "Marketing",
    "body": "Send newsletters and event messages where lawful, with effective unsubscribe. Transactional/security messages may continue when necessary."
  },
  {
    "n": "18",
    "h": "Children",
    "body": "Platform is intended for adults, not children under 18. Address discovered inappropriate collection under applicable law."
  },
  {
    "n": "19",
    "h": "Third parties",
    "body": "External sites and services may have their own privacy notices; users should review them."
  },
  {
    "n": "20",
    "h": "Updates",
    "body": "Publish effective dates and provide notice of material changes when required."
  },
  {
    "n": "21",
    "h": "Contact",
    "body": "Axal VC Management LLC, 16192 Coastal Hwy, Lewes, DE 19958, United States (correspondence address, not verified registered office). Email privacy@axal.vc. Insert any required local representative or DPO contact after review.\n\n## Counsel review gate\nVerify controllers and processors, actual data flows, Regulation S-P/GLBA applicability, GDPR and state privacy laws, international transfers, retention schedules, cookies and consent, incident notification duties, AI vendors, Google OAuth scopes, interviews and security claims before publication."
  }
];
const SECTIONS = CONTENT.map(({ n, h, body }) => ({ n, h, body: <ReactMarkdown>{body}</ReactMarkdown> }));

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated={PRIVACY_UPDATED}
      intro={<><p><strong>Proposed revision — pending legal review. Not yet effective.</strong></p><ReactMarkdown>{INTRO_MARKDOWN}</ReactMarkdown></>}
      sections={SECTIONS}
      email={PRIVACY_EMAIL}
    />
  );
}
