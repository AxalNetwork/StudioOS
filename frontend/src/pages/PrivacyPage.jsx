import React from 'react';
import { Link } from 'react-router-dom';
import LegalDocument from './site/LegalDocument';

/**
 * `/privacy` — the Privacy Policy, in the owner's canvas legal layout (D680).
 *
 * The text is the page's own, as it read before D680 (option A on #1554):
 * sections 0 to 9 (section 9, Google user data, added for Google's OAuth
 * verification in D1379; contact moved to 10), their headings in sentence case, and its date as "Last
 * updated". The canvas's policy waits on the owner and counsel; see
 * LegalDocument. D8831 carries the owner-approved factual corrections, including the three
 * cookie categories; regulatory claims remain for counsel on #5511.
 */
export const PRIVACY_UPDATED = 'November 27, 2026';
export const PRIVACY_EMAIL = 'privacy@axal.vc';

const INTRO = (
  <>
    <p>
      Data Controller: <strong>Axal VC Management LLC</strong>, a Delaware limited liability company.
    </p>
    <p><strong>Axal VC Management LLC</strong> ("Axal VC Management", "we", or "us") is the operator of the Axal VC StudioOS platform and the data controller for personal information collected through <code>axal.vc</code>. We recognize that our investors and founders entrust us with highly sensitive financial and personal information. This Privacy Policy explains how we collect, protect, and use your information in compliance with the Gramm-Leach-Bliley Act (GLBA), SEC Regulation S-P, and applicable state and international privacy laws (CCPA/GDPR).</p>
  </>
);

