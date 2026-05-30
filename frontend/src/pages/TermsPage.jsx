import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col pt-16">
      <PublicNav />
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full">
        <Link to="/" className="flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8">
          <ArrowLeft size={16} /> Back to Axal Ventures
        </Link>

        <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-gray-600 mb-1">Effective Date: March 31, 2026</p>
        <p className="text-gray-600 mb-8 text-sm">
          Operated by <strong>Axal VC Management LLC</strong>, a Delaware limited liability company.
          Platform IP and brand assets owned by <strong>Axal VC Holdings LLC</strong>.
          Investments in <strong>Axal VC Fund I, LP</strong> are managed by <strong>Axal VC GP LLC</strong>
          as its general partner.
        </p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. SCOPE OF SERVICE & NO ADVICE</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Platform Purpose:</strong> The Axal StudioOS platform (the "Platform") is operated by Axal VC Management LLC and is a proprietary technology tool for venture capital operations, deal flow management, and investor relations.</li>
              <li><strong>No Investment Advice:</strong> The Platform is for informational and administrative purposes only. Axal VC Management LLC is not a registered broker-dealer or investment adviser. No content on the Platform constitutes a recommendation, solicitation, or offer to buy or sell any securities or financial instruments. Offers to invest in Axal VC Fund I, LP are made only by Axal VC GP LLC through the Fund's separate subscription documents.</li>
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
              <li><strong>Ownership:</strong> The Platform's software, design, copyrighted content, domain names (including <code>axal.vc</code>), and trademarks (including "Axal", "Axal VC", and "StudioOS") are the exclusive property of <strong>Axal VC Holdings LLC</strong> and are protected by intellectual property laws. Axal VC Holdings LLC licenses these assets to Axal VC Management LLC for operation of the Platform.</li>
              <li><strong>License:</strong> Axal VC Management LLC grants you a limited, revocable, non-transferable license to use the Platform for its intended professional purpose. You may not scrape, "deep-link," or reverse-engineer any portion of the Platform.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. CONFIDENTIALITY & DATA PRIVACY</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Non-Disclosure:</strong> You will have access to "Confidential Information" (e.g., startup pitch decks, cap tables, and Axal VC Fund I, LP performance data). You agree to keep this information strictly confidential and use it solely for evaluating potential investments through the Axal network.</li>
              <li><strong>Data Handling:</strong> Axal VC Management LLC's use of your data is governed by our <Link to="/privacy" className="text-violet-600 hover:underline">Privacy Policy</Link>. You consent to the processing of your data in accordance with the Amended Regulation S-P (2026) regarding financial data protection.</li>
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
              <li><strong>"As-Is" Basis:</strong> The Platform is provided without warranties of any kind. Axal VC Management LLC does not guarantee the accuracy of data provided by third-party founders or LPs.</li>
              <li><strong>Liability Cap:</strong> To the maximum extent permitted by law, the total liability of Axal VC Management LLC and its affiliates (Axal VC Holdings LLC and Axal VC GP LLC) for any claim shall not exceed the fees paid by you to Axal VC Management LLC in the six (6) months preceding the claim.</li>
              <li><strong>Indemnity:</strong> You agree to indemnify <strong>Axal VC Management LLC</strong>, <strong>Axal VC Holdings LLC</strong>, and <strong>Axal VC GP LLC</strong> against any losses arising from your breach of these Terms or misrepresentation of your investor status.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6A. LEGAL ENTITIES & ROLES</h2>
            <p className="mb-2">The "Axal VC" platform is operated through three distinct Delaware limited liability companies, each with a specific role:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Axal VC Holdings LLC</strong> — passive holding company. Owns the brand and platform intellectual property (trademarks, copyrights, domain names including <code>axal.vc</code>), holds equity interests in subsidiaries and SPVs, and holds treasury and long-term reserves. Licenses platform IP to Axal VC Management LLC.</li>
              <li><strong>Axal VC Management LLC</strong> — operating company and your counterparty under these Terms. Operates the Platform, employs personnel and contractors, signs customer, vendor, and partner agreements, and is the data controller under the <Link to="/privacy" className="text-violet-600 hover:underline">Privacy Policy</Link>.</li>
              <li><strong>Axal VC GP LLC</strong> — general partner of <strong>Axal VC Fund I, LP</strong>. Manages the Fund, makes investment decisions, approves exits, and owes fiduciary duties to the Fund's limited partners. Axal VC GP LLC is not a party to these Terms and does not operate the Platform.</li>
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
      </main>
      <PublicFooter />
    </div>
  );
}
