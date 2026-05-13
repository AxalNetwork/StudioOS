import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8">
          <ArrowLeft size={16} /> Back to Axal Ventures
        </Link>

        <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-gray-600 mb-8">Effective Date: March 31, 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. SCOPE OF SERVICE & NO ADVICE</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Platform Purpose:</strong> Axal.vc is a proprietary technology tool for venture capital operations, deal flow management, and investor relations.</li>
              <li><strong>No Investment Advice:</strong> The Platform is for informational and administrative purposes only. Axal is not a registered broker-dealer or investment adviser. No content on the Platform constitutes a recommendation, solicitation, or offer to buy or sell any securities or financial instruments.</li>
              <li><strong>High Risk:</strong> You acknowledge that venture capital investments are highly illiquid and carry a risk of 100% loss of principal.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. ELIGIBILITY & COMPLIANCE (2026 STANDARDS)</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Accredited Investor Status:</strong> Access to specific deal rooms is strictly limited to "Accredited Investors" as defined in Rule 501 of Regulation D. You represent that all information provided regarding your financial status is accurate.</li>
              <li><strong>KYC/AML Requirements:</strong> In accordance with 2026 FinCEN regulations for Exempt Reporting Advisers (ERAs), you agree to provide all requested documentation for Identity Verification (KYC) and Anti-Money Laundering (AML) screening before participating in any transactions.</li>
              <li><strong>Bad Actor Disqualification:</strong> You certify that you are not subject to any "Bad Actor" disqualifications as defined under Rule 506(d).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. PROPRIETARY RIGHTS & LICENSING</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Ownership:</strong> The Platform's software, design, and trademarks (including "Axal") are the exclusive property of Axal Holding Co. and are protected by intellectual property laws.</li>
              <li><strong>License:</strong> We grant you a limited, revocable, non-transferable license to use the Platform for its intended professional purpose. You may not scrape, "deep-link," or reverse-engineer any portion of the Platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. CONFIDENTIALITY & DATA PRIVACY</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Non-Disclosure:</strong> You will have access to "Confidential Information" (e.g., startup pitch decks, cap tables, and fund performance data). You agree to keep this information strictly confidential and use it solely for evaluating potential investments through the Axal network.</li>
              <li><strong>Data Handling:</strong> Our use of your data is governed by our <Link to="/privacy" className="text-violet-600 hover:underline">Privacy Policy</Link>. You consent to the processing of your data in accordance with the Amended Regulation S-P (2026) regarding financial data protection.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. USER CONDUCT & RESTRICTIONS</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Share your login credentials with any third party.</li>
              <li>Use the Platform to solicit Axal's users for competing funds or services (Non-Solicitation).</li>
              <li>Upload any malicious code or attempt to bypass the Platform's security layers.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. LIMITATION OF LIABILITY & INDEMNITY</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>"As-Is" Basis:</strong> The Platform is provided without warranties of any kind. Axal does not guarantee the accuracy of data provided by third-party founders or LPs.</li>
              <li><strong>Liability Cap:</strong> To the maximum extent permitted by law, Axal's total liability for any claim shall not exceed the fees paid by you to Axal in the six (6) months preceding the claim.</li>
              <li><strong>Indemnity:</strong> You agree to indemnify Axal Management, LLC and Axal Holding Co. against any losses arising from your breach of these Terms or misrepresentation of your investor status.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. DISPUTE RESOLUTION</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Governing Law:</strong> These Terms are governed by the laws of the State of Delaware.</li>
              <li><strong>Arbitration:</strong> Any dispute shall be settled by binding arbitration in San Francisco, CA under the rules of the American Arbitration Association (AAA).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. MODIFICATIONS</h2>
            <p>We reserve the right to update these Terms at any time. Continued use of the Platform after an update constitutes acceptance of the revised Terms.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
