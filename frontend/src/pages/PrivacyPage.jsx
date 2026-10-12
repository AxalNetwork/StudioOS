import React from 'react';
import LegalDocument from './site/LegalDocument';

/**
 * `/privacy` — the Privacy Policy, in the owner's canvas legal layout (D680).
 *
 * The text is the page's own, as it read before D680 (option A on #1554):
 * sections 0 to 8, their headings in sentence case, and its date as "Last
 * updated". The canvas's policy waits on the owner and counsel; see
 * LegalDocument. Section 7 still describes four cookie categories; the
 * preferences dialog now draws only the ones the site sets (D680), and the
 * text changes when the owner's does.
 */
export const PRIVACY_UPDATED = 'March 31, 2026';
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
          <li><strong>Axal VC GP LLC</strong> — general partner of Axal VC Fund I, LP. Receives investor data only where necessary for fund administration (capital calls, distributions, K-1s).</li>
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
          <li><strong>AI & Analytics:</strong> We may use anonymized data to improve our deal-matching algorithms. We do not sell your personal data to third parties for marketing.</li>
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
          <li><strong>Affiliates:</strong> With <strong>Axal VC Holdings LLC</strong> only as necessary to administer brand/IP rights, and with <strong>Axal VC GP LLC</strong> only as necessary to operate Axal VC Fund I, LP (subscription processing, capital calls, distributions, regulatory filings).</li>
          <li><strong>Service Providers:</strong> Fund administrators, legal counsel, and KYC/AML verification vendors. These providers are contractually bound to maintain 2026 SEC-level data security standards.</li>
          <li><strong>Regulatory Bodies:</strong> When required by the SEC, FINRA, or other governmental authorities.</li>
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
      </>
    ),
  },
  {
    n: '07',
    h: 'Cookies & similar technologies',
    body: (
      <>
        <p>We use cookies and similar browser storage to operate the Platform and to remember your preferences. On your first visit a cookie banner lets you accept all, reject all, or choose specific categories; you can change your choice at any time via the <strong>"Cookie preferences"</strong> link in our site footer. Your choice is stored in your browser. We group cookies into four categories:</p>
        <ul>
          <li><strong>Essential:</strong> Required for the Platform to function — signing in, keeping your session secure, and remembering your privacy choices. Always on; cannot be turned off.</li>
          <li><strong>Functional:</strong> Remember your preferences and settings (such as theme and layout) to improve your experience.</li>
          <li><strong>Analytics:</strong> Help us understand how the Platform is used so we can improve it. We record your preference now; the Platform does not currently load third-party analytics.</li>
          <li><strong>Advertising:</strong> Would support measuring or tailoring marketing. We record your preference now; the Platform does not currently load advertising cookies.</li>
        </ul>
      </>
    ),
  },
  {
    n: '08',
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