const SECTIONS = [
  {
    n: '00',
    h: 'Who we are',
    body: (
      <>
        <p>The Axal VC platform is operated through three Delaware limited liability companies, with the following privacy roles:</p>
        <ul>
          <li><strong>Axal VC Management LLC</strong> — data controller. Operates the Platform and is responsible for the lawful processing of your personal information.</li>
          <li><strong>Axal VC Holdings LLC</strong> — holding company. Owns brand and platform IP (including the <code>axal.vc</code> domain) but does not directly collect or process user personal data.</li>
          <li><strong>Axal VC GP LLC</strong> — general partner of Axal VC Spin-Out Lab Fund I LP. Receives investor data only where necessary for fund administration (capital calls, distributions, K-1s).</li>
        </ul>
      </>
    ),
  },
  {
    n: '01',
    h: 'Information we collect',
    body: (
      <>
        <p>We collect "Non-Public Personal Information" (NPI) to provide venture capital services and comply with federal law:</p>
        <ul>
          <li><strong>Identity Data:</strong> Full name, Social Security Number (SSN), Tax ID, passport/driver's license (for KYC/AML), and date of birth.</li>
          <li><strong>Financial Data:</strong> Net worth, accredited investor status, bank account numbers, wire instructions, and investment history.</li>
          <li><strong>Professional Data:</strong> Current firm, title, and investment sectors of interest.</li>
          <li><strong>Technical Data:</strong> IP address, browser type, and "Global Privacy Control" (GPC) signals.</li>
        </ul>
      </>
    ),
  },
  {
    n: '02',
    h: 'How we use your information',
    body: (
      <>
        <p>We process your data for the following "Business Purposes":</p>
        <ul>
          <li><strong>Onboarding:</strong> To verify your identity and suitability for private placements.</li>
          <li><strong>Transaction Processing:</strong> To facilitate capital calls, distributions, and K-1 tax reporting.</li>
          <li><strong>Compliance:</strong> To meet anti-money laundering (AML) and "know your customer" (KYC) regulatory requirements.</li>
          <li><strong>AI processing:</strong> AI-assisted analysis, matching, summaries and document workflows may involve personal data you submit or select. AI runs on Cloudflare Workers AI and AI Gateway; an external model provider receives a request only when that provider is enabled for the feature. We may use anonymized data to improve our deal-matching algorithms. We do not sell your personal data to third parties for marketing.</li>
        </ul>
      </>
    ),
  },
  {
    n: '03',
    h: 'Disclosure to third parties and affiliates',
    body: (
      <>
        <p>We only share your information with affiliates and non-affiliated third parties as permitted by law:</p>
        <ul>
          <li><strong>Affiliates:</strong> With <strong>Axal VC Holdings LLC</strong> only as necessary to administer brand/IP rights, and with <strong>Axal VC GP LLC</strong> only as necessary to operate Axal VC Spin-Out Lab Fund I LP (subscription processing, capital calls, distributions, regulatory filings).</li>
          <li><strong>Service Providers:</strong> Fund administrators, legal counsel, and KYC/AML verification vendors. These providers are contractually bound to maintain 2026 SEC-level data security standards.</li>
          <li><strong>Regulatory Bodies:</strong> When required by the SEC, FINRA, or other governmental authorities.</li>
          <li><strong>Company formation:</strong> If you request company formation in a country, information the filing needs about you and the people named in it is shared with the named formation partner that files there. The partner may carry out its own identity checks. Axal VC Management LLC arranges the service; it does not file.</li>
          <li><strong>Target Companies:</strong> Basic identity info may be shared with companies in which you are actively seeking to invest (for their cap table management).</li>
        </ul>
      </>
    ),
  },
  {
    n: '04',
    h: 'Data security & incident response',
    body: (
      <>
        <p>In accordance with the 2026 SEC Regulation S-P Safeguards Rule:</p>
        <ul>
          <li><strong>Safeguards:</strong> We maintain administrative, technical, and physical safeguards (including encryption at rest and in transit) to protect your NPI.</li>
          <li><strong>Breach Notification:</strong> In the event of a "significant security incident" involving your sensitive information, we will notify you within 30 days of discovery, as required by federal law.</li>
        </ul>
      </>
    ),
  },
  {
    n: '05',
    h: 'Your privacy rights',
    body: (
      <>
        <p>Depending on your residency (e.g., California, EU), you may have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a portable copy of the data we hold about you.</li>
          <li><strong>Correction:</strong> Request that we fix inaccurate financial or identity records.</li>
          <li><strong>Deletion:</strong> Request the deletion of your data (subject to our legal obligation to retain financial records for 5–7 years under SEC record-keeping rules).</li>
          <li><strong>Opt-Out:</strong> Opt out of "Profiling" or "Automated Decision Making" regarding investment opportunities.</li>
        </ul>
      </>
    ),
  },
  {
    n: '06',
    h: 'Retention',
    body: (
      <>
        <p>We retain your NPI for as long as your account is active and for the minimum period required by SEC and IRS regulations (typically 7 years after the dissolution of a fund or termination of a relationship).</p>
        <p>Recorded retention periods for Platform features include:</p>
        <ul>
          <li><strong>Call audio:</strong> Deleted after 30 days by default, or the period you choose where offered. Transcripts stay with their interview until you or your company delete it.</li>
          <li><strong>Referral cookies:</strong> Up to 30 days for a referral code or 90 days for a referral handle in your browser.</li>
          <li><strong>Signup measurement events:</strong> With Analytics enabled, kept for 180 days.</li>
          <li><strong>Google access tokens:</strong> Kept encrypted until you disconnect Google.</li>
        </ul>
      </>
    ),
  },
  {
    n: '07',
    h: 'Cookies & similar technologies',
    body: (
      <>
        <p>We use cookies and similar browser storage to operate StudioOS and remember your cookie choices. On your first visit, you can accept all, reject all optional categories, or choose which optional categories to enable. You can change or withdraw either optional choice at any time using <strong>Cookie preferences</strong> in the site footer.</p>
        <ul>
          <li><strong>Essential:</strong> Supports sign-in, session security and the settings you choose, including cookie preferences, and first-party error reports sent only to Axal VC. Essential storage is always on.</li>
          <li><strong>Analytics (Sign-up measurement):</strong> If you enable Analytics, we measure which signup steps are reached and which link brought you here, using a random browser ID. This measurement is sent only to Axal VC. Analytics also lets us count visits to active referral handles using a separate random ID kept in your browser for the life of that tab.</li>
          <li><strong>Marketing (Referral cookie):</strong> If you enable Marketing, a first-party cookie remembers the first referral link you use so we can credit the referrer and apply eligible offers. The cookie lasts up to <strong>30 days for a referral code</strong> or <strong>90 days for a referral handle</strong>, measured from the first qualifying use.</li>
        </ul>
        <p>Turning off Analytics stops optional analytics measurement and clears the handle visit ID from your browser. Turning off Marketing stops referral attribution through the cookie and clears it. You can still sign up with either optional category turned off.</p>
      </>
    ),
  },
  {
    n: '08',
    h: 'Interviews recorded by founders',
    body: (
      <>
        <p>Interview and meeting recording and transcription happen only with notice and, where the law requires, consent, including for participants without an account. Call audio is deleted after 30 days by default; transcripts and the findings drawn from them stay with the interview until it is deleted. A meeting provider may keep its own copy under its terms. Founders who use the Platform can record interviews with people who have no Axal VC account. <Link to="/privacy/interviews">When a founder records you</Link> says what is kept, who can read it, for how long, and how to say no or ask for deletion.</p>
      </>
    ),
  },
  {
    n: '09',
    h: 'Google user data',
    body: (
      <>
        <p>You can connect a Google account to Axal VC in Account › Connectors. Axal VC then uses Google data only for the features you turn on, and only to provide them to you:</p>
        <ul>
          <li><strong>Google Calendar:</strong> We read your calendar events to find the call you attach to an interview, and we create calendar events with a Google Meet link when you schedule a call from Axal VC.</li>
          <li><strong>Google Meet:</strong> When you start a call from Record a Session, we create the Meet meeting for you and set it so your Axal VC note-taker can join and Meet can transcribe it. After a call you attached to an interview, we read that call's participants and transcript and add them to the interview.</li>
          <li><strong>Google Drive and Google Sheets:</strong> We open only the files you choose in Google's own file picker, or the spreadsheet you connect for fund reporting.</li>
          <li><strong>Gmail:</strong> If you connect a mailbox, we send the emails you send from Axal VC through it. We do not read your inbox. An earlier connection that granted read-only Gmail access can remove it in Connectors.</li>
          <li><strong>Google Search Console:</strong> We read your site's search performance for the venture you connect it to, using read-only access.</li>
          <li><strong>Your Google profile:</strong> Your name and email address, to show which account is connected.</li>
        </ul>
        <p>Axal VC's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. In particular:</p>
        <ul>
          <li>We use Google user data only to provide and improve the features above, which you can see in the Platform.</li>
          <li>We do not sell it, use it for advertising, or use it to build user profiles for third parties.</li>
          <li>We do not use it to train generalized AI or machine-learning models.</li>
          <li>We transfer it to others only as needed to provide those features (for example, the service that transcribes a call), to comply with law, or as part of a merger or sale with notice to you.</li>
          <li>Our staff do not read it unless you ask us to, it is needed for security or to investigate abuse, or the law requires it.</li>
        </ul>
        <p><strong>Storage and deletion:</strong> Google access tokens are stored encrypted. A transcript or participant list we import is kept with the interview it belongs to until you or your company delete that interview. Disconnecting Google in Account › Connectors deletes the stored tokens and revokes Axal VC's access. You can also remove access at any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>. To ask us to delete Google data we hold, email privacy@axal.vc.</p>
      </>
    ),
  },
  {
    n: '10',
    h: 'Contact us',
    body: (
      <>
        <p>For privacy requests or to report a suspected security issue:</p>
        <p><strong>Privacy Officer</strong><br />Axal VC Management LLC<br /><strong>Email:</strong> privacy@axal.vc</p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated={PRIVACY_UPDATED}
      intro={INTRO}
      sections={SECTIONS}
      email={PRIVACY_EMAIL}
    />
  );
}
