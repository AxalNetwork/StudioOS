import React from 'react';
import ReactMarkdown from 'react-markdown';
import LegalDocument from './site/LegalDocument';

/**
 * #4565 — the proposed v2 Terms of Service, for counsel's review, at `/terms/v2-draft`.
 * Source: tos_v2_review_draft (#134) in D1, which stays inactive. Nothing links here and the path is
 * `noindex, nofollow` (`frontend/public/_headers`). `/terms` keeps the published text, whose
 * date the Trust versions read (D1074); this draft replaces it only once counsel approves
 * the text and its effective date. The LegalDocument layout is intentionally preserved.
 */
export const TERMS_DRAFT_UPDATED = 'Pending legal approval';
export const TERMS_DRAFT_EMAIL = 'management@axal.vc';
const INTRO_MARKDOWN = "# AXAL VC — TERMS OF SERVICE\nVersion: Proposed v2. Effective date: [LEGAL APPROVAL DATE]. Status: DRAFT FOR COUNSEL REVIEW; NOT EFFECTIVE OR PUBLISHED.\n";
const CONTENT = [
  {
    "n": "01",
    "h": "Operator and acceptance",
    "body": "These Terms govern the Axal VC website, StudioOS platform and related services (Platform), operated by Axal VC Management LLC, a Delaware LLC (Operator). By registering, clicking acceptance, or using the Platform after legally sufficient notice, users accept these Terms. A representative accepting for an organization warrants authority. Users who disagree must not use the Platform."
  },
  {
    "n": "02",
    "h": "Separate affiliated entities",
    "body": "Axal VC Holdings LLC is parent of Axal VC Management LLC and Axal VC GP LLC. Each remains legally separate. GP LLC may act as general partner of specified vehicles, including Axal VC Spin-Out Lab Fund I LP, under their executed governing documents. These Terms do not bind an affiliate or fund absent separate authorization or agreement. [OWNER AND COUNSEL TO CONFIRM EACH ENTITY'S ROLE AGAINST OPERATIONS AND AGREEMENTS: Management LLC as Operator and contracting party; Holdings LLC as owner of the Platform and its IP (as the effective Terms state); GP LLC's fund role.]"
  },
  {
    "n": "03",
    "h": "Eligibility and registration",
    "body": "Users must be at least 18, legally competent, and permitted to access relevant features in their jurisdictions. Investment or regulated features may require additional eligibility, identity, business, sanctions or investor-status checks. Access may be refused or restricted lawfully."
  },
  {
    "n": "04",
    "h": "Account security",
    "body": "Users shall provide accurate information, protect authentication methods, notify Operator of suspected unauthorized access, and not share access beyond permitted users. Operator may apply reasonable security measures and proportionate restrictions."
  },
  {
    "n": "05",
    "h": "Services and no guaranteed outcome",
    "body": "Platform features may include venture building, portfolio and investor communications, introductions, documents, analytics and collaboration. Availability varies. No financing, introductions, investment return, exit or other commercial outcome is guaranteed."
  },
  {
    "n": "06",
    "h": "Securities and regulated services",
    "body": "Platform information alone is not an offer, solicitation or individualized recommendation. Any fund investment or securities transaction is governed by definitive offering, subscription and fund documents and applicable eligibility restrictions. Platform access alone does not create an investment advisory, brokerage, fiduciary or partnership relationship; duties arising by law or separate contract are unaffected. See Risk Disclosures. [COUNSEL TO CONFIRM THE REGULATORY STATUS OF MANAGEMENT LLC AND GP LLC (REGISTERED, EXEMPT REPORTING OR NEITHER; ADVISER OR BROKER) BEFORE ANY STATUS STATEMENT IS PUBLISHED. The effective Terms state that Management LLC is not a registered investment adviser or broker-dealer; that statement is carried only once confirmed.]"
  },
  {
    "n": "07",
    "h": "Confidentiality",
    "body": "Users shall protect nonpublic deal flow, financial, technical, personal and business information and use it only for authorized purposes. Exceptions include information lawfully public, independently developed, received without duty or legally compelled to be disclosed. Separate NDAs prevail where applicable."
  },
  {
    "n": "08",
    "h": "Intellectual property and user content",
    "body": "Platform IP is owned by Axal VC Holdings LLC or its licensors [OWNER AND COUNSEL TO VERIFY CHAIN OF TITLE]; these Terms do not establish chain of title. Operator grants limited nonexclusive, nontransferable, revocable authorized-use rights. Users retain lawful rights in uploaded content and grant Operator a limited licence to host, process and transmit it to deliver the Platform and meet lawful security obligations. No independent authorization to train third-party AI models on confidential uploads is granted."
  },
  {
    "n": "09",
    "h": "Acceptable use",
    "body": "No unauthorized access, credential abuse, malware, disruption, infringement, unlawful scraping, misrepresentation, unlawful distribution of confidential material, sanctions violations or circumvention of restrictions. Operator may investigate and respond proportionately."
  },
  {
    "n": "10",
    "h": "AI features",
    "body": "AI-assisted summaries, analysis and workflows may be inaccurate or incomplete. Users must independently verify consequential outputs and not treat them as legal, tax, financial or investment advice. Confidentiality, privacy and contract restrictions apply to AI processing."
  },
  {
    "n": "11",
    "h": "Privacy and data",
    "body": "Personal data is handled under the Privacy Policy and applicable law. Users warrant lawful authority to upload third-party data. Data processing and international transfers may require separate agreements or lawful safeguards."
  },
  {
    "n": "12",
    "h": "Third-party integrations",
    "body": "External identity, payment, cloud, analytics and communication services may have separate terms. Operator remains responsible where applicable law or its own contractual obligations require."
  },
  {
    "n": "13",
    "h": "Fees",
    "body": "Fees, subscriptions, refunds and taxes are shown before you pay. A paid subscription renews automatically at the end of each billing period, monthly or yearly, until cancelled. You can cancel at any time from Billing in your account; cancellation takes effect at the end of the current paid period, and paid features remain available until then. Cancelling does not by itself refund the current period. Refunds are given where the law requires them or where the price page or checkout says so. Purchased AI tokens are a separate balance from a plan's monthly AI allowance. [COUNSEL TO CONFIRM CONSUMER WITHDRAWAL AND REFUND RIGHTS BY MARKET; NO BLANKET NO-REFUND OR WITHDRAWAL WAIVER IS APPROVED.] Fund fees, carry, commitments and expenses are governed by separate fund and investment documents."
  },
  {
    "n": "14",
    "h": "Company formation through partners",
    "body": "Where the Platform offers company formation in a country, the registration is filed by a named formation partner licensed or permitted to do that work there, not by Axal VC Management LLC, which arranges the service as intermediary. The partner may carry out its own identity and eligibility checks on founders, directors, shareholders and beneficial owners before filing, and may refuse or pause a filing. Times shown are targets, not guarantees; registration depends on the partner, the registry and the information provided. The partner's own terms may apply to its services. [OWNER AND COUNSEL TO APPROVE BEFORE THE FIRST NON-US COUNTRY GOES LIVE (#6717).]"
  },
  {
    "n": "15",
    "h": "Availability and disclaimers",
    "body": "Platform provided on an as-available basis to the extent permitted by law. No guarantee of uninterrupted access, error-free features or third-party information accuracy. Nonwaivable statutory protections remain intact."
  },
  {
    "n": "16",
    "h": "Liability",
    "body": "To the extent permitted by law, Operator excludes indirect and consequential losses, subject to nonwaivable exceptions. [COUNSEL MUST INSERT PROPORTIONATE AGGREGATE LIABILITY CAP AND CARVE-OUTS]. No provision excludes liability where prohibited."
  },
  {
    "n": "17",
    "h": "Suspension, closure and survival",
    "body": "Operator may suspend or terminate for material breach, security risk or unlawful conduct with reasonable notice where appropriate. Users may request closure. Accrued rights and surviving confidentiality, IP and dispute provisions remain; retention/deletion follows law and applicable policies."
  },
  {
    "n": "18",
    "h": "International access",
    "body": "Access from another jurisdiction does not imply every financial service is offered there. Users must comply with applicable local law, sanctions and export restrictions. Operator may georestrict regulated features."
  },
  {
    "n": "19",
    "h": "Governing law and dispute resolution",
    "body": "Delaware law governs to the extent permitted by mandatory law. [COUNSEL MUST SELECT COURT OR ARBITRATION FORUM, SERVICE AND PROCEDURAL TERMS AND INTERNATIONAL OR CONSUMER EXCEPTIONS]. Separate executed investment and commercial agreements control their own disputes."
  },
  {
    "n": "20",
    "h": "Changes",
    "body": "Material revisions require appropriate notice and, where required, affirmative consent. Publish effective dates and preserve prior versions and acceptance records."
  },
  {
    "n": "21",
    "h": "Contact, notices and related policies",
    "body": "Axal VC Management LLC; management@axal.vc. Notices under these Terms are given in writing by email to that address and take effect on delivery. Postal notices: [OWNER TO SUPPLY THE APPROVED DELIVERABLE POSTAL ADDRESS FOR LEGAL NOTICES. 16192 Coastal Hwy, Lewes, DE 19958 appears in this draft as a correspondence address and is not verified as deliverable for notices. The effective Terms allow notice by registered mail without giving any address; no mail-based notice term is published until an address is approved.] Privacy: https://axal.vc/privacy. Risks: https://axal.vc/risk-disclosures. Separately executed agreements control their specific transactions where inconsistent.\n\n## Counsel publication checklist\nVerify Operator and affiliate roles and the notices address; adviser/broker/fund regulatory status; IP ownership; consent and age requirements; cookie/privacy terms; user-content and AI data practices; consumer and international protections; liability cap and forum; security and retention; existing agreements. Do not publish until approved."
  }
];
const SECTIONS = CONTENT.map(({ n, h, body }) => ({ n, h, body: <ReactMarkdown>{body}</ReactMarkdown> }));

export default function TermsV2DraftPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      updated={TERMS_DRAFT_UPDATED}
      intro={<><p><strong>Proposed revision — pending legal review. Not yet effective.</strong></p><ReactMarkdown>{INTRO_MARKDOWN}</ReactMarkdown></>}
      sections={SECTIONS}
      email={TERMS_DRAFT_EMAIL}
    />
  );
}
