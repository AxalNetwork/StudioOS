import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function RiskDisclosuresPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8">
          <ArrowLeft size={16} /> Back to Axal Ventures
        </Link>

        <h1 className="text-4xl font-bold text-gray-900 mb-2">Risk Disclosures & Disclaimers</h1>
        <p className="text-gray-600 mb-8">Last Updated: March 31, 2026</p>

        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
          <p className="text-red-900 font-semibold">
            Investment in startups involves a high degree of risk and may result in the loss of your entire investment.
          </p>
        </div>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <p>Investment in private, early-stage companies (the "Securities") involves a high degree of risk and is suitable only for sophisticated investors who can afford the loss of their entire investment. By using the Axal.vc platform (the "Platform"), you acknowledge and accept the following risks:</p>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. LOSS OF PRINCIPAL</h2>
            <p>Statistically, most startup companies fail. Investments in the Securities are highly speculative. There is no guarantee of any return on your capital, and you should not invest any funds that you cannot afford to lose entirely.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. ILLIQUIDITY AND LACK OF RESALE</h2>
            <p>Unlike stocks traded on a public exchange (like the NYSE or NASDAQ), the Securities are "restricted" and highly illiquid.</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>No Secondary Market:</strong> There is currently no active public market for the Securities.</li>
              <li><strong>Holding Period:</strong> You should expect to hold your investment for an indefinite period, often 7 to 10 years or more, until a "liquidity event" (such as an IPO or acquisition) occurs.</li>
              <li><strong>Transfer Restrictions:</strong> The Securities are subject to legal and contractual restrictions on resale. You may be prohibited from selling your interest without the express consent of the Issuer or Axal.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. DILUTION</h2>
            <p>Startup companies typically require multiple rounds of funding. Each time a company raises additional capital, it issues new shares. This will likely "dilute" your percentage of ownership and may involve the issuance of new shares with rights superior to those of your Securities (e.g., liquidation preferences).</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. LACK OF OPERATING HISTORY</h2>
            <p>Many companies featured on the Platform are in the "seed" or "early stage" of development. They may have little or no track record of revenue or profitability. Their success depends heavily on the management team's ability to execute a business plan in a competitive market.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. VALUATION SUBJECTIVITY</h2>
            <p>The "valuation" of a private company is not based on public market data. It is often a negotiation between the company and lead investors. There is no assurance that the valuation reflected on the Platform accurately represents the intrinsic value of the company or the price at which the Securities could be sold to a third party.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. NO RELIANCE ON AXAL.VC DATA</h2>
            <p>While Axal Management, LLC performs certain due diligence, we do not guarantee the accuracy or completeness of the information provided by the companies (the "Issuers").</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Forward-Looking Statements:</strong> Pitch decks and financial projections are "forward-looking statements" and are inherently unreliable. Actual results may differ materially from those projected.</li>
              <li><strong>Third-Party Info:</strong> Axal is not responsible for the truthfulness of information provided by founders or third-party data providers.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. MINORITY RIGHTS & CONTROL</h2>
            <p>As a minority investor, you will generally have no power to influence the management or decisions of the companies in which you invest. You will be relying entirely on the company's officers and directors.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. TAX CONSEQUENCES</h2>
            <p>The federal, state, and local tax consequences of private equity investments are complex. You should consult with your own tax professional regarding the implications of holding these Securities, including the timing of K-1 distributions.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
