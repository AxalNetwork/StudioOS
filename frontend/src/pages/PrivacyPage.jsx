import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8">
          <ArrowLeft size={16} /> Back to Axal Ventures
        </Link>

        <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-gray-600 mb-8">Last Updated: March 31, 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <p>At Axal.vc, we recognize that our investors and founders entrust us with highly sensitive financial and personal information. This Privacy Policy explains how we collect, protect, and use your information in compliance with the Gramm-Leach-Bliley Act (GLBA), SEC Regulation S-P, and applicable state and international privacy laws (CCPA/GDPR).</p>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. INFORMATION WE COLLECT</h2>
            <p>We collect "Non-Public Personal Information" (NPI) to provide venture capital services and comply with federal law:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Identity Data:</strong> Full name, Social Security Number (SSN), Tax ID, passport/driver's license (for KYC/AML), and date of birth.</li>
              <li><strong>Financial Data:</strong> Net worth, accredited investor status, bank account numbers, wire instructions, and investment history.</li>
              <li><strong>Professional Data:</strong> Current firm, title, and investment sectors of interest.</li>
              <li><strong>Technical Data:</strong> IP address, browser type, and "Global Privacy Control" (GPC) signals.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. HOW WE USE YOUR INFORMATION</h2>
            <p>We process your data for the following "Business Purposes":</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Onboarding:</strong> To verify your identity and suitability for private placements.</li>
              <li><strong>Transaction Processing:</strong> To facilitate capital calls, distributions, and K-1 tax reporting.</li>
              <li><strong>Compliance:</strong> To meet anti-money laundering (AML) and "know your customer" (KYC) regulatory requirements.</li>
              <li><strong>AI & Analytics:</strong> We may use anonymized data to improve our deal-matching algorithms. We do not sell your personal data to third parties for marketing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. DISCLOSURE TO THIRD PARTIES</h2>
            <p>We only share your information with non-affiliated third parties as permitted by law:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Service Providers:</strong> Fund administrators, legal counsel, and KYC/AML verification vendors. These providers are contractually bound to maintain 2026 SEC-level data security standards.</li>
              <li><strong>Regulatory Bodies:</strong> When required by the SEC, FINRA, or other governmental authorities.</li>
              <li><strong>Target Companies:</strong> Basic identity info may be shared with companies in which you are actively seeking to invest (for their cap table management).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. DATA SECURITY & INCIDENT RESPONSE</h2>
            <p>In accordance with the 2026 SEC Regulation S-P Safeguards Rule:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Safeguards:</strong> We maintain administrative, technical, and physical safeguards (including encryption at rest and in transit) to protect your NPI.</li>
              <li><strong>Breach Notification:</strong> In the event of a "significant security incident" involving your sensitive information, we will notify you within 30 days of discovery, as required by federal law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. YOUR PRIVACY RIGHTS</h2>
            <p>Depending on your residency (e.g., California, EU), you may have the right to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Access:</strong> Request a portable copy of the data we hold about you.</li>
              <li><strong>Correction:</strong> Request that we fix inaccurate financial or identity records.</li>
              <li><strong>Deletion:</strong> Request the deletion of your data (subject to our legal obligation to retain financial records for 5–7 years under SEC record-keeping rules).</li>
              <li><strong>Opt-Out:</strong> Opt out of "Profiling" or "Automated Decision Making" regarding investment opportunities.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. RETENTION</h2>
            <p>We retain your NPI for as long as your account is active and for the minimum period required by SEC and IRS regulations (typically 7 years after the dissolution of a fund or termination of a relationship).</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. CONTACT US</h2>
            <p>For privacy requests or to report a suspected security issue:</p>
            <p><strong>Privacy Officer</strong><br />Axal Management, LLC<br /><strong>Email:</strong> privacy@axal.vc</p>
          </section>
        </div>
      </div>
    </div>
  );
}
