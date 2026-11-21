import React from 'react';
import ReactMarkdown from 'react-markdown';
import LegalDocument from './site/LegalDocument';

/**
 * #4565 — the proposed v2 Privacy Policy, for counsel's review, at `/privacy/v2-draft`.
 * Source: privacy_v2_review_draft (#135) in D1, which stays inactive. Nothing links here and the path is
 * `noindex, nofollow` (`frontend/public/_headers`). `/privacy` keeps the published text, whose
 * date the Trust versions read (D1074); this draft replaces it only once counsel approves
 * the text and its effective date. The LegalDocument layout is intentionally preserved.
 */
export const PRIVACY_DRAFT_UPDATED = 'Pending legal approval';
export const PRIVACY_DRAFT_EMAIL = 'privacy@axal.vc';
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
    "body": "Axal VC Management LLC operates the website and StudioOS and is generally responsible for their personal-data processing. Axal VC Holdings LLC is the parent of Management LLC and Axal VC GP LLC. Depending on actual processing, an affiliate, fund or service provider may be an independent controller, joint controller or processor. Specific roles must be verified; group ownership does not mean unrestricted access. [OWNER AND COUNSEL TO CONFIRM, FOR EACH ACTIVITY, WHICH ENTITY IS CONTROLLER OR PROCESSOR, AGAINST OPERATIONS AND SIGNED AGREEMENTS.]"
  },
  {
    "n": "03",
    "h": "Categories of information",
    "body": "Depending on the service, we may collect identity and contact details, professional details, investor eligibility and financial data, KYC/AML information (identity documents and review decisions for checks that require them), account credentials and logs, uploaded documents, communications, interview recordings and transcripts, device/IP information, cookie preferences and authorized connector data. Sensitive identifiers and banking data should be collected only where necessary. We do not ask for date of birth at registration."
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
    "body": "Subscription, capital-call, tax, suitability and compliance data may be processed for particular vehicles. GLBA, Regulation S-P and other rules apply only where relevant to an entity and activity. Separate investor notices and fund documents may control. [COUNSEL TO CONFIRM WHETHER ANY AXAL ENTITY IS SUBJECT TO GLBA OR REGULATION S-P, FOR WHICH ACTIVITY AND SINCE WHEN. The effective Policy states compliance with both for all processing; that statement is not carried until confirmed.]"
  },
  {
    "n": "08",
    "h": "Disclosures",
    "body": "Personal information may be shared on a need-to-know basis with affiliates, fund administrators, verification and technology vendors, legal/accounting advisers, transaction participants, formation partners for a company formation you request, competent authorities and parties to lawful corporate transactions. Apply contracts and confidentiality safeguards as required."
  },
  {
    "n": "09",
    "h": "International transfers",
    "body": "Cross-border transfers shall use lawful mechanisms where required, potentially adequacy decisions, standard contractual clauses or equivalent safeguards. Actual processing locations and mechanisms must be verified. Our hosting runs on Cloudflare's global network. Where you request company formation in another country, the information the filing needs is sent to the formation partner for that country. [COUNSEL TO CONFIRM THE TRANSFER MECHANISM FOR EACH PARTNER AND COUNTRY; EACH PARTNER'S SIGNED DATA TERMS ARE RECORDED IN THE FORMATION PARTNER REGISTRY (D6692).]"
  },
  {
    "n": "10",
    "h": "Security and incidents",
    "body": "Apply proportionate administrative, technical and organizational safeguards, including appropriate authentication, access controls, encryption, logging and incident response. No system is perfectly secure. Notify affected people and authorities where and when applicable law requires; do not promise a universal 30-day deadline. [COUNSEL TO CONFIRM WHICH NOTIFICATION DUTIES APPLY, TO WHICH ENTITY, AND THEIR TIMING. The effective Policy's 30-day federal deadline is not carried.]"
  },
  {
    "n": "11",
    "h": "Retention",
    "body": "Retention varies by category. Periods recorded today:\n\n- **Call audio** from recorded calls is deleted after 30 days by default, or the period you choose where offered; the transcript stays with its interview until you or your company delete the interview.\n- **Referral cookie**: up to 30 days for a referral code or 90 days for a referral handle in your browser (section on cookies).\n- **Signup measurement events** (with Analytics on) are kept for 180 days.\n- **Google access tokens** are kept, encrypted, until you disconnect Google.\n- **AI agent run summaries** are kept for 180 days and agent memory until the agent is removed plus 90 days [PENDING LEGAL REVIEW, D1528].\n\nAccount data is kept while your account is open; deletion requests are handled case by case and some records may be held where the law requires. Investor, tax, fund and compliance records are retained separately from ordinary accounts, for the periods the applicable fund documents and laws require. [COUNSEL TO SET THE INVESTOR AND FINANCIAL RECORD PERIODS AND THEIR LEGAL BASIS; THE EFFECTIVE POLICY'S \"7 YEARS\" HAS NO RECORDED BASIS (#5510).] Maintain an approved category-specific schedule, legal holds and deletion procedures."
  },
  {
    "n": "12",
    "h": "Individual rights",
    "body": "Where applicable, individuals may request access, correction, deletion, portability, restriction, objection, withdrawal of consent and applicable sale/sharing or profiling opt-outs, and complain to competent authorities. Rights may be limited by law. Requests: privacy@axal.vc; verify identity and meet applicable deadlines."
  },
  {
    "n": "13",
    "h": "Cookies and similar technologies",
    "body": "We use cookies and similar browser storage to operate StudioOS and remember your cookie choices. On your first visit, you can accept all, reject all optional categories, or choose which optional categories to enable. You can change or withdraw either optional choice at any time using **Cookie preferences** in the site footer.\n\n- **Essential.** This storage supports sign-in, session security and the settings you choose, including your cookie preferences. Essential storage is always on.\n- **Analytics.** If you enable Analytics, we measure which signup steps are reached and which link brought you here, using a random browser ID. We send this measurement only to Axal. Analytics also lets us count visits to active referral handles using a separate random ID kept in your browser for the life of that tab.\n- **Marketing.** If you enable Marketing, we use a first-party cookie to remember the first referral link you use so we can credit the referrer and apply eligible offers. The cookie lasts up to **30 days for a referral code** or **90 days for a referral handle**, measured from the first qualifying use.\n\nTurning off Analytics stops optional analytics measurement and clears the handle visit ID from your browser. Turning off Marketing stops referral attribution through the cookie and clears it. You can still sign up with either optional category turned off."
  },
  {
    "n": "14",
    "h": "AI processing",
    "body": "AI-assisted analysis, matching, summaries and document workflows may involve personal data you submit or select. AI runs on Cloudflare (Workers AI and AI Gateway); an external model provider, such as Anthropic or OpenAI, receives a request only when that provider is enabled for the feature. [OWNER TO CONFIRM THE PROVIDERS ENABLED IN PRODUCTION, THEIR PROMPT-LOGGING AND RETENTION TERMS, AND REGIONS.] Inputs and outputs are not used to train generalized models by Axal VC. Do not assume AI data is anonymized or that all vendors share retention policies. Explain significant automated decision-making rights where applicable."
  },
  {
    "n": "15",
    "h": "Interview recordings",
    "body": "Interview and meeting recording and transcription happen only with notice and, where the law requires, consent, including for participants without an account. Call audio is deleted after 30 days by default; transcripts and the findings drawn from them stay with the interview until it is deleted. A meeting provider (Zoom, Google Meet or Microsoft Teams) may keep its own copy under its terms. See https://axal.vc/privacy/interviews."
  },
  {
    "n": "16",
    "h": "Google integrations",
    "body": "You can connect a Google account in Account › Connectors. Google data is used only for the features you turn on:\n\n- **Calendar**: read events to find a call you attach to an interview, and create events with a Meet link when you schedule a call.\n- **Meet**: create the meeting so your note-taker can join and Meet can transcribe it, and read an attached call's participants and transcript.\n- **Drive and Sheets**: open only files you pick in Google's picker, or the spreadsheet you connect for fund reporting.\n- **Gmail**: send the emails you send from Axal VC through your mailbox. We do not read your inbox. An earlier connection that granted read-only Gmail access can remove it in Connectors.\n- **Search Console**: read your site's search performance for the venture you connect it to.\n- **Profile**: your name and email, to show which account is connected.\n\nUse and transfer of Google API data adheres to the Google API Services User Data Policy, including the Limited Use requirements: no sale, no advertising, no generalized AI model training, and staff access only on your request, for security or as the law requires. Tokens are stored encrypted and deleted when you disconnect. [VERIFY EACH SCOPE AGAINST THE PRODUCTION OAUTH CONSENT SCREEN BEFORE PUBLICATION.]"
  },
  {
    "n": "17",
    "h": "Company formation",
    "body": "If you request company formation in a country, we share the information the filing needs about you and the other people named in it (directors, shareholders, beneficial owners and co-founders) with the formation partner that files there. The partner may verify identities itself and keeps records under its own legal duties. Axal VC Management LLC arranges the service; it does not file. If you name other people in a formation, you confirm you have told them their information will be shared for this purpose. [OWNER AND COUNSEL TO APPROVE, WITH EACH PARTNER'S DATA ROLE AND TRANSFER BASIS, BEFORE THE FIRST NON-US COUNTRY GOES LIVE (#6717).]"
  },
  {
    "n": "18",
    "h": "Marketing",
    "body": "Send newsletters and event messages where lawful, with effective unsubscribe. Transactional/security messages may continue when necessary."
  },
  {
    "n": "19",
    "h": "Children",
    "body": "The Platform is intended for adults, not children under 18. Address discovered inappropriate collection under applicable law. [OWNER TO CONFIRM THE INTENDED AGE AUDIENCE BEFORE ANY ELIGIBILITY CHANGE OR DATE-OF-BIRTH COLLECTION.]"
  },
  {
    "n": "20",
    "h": "Third parties",
    "body": "External sites and services may have their own privacy notices; users should review them."
  },
  {
    "n": "21",
    "h": "Updates",
    "body": "Publish effective dates and provide notice of material changes when required."
  },
  {
    "n": "22",
    "h": "Contact",
    "body": "Axal VC Management LLC. Postal address: [OWNER TO SUPPLY THE APPROVED DELIVERABLE POSTAL ADDRESS. 16192 Coastal Hwy, Lewes, DE 19958 is an unverified correspondence address.] Email privacy@axal.vc. Insert any required local representative or DPO contact after review.\n\n## Counsel review gate\nVerify controllers and processors, actual data flows, Regulation S-P/GLBA applicability, GDPR and state privacy laws, international transfers, retention schedules, cookies and consent, incident notification duties, AI vendors, Google OAuth scopes, interviews and security claims before publication."
  }
];
const SECTIONS = CONTENT.map(({ n, h, body }) => ({ n, h, body: <ReactMarkdown>{body}</ReactMarkdown> }));

export default function PrivacyV2DraftPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated={PRIVACY_DRAFT_UPDATED}
      intro={<><p><strong>Proposed revision — pending legal review. Not yet effective.</strong></p><ReactMarkdown>{INTRO_MARKDOWN}</ReactMarkdown></>}
      sections={SECTIONS}
      email={PRIVACY_DRAFT_EMAIL}
    />
  );
}
